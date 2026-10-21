import { eq, asc } from "drizzle-orm";
import { db, attendeesTable, registrationsTable, reunionFeesTable, registrationFeesTable, type AddOnOptionGroup, type AddOnPurchase, type ReunionFee } from "@workspace/db";
import { computeFeeAmount, feeApplies, isShirtFee, tierForAge } from "./fees";

type Choice = { groupId: string; valueId: string };
export type AddOnSelection = { feeId: number; choices: Choice[] };
type Person = {
  id?: number; name: string; age?: number | null; shirtSize?: string | null;
  includeShirt?: boolean | null; addOns?: AddOnSelection[] | null;
};
export function isAddOn(fee: { isAddOn?: boolean; chargeType: string; isShirt?: boolean | null; label?: string | null }) {
  return fee.isAddOn === true || isShirtFee(fee);
}
export function catalogFee(fee: ReunionFee) {
  if (fee.isAddOn || !isShirtFee(fee)) return fee;
  return {
    ...fee, isAddOn: true, isShirt: false, isDinner: false,
    basePriceCents: fee.amount * 100,
    optionGroups: [{
      id: "legacy-size", label: "Size",
      values: ["XS", "S", "M", "L", "XL", "2XL", "3XL"].map(label => ({
        id: label, label, adjustmentCents: 0, active: true,
      })),
    }],
  };
}
export function legacyPurchases(fees: ReunionFee[], selected: number[], person: Person): AddOnPurchase[] {
  return fees.filter(f => !f.isAddOn && isShirtFee(f) && (!f.isOptional || selected.includes(f.id)) && person.includeShirt !== false)
    .map(f => ({
      feeId: f.id, label: f.label,
      unitPriceCents: (tierForAge(f.ageTiers ?? [], person.age)?.amount ?? f.amount) * 100,
      choices: person.shirtSize ? [{ groupId: "legacy-size", groupLabel: "Size", valueId: person.shirtSize, valueLabel: person.shirtSize }] : [],
    }));
}
export function hydrateAddOns<T extends Person>(fees: ReunionFee[], selected: number[], attendees: T[]) {
  return attendees.map(a => ({ ...a, addOns: (a.addOns ?? legacyPurchases(fees, selected, a)) as AddOnPurchase[] }));
}

export function validateCatalog(groups: AddOnOptionGroup[], base: number): string | null {
  if (!Number.isSafeInteger(base) || base < 0 || base > 100000000) return "Enter a valid add-on base price.";
  const ids = new Set<string>();
  let minimum = base, maximum = base;
  for (const g of groups) {
    if (!g.id.trim() || !g.label.trim() || ids.has(g.id)) return "Add-on option groups need unique IDs and non-empty names.";
    ids.add(g.id);
    const valueIds = new Set<string>();
    for (const v of g.values) {
      if (!v.id.trim() || !v.label.trim() || valueIds.has(v.id) || !Number.isSafeInteger(v.adjustmentCents)) return "Add-on options need unique IDs, names, and valid price adjustments.";
      valueIds.add(v.id);
    }
    const active = g.values.filter(v => v.active);
    if (!active.length) return "Each add-on option group needs at least one active choice.";
    minimum += Math.min(...active.map(v => v.adjustmentCents));
    maximum += Math.max(...active.map(v => v.adjustmentCents));
  }
  return minimum < 0 || maximum > 100000000 ? "Every add-on combination must cost between $0 and $1,000,000." : null;
}
function sameChoices(a: Choice[], b: Choice[]) {
  return a.length === b.length && a.every(c => b.some(d => d.groupId === c.groupId && d.valueId === c.valueId));
}
function resolveList(fees: ReunionFee[], input: AddOnSelection[] | undefined | null, previous: AddOnPurchase[], scope: "flat" | "per_person") {
  const selections = input ?? previous;
  const seen = new Set<number>();
  const purchases: AddOnPurchase[] = selections.map(s => {
    if (seen.has(s.feeId)) throw new Error("Duplicate add-on selection.");
    seen.add(s.feeId);
    const fee = fees.find(f => f.id === s.feeId && isAddOn(f));
    if (!fee || fee.chargeType !== scope) throw new Error("Selected add-on does not belong to this event or recipient.");
    const old = previous.find(p => p.feeId === s.feeId);
    if (new Set(s.choices.map(c => c.groupId)).size !== s.choices.length) throw new Error("Duplicate add-on option group.");
    if (old && sameChoices(s.choices, old.choices)) return old;
    if (fee.retired) throw new Error(`The add-on "${fee.label}" is no longer available.`);
    const current = catalogFee(fee);
    if (s.choices.length !== current.optionGroups.length) throw new Error(`Choose every option for add-on "${fee.label}".`);
    let price = current.basePriceCents ?? current.amount * 100;
    const choices = current.optionGroups.map(g => {
      const choice = s.choices.find(c => c.groupId === g.id);
      const v = g.values.find(v => v.id === choice?.valueId && v.active);
      if (!v) throw new Error(`Choose an available ${g.label} for add-on "${fee.label}".`);
      price += v.adjustmentCents;
      return { groupId: g.id, groupLabel: g.label, valueId: v.id, valueLabel: v.label };
    });
    if (!Number.isSafeInteger(price) || price < 0 || price > 100000000) throw new Error("Invalid add-on price.");
    return { feeId: fee.id, label: fee.label, unitPriceCents: price, choices };
  });
  for (const f of fees.filter(f => isAddOn(f) && !f.retired && !f.isOptional && f.chargeType === scope)) {
    if (!seen.has(f.id)) {
      const current = catalogFee(f);
      if (current.optionGroups.length) throw new Error(`Select the required add-on "${f.label}" and its options.`);
      purchases.push({ feeId: f.id, label: f.label, unitPriceCents: current.basePriceCents ?? current.amount * 100, choices: [] });
    }
  }
  return purchases;
}
export function resolveAddOns<T extends Person>(
  fees: ReunionFee[], attendees: T[], household: AddOnSelection[] | undefined,
  previous?: { attendees: (Person & { addOns: AddOnPurchase[] })[]; addOns: AddOnPurchase[] },
  selectedFeeIds: number[] = [],
) {
  // Already-open pages may still submit the removed shirt controls. Never
  // interpret those as an empty generic purchase list or ignore an old opt-out.
  const hasMerchandise = fees.some(isAddOn);
  const legacySelected = selectedFeeIds.some(id => fees.some(f => f.id === id && isAddOn(f)));
  if (hasMerchandise && attendees.some(a => a.addOns == null &&
    (a.includeShirt !== undefined || a.shirtSize !== undefined || legacySelected))) {
    throw new Error("The add-on form has changed. Refresh this page and choose your items again. Nothing was saved.");
  }
  const used = new Set<number>();
  return {
    addOns: resolveList(fees, household, previous?.addOns ?? [], "flat"),
    attendees: attendees.map(a => {
      const old = a.id == null
        ? previous?.attendees.find(p => p.id != null && !used.has(p.id) && p.name.trim().toLowerCase() === a.name.trim().toLowerCase())
        : previous?.attendees.find(p => p.id === a.id);
      if (a.id != null && (!old || used.has(a.id))) throw new Error("Invalid or duplicate attendee for add-on selections.");
      if (old?.id != null) used.add(old.id);
      return { ...a, shirtSize: a.shirtSize === undefined ? old?.shirtSize : a.shirtSize, includeShirt: a.includeShirt ?? old?.includeShirt ?? false, addOns: resolveList(fees, a.addOns, old?.addOns ?? [], "per_person") };
    }),
  };
}

/** Freeze legacy merchandise before any catalog mutation, including rename/removal.
 * New mandatory catalog items never retroactively become a historical purchase. */
export async function freezeAddOns(ex: Parameters<Parameters<typeof db.transaction>[0]>[0], reunionId: number) {
  const fees = await ex.select().from(reunionFeesTable).where(eq(reunionFeesTable.reunionId, reunionId));
  const regs = await ex.select().from(registrationsTable).where(eq(registrationsTable.reunionId, reunionId));
  for (const reg of regs) {
    const selected = await ex.select().from(registrationFeesTable).where(eq(registrationFeesTable.registrationId, reg.id));
    const people = await ex.select().from(attendeesTable).where(eq(attendeesTable.registrationId, reg.id)).orderBy(asc(attendeesTable.id));
    for (const a of people) {
      if (a.addOns == null) await ex.update(attendeesTable).set({ addOns: legacyPurchases(fees, selected.map(s => s.feeId), a) }).where(eq(attendeesTable.id, a.id));
    }
    if (reg.addOns == null) await ex.update(registrationsTable).set({ addOns: [] }).where(eq(registrationsTable.id, reg.id));
  }
}

/** Explicitly converting an ordinary fee must not erase its existing charges. */
export async function freezeConvertedFee(ex: Parameters<Parameters<typeof db.transaction>[0]>[0], fee: ReunionFee) {
  const regs = await ex.select().from(registrationsTable).where(eq(registrationsTable.reunionId, fee.reunionId));
  for (const r of regs) {
    const selected = await ex.select().from(registrationFeesTable).where(eq(registrationFeesTable.registrationId, r.id));
    if (!feeApplies(fee, selected.map(s => s.feeId))) continue;
    const people = await ex.select().from(attendeesTable).where(eq(attendeesTable.registrationId, r.id));
    const purchase = (amount: number): AddOnPurchase => ({ feeId: fee.id, label: fee.label, unitPriceCents: Math.round(amount * 100), choices: [] });
    if (fee.chargeType === "flat") {
      await ex.update(registrationsTable).set({ addOns: [...(r.addOns ?? []), purchase(fee.amount)] }).where(eq(registrationsTable.id, r.id));
    } else {
      for (const a of people) {
        await ex.update(attendeesTable).set({ addOns: [...(a.addOns ?? []), purchase(computeFeeAmount(fee, [a]))] }).where(eq(attendeesTable.id, a.id));
      }
    }
  }
}
