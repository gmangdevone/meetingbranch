import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { attachAuth } from "../middlewares/requireAdmin";
import { requireReunionManager, requireReunionPermission } from "../middlewares/requireReunionManager";
import { canManageRegistrations } from "./registrations";
import {
  type Exec,
  LedgerError,
  fmtCents,
  type RegistrationLedger,
  ensureLedgerInitialized,
  fundBalanceCents,
  isValidCents,
  isValidIsoDate,
  loadLedgers,
  lockReunionRow,
  syncLedgerStatus,
} from "../lib/ledger";

const router: IRouter = Router();
const manage = [attachAuth, requireReunionManager] as const;
const METHODS = ["cashapp", "zelle", "cash", "check", "other"] as const;


const rows = async <T>(ex: Exec, q: ReturnType<typeof sql>): Promise<T[]> => {
  const r = await ex.execute(q);
  return (r?.rows ?? r) as T[];
};


function todayPlus(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > max) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) return undefined;
  return t || null;
}

export function ledgerJson(l: RegistrationLedger) {
  return { ...l };
}

async function nameMap(ids: string[]) {
  const m = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return m;
  const r = await rows<{ id: string; first_name: string | null; last_name: string | null; email: string | null }>(
    db, sql`SELECT id, first_name, last_name, email FROM users WHERE id IN (${sql.join(uniq.map((i) => sql`${i}`), sql`, `)})`);
  for (const u of r) m.set(u.id, u.first_name ? `${u.first_name} ${u.last_name ?? ""}`.trim() : u.email || "Organizer");
  return m;
}

/** Ledger history entries touching the given registrations. */
export async function ledgerEntries(registrationIds: number[], includePrivate: boolean) {
  if (!registrationIds.length) return [];
  const L = sql.join(registrationIds.map((i) => sql`${i}`), sql`, `);
  const r = await rows<{
    id: number; kind: string; amount_cents: number; method: string | null; received_date: string | null;
    reference: string | null; note: string | null; submission_id: number | null; replaces_receipt_id: number | null;
    recorded_by: string; created_at: Date; reg_cents: string; contrib_cents: string;
    rev_reason: string | null; rev_by: string | null; rev_at: Date | null;
  }>(db, sql`
    SELECT r.id, r.kind, r.amount_cents, r.method, r.received_date, r.reference, r.note, r.submission_id,
      r.replaces_receipt_id, r.recorded_by, r.created_at,
      coalesce(sum(a.amount_cents) FILTER (WHERE a.contribution_id IS NULL AND a.registration_id IN (${L})), 0) AS reg_cents,
      coalesce(sum(a.amount_cents) FILTER (WHERE a.contribution_id IS NOT NULL AND a.registration_id IN (${L})), 0) AS contrib_cents,
      v.reason AS rev_reason, v.reversed_by AS rev_by, v.created_at AS rev_at
    FROM payment_receipts r
    JOIN payment_receipt_allocations a ON a.receipt_id = r.id
    LEFT JOIN payment_receipt_reversals v ON v.receipt_id = r.id
    WHERE r.id IN (SELECT receipt_id FROM payment_receipt_allocations WHERE registration_id IN (${L}))
    GROUP BY r.id, v.id
    ORDER BY r.created_at DESC, r.id DESC`);
  const names = includePrivate ? await nameMap(r.flatMap((e) => [e.recorded_by, e.rev_by ?? ""])) : new Map();
  return r.map((e) => ({
    id: e.id,
    kind: e.kind,
    totalCents: e.amount_cents,
    registrationCents: Number(e.reg_cents),
    contributionCents: Number(e.contrib_cents),
    method: e.method,
    receivedDate: e.received_date,
    reference: includePrivate ? e.reference : null,
    note: includePrivate || e.kind === "legacy_credit" ? e.note : null,
    submissionId: e.submission_id,
    replacesReceiptId: e.replaces_receipt_id,
    recordedByName: includePrivate ? names.get(e.recorded_by) ?? "Organizer" : null,
    createdAt: e.created_at,
    reversed: e.rev_at
      ? { at: e.rev_at, reason: includePrivate ? e.rev_reason : null, byName: includePrivate ? names.get(e.rev_by ?? "") ?? "Organizer" : null }
      : null,
  }));
}

async function pendingSubmissionsFor(registrationId: number) {
  return rows<{ id: number; method: string; amount_cents: number; created_at: Date; reference: string | null; registration_ids: number[] }>(db, sql`
    SELECT s.id, s.method, coalesce(s.amount_cents, s.amount * 100) AS amount_cents, s.created_at, s.reference, s.registration_ids
    FROM payment_submissions s
    WHERE ${registrationId} = ANY(s.registration_ids) AND NOT EXISTS (
      SELECT 1 FROM payment_receipts r WHERE r.submission_id = s.id
        AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = r.id))
    ORDER BY s.created_at DESC`);
}

// GET /registrations/:id/ledger — registrant or registration manager.
router.get("/registrations/:id/ledger", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid registration ID" });
    return;
  }
  const userId = (req as unknown as { userId: string }).userId;
  const [reg] = await rows<{ id: number; user_id: string; reunion_id: number }>(db, sql`SELECT id, user_id, reunion_id FROM registrations WHERE id = ${id}`);
  if (!reg) {
    res.status(404).json({ error: "Registration not found" });
    return;
  }
  const isManager = await canManageRegistrations(userId, reg.reunion_id);
  if (reg.user_id !== userId && !isManager) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const ledger = (await loadLedgers(db, [id])).get(id)!;
  const [entries, pending] = await Promise.all([ledgerEntries([id], isManager), pendingSubmissionsFor(id)]);
  res.json({
    ledger: ledgerJson(ledger),
    entries,
    pendingSubmissions: pending.map((p) => ({
      id: p.id, method: p.method, amountCents: Number(p.amount_cents), createdAt: p.created_at,
      reference: isManager ? p.reference : null, registrationIds: p.registration_ids,
    })),
    canManage: isManager,
  });
});

// standalone=true: a direct (unattached) fund chip-in included in a reported
// payment. Settled all-or-nothing: the allocation must equal its full pledge.
interface AllocIn { registrationId: number | null; contributionId: number | null; amountCents: number; standalone: boolean }

function parseReceiptBody(b: Record<string, unknown>) {
  if (!isValidCents(b.amountCents)) throw new LedgerError(400, "Enter an amount greater than $0.00, in dollars and cents.");
  if (typeof b.method !== "string" || !(METHODS as readonly string[]).includes(b.method)) throw new LedgerError(400, "Choose how the money was received.");
  if (!isValidIsoDate(b.receivedDate))
    throw new LedgerError(400, "Enter the date the money was received.");
  if (b.receivedDate > todayPlus(1) || b.receivedDate < "2000-01-01") throw new LedgerError(400, "The received date can't be in the future.");
  const reference = cleanText(b.reference, 120);
  const note = cleanText(b.note, 500);
  if (reference === undefined || note === undefined) throw new LedgerError(400, "Reference or note is too long or has invalid characters.");
  if (typeof b.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(b.idempotencyKey)) throw new LedgerError(400, "Missing request key. Refresh and try again.");
  if (!Array.isArray(b.allocations) || !b.allocations.length || b.allocations.length > 50) throw new LedgerError(400, "Allocate the amount to at least one registration.");
  const seen = new Set<string>();
  const allocations: AllocIn[] = b.allocations.map((raw) => {
    const a = (raw ?? {}) as Record<string, unknown>;
    const standalone = a.standaloneContributionId != null;
    if (standalone && (a.registrationId != null || a.contributionId != null)) throw new LedgerError(400, "Each allocation targets exactly one obligation.");
    const registrationId = a.registrationId == null ? null : Number(a.registrationId);
    const contributionId = standalone ? Number(a.standaloneContributionId) : a.contributionId == null ? null : Number(a.contributionId);
    if ((registrationId == null) === (contributionId == null)) throw new LedgerError(400, "Each allocation targets exactly one registration fee or one attached contribution.");
    if ((registrationId != null && !Number.isInteger(registrationId)) || (contributionId != null && !Number.isInteger(contributionId))) throw new LedgerError(400, "Invalid allocation target.");
    if (!isValidCents(a.amountCents)) throw new LedgerError(400, "Every allocation must be more than $0.00.");
    const k = registrationId != null ? `r${registrationId}` : `c${contributionId}`;
    if (seen.has(k)) throw new LedgerError(400, "Each registration or contribution may appear only once.");
    seen.add(k);
    return { registrationId, contributionId, amountCents: a.amountCents as number, standalone };
  });
  const sum = allocations.reduce((s, a) => s + a.amountCents, 0);
  if (sum !== b.amountCents) throw new LedgerError(400, `Allocations add up to ${fmtCents(sum)}, but the amount received is ${fmtCents(b.amountCents as number)}.`);
  const submissionId = b.submissionId == null ? null : Number(b.submissionId);
  const replacesReceiptId = b.replacesReceiptId == null ? null : Number(b.replacesReceiptId);
  if ((submissionId != null && !Number.isInteger(submissionId)) || (replacesReceiptId != null && !Number.isInteger(replacesReceiptId))) throw new LedgerError(400, "Invalid input");
  return { amountCents: b.amountCents as number, method: b.method, receivedDate: b.receivedDate, reference, note, idempotencyKey: b.idempotencyKey, allocations, submissionId, replacesReceiptId };
}

function sendErr(res: Response, err: unknown) {
  if (err instanceof LedgerError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") {
    res.status(409).json({ error: "This payment was already recorded. Refresh to see the latest history." });
    return true;
  }
  return false;
}

async function affectedLedgers(regIds: number[]) {
  const m = await loadLedgers(db, regIds);
  return [...m.values()].map(ledgerJson);
}

// POST /reunions/:reunionId/receipts — record (or reconcile) confirmed money.
router.post("/reunions/:reunionId/receipts", ...manage, requireReunionPermission("registration"), async (req: Request, res: Response): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const actor = req.userId!;
  try {
    const input = parseReceiptBody((req.body ?? {}) as Record<string, unknown>);
    // Idempotent retry: same key returns the original receipt.
    const [prior] = await rows<{ id: number; amount_cents: number; method: string | null; received_date: string | null; submission_id: number | null }>(db, sql`SELECT id, amount_cents, method, received_date::text AS received_date, submission_id FROM payment_receipts WHERE reunion_id = ${reunionId} AND idempotency_key = ${input.idempotencyKey}`);
    if (prior) {
      if (prior.amount_cents !== input.amountCents || prior.method !== input.method || prior.received_date !== input.receivedDate || (prior.submission_id ?? null) !== (input.submissionId ?? null))
        throw new LedgerError(409, "This request key was already used for a different payment.");
      const regs = await rows<{ registration_id: number }>(db, sql`SELECT DISTINCT registration_id FROM payment_receipt_allocations WHERE receipt_id = ${prior.id} AND registration_id IS NOT NULL`);
      res.status(200).json({ receiptId: prior.id, duplicate: true, ledgers: await affectedLedgers(regs.map((r) => r.registration_id)) });
      return;
    }
    const regIds = await db.transaction(async (tx) => {
      await lockReunionRow(tx, reunionId);
      // Resolve contribution targets to their registrations.
      const contribIds = input.allocations.filter((a) => a.contributionId != null).map((a) => a.contributionId!);
      const contribRows = contribIds.length
        ? await rows<{ id: number; registration_id: number | null; source: string; reunion_id: number; payment_status: string; amount: number; amount_cents: number | null }>(tx, sql`SELECT id, registration_id, source, reunion_id, payment_status, amount, amount_cents FROM sponsorship_contributions WHERE id IN (${sql.join(contribIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY id FOR UPDATE`)
        : [];
      const standaloneAllocs = input.allocations.filter((a) => a.standalone);
      if (standaloneAllocs.length && input.submissionId == null)
        throw new LedgerError(400, "Standalone fund chip-ins are confirmed with the reported payment that included them, or marked paid on their own.");
      for (const a of standaloneAllocs) {
        const c = contribRows.find((r) => r.id === a.contributionId);
        if (!c || c.reunion_id !== reunionId || c.source !== "direct" || c.registration_id != null)
          throw new LedgerError(400, "That chip-in is not a standalone fund chip-in in this reunion.");
        if (c.payment_status !== "pending") throw new LedgerError(409, "That fund chip-in is already settled. Refresh to see its status.");
        const full = c.amount_cents ?? c.amount * 100;
        if (a.amountCents !== full)
          throw new LedgerError(400, `Standalone chip-ins are all-or-nothing: allocate the full ${fmtCents(full)} or leave it out.`);
      }
      for (const a of input.allocations) {
        if (a.contributionId == null || a.standalone) continue;
        const c = contribRows.find((r) => r.id === a.contributionId);
        if (!c || c.reunion_id !== reunionId || c.source !== "registration" || c.registration_id == null)
          throw new LedgerError(400, "Only a sponsorship chip-in attached to a registration can share a receipt. Standalone chip-ins are confirmed on their own.");
        a.registrationId = c.registration_id;
      }
      const ids = [...new Set(input.allocations.filter((a) => !a.standalone).map((a) => a.registrationId!))].sort((x, y) => x - y);
      const regs = ids.length
        ? await rows<{ id: number; reunion_id: number; status: string; payment_status: string }>(tx, sql`SELECT id, reunion_id, status, payment_status FROM registrations WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY id FOR UPDATE`)
        : [];
      if (regs.length !== ids.length || regs.some((r) => r.reunion_id !== reunionId)) throw new LedgerError(400, "Every registration must belong to this reunion.");
      if (regs.some((r) => r.status !== "active")) throw new LedgerError(409, "A cancelled registration can't receive new payments.");
      if (regs.some((r) => r.payment_status === "waived" && input.allocations.some((a) => a.registrationId === r.id && a.contributionId == null)))
        throw new LedgerError(409, "That registration's fees are waived. Remove the waiver before recording a fee payment.");
      for (const id of ids) await ensureLedgerInitialized(tx, id, actor);

      if (input.submissionId != null) {
        const [s] = await rows<{ id: number; reunion_id: number; registration_ids: number[]; contribution_ids: number[] | null }>(tx, sql`SELECT id, reunion_id, registration_ids, contribution_ids FROM payment_submissions WHERE id = ${input.submissionId} FOR UPDATE`);
        if (!s || s.reunion_id !== reunionId) throw new LedgerError(404, "Reported payment not found.");
        const [live] = await rows<{ id: number }>(tx, sql`SELECT r.id FROM payment_receipts r WHERE r.submission_id = ${s.id} AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = r.id)`);
        if (live) throw new LedgerError(409, "This reported payment was already confirmed. Reverse that receipt first to re-confirm it.");
        if (ids.some((id) => !s.registration_ids.includes(id))) throw new LedgerError(400, "Allocate only to registrations covered by the reported payment.");
        if (standaloneAllocs.some((a) => !(s.contribution_ids ?? []).includes(a.contributionId!)))
          throw new LedgerError(400, "Allocate only to chip-ins included in the reported payment.");
      }
      if (input.replacesReceiptId != null) {
        const [o] = await rows<{ id: number; reunion_id: number; reversed: boolean; replaced: boolean }>(tx, sql`
          SELECT r.id, r.reunion_id,
            EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = r.id) AS reversed,
            EXISTS (SELECT 1 FROM payment_receipts n WHERE n.replaces_receipt_id = r.id AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v2 WHERE v2.receipt_id = n.id)) AS replaced
          FROM payment_receipts r WHERE r.id = ${input.replacesReceiptId}`);
        if (!o || o.reunion_id !== reunionId) throw new LedgerError(404, "Original receipt not found.");
        if (!o.reversed) throw new LedgerError(409, "Reverse the original receipt before recording its replacement.");
        if (o.replaced) throw new LedgerError(409, "That receipt already has a replacement.");
      }

      const ledgers = await loadLedgers(tx, ids);
      for (const a of input.allocations) {
        if (a.standalone) continue;
        const l = ledgers.get(a.registrationId!)!;
        if (a.contributionId == null) {
          if (a.amountCents > l.balanceCents)
            throw new LedgerError(409, `${fmtCents(a.amountCents)} is more than the ${fmtCents(l.balanceCents)} remaining on registration #${l.registrationId}. Excess money is not turned into a donation; record only what is owed.`);
        } else {
          const c = l.contributions.find((x) => x.id === a.contributionId)!;
          if (c?.waived) throw new LedgerError(409, "That fund chip-in was waived by an organizer; nothing is owed on it.");
          if (!c || a.amountCents > c.outstandingCents)
            throw new LedgerError(409, `${fmtCents(a.amountCents)} is more than the ${fmtCents(c?.outstandingCents ?? 0)} still owed on the attached chip-in.`);
        }
      }
      const [receipt] = await rows<{ id: number }>(tx, sql`
        INSERT INTO payment_receipts (reunion_id, kind, amount_cents, method, received_date, reference, note, submission_id, replaces_receipt_id, idempotency_key, recorded_by)
        VALUES (${reunionId}, 'payment', ${input.amountCents}, ${input.method}, ${input.receivedDate}, ${input.reference}, ${input.note}, ${input.submissionId}, ${input.replacesReceiptId}, ${input.idempotencyKey}, ${actor})
        RETURNING id`);
      for (const a of input.allocations) {
        await tx.execute(sql`INSERT INTO payment_receipt_allocations (receipt_id, reunion_id, registration_id, contribution_id, amount_cents)
          VALUES (${receipt.id}, ${reunionId}, ${a.standalone ? null : a.registrationId}, ${a.contributionId}, ${a.amountCents})`);
        // All-or-nothing: the standalone chip-in is now fully received. The fund
        // counts it once, via its paid status (receipt allocations for direct
        // chip-ins are excluded from fundBalanceCents).
        if (a.standalone) await tx.execute(sql`UPDATE sponsorship_contributions SET payment_status = 'paid' WHERE id = ${a.contributionId}`);
      }
      for (const id of ids) await syncLedgerStatus(tx, id);
      return { ids, receiptId: receipt.id };
    });
    res.status(201).json({ receiptId: regIds.receiptId, duplicate: false, ledgers: await affectedLedgers(regIds.ids) });
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

// POST /reunions/:reunionId/receipts/:receiptId/reversal — append a reversal.
router.post("/reunions/:reunionId/receipts/:receiptId/reversal", ...manage, requireReunionPermission("registration"), async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const receiptId = Number(req.params.receiptId);
  const reason = cleanText((req.body ?? {}).reason, 500);
  if (!Number.isInteger(receiptId)) {
    res.status(400).json({ error: "Invalid receipt" });
    return;
  }
  if (!reason || reason.length < 3) {
    res.status(400).json({ error: "A reason (at least 3 characters) is required to reverse a receipt." });
    return;
  }
  try {
    const ids = await db.transaction(async (tx) => {
      await lockReunionRow(tx, reunionId);
      const [r] = await rows<{ id: number; reunion_id: number }>(tx, sql`SELECT id, reunion_id FROM payment_receipts WHERE id = ${receiptId} FOR UPDATE`);
      if (!r || r.reunion_id !== reunionId) throw new LedgerError(404, "Receipt not found.");
      const [rev] = await rows<{ id: number }>(tx, sql`SELECT id FROM payment_receipt_reversals WHERE receipt_id = ${receiptId}`);
      if (rev) throw new LedgerError(409, "This receipt was already reversed.");
      const regs = await rows<{ id: number; status: string }>(tx, sql`
        SELECT g.id, g.status FROM registrations g WHERE g.id IN (SELECT registration_id FROM payment_receipt_allocations WHERE receipt_id = ${receiptId}) ORDER BY g.id FOR UPDATE`);
      if (regs.some((g) => g.status !== "active"))
        throw new LedgerError(409, "This receipt belongs to a cancelled registration whose money was already resolved (refunded or donated). It can't be reversed.");
      await tx.execute(sql`INSERT INTO payment_receipt_reversals (receipt_id, reason, reversed_by) VALUES (${receiptId}, ${reason}, ${req.userId!})`);
      // Standalone chip-ins settled by this receipt go back to pending (whole).
      await tx.execute(sql`UPDATE sponsorship_contributions SET payment_status = 'pending'
        WHERE id IN (SELECT a.contribution_id FROM payment_receipt_allocations a WHERE a.receipt_id = ${receiptId} AND a.registration_id IS NULL AND a.contribution_id IS NOT NULL)
          AND source = 'direct' AND registration_id IS NULL`);
      // Money already moved onward by a transfer can't be un-received: after
      // the proposed reversal no registration may hold negative confirmed money
      // (payments + legacy credit + signed transfers).
      const after = await loadLedgers(tx, regs.map((g) => g.id));
      for (const g of regs) {
        const l = after.get(g.id);
        if (l && l.confirmedCents + l.legacyCreditCents < 0)
          throw new LedgerError(409, `Reversing this receipt would leave registration #${g.id} with ${fmtCents(l.confirmedCents + l.legacyCreditCents)} confirmed, because that money was already transferred to another registration. Reverse the later transfer first, then reverse this receipt.`);
      }
      for (const g of regs) await syncLedgerStatus(tx, g.id);
      const fund = await fundBalanceCents(tx, reunionId);
      if (fund.balanceCents < 0)
        throw new LedgerError(409, "This receipt can't be reversed: its chip-in money was already allocated from the sponsorship fund.");
      return regs.map((g) => g.id);
    });
    res.json({ receiptId, ledgers: await affectedLedgers(ids) });
  } catch (err) {
    if (!sendErr(res, err)) throw err;
  }
});

// GET /reunions/:reunionId/receipts/export — receipt-level CSV for treasurers.
router.get("/reunions/:reunionId/receipts/export", ...manage, requireReunionPermission("registration"), async (req, res): Promise<void> => {
  const reunionId = req.managedReunion!.id;
  const r = await rows<{
    id: number; kind: string; amount_cents: number; method: string | null; received_date: string | null; reference: string | null;
    note: string | null; submission_id: number | null; replaces_receipt_id: number | null; recorded_by: string; created_at: Date;
    rev_reason: string | null; rev_at: Date | null; allocs: string | null;
  }>(db, sql`
    SELECT r.*, v.reason AS rev_reason, v.created_at AS rev_at,
      (SELECT string_agg(CASE WHEN a.contribution_id IS NULL THEN 'reg ' || a.registration_id ELSE 'chip-in ' || a.contribution_id END || ':' || to_char(a.amount_cents / 100.0, 'FM999999990.00'), '; ' ORDER BY a.id)
        FROM payment_receipt_allocations a WHERE a.receipt_id = r.id) AS allocs
    FROM payment_receipts r LEFT JOIN payment_receipt_reversals v ON v.receipt_id = r.id
    WHERE r.reunion_id = ${reunionId} ORDER BY r.created_at, r.id`);
  const names = await nameMap(r.map((x) => x.recorded_by));
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Receipt", "Kind", "Amount", "Method", "Received date", "Reference", "Allocations", "Reported payment", "Replaces", "Recorded by", "Recorded at", "Reversed at", "Reversal reason", "Note"];
  const lines = r.map((x) => [x.id, x.kind === "legacy_credit" ? "legacy opening credit" : x.kind, (x.amount_cents / 100).toFixed(2), x.method ?? "", x.received_date ?? "", x.reference, x.allocs, x.submission_id ?? "", x.replaces_receipt_id ?? "", names.get(x.recorded_by) ?? "", new Date(x.created_at).toISOString(), x.rev_at ? new Date(x.rev_at).toISOString() : "", x.rev_reason, x.note].map(esc).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="receipts-${reunionId}.csv"`);
  res.send([head.join(","), ...lines].join("\n"));
});

export default router;
