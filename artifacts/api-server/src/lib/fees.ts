import type { ReunionFee } from "@workspace/db";

export interface FeeAttendee {
  age?: number | null;
}

/** A mandatory fee always applies; an optional fee applies only if it was selected. */
export function feeApplies(
  fee: Pick<ReunionFee, "id" | "isOptional">,
  selectedFeeIds: number[],
): boolean {
  return !fee.isOptional || selectedFeeIds.includes(fee.id);
}

/**
 * How much a single fee costs a household.
 * - flat: one amount per registration (age is ignored)
 * - per_person: amount × attendees, or age-tiered when ageThreshold is set
 *   (attendees younger than the threshold pay amountUnderThreshold; a null age
 *   is treated as at-or-over, i.e. the standard amount).
 */
export function computeFeeAmount(
  fee: Pick<ReunionFee, "chargeType" | "amount" | "ageThreshold" | "amountUnderThreshold">,
  attendees: FeeAttendee[],
): number {
  if (fee.chargeType === "flat") return fee.amount;
  if (fee.ageThreshold != null && fee.amountUnderThreshold != null) {
    const threshold = fee.ageThreshold;
    const under = fee.amountUnderThreshold;
    return attendees.reduce(
      (sum, a) => sum + (a.age != null && a.age < threshold ? under : fee.amount),
      0,
    );
  }
  return fee.amount * attendees.length;
}

/** Total across every applicable fee for this household. */
export function computeTotal(
  fees: ReunionFee[],
  attendees: FeeAttendee[],
  selectedFeeIds: number[],
): number {
  return fees.reduce(
    (sum, fee) =>
      feeApplies(fee, selectedFeeIds) ? sum + computeFeeAmount(fee, attendees) : sum,
    0,
  );
}
