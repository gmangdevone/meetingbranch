import type { ReunionFee, FeeAgeTier, AddOnPurchase } from "@workspace/api-client-react";

export interface FeeAttendee {
  includeShirt?: boolean | null;
  age?: number | null;
  /** false = opted out of dinner-classified fees. Missing means included. */
  includeDinner?: boolean | null;
  /** Server-owned dinner eligibility snapshot. Null/missing = legacy (no filter). */
  dinnerFeeIds?: number[] | null;
  /** Priced add-on purchase snapshots for this attendee (server-computed or locally built previews). */
  addOns?: AddOnPurchase[] | null;
}

/** Generic configurable add-on (merchandise etc). Never classified as shirt/dinner. */
export function isAddOnFee(fee: { isAddOn?: boolean | null }): boolean {
  return fee.isAddOn === true;
}

/** Sum of snapshot charges in cents, optionally filtered to one fee. */
export function sumAddOnCents(items: AddOnPurchase[] | null | undefined, feeId?: number): number {
  return (items ?? []).reduce((s, p) => (feeId == null || p.feeId === feeId ? s + p.unitPriceCents : s), 0);
}

type DinnerModeFee = { chargeType: string; label?: string | null; isDinner?: boolean | null; dinnerMode?: string | null };

/** Dinner fee with an explicit Hidden/Optional/Mandatory mode (null = legacy). */
export function isConfiguredDinner(fee: DinnerModeFee): boolean {
  return isDinnerFee(fee) && fee.dinnerMode != null;
}

/** Configured dinners members can see on new registrations. */
export function isVisibleDinner(fee: DinnerModeFee): boolean {
  return isConfiguredDinner(fee) && fee.dinnerMode !== "hidden";
}

/** Whether this attendee is charged for (and receives) a given dinner fee. */
export function attendeeGetsDinner(fee: { id: number } & DinnerModeFee, a: FeeAttendee): boolean {
  if (!isDinnerFee(fee)) return false;
  if (a.includeDinner === false) return false;
  return a.dinnerFeeIds == null || a.dinnerFeeIds.includes(fee.id);
}

/** Per-person shirt charges follow the attendee's shirt choice; flat fees remain household-wide. */
export function isShirtFee(fee: { chargeType: string; label?: string | null; isShirt?: boolean | null; isAddOn?: boolean | null }): boolean {
  if (fee.isAddOn) return false;
  if (fee.chargeType !== "per_person") return false;
  if (fee.isShirt != null) return fee.isShirt;
  return /\b(t[\s-]?shirts?|tee(?:[\s-]?shirts?)?)\b/i.test(fee.label ?? "");
}

/**
 * Dinner fees are per_person only. Uses the server-resolved isDinner (explicit
 * or legacy-detected); falls back to the label rule when absent. Mirrors the
 * API server copy.
 */
export function isDinnerFee(fee: { chargeType: string; label?: string | null; isDinner?: boolean | null; isAddOn?: boolean | null }): boolean {
  if (fee.isAddOn) return false;
  if (fee.chargeType !== "per_person") return false;
  if (fee.isDinner != null) return fee.isDinner;
  return /dinner/i.test(fee.label ?? "");
}

/** A mandatory fee always applies; an optional fee applies only if it was selected. */
export function feeApplies(
  fee: Pick<ReunionFee, "id" | "isOptional"> & Partial<DinnerModeFee>,
  selectedFeeIds: number[],
): boolean {
  // Configured dinners apply only when saved in the selection, even if mandatory.
  if (fee.chargeType && isConfiguredDinner(fee as DinnerModeFee)) return selectedFeeIds.includes(fee.id);
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
  fee: Pick<ReunionFee, "chargeType" | "amount" | "ageTiers"> & { id?: number; label?: string | null; isDinner?: boolean | null; isShirt?: boolean | null; isAddOn?: boolean | null },
  attendees: FeeAttendee[],
  _selectedFeeIds?: number[],
  householdAddOns: AddOnPurchase[] = [],
): number {
  // Add-ons: charges come only from priced snapshots, never from catalog price.
  if (isAddOnFee(fee)) {
    const cents = attendees.reduce((s, a) => s + sumAddOnCents(a.addOns, fee.id), 0) + sumAddOnCents(householdAddOns, fee.id);
    return cents / 100;
  }
  if (fee.chargeType === "flat") return fee.amount;
  const tiers = fee.ageTiers ?? [];
  // Dinner fees skip attendees who opted out; every other fee charges everyone.
  const charged = attendees.filter(a =>
    (!isDinnerFee(fee) || (a.includeDinner !== false &&
      (a.dinnerFeeIds == null || fee.id == null || a.dinnerFeeIds.includes(fee.id)))) &&
    (!isShirtFee(fee) || a.includeShirt !== false),
  );
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
  householdAddOns: AddOnPurchase[] | null = [],
): number {
  const base = fees.reduce(
    (sum, fee) =>
      !isAddOnFee(fee) && feeApplies(fee, selectedFeeIds) ? sum + computeFeeAmount(fee, attendees) : sum,
    0,
  );
  // Add-on snapshots are counted independently of the catalog (retired/removed items still bill).
  const addOnCents = attendees.reduce((s, a) => s + sumAddOnCents(a.addOns), 0) + sumAddOnCents(householdAddOns);
  return base + addOnCents / 100;
}

/** Human-readable label for a tier's age bracket, e.g. "9 and under", "ages 10–17", "18 and up". */
export function describeTierRange(tier: FeeAgeTier): string {
  if (tier.maxAge == null) return `${tier.minAge ?? 0} and up`;
  if (tier.minAge == null || tier.minAge <= 0) return `${tier.maxAge} and under`;
  return `ages ${tier.minAge}–${tier.maxAge}`;
}

/** Human-readable description of how a fee is charged, e.g. "$50 per person · ages 10–17: $25 · under 10: free". */
export function describeFee(fee: ReunionFee): string {
  if (isAddOnFee(fee)) {
    const base = fee.basePriceCents ?? Math.round(fee.amount * 100);
    const groups = (fee.optionGroups ?? []).map(g => g.label).join(", ");
    return `$${(base / 100).toFixed(base % 100 ? 2 : 0)} ${fee.chargeType === "flat" ? "per household" : "per person"}${groups ? ` · choose ${groups}` : ""}`;
  }
  if (fee.chargeType === "flat") return `$${fee.amount} flat`;
  const parts = [`$${fee.amount} per person`];
  for (const tier of fee.ageTiers ?? []) {
    parts.push(`${describeTierRange(tier)}: ${tier.amount === 0 ? "free" : `$${tier.amount}`}`);
  }
  return parts.join(" · ");
}
