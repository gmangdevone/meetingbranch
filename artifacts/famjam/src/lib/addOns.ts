import type { AddOnPurchase, AddOnSelection, ReunionFee } from "@workspace/api-client-react";
import { isAddOnFee } from "./fees";

/** feeId -> (groupId -> valueId). Presence of a feeId key means the item is selected. */
export type AddOnPicks = Record<number, Record<string, string>>;

export type AddOnScope = "attendee" | "household";

export function scopeOf(fee: Pick<ReunionFee, "chargeType">): AddOnScope {
  return fee.chargeType === "flat" ? "household" : "attendee";
}

/** Catalog add-ons that may be newly chosen at this scope. */
export function offeredAddOns(fees: ReunionFee[], scope: AddOnScope): ReunionFee[] {
  return fees
    .filter((f) => isAddOnFee(f) && !f.retired && scopeOf(f) === scope)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function basePriceCents(fee: Pick<ReunionFee, "basePriceCents" | "amount">): number {
  return fee.basePriceCents ?? Math.round((fee.amount ?? 0) * 100);
}

export function centsLabel(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(abs % 100 === 0 ? 0 : 2)}`;
}

export function adjustmentLabel(cents: number): string {
  if (cents === 0) return "";
  return `${cents > 0 ? "+" : "-"}${centsLabel(Math.abs(cents))}`;
}

const sameChoices = (a: Record<string, string>, p: AddOnPurchase) => {
  const keys = Object.keys(a).filter((k) => a[k]);
  if (keys.length !== p.choices.length) return false;
  return p.choices.every((c) => a[c.groupId] === c.valueId);
};

export function picksFromPurchases(items: AddOnPurchase[] | null | undefined): AddOnPicks {
  const out: AddOnPicks = {};
  for (const p of items ?? []) {
    out[p.feeId] = Object.fromEntries(p.choices.map((c) => [c.groupId, c.valueId]));
  }
  return out;
}

export function picksToSelections(picks: AddOnPicks): AddOnSelection[] {
  return Object.entries(picks).map(([feeId, choices]) => ({
    feeId: Number(feeId),
    choices: Object.entries(choices)
      .filter(([, v]) => !!v)
      .map(([groupId, valueId]) => ({ groupId, valueId })),
  }));
}

/**
 * Local preview of one purchase. A saved snapshot with identical choice IDs keeps
 * its original price and labels (catalog changes never reprice). Otherwise the
 * current catalog base + adjustments apply. Returns null if not priceable.
 */
export function previewPurchase(
  fee: ReunionFee | undefined,
  feeId: number,
  choices: Record<string, string>,
  saved: AddOnPurchase[] = [],
): AddOnPurchase | null {
  const prior = saved.find((p) => p.feeId === feeId);
  if (prior && sameChoices(choices, prior)) return prior;
  if (!fee) return null;
  let cents = basePriceCents(fee);
  const out: AddOnPurchase["choices"] = [];
  for (const g of fee.optionGroups ?? []) {
    const vid = choices[g.id];
    if (!vid) continue;
    const v = g.values.find((x) => x.id === vid);
    if (!v) continue;
    cents += v.adjustmentCents;
    out.push({ groupId: g.id, valueId: v.id, groupLabel: g.label, valueLabel: v.label });
  }
  return { feeId, label: fee.label, unitPriceCents: Math.max(0, cents), choices: out };
}

export function buildPurchases(fees: ReunionFee[], picks: AddOnPicks, saved: AddOnPurchase[] = []): AddOnPurchase[] {
  const out: AddOnPurchase[] = [];
  for (const [k, choices] of Object.entries(picks)) {
    const id = Number(k);
    const p = previewPurchase(fees.find((f) => f.id === id), id, choices, saved);
    if (p) out.push(p);
  }
  return out;
}

/** True when the saved snapshot for this fee would be repriced by the current picks. */
export function isRepriced(fees: ReunionFee[], feeId: number, choices: Record<string, string>, saved: AddOnPurchase[]): boolean {
  const prior = saved.find((p) => p.feeId === feeId);
  if (!prior) return false;
  const next = previewPurchase(fees.find((f) => f.id === feeId), feeId, choices, saved);
  return !!next && next !== prior && next.unitPriceCents !== prior.unitPriceCents;
}

/** Problems that block submission: missing/inactive choices, missing mandatory items. */
export function addOnProblems(
  fees: ReunionFee[],
  picks: AddOnPicks,
  scope: AddOnScope,
  saved: AddOnPurchase[] = [],
): string[] {
  const problems: string[] = [];
  for (const fee of offeredAddOns(fees, scope)) {
    if (!fee.isOptional && !(fee.id in picks)) problems.push(`${fee.label} is required.`);
  }
  for (const [k, choices] of Object.entries(picks)) {
    const id = Number(k);
    const prior = saved.find((p) => p.feeId === id);
    if (prior && sameChoices(choices, prior)) continue; // unchanged saved purchase is always kept
    const fee = fees.find((f) => f.id === id);
    if (!fee || fee.retired) {
      problems.push(`${fee?.label ?? prior?.label ?? "An item"} is no longer offered.`);
      continue;
    }
    for (const g of fee.optionGroups ?? []) {
      const v = g.values.find((x) => x.id === choices[g.id]);
      if (!v) problems.push(`Choose a ${g.label.toLowerCase()} for ${fee.label}.`);
      else if (!v.active) problems.push(`${v.label} is no longer available for ${fee.label}.`);
    }
  }
  return problems;
}

/** Default picks for a fresh attendee/household: mandatory items, auto-choosing single-value groups. */
export function seedPicks(fees: ReunionFee[], scope: AddOnScope, current: AddOnPicks = {}): AddOnPicks {
  const out: AddOnPicks = { ...current };
  for (const fee of offeredAddOns(fees, scope)) {
    if (fee.isOptional || fee.id in out) continue;
    out[fee.id] = autoChoices(fee);
  }
  return out;
}

export function autoChoices(fee: ReunionFee): Record<string, string> {
  const c: Record<string, string> = {};
  for (const g of fee.optionGroups ?? []) {
    const act = g.values.filter((v) => v.active);
    if (act.length === 1) c[g.id] = act[0].id;
  }
  return c;
}

/** "Size: XL, Color: Navy" */
export function describeChoices(p: Pick<AddOnPurchase, "choices">): string {
  return p.choices.map((c) => `${c.groupLabel ?? c.groupId}: ${c.valueLabel ?? c.valueId}`).join(", ");
}

/** Aggregate purchases into label+variation lines with quantity and cents. */
export function aggregatePurchases(items: AddOnPurchase[]) {
  const map = new Map<string, { label: string; variation: string; quantity: number; totalCents: number }>();
  for (const p of items) {
    const variation = describeChoices(p);
    const key = `${p.feeId}|${variation}`;
    const row = map.get(key) ?? { label: p.label, variation, quantity: 0, totalCents: 0 };
    row.quantity += 1;
    row.totalCents += p.unitPriceCents;
    map.set(key, row);
  }
  return [...map.values()];
}
