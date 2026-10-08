import type { ReunionFee, FeeAgeTier } from "@workspace/db";

export interface FeeAttendee {
  age?: number | null;
  /** false = opted out of dinner-classified fees. Missing means included. */
  includeDinner?: boolean | null;
}

/** Fields needed to classify a fee as dinner. */
export interface DinnerClassifiable {
  chargeType: string;
  label?: string | null;
  isDinner?: boolean | null;
}

/**
 * Dinner fees are per_person only (a flat fee can't be split per attendee).
 * Explicit classification wins; NULL (legacy, never classified) falls back to
 * a label containing "dinner". Mirrors the web app copy.
 */
export function isDinnerFee(fee: DinnerClassifiable): boolean {
  if (fee.chargeType !== "per_person") return false;
  if (fee.isDinner != null) return fee.isDinner;
  return /dinner/i.test(fee.label ?? "");
}

/** API shape: resolved isDinner plus where it came from. */
export function serializeFee<T extends DinnerClassifiable>(fee: T): Omit<T, "isDinner"> & { isDinner: boolean; dinnerClassification: "explicit" | "detected" } {
  return { ...fee, isDinner: isDinnerFee(fee), dinnerClassification: fee.isDinner == null ? "detected" : "explicit" };
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
 * How much a single fee costs a household. Mirrors the web app's fee logic.
 * - flat: one amount per registration (age is ignored)
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
  fees: (Pick<ReunionFee, "id" | "isOptional" | "chargeType" | "amount" | "ageTiers"> & { label?: string | null; isDinner?: boolean | null })[],
  attendees: FeeAttendee[],
  selectedFeeIds: number[],
): number {
  return fees.reduce(
    (sum, fee) =>
      feeApplies(fee, selectedFeeIds) ? sum + computeFeeAmount(fee, attendees) : sum,
    0,
  );
}
