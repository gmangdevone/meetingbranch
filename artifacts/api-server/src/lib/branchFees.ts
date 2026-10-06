import { sql } from "drizzle-orm";
import { type Exec, rows } from "./ledger";

/**
 * Branch special fee: ONE shared, one-time, opt-in obligation per branch
 * (never per registration, never part of registration dues). Confirmed money
 * is receipt allocations with branch_id set; pending self-reports never
 * reduce the balance. Payers are private to organizers.
 */
export interface BranchFeeEntry {
  receiptId: number;
  kind: string;
  cents: number;
  method: string | null;
  receivedDate: string | null;
  createdAt: Date;
  reversed: boolean;
  reversalReason: string | null;
  payerRegistrationId: number | null;
  payerName: string | null;
}
export interface BranchFeeLedger {
  branchId: number;
  branchName: string;
  label: string;
  enabled: boolean;
  archived: boolean;
  amountCents: number;
  paidCents: number;
  remainingCents: number;
  creditCents: number;
  pendingReportedCents: number;
  settled: boolean;
  entries: BranchFeeEntry[];
}

export const DEFAULT_BRANCH_FEE_LABEL = "Branch fee";

type BranchRow = {
  id: number; reunion_id: number; name: string; special_fee_enabled: boolean; special_fee_label: string | null;
  special_fee_cents: number; archived_at: Date | null;
};

export async function loadBranchFeeLedgers(
  ex: Exec,
  reunionId: number,
  opts: { branchIds?: number[]; includePayers: boolean; onlyRelevant?: boolean },
): Promise<BranchFeeLedger[]> {
  const filter = opts.branchIds
    ? opts.branchIds.length ? sql`AND b.id IN (${sql.join(opts.branchIds.map((i) => sql`${i}`), sql`, `)})` : sql`AND false`
    : sql``;
  const branches = await rows<BranchRow>(ex, sql`
    SELECT b.id, b.reunion_id, b.name, b.special_fee_enabled, b.special_fee_label, b.special_fee_cents, b.archived_at
    FROM reunion_branches b WHERE b.reunion_id = ${reunionId} ${filter} ORDER BY b.sort_order, b.id`);
  if (!branches.length) return [];
  const ids = sql.join(branches.map((b) => sql`${b.id}`), sql`, `);
  const [entries, pending] = await Promise.all([
    rows<{ branch_id: number; receipt_id: number; kind: string; cents: number; method: string | null; received_date: string | null; created_at: Date; reversed: boolean; reason: string | null; payer_registration_id: number | null; first_name: string | null; last_name: string | null }>(ex, sql`
      SELECT a.branch_id, a.receipt_id, r.kind, a.amount_cents AS cents, r.method, r.received_date, r.created_at,
        (v.id IS NOT NULL) AS reversed, v.reason, a.payer_registration_id, u.first_name, u.last_name
      FROM payment_receipt_allocations a
      JOIN payment_receipts r ON r.id = a.receipt_id
      LEFT JOIN payment_receipt_reversals v ON v.receipt_id = r.id
      LEFT JOIN registrations g ON g.id = a.payer_registration_id
      LEFT JOIN users u ON u.id = g.user_id
      WHERE a.branch_id IN (${ids}) ORDER BY r.created_at, a.id`),
    rows<{ branch_id: number; cents: string }>(ex, sql`
      SELECT s.branch_fee_branch_id AS branch_id, sum(s.branch_fee_cents) AS cents FROM payment_submissions s
      WHERE s.branch_fee_branch_id IN (${ids}) AND coalesce(s.branch_fee_cents, 0) > 0
        AND NOT EXISTS (SELECT 1 FROM payment_receipts r WHERE r.submission_id = s.id
          AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = r.id))
      GROUP BY s.branch_fee_branch_id`),
  ]);
  const out: BranchFeeLedger[] = [];
  for (const b of branches) {
    const mine = entries.filter((e) => e.branch_id === b.id);
    if (opts.onlyRelevant && !b.special_fee_enabled && mine.length === 0) continue;
    const paidCents = mine.filter((e) => !e.reversed).reduce((s, e) => s + Number(e.cents), 0);
    const amountCents = b.special_fee_enabled ? b.special_fee_cents : 0;
    const remainingCents = Math.max(0, amountCents - paidCents);
    out.push({
      branchId: b.id,
      branchName: b.name,
      label: b.special_fee_label?.trim() || DEFAULT_BRANCH_FEE_LABEL,
      enabled: b.special_fee_enabled,
      archived: !!b.archived_at,
      amountCents: b.special_fee_cents,
      paidCents,
      remainingCents,
      creditCents: Math.max(0, paidCents - b.special_fee_cents),
      pendingReportedCents: Number(pending.find((p) => p.branch_id === b.id)?.cents ?? 0),
      settled: amountCents > 0 && remainingCents === 0,
      entries: mine.map((e) => ({
        receiptId: e.receipt_id,
        kind: e.kind,
        cents: Number(e.cents),
        method: e.method,
        receivedDate: e.received_date,
        createdAt: e.created_at,
        reversed: e.reversed,
        reversalReason: opts.includePayers ? e.reason : null,
        payerRegistrationId: opts.includePayers ? e.payer_registration_id : null,
        payerName: opts.includePayers ? [e.first_name, e.last_name].filter(Boolean).join(" ") || (e.payer_registration_id ? `Registration #${e.payer_registration_id}` : null) : null,
      })),
    });
  }
  return out;
}

/** The active (non-archived) branch a registration belongs to, by its stored branch name. */
export async function branchIdForRegistration(ex: Exec, registrationId: number): Promise<number | null> {
  const [b] = await rows<{ id: number }>(ex, sql`
    SELECT b.id FROM registrations g JOIN reunion_branches b ON b.reunion_id = g.reunion_id AND b.name = g.branch_name AND b.archived_at IS NULL
    WHERE g.id = ${registrationId} ORDER BY b.id LIMIT 1`);
  return b?.id ?? null;
}
