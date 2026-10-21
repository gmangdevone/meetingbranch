import { describe, it, expect } from "vitest";
import type { ReunionFee } from "@workspace/db";
import { catalogFee, hydrateAddOns, resolveAddOns, validateCatalog } from "./addOns";
import { computeTotal } from "./fees";

const groups = [
  { id: "size", label: "Size", values: ["S", "M", "L", "XL", "2XL", "3XL"].map((label, i) => ({ id: label, label, adjustmentCents: i < 3 ? 0 : 300, active: true })) },
];
const fee = (extra: Partial<ReunionFee> = {}): ReunionFee => ({
  id: 10, reunionId: 1, label: "An editable item", chargeType: "per_person", isOptional: true,
  amount: 10, ageTiers: [], sortOrder: 0, isDinner: false, dinnerMode: null, isShirt: false,
  isAddOn: true, basePriceCents: 1000, retired: false, optionGroups: groups, ...extra,
});
const pick = (size: string) => ({ feeId: 10, choices: [{ groupId: "size", valueId: size }] });
describe("generic add-on pricing", () => {
  it.each([["S", 1000], ["M", 1000], ["L", 1000], ["XL", 1300], ["2XL", 1300], ["3XL", 1300]])("prices %s at %i cents", (size, cents) => {
    const result = resolveAddOns([fee()], [{ name: "A", addOns: [pick(String(size))] }], []);
    expect(result.attendees[0].addOns[0].unitPriceCents).toBe(cents);
    expect(computeTotal([fee()], result.attendees, [], result.addOns)).toBe(Number(cents) / 100);
  });
  it("adds independent color/material adjustments, without using the label", () => {
    const f = fee({ label: "Coffee mug", optionGroups: [...groups, { id: "material", label: "Material", values: [{ id: "steel", label: "Steel", active: true, adjustmentCents: 225 }] }] });
    const result = resolveAddOns([f], [{ name: "A", addOns: [{ feeId: 10, choices: [...pick("XL").choices, { groupId: "material", valueId: "steel" }] }] }], []);
    expect(result.attendees[0].addOns[0].unitPriceCents).toBe(1525);
  });
  it("does not require options on declined optional items, but enforces mandatory options", () => {
    expect(resolveAddOns([fee()], [{ name: "A", addOns: [] }], []).attendees[0].addOns).toEqual([]);
    expect(() => resolveAddOns([fee({ isOptional: false })], [{ name: "A", addOns: [] }], [])).toThrow(/required add-on/);
    expect(resolveAddOns([fee({ isOptional: false, optionGroups: [] })], [{ name: "A" }], []).attendees[0].addOns[0].unitPriceCents).toBe(1000);
  });
  it("keeps household purchases separate from recipients", () => {
    const f = fee({ chargeType: "flat" });
    const result = resolveAddOns([f], [{ name: "A" }, { name: "B" }], [pick("XL")]);
    expect(result.attendees.every(a => a.addOns.length === 0)).toBe(true);
    expect(computeTotal([f], result.attendees, [], result.addOns)).toBe(13);
    expect(() => resolveAddOns([f], [{ name: "A", addOns: [pick("L")] }], [])).toThrow(/recipient/);
  });
  it("rejects foreign, duplicate, inactive and missing choices and negative prices", () => {
    expect(() => resolveAddOns([fee()], [{ name: "A", addOns: [{ feeId: 999, choices: [] }] }], [])).toThrow(/event/);
    expect(() => resolveAddOns([fee()], [{ name: "A", addOns: [pick("L"), pick("L")] }], [])).toThrow(/Duplicate/);
    expect(() => resolveAddOns([fee()], [{ name: "A", addOns: [pick("bad")] }], [])).toThrow(/available/);
    expect(() => resolveAddOns([fee()], [{ name: "A", addOns: [{ feeId: 10, choices: [] }] }], [])).toThrow(/every option/);
    expect(validateCatalog([{ id: "x", label: "x", values: [{ id: "y", label: "y", active: true, adjustmentCents: -2000 }] }], 1000)).toMatch(/between/);
  });
  it("preserves immutable prices and labels after rename, option retirement or catalog change", () => {
    const old = resolveAddOns([fee()], [{ id: undefined, name: "A", addOns: [pick("XL")] }], []);
    const previous = { addOns: [], attendees: [{ ...old.attendees[0], id: 42 }] };
    const changed = fee({ label: "Jacket", basePriceCents: 2500, retired: true });
    const result = resolveAddOns([changed], [{ id: 42, name: "Renamed person", addOns: [pick("XL")] }], [], previous);
    expect(result.attendees[0].addOns[0]).toEqual(old.attendees[0].addOns[0]);
    expect(() => resolveAddOns([changed], [{ name: "New", addOns: [pick("XL")] }], [])).toThrow(/no longer/);
    const next = resolveAddOns([fee({ basePriceCents: 2500 })], [{ id: 42, name: "A", addOns: [pick("M")] }], [], previous);
    expect(next.attendees[0].addOns[0].unitPriceCents).toBe(2500);
  });
  it("maps legacy purchases but never manufactures one from a size-only record", () => {
    const oldFee = fee({ isAddOn: false, isShirt: true });
    expect(catalogFee(oldFee)).toMatchObject({ isAddOn: true, isShirt: false });
    const [a] = hydrateAddOns([oldFee], [], [{ name: "A", shirtSize: "L" }]);
    expect(a.addOns).toEqual([]);
    const [b] = hydrateAddOns([oldFee], [10], [{ name: "B", shirtSize: "XL" }]);
    expect(b.addOns[0]).toMatchObject({ unitPriceCents: 1000, choices: [{ valueId: "XL" }] });
    expect(computeTotal([oldFee], [b], [10])).toBe(10);
  });
});
