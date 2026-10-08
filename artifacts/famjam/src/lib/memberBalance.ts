import { computeTotal } from "./fees";

type Fee = Parameters<typeof computeTotal>[0][number];
type Ledger = {
  status: string;
  balanceCents: number;
  chargeCents: number;
  contributions: { outstandingCents: number }[];
};
export type MemberRegistration = {
  id: number;
  paymentStatus: string;
  attendees: Parameters<typeof computeTotal>[1];
  selectedFeeIds?: number[] | null;
  ledger?: Ledger | null;
};
export type MemberContribution = { id: number; registrationId?: number | null; paymentStatus: string; amount: number };
export type MemberBranchFee = { status: "unpaid" | "reported" | "paid"; collecting: boolean; amountCents: number };

/**
 * A member's money position in one reunion, in exact cents. The server ledger
 * is authoritative: fee balance after sponsorship, confirmed receipts and
 * waivers, plus attached chip-in cents still owed. Reported payments never
 * reduce it. Each cent is counted once: attached chip-ins only via their
 * registration ledger, standalone chip-ins only while pending.
 */
export function memberBalance<R extends MemberRegistration, C extends MemberContribution>(
  registrations: R[],
  contributions: C[],
  fees: Fee[],
  branchFees: MemberBranchFee[] = [],
) {
  const remainingCentsFor = (r: R) =>
    r.ledger
      ? r.ledger.balanceCents + r.ledger.contributions.reduce((s, c) => s + c.outstandingCents, 0)
      : r.paymentStatus === "paid" || r.paymentStatus === "waived"
        ? 0
        : Math.round(computeTotal(fees, r.attendees, r.selectedFeeIds ?? []) * 100) +
          contributions
            .filter((c) => c.registrationId === r.id && c.paymentStatus === "pending")
            .reduce((s, c) => s + Math.round(c.amount * 100), 0);
  const unpaid = registrations.filter((r) => remainingCentsFor(r) > 0);
  const pendingChipIns = contributions.filter((c) => c.registrationId == null && c.paymentStatus === "pending");
  const pendingChipInsCents = pendingChipIns.reduce((s, c) => s + Math.round(c.amount * 100), 0);
  // A report is not a confirmed receipt. Include branch fees until confirmed,
  // but do not offer another submission while their report awaits review.
  const outstandingBranchFees = branchFees.filter((f) => f.collecting && f.status !== "paid");
  const branchFeeCents = outstandingBranchFees.reduce((sum, f) => sum + f.amountCents, 0);
  const outstandingCents = unpaid.reduce((s, r) => s + remainingCentsFor(r), 0) + pendingChipInsCents + branchFeeCents;
  const settled = [
    ...registrations.map((r) => r.ledger?.status ?? r.paymentStatus),
    ...contributions.filter((c) => c.registrationId == null).map((c) => c.paymentStatus),
    ...branchFees.filter((f) => f.collecting || f.status === "paid").map((f) => f.status),
  ];
  const status: "pending" | "paid" | "waived" =
    outstandingCents > 0 || unpaid.length > 0 || pendingChipIns.length > 0
      ? "pending"
      : settled.length > 0 && settled.every((s) => s === "waived")
        ? "waived"
        : "paid";
  /** Whether the "Submit a payment" form should be offered (no recipient needed: cash is always available). */
  const canSubmitPayment = status === "pending" && (unpaid.length > 0 || pendingChipIns.length > 0 || outstandingBranchFees.some((f) => f.status === "unpaid"));
  return { remainingCentsFor, unpaid, pendingChipIns, pendingChipInsCents, branchFeeCents, outstandingCents, status, canSubmitPayment };
}
