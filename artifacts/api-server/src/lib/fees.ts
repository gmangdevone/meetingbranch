import type { ReunionFee, FeeAgeTier } from "@workspace/db";

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

/** The tier whose [minAge, maxAge] bracket contains this age, if any. */
export function tierForAge(
  tiers: FeeAgeTier[],
  age: number | null | undefined,
): FeeAgeTier | undefined {
  if (age == null) return undefined;
  return tiers.find((t) => age >= t.minAge && age <= t.maxAge);
}

/**
 * How much a single fee costs a household. Mirrors the web app's fee logic.
 * - flat: one amount per registration (age is ignored)
 * - per_person: each attendee pays the base amount, unless their age falls in
 *   one of the fee's age tiers, in which case they pay that tier's amount.
 *   A null age always pays the base amount.
 */
export function computeFeeAmount(
  fee: Pick<ReunionFee, "chargeType" | "amount" | "ageTiers">,
  attendees: FeeAttendee[],
): number {
  if (fee.chargeType === "flat") return fee.amount;
  const tiers = fee.ageTiers ?? [];
  return attendees.reduce(
    (sum, a) => sum + (tierForAge(tiers, a.age)?.amount ?? fee.amount),
    0,
  );
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
