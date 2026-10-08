/**
 * Server-authoritative registration balance + confirmed-receipt ledger.
 *
 * Everything here is exact integer cents. Fees are whole dollars (x100).
 *
 *   balance = charge - sponsored - confirmed - legacyCredit   (0 when waived)
 *
 * - charge: computeTotal(fees, attendees, selected optional fees) * 100
 * - sponsored: sponsorship allocations covering this registration
 * - confirmed: live (not reversed) payment/transfer allocations
 * - legacyCredit: opening credit for registrations marked paid before the
 *   ledger existed. Before lazy initialization it is derived virtually as
 *   max(0, charge - sponsored) when payment_status = 'paid'; at
 *   initialization it is frozen into a labeled legacy_credit receipt.
 * Pending payment submissions never reduce the balance.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { computeTotal } from "./fees";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Exec = { execute: (q: any) => Promise<any> };

export class LedgerError extends Error {
  /** `code: "already_recorded"` tells clients this money may already be on the books: never retry under a new key. */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const fmtCents = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;

export const MAX_CENTS = 10_000_000; // $100,000 safety ceiling per entry

/** Parse a dollars value (number or string, up to 2 decimals) into positive cents. */
export function parseDollarsToCents(input: unknown): number | null {
  let s: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    s = String(input);
  } else if (typeof input === "string") s = input.trim().replace(/^\$/, "").replace(/,/g, "");
  else return null;
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}

/** Strict calendar date YYYY-MM-DD (rejects Feb 30, month 13, etc.). */
export function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidCents(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_CENTS;
}

export type LedgerStatus = "unpaid" | "partial" | "paid" | "waived";

export interface AttachedContributionLedger {
  id: number;
  pledgedCents: number;
  confirmedCents: number;
  outstandingCents: number;
  waived?: boolean;
}

export interface RegistrationLedger {
  registrationId: number;
  chargeCents: number;
  sponsoredCents: number;
  confirmedCents: number;
  legacyCreditCents: number;
  waived: boolean;
  waivedCents: number;
  balanceCents: number; // never negative
  creditCents: number; // confirmed money above charges, for organizer review
  pendingReportedCents: number;
  status: LedgerStatus;
  legacyPending: boolean; // legacy credit not yet frozen into the ledger
  contributions: AttachedContributionLedger[];
}

export const rows = async <T>(ex: Exec, q: ReturnType<typeof sql>): Promise<T[]> => {
  const r = await ex.execute(q);
  return (r?.rows ?? r) as T[];
};

const idList = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

export async function loadLedgers(ex: Exec, registrationIds: number[]): Promise<Map<number, RegistrationLedger>> {
  const out = new Map<number, RegistrationLedger>();
  const ids = [...new Set(registrationIds)].filter((n) => Number.isInteger(n));
  if (!ids.length) return out;
  const L = idList(ids);
  const [regs, fees, attendees, selected, sponsored, allocs, contribs, pending] = await Promise.all([
    rows<{ id: number; reunion_id: number; payment_status: string; ledger_initialized_at: Date | null }>(
      ex, sql`SELECT id, reunion_id, payment_status, ledger_initialized_at FROM registrations WHERE id IN (${L})`),
    rows<{ id: number; reunion_id: number; label: string; amount: number; charge_type: string; is_optional: boolean; age_tiers: unknown; is_dinner: boolean | null }>(
      ex, sql`SELECT f.* FROM reunion_fees f WHERE f.reunion_id IN (SELECT reunion_id FROM registrations WHERE id IN (${L}))`),
    rows<{ registration_id: number; age: number | null; include_dinner: boolean }>(ex, sql`SELECT registration_id, age, include_dinner FROM attendees WHERE registration_id IN (${L})`),
    rows<{ registration_id: number; fee_id: number }>(ex, sql`SELECT registration_id, fee_id FROM registration_fees WHERE registration_id IN (${L})`),
    rows<{ registration_id: number; cents: string }>(ex, sql`SELECT registration_id, sum(amount)*100 AS cents FROM sponsorship_allocations WHERE registration_id IN (${L}) GROUP BY registration_id`),
    rows<{ registration_id: number | null; contribution_id: number | null; kind: string; cents: string }>(ex, sql`
      SELECT a.registration_id, a.contribution_id, r.kind, sum(a.amount_cents) AS cents
      FROM payment_receipt_allocations a JOIN payment_receipts r ON r.id = a.receipt_id
      WHERE NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = r.id)
        AND (a.registration_id IN (${L}) OR a.contribution_id IN (SELECT id FROM sponsorship_contributions WHERE registration_id IN (${L}) AND source = 'registration'))
      GROUP BY a.registration_id, a.contribution_id, r.kind`),
    rows<{ id: number; registration_id: number; amount: number; amount_cents: number | null; payment_status: string }>(ex, sql`
      SELECT id, registration_id, amount, amount_cents, payment_status FROM sponsorship_contributions
      WHERE registration_id IN (${L}) AND source = 'registration' ORDER BY id`),
    rows<{ rid: number; cents: string }>(ex, sql`
      SELECT rid, sum(coalesce(s.amount_cents, s.amount * 100) - coalesce(s.branch_fee_cents, 0)) AS cents
      FROM payment_submissions s CROSS JOIN LATERAL unnest(s.registration_ids) AS rid
      WHERE rid IN (${L}) AND NOT EXISTS (
        SELECT 1 FROM payment_receipts r WHERE r.submission_id = s.id
          AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = r.id))
      GROUP BY rid`),
  ]);
  for (const reg of regs) {
    const regFees = fees
      .filter((f) => f.reunion_id === reg.reunion_id)
      .map((f) => ({ id: f.id, label: f.label, amount: f.amount, chargeType: f.charge_type, isOptional: f.is_optional, ageTiers: f.age_tiers, isDinner: f.is_dinner }));
    const chargeCents =
      computeTotal(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        regFees as any,
        attendees.filter((a) => a.registration_id === reg.id).map((a) => ({ age: a.age, includeDinner: a.include_dinner })),
        selected.filter((s) => s.registration_id === reg.id).map((s) => s.fee_id),
      ) * 100;
    const sponsoredCents = Number(sponsored.find((s) => s.registration_id === reg.id)?.cents ?? 0);
    const initialized = !!reg.ledger_initialized_at;
    let confirmedCents = 0;
    let legacyCreditCents = 0;
    for (const a of allocs) {
      if (a.registration_id !== reg.id || a.contribution_id != null) continue;
      if (a.kind === "legacy_credit") legacyCreditCents += Number(a.cents);
      else confirmedCents += Number(a.cents);
    }
    const legacyPending = !initialized && reg.payment_status === "paid";
    if (legacyPending) legacyCreditCents += Math.max(0, chargeCents - sponsoredCents - confirmedCents);
    const contributions = contribs
      .filter((c) => c.registration_id === reg.id)
      .map((c) => {
        const pledgedCents = c.amount_cents ?? c.amount * 100;
        let confirmed = allocs
          .filter((a) => a.contribution_id === c.id)
          .reduce((s, a) => s + Number(a.cents), 0);
        // Waived chip-ins (organizer decision) owe nothing and never count as
        // received money: confirmed stays whatever receipts actually allocated.
        if (c.payment_status === "waived") return { id: c.id, pledgedCents, confirmedCents: confirmed, outstandingCents: 0, waived: true };
        if (!initialized && c.payment_status === "paid") confirmed = Math.max(confirmed, pledgedCents);
        return { id: c.id, pledgedCents, confirmedCents: confirmed, outstandingCents: Math.max(0, pledgedCents - confirmed), waived: false };
      });
    const waived = reg.payment_status === "waived";
    const net = chargeCents - sponsoredCents - confirmedCents - legacyCreditCents;
    const waivedCents = waived ? Math.max(0, net) : 0;
    const balanceCents = waived ? 0 : Math.max(0, net);
    const creditCents = Math.max(0, -net);
    const paidCents = confirmedCents + legacyCreditCents;
    const status: LedgerStatus = waived
      ? "waived"
      : balanceCents === 0 && (chargeCents > 0 || paidCents > 0 || sponsoredCents > 0)
        ? "paid"
        : paidCents > 0 || sponsoredCents > 0
          ? "partial"
          : "unpaid";
    out.set(reg.id, {
      registrationId: reg.id,
      chargeCents,
      sponsoredCents,
      confirmedCents,
      legacyCreditCents,
      waived,
      waivedCents,
      balanceCents,
      creditCents,
      pendingReportedCents: Number(pending.find((p) => p.rid === reg.id)?.cents ?? 0),
      status,
      legacyPending,
      contributions,
    });
  }
  return out;
}

export async function loadLedger(ex: Exec, registrationId: number) {
  return (await loadLedgers(ex, [registrationId])).get(registrationId) ?? null;
}

/**
 * Freeze a legacy paid registration into an explicit, labeled opening credit.
 * Must be called inside the money-changing transaction, before reading
 * balances for validation. Idempotent; takes a row lock on the registration.
 */
export async function ensureLedgerInitialized(tx: Exec, registrationId: number, actor: string) {
  const [reg] = await rows<{ id: number; reunion_id: number; payment_status: string; ledger_initialized_at: Date | null }>(
    tx, sql`SELECT id, reunion_id, payment_status, ledger_initialized_at FROM registrations WHERE id = ${registrationId} FOR UPDATE`);
  if (!reg || reg.ledger_initialized_at) return;
  if (reg.payment_status === "paid") {
    const ledger = await loadLedger(tx, registrationId);
    const parts: { registrationId: number | null; contributionId: number | null; cents: number }[] = [];
    if (ledger && ledger.legacyCreditCents > 0) parts.push({ registrationId, contributionId: null, cents: ledger.legacyCreditCents });
    for (const c of ledger?.contributions ?? []) {
      if (c.confirmedCents > 0) parts.push({ registrationId, contributionId: c.id, cents: c.confirmedCents });
    }
    const total = parts.reduce((s, p) => s + p.cents, 0);
    if (total > 0) {
      const [receipt] = await rows<{ id: number }>(tx, sql`
        INSERT INTO payment_receipts (reunion_id, kind, amount_cents, note, recorded_by)
        VALUES (${reg.reunion_id}, 'legacy_credit', ${total}, 'Opening credit: marked paid before itemized receipts. Original method and date were not recorded.', ${actor})
        RETURNING id`);
      for (const p of parts) {
        await tx.execute(sql`INSERT INTO payment_receipt_allocations (receipt_id, reunion_id, registration_id, contribution_id, amount_cents)
          VALUES (${receipt.id}, ${reg.reunion_id}, ${p.registrationId}, ${p.contributionId}, ${p.cents})`);
      }
    }
  }
  await tx.execute(sql`UPDATE registrations SET ledger_initialized_at = now() WHERE id = ${registrationId}`);
}

export async function ensureReunionLedgersInitialized(tx: Exec, reunionId: number, actor: string) {
  const regs = await rows<{ id: number }>(tx, sql`SELECT id FROM registrations WHERE reunion_id = ${reunionId} AND ledger_initialized_at IS NULL ORDER BY id`);
  for (const r of regs) await ensureLedgerInitialized(tx, r.id, actor);
}

/**
 * Keep the legacy payment_status columns consistent with the ledger so older
 * filters and aggregates agree. Waived is an organizer decision and is kept.
 */
export async function syncLedgerStatus(tx: Exec, registrationId: number) {
  const l = await loadLedger(tx, registrationId);
  if (!l) return;
  if (!l.waived) {
    const next = l.status === "paid" && l.chargeCents > 0 ? "paid" : "pending";
    await tx.execute(sql`UPDATE registrations SET payment_status = ${next} WHERE id = ${registrationId} AND payment_status <> 'waived'`);
  }
  for (const c of l.contributions) {
    const next = c.confirmedCents >= c.pledgedCents ? "paid" : "pending";
    await tx.execute(sql`UPDATE sponsorship_contributions SET payment_status = ${next} WHERE id = ${c.id} AND payment_status <> 'waived'`);
  }
}

/**
 * Fund balance in cents. Standalone and cancellation contributions count when
 * paid. Registration-attached chip-ins count only their confirmed receipt
 * allocations (or their legacy paid status before ledger initialization).
 */
export async function fundBalanceCents(ex: Exec, reunionId: number) {
  const [r] = await rows<{ contributed: string; allocated: string; pending: string }>(ex, sql`
    SELECT
      (SELECT coalesce(sum(coalesce(c.amount_cents, c.amount * 100)), 0) FROM sponsorship_contributions c
        LEFT JOIN registrations g ON g.id = c.registration_id
        WHERE c.reunion_id = ${reunionId} AND c.payment_status = 'paid'
          AND (c.source <> 'registration' OR c.registration_id IS NULL OR g.ledger_initialized_at IS NULL))
      +
      (SELECT coalesce(sum(a.amount_cents), 0) FROM payment_receipt_allocations a
        JOIN sponsorship_contributions c ON c.id = a.contribution_id
        WHERE a.reunion_id = ${reunionId} AND c.source = 'registration'
          AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = a.receipt_id)) AS contributed,
      (SELECT coalesce(sum(amount), 0) * 100 FROM sponsorship_allocations WHERE reunion_id = ${reunionId} AND funded_from = 'fund') AS allocated,
      -- Pending: standalone/cancellation pledges are all-or-nothing (whole
      -- pledge while pending). Attached chip-ins owe pledge minus live receipt
      -- allocations; waived owe nothing; legacy paid (pre-ledger) owe nothing.
      (SELECT coalesce(sum(coalesce(c.amount_cents, c.amount * 100)), 0) FROM sponsorship_contributions c
        WHERE c.reunion_id = ${reunionId} AND c.payment_status = 'pending'
          AND NOT (c.source = 'registration' AND c.registration_id IS NOT NULL))
      +
      (SELECT coalesce(sum(greatest(0, coalesce(c.amount_cents, c.amount * 100) - coalesce((
          SELECT sum(a.amount_cents) FROM payment_receipt_allocations a
          WHERE a.contribution_id = c.id
            AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = a.receipt_id)), 0))), 0)
        FROM sponsorship_contributions c JOIN registrations g ON g.id = c.registration_id
        WHERE c.reunion_id = ${reunionId} AND c.source = 'registration' AND g.status = 'active'
          AND c.payment_status <> 'waived'
          AND NOT (g.ledger_initialized_at IS NULL AND c.payment_status = 'paid')) AS pending`);
  const contributed = Number(r.contributed);
  const allocated = Number(r.allocated);
  return { contributedCents: contributed, allocatedCents: allocated, balanceCents: contributed - allocated, pendingCents: Number(r.pending) };
}

export async function lockReunionRow(tx: Exec, reunionId: number) {
  await tx.execute(sql`SELECT id FROM reunions WHERE id = ${reunionId} FOR UPDATE`);
}

export const defaultExec: Exec = db;
