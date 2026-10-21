import type { ReunionFee, FeeAgeTier, AddOnPurchase } from "@workspace/db";
import { catalogFee } from "./addOns";

export interface FeeAttendee {
  addOns?: AddOnPurchase[] | null;
  dinnerFeeIds?: number[] | null;
  includeShirt?: boolean | null;
  age?: number | null;
  /** false = opted out of dinner-classified fees. Missing means included. */
  includeDinner?: boolean | null;
}

/** Mirrors the frontend: flat fees are not divisible among attendees. */
export function isShirtFee(fee: { chargeType: string; label?: string | null; isShirt?: boolean | null }): boolean {
  if (fee.chargeType !== "per_person") return false;
  if (fee.isShirt != null) return fee.isShirt;
  return /\b(t[\s-]?shirts?|tee(?:[\s-]?shirts?)?)\b/i.test(fee.label ?? "");
}

/** Fields needed to classify a fee as dinner. */
export interface DinnerClassifiable {
  isAddOn?: boolean;
  id?: number;
  dinnerMode?: "hidden" | "optional" | "mandatory" | null;
  chargeType: string;
  label?: string | null;
  isDinner?: boolean | null;
  isShirt?: boolean | null;
}

/**
 * Dinner fees are per_person only (a flat fee can't be split per attendee).
 * Explicit classification wins; NULL (legacy, never classified) falls back to
 * a label containing "dinner". Mirrors the web app copy.
 */
export function isDinnerFee(fee: DinnerClassifiable): boolean {
  if (fee.isAddOn) return false;
  if (fee.chargeType !== "per_person") return false;
  if (fee.isDinner != null) return fee.isDinner;
  return /dinner/i.test(fee.label ?? "");
}

/** API shape: resolved isDinner plus where it came from. */
export function serializeFee<T extends DinnerClassifiable>(fee: T): Omit<T, "isDinner" | "isShirt"> & { isDinner: boolean; dinnerClassification: "explicit" | "detected"; isShirt: boolean; shirtClassification: "explicit" | "detected" } {
  const mapped = catalogFee(fee as unknown as ReunionFee);
  return { ...fee, ...mapped, isDinner: isDinnerFee(mapped), dinnerClassification: fee.isDinner == null ? "detected" : "explicit", isShirt: mapped.isAddOn ? false : isShirtFee(fee), shirtClassification: fee.isShirt == null ? "detected" : "explicit" };
}

/** A mandatory fee always applies; an optional fee applies only if it was selected. */
export function feeApplies(
  fee: Pick<ReunionFee, "id" | "isOptional"> & { dinnerMode?: string | null },
  selectedFeeIds: number[],
): boolean {
  return fee.dinnerMode != null ? selectedFeeIds.includes(fee.id) : !fee.isOptional || selectedFeeIds.includes(fee.id);
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
  fee: Pick<ReunionFee, "chargeType" | "amount" | "ageTiers"> & DinnerClassifiable,
  attendees: FeeAttendee[],
): number {
  if (fee.chargeType === "flat") return fee.amount;
  const tiers = fee.ageTiers ?? [];
  // Dinner fees skip attendees who opted out; every other fee charges everyone.
  const charged = attendees.filter(a =>
    (!isDinnerFee(fee) || (a.includeDinner !== false &&
      (a.dinnerFeeIds == null || (fee.id != null && a.dinnerFeeIds.includes(fee.id))))) &&
    (!isShirtFee(fee) || a.includeShirt !== false),
  );
  return charged.reduce(
    (sum, a) => sum + (tierForAge(tiers, a.age)?.amount ?? fee.amount),
    0,
  );
}

/** Total across every applicable fee for this household. */
export function computeTotal(
  fees: (Pick<ReunionFee, "id" | "isOptional" | "chargeType" | "amount" | "ageTiers"> & DinnerClassifiable)[],
  attendees: FeeAttendee[],
  selectedFeeIds: number[],
  householdAddOns: AddOnPurchase[] = [],
): number {
  const regular = fees.reduce((sum, fee) => {
    if (fee.isAddOn) return sum;
    const people = isShirtFee(fee) ? attendees.filter(a => a.addOns == null) : attendees;
    return feeApplies(fee, selectedFeeIds) ? sum + computeFeeAmount(fee, people) : sum;
  }, 0);
  return (Math.round(regular * 100) +
    attendees.flatMap(a => a.addOns ?? []).reduce((s, p) => s + p.unitPriceCents, 0) +
    householdAddOns.reduce((s, p) => s + p.unitPriceCents, 0)) / 100;
}
