import { sql } from "drizzle-orm";
import { loadLedgers, rows, fmtCents, type Exec } from "./ledger";
import { loadMyElections } from "./branchFees";

/** Read only: confirmations, waivers and sponsorship are resolved by the existing ledger. */
export async function checklistAutomaticStatus(ex: Exec, reunionId: number, userId: string) {
  const registrations = await rows<{ id: number; attendee_count: number }>(ex, sql`
    SELECT id, attendee_count FROM registrations
    WHERE reunion_id = ${reunionId} AND user_id = ${userId} AND status = 'active'`);
  const ledgers = [...(await loadLedgers(ex, registrations.map(r => r.id))).values()];
  const contributions = await rows<{ cents: number; payment_status: string }>(ex, sql`
    SELECT coalesce(amount_cents, amount * 100)::int AS cents, payment_status
    FROM sponsorship_contributions WHERE reunion_id = ${reunionId}
      AND contributor_user_id = ${userId} AND registration_id IS NULL AND source = 'direct'`);
  const elections = await loadMyElections(ex, reunionId, userId);
  const collecting = elections.filter(e => e.collecting || e.status === "paid");
  const outstanding = ledgers.reduce((sum, l) => sum + l.balanceCents +
    l.contributions.reduce((s, c) => s + (c.waived ? 0 : c.outstandingCents), 0), 0)
    + contributions.filter(c => c.payment_status === "pending").reduce((sum, c) => sum + c.cents, 0)
    + collecting.filter(e => e.status !== "paid").reduce((sum, e) => sum + e.amountCents, 0);
  const hasObligations = registrations.length > 0 || contributions.length > 0 || collecting.length > 0;
  const hasConfirmedMoney = ledgers.some(l => l.confirmedCents > 0 || l.legacyCreditCents > 0 || l.contributions.some(c => c.confirmedCents > 0)) ||
    contributions.some(c => c.payment_status === "paid") || collecting.some(e => e.status === "paid");
  const awaiting = ledgers.some(l => l.pendingReportedCents > 0) || collecting.some(e => e.status === "reported");
  return {
    registration: {
      completed: registrations.some(r => r.attendee_count > 0),
      statusText: registrations.some(r => r.attendee_count > 0) ? "Attendees registered" : "Register your attendees",
    },
    payment: {
      completed: hasObligations && outstanding === 0,
      statusText: outstanding > 0
        ? `${awaiting ? "Awaiting organizer confirmation" : "Payment needed"} — ${fmtCents(outstanding)} remaining`
        : hasObligations ? (hasConfirmedMoney ? "Paid in full" : "No payment due") : "Register or choose a payable item first",
    },
  };
}
