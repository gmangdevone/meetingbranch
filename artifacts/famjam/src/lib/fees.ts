import type { ReunionFee, FeeAgeTier } from "@workspace/api-client-react";

export interface FeeAttendee {
  age?: number | null;
  /** false = opted out of dinner-classified fees. Missing means included. */
  includeDinner?: boolean | null;
}

/**
 * Dinner fees are per_person only. Uses the server-resolved isDinner (explicit
 * or legacy-detected); falls back to the label rule when absent. Mirrors the
 * API server copy.
 */
export function isDinnerFee(fee: { chargeType: string; label?: string | null; isDinner?: boolean | null }): boolean {
  if (fee.chargeType !== "per_person") return false;
  if (fee.isDinner != null) return fee.isDinner;
  return /dinner/i.test(fee.label ?? "");
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
  return tiers.find(
    (t) => (t.minAge == null || age >= t.minAge) && (t.maxAge == null || age <= t.maxAge),
  );
}

/**
 * How much a single fee costs a household. Mirrors the server's fee logic.
 * - flat: one amount per registration (age ignored)
 * - per_person: each attendee pays the base amount, unless their age falls in
 *   one of the fee's age tiers, in which case they pay that tier's amount.
 *   A null age always pays the base amount.
 */
export function computeFeeAmount(
  fee: Pick<ReunionFee, "chargeType" | "amount" | "ageTiers"> & { label?: string | null; isDinner?: boolean | null },
  attendees: FeeAttendee[],
): number {
  if (fee.chargeType === "flat") return fee.amount;
  const tiers = fee.ageTiers ?? [];
  // Dinner fees skip attendees who opted out; every other fee charges everyone.
  const charged = isDinnerFee(fee) ? attendees.filter((a) => a.includeDinner !== false) : attendees;
  return charged.reduce(
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

/** Human-readable label for a tier's age bracket, e.g. "9 and under", "ages 10–17", "18 and up". */
export function describeTierRange(tier: FeeAgeTier): string {
  if (tier.maxAge == null) return `${tier.minAge ?? 0} and up`;
  if (tier.minAge == null || tier.minAge <= 0) return `${tier.maxAge} and under`;
  return `ages ${tier.minAge}–${tier.maxAge}`;
}

/** Human-readable description of how a fee is charged, e.g. "$50 per person · ages 10–17: $25 · under 10: free". */
export function describeFee(fee: ReunionFee): string {
  if (fee.chargeType === "flat") return `$${fee.amount} flat`;
  const parts = [`$${fee.amount} per person`];
  for (const tier of fee.ageTiers ?? []) {
    parts.push(`${describeTierRange(tier)}: ${tier.amount === 0 ? "free" : `$${tier.amount}`}`);
  }
  return parts.join(" · ");
}
