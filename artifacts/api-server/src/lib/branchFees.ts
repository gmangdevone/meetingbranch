import { sql } from "drizzle-orm";
import { type Exec, rows } from "./ledger";

/**
 * Branch special fee: an optional, once-per-branch fee paid IN FULL by the one
 * member who elects it. The election (branch_fee_elections) is separate from
 * attendee registrations, so it never adds headcount or dues.
 *
 * Lifecycle: open -> elected (unpaid) -> reported (pending self-report) ->
 * paid (an organizer confirmed a receipt allocation for the full amount).
 * A reversal reopens the election as unpaid; an unpaid election can be
 * released (history kept) so someone else can elect. At most one active
 * election per branch (partial unique index), so the fee can be paid once.
 *
 * Legacy pooled money (allocations with branch_id but no election) is kept
 * with no inferred payer. If it covers the full fee the branch stays PAID
 * (once per branch); a partial amount puts the branch in legacy_review and
 * blocks new elections until an organizer reverses or settles it.
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
  legacy: boolean;
  payerName: string | null;
}
export type ElectionStatus = "unpaid" | "reported" | "paid";
export interface BranchFeeElectionSummary {
  id: number;
  status: ElectionStatus;
  amountCents: number;
  createdAt: Date;
  userName: string | null;
  userEmail: string | null;
  pendingSubmissionId: number | null;
}
export interface BranchFeeLedger {
  branchId: number;
  branchName: string;
  label: string;
  enabled: boolean;
  archived: boolean;
  amountCents: number;
  state: "off" | "open" | "elected" | "reported" | "paid" | "legacy_review";
  paidCents: number;
  legacyCents: number;
  election: BranchFeeElectionSummary | null;
  entries: BranchFeeEntry[];
}
export interface BranchFeeSummary {
  paidCount: number;
  paidCents: number;
  outstandingCount: number;
  outstandingCents: number;
  outstanding: { branchId: number; branchName: string; label: string; amountCents: number; elected: boolean }[];
}

export const DEFAULT_BRANCH_FEE_LABEL = "Branch fee";
export const feeLabel = (l: string | null | undefined) => l?.trim() || DEFAULT_BRANCH_FEE_LABEL;

type BranchRow = {
  id: number; name: string; special_fee_enabled: boolean; special_fee_label: string | null; special_fee_cents: number; archived_at: Date | null;
};
type ElectionRow = {
  id: number; branch_id: number; user_id: string; amount_cents: number; status: string; created_at: Date;
  paid: boolean; pending_submission_id: number | null; first_name: string | null; last_name: string | null; email: string | null;
};
type EntryRow = {
  branch_id: number; election_id: number | null; receipt_id: number; kind: string; cents: number; method: string | null;
  received_date: string | null; created_at: Date; reversed: boolean; reason: string | null;
  first_name: string | null; last_name: string | null;
};

const idList = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/** Elections with derived paid / pending-report state. Active ones only unless `all`. */
async function loadElections(ex: Exec, where: ReturnType<typeof sql>): Promise<ElectionRow[]> {
  return rows<ElectionRow>(ex, sql`
    SELECT e.id, e.branch_id, e.user_id, e.amount_cents, e.status, e.created_at,
      EXISTS (SELECT 1 FROM payment_receipt_allocations a WHERE a.branch_fee_election_id = e.id
        AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = a.receipt_id)) AS paid,
      (SELECT max(s.id) FROM payment_submissions s WHERE s.branch_fee_election_id = e.id
        AND NOT EXISTS (SELECT 1 FROM payment_receipts r WHERE r.submission_id = s.id
          AND NOT EXISTS (SELECT 1 FROM payment_receipt_reversals v WHERE v.receipt_id = r.id))) AS pending_submission_id,
      u.first_name, u.last_name, u.email
    FROM branch_fee_elections e LEFT JOIN users u ON u.id = e.user_id
    WHERE ${where} ORDER BY e.id`);
}

export const electionStatus = (e: Pick<ElectionRow, "paid" | "pending_submission_id">): ElectionStatus =>
  e.paid ? "paid" : e.pending_submission_id != null ? "reported" : "unpaid";

const personName = (r: { first_name: string | null; last_name: string | null }) => [r.first_name, r.last_name].filter(Boolean).join(" ") || null;

async function loadEntries(ex: Exec, branchIds: number[]): Promise<EntryRow[]> {
  return rows<EntryRow>(ex, sql`
    SELECT a.branch_id, a.branch_fee_election_id AS election_id, a.receipt_id, r.kind, a.amount_cents AS cents, r.method, r.received_date, r.created_at,
      (v.id IS NOT NULL) AS reversed, v.reason, u.first_name, u.last_name
    FROM payment_receipt_allocations a
    JOIN payment_receipts r ON r.id = a.receipt_id
    LEFT JOIN payment_receipt_reversals v ON v.receipt_id = r.id
    LEFT JOIN branch_fee_elections e ON e.id = a.branch_fee_election_id
    LEFT JOIN registrations g ON g.id = a.payer_registration_id
    LEFT JOIN users u ON u.id = coalesce(e.user_id, g.user_id)
    WHERE a.branch_id IN (${idList(branchIds)}) ORDER BY r.created_at, a.id`);
}

const toEntry = (e: EntryRow, includePayers: boolean): BranchFeeEntry => ({
  receiptId: e.receipt_id,
  kind: e.kind,
  cents: Number(e.cents),
  method: e.method,
  receivedDate: e.received_date,
  createdAt: e.created_at,
  reversed: e.reversed,
  reversalReason: includePayers ? e.reason : null,
  legacy: e.election_id == null,
  payerName: includePayers ? personName(e) : null,
});

export async function loadBranchFeeLedgers(
  ex: Exec,
  reunionId: number,
  opts: { branchIds?: number[]; includePayers: boolean },
): Promise<BranchFeeLedger[]> {
  const filter = opts.branchIds ? (opts.branchIds.length ? sql`AND b.id IN (${idList(opts.branchIds)})` : sql`AND false`) : sql``;
  const branches = await rows<BranchRow>(ex, sql`
    SELECT b.id, b.name, b.special_fee_enabled, b.special_fee_label, b.special_fee_cents, b.archived_at
    FROM reunion_branches b WHERE b.reunion_id = ${reunionId} ${filter} ORDER BY b.sort_order, b.id`);
  if (!branches.length) return [];
  const ids = branches.map((b) => b.id);
  const [entries, elections] = await Promise.all([
    loadEntries(ex, ids),
    loadElections(ex, sql`e.branch_id IN (${idList(ids)}) AND e.status = 'active'`),
  ]);
  return branches.map((b) => {
    const mine = entries.filter((e) => e.branch_id === b.id);
    const el = elections.find((e) => e.branch_id === b.id) ?? null;
    const status = el ? electionStatus(el) : null;
    const paidCents = el && status === "paid"
      ? mine.filter((e) => e.election_id === el.id && !e.reversed).reduce((s, e) => s + Number(e.cents), 0)
      : 0;
    const legacyCents = mine.filter((e) => e.election_id == null && !e.reversed).reduce((s, e) => s + Number(e.cents), 0);
    const collecting = b.special_fee_enabled && b.special_fee_cents > 0 && !b.archived_at;
    const state: BranchFeeLedger["state"] = status === "paid" ? "paid" : status === "reported" ? "reported" : status === "unpaid" ? "elected"
      : legacyCents > 0 && legacyCents >= b.special_fee_cents ? "paid" // previously confirmed pooled money covered it
      : legacyCents > 0 ? "legacy_review"
      : collecting ? "open" : "off";
    return {
      branchId: b.id,
      branchName: b.name,
      label: feeLabel(b.special_fee_label),
      enabled: b.special_fee_enabled,
      archived: !!b.archived_at,
      amountCents: b.special_fee_cents,
      state,
      paidCents: status === "paid" ? paidCents : !el && state === "paid" ? legacyCents : 0,
      legacyCents,
      election: el && status
        ? {
            id: el.id,
            status,
            amountCents: el.amount_cents,
            createdAt: el.created_at,
            userName: opts.includePayers ? personName(el) : null,
            userEmail: opts.includePayers ? el.email : null,
            pendingSubmissionId: el.pending_submission_id,
          }
        : null,
      entries: mine.map((e) => toEntry(e, opts.includePayers)),
    };
  });
}

/** Report totals. Outstanding = collecting branches (active) not yet confirmed paid. */
export function summarizeBranchFees(ledgers: BranchFeeLedger[]): BranchFeeSummary {
  const paid = ledgers.filter((l) => l.state === "paid");
  const outstanding = ledgers
    .filter((l) => !l.archived && (l.state === "open" || l.state === "elected" || l.state === "reported" || l.state === "legacy_review"))
    .map((l) => ({
      branchId: l.branchId,
      branchName: l.branchName,
      label: l.label,
      // Legacy review: only the uncollected remainder is outstanding.
      amountCents: l.state === "legacy_review" ? Math.max(0, l.amountCents - l.legacyCents) : l.election?.amountCents ?? l.amountCents,
      elected: l.election != null,
    }));
  return {
    paidCount: paid.length,
    paidCents: paid.reduce((s, l) => s + l.paidCents, 0),
    outstandingCount: outstanding.length,
    outstandingCents: outstanding.reduce((s, l) => s + l.amountCents, 0),
    outstanding,
  };
}

export interface MyBranchFeeElection {
  id: number;
  reunionId: number;
  branchId: number;
  branchName: string;
  label: string;
  amountCents: number;
  status: ElectionStatus;
  collecting: boolean;
  createdAt: Date;
  pendingSubmissionId: number | null;
  history: BranchFeeEntry[];
}

/** A member's active elections (amounts and dates only). */
export async function loadMyElections(ex: Exec, reunionId: number, userId: string, electionId?: number): Promise<MyBranchFeeElection[]> {
  const els = await loadElections(ex, electionId != null
    ? sql`e.id = ${electionId}`
    : sql`e.reunion_id = ${reunionId} AND e.user_id = ${userId} AND e.status = 'active'`);
  if (!els.length) return [];
  const branches = await rows<{ id: number; name: string; special_fee_label: string | null; special_fee_enabled: boolean; special_fee_cents: number; archived_at: Date | null }>(ex, sql`
    SELECT id, name, special_fee_label, special_fee_enabled, special_fee_cents, archived_at FROM reunion_branches WHERE id IN (${idList(els.map((e) => e.branch_id))})`);
  const entries = await loadEntries(ex, els.map((e) => e.branch_id));
  return els.map((e) => {
    const b = branches.find((x) => x.id === e.branch_id);
    return {
      id: e.id,
      reunionId,
      branchId: e.branch_id,
      branchName: b?.name ?? "Branch",
      label: feeLabel(b?.special_fee_label),
      amountCents: e.amount_cents,
      status: electionStatus(e),
      collecting: !!b && b.special_fee_enabled && b.special_fee_cents > 0 && !b.archived_at,
      createdAt: e.created_at,
      pendingSubmissionId: e.pending_submission_id,
      history: entries.filter((x) => x.election_id === e.id).map((x) => toEntry(x, false)),
    };
  });
}

export type BranchFeeOptionState = "available" | "yours_unpaid" | "yours_reported" | "yours_paid" | "paid" | "claimed" | "under_review" | "yours_disabled";

/** Registration-flow view: collecting branches and whether this member may elect. No identities. */
export async function loadBranchFeeOptions(ex: Exec, reunionId: number, userId: string) {
  const ledgers = await loadBranchFeeLedgers(ex, reunionId, { includePayers: false });
  const els = await loadElections(ex, sql`e.reunion_id = ${reunionId} AND e.status = 'active'`);
  const options: { branchId: number; branchName: string; label: string; amountCents: number; state: BranchFeeOptionState; electionId: number | null }[] = [];
  for (const l of ledgers) {
    if (l.archived) continue;
    const el = els.find((e) => e.branch_id === l.branchId);
    const own = el?.user_id === userId;
    const st = el ? electionStatus(el) : null;
    const collecting = l.enabled && l.amountCents > 0;
    let state: BranchFeeOptionState;
    if (!el) {
      if (l.state === "paid") state = "paid"; // legacy pooled money covered it
      else if (l.state === "legacy_review") state = "under_review";
      else if (l.state === "open") state = "available";
      else continue;
    } else if (own) {
      state = st === "paid" ? "yours_paid" : st === "reported" ? "yours_reported" : collecting ? "yours_unpaid" : "yours_disabled";
    } else {
      if (st !== "paid" && !collecting) continue;
      state = st === "paid" ? "paid" : "claimed";
    }
    options.push({ branchId: l.branchId, branchName: l.branchName, label: l.label, amountCents: el?.amount_cents ?? l.amountCents, state, electionId: own ? el!.id : null });
  }
  return options;
}

/** Locks and returns an active election with its derived status (call inside a reunion-locked tx). */
export async function lockElection(ex: Exec, electionId: number) {
  await ex.execute(sql`SELECT id FROM branch_fee_elections WHERE id = ${electionId} FOR UPDATE`);
  const [e] = await loadElections(ex, sql`e.id = ${electionId}`);
  if (!e) return null;
  const [b] = await rows<{ reunion_id: number; name: string; special_fee_label: string | null; special_fee_enabled: boolean; archived_at: Date | null }>(ex, sql`
    SELECT reunion_id, name, special_fee_label, special_fee_enabled, archived_at FROM reunion_branches WHERE id = ${e.branch_id}`);
  return { ...e, status_db: e.status, reunionId: b.reunion_id, branchName: b.name, label: feeLabel(b.special_fee_label), enabled: b.special_fee_enabled && !b.archived_at, status: electionStatus(e) };
}
