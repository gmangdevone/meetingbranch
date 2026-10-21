import { describe, expect, it } from "vitest";
import type { ReunionFee } from "@workspace/api-client-react";
import { addOnProblems, aggregatePurchases, buildPurchases, isRepriced, seedPicks } from "./addOns";
import { computeFeeAmount, computeTotal, isDinnerFee, isShirtFee } from "./fees";

const base = { ageTiers: [], isDinner: false, isShirt: false, shirtClassification: "explicit", dinnerClassification: "explicit", reunionId: 1, sortOrder: 0 };
const tee = { ...base, id: 9, label: "T-shirt", chargeType: "per_person", amount: 10, basePriceCents: 1000, isOptional: true, isAddOn: true, retired: false,
  optionGroups: [
    { id: "size", label: "Size", values: ["S", "M", "L"].map((v) => ({ id: v, label: v, adjustmentCents: 0, active: true }))
      .concat(["XL", "2XL", "3XL"].map((v) => ({ id: v, label: v, adjustmentCents: 300, active: true }))) },
  ] } as unknown as ReunionFee;
const jacket = { ...base, id: 11, label: "Jacket", chargeType: "per_person", amount: 40, basePriceCents: 4000, isOptional: false, isAddOn: true, retired: false,
  optionGroups: [
    { id: "color", label: "Color", values: [{ id: "navy", label: "Navy", adjustmentCents: 0, active: true }, { id: "red", label: "Red", adjustmentCents: 250, active: true }] },
    { id: "mat", label: "Material", values: [{ id: "wool", label: "Wool", adjustmentCents: 1500, active: true }, { id: "poly", label: "Poly", adjustmentCents: 0, active: false }] },
  ] } as unknown as ReunionFee;
const reg = { ...base, id: 1, label: "Registration", chargeType: "per_person", amount: 50, isOptional: false } as unknown as ReunionFee;
const mug = { ...base, id: 12, label: "Mug", chargeType: "flat", amount: 6, basePriceCents: 650, isOptional: true, isAddOn: true, optionGroups: [] } as unknown as ReunionFee;
const fees = [reg, tee, jacket, mug];

describe("add-on pricing", () => {
  it("charges exactly $10 for S/M/L and $13 for XL/2XL/3XL", () => {
    for (const s of ["S", "M", "L"]) expect(buildPurchases(fees, { 9: { size: s } })[0].unitPriceCents).toBe(1000);
    for (const s of ["XL", "2XL", "3XL"]) expect(buildPurchases(fees, { 9: { size: s } })[0].unitPriceCents).toBe(1300);
  });

  it("adds combined color + material adjustments with labels", () => {
    const [p] = buildPurchases(fees, { 11: { color: "red", mat: "wool" } });
    expect(p.unitPriceCents).toBe(4000 + 250 + 1500);
    expect(p.choices.map((c) => c.valueLabel)).toEqual(["Red", "Wool"]);
  });

  it("preserves a saved price when choice ids are unchanged, reprices when changed", () => {
    const saved = [{ feeId: 9, label: "Old Tee", unitPriceCents: 700, choices: [{ groupId: "size", valueId: "XL" }] }];
    expect(buildPurchases(fees, { 9: { size: "XL" } }, saved)[0].unitPriceCents).toBe(700);
    expect(isRepriced(fees, 9, { size: "XL" }, saved)).toBe(false);
    expect(buildPurchases(fees, { 9: { size: "M" } }, saved)[0].unitPriceCents).toBe(1000);
    expect(isRepriced(fees, 9, { size: "M" }, saved)).toBe(true);
  });

  it("flags missing choices, inactive values and missing mandatory items; keeps unchanged retired saves", () => {
    expect(addOnProblems(fees, { 9: {} }, "attendee")).toEqual(expect.arrayContaining(["Choose a size for T-shirt.", "Jacket is required."]));
    expect(addOnProblems(fees, { 11: { color: "navy", mat: "poly" } }, "attendee")).toContain("Poly is no longer available for Jacket.");
    const saved = [{ feeId: 11, label: "Jacket", unitPriceCents: 4000, choices: [{ groupId: "color", valueId: "navy" }, { groupId: "mat", valueId: "poly" }] }];
    expect(addOnProblems(fees, { 11: { color: "navy", mat: "poly" } }, "attendee", saved)).toEqual([]);
    expect(addOnProblems(fees, {}, "household")).toEqual([]);
  });

  it("seeds mandatory items only at their own scope", () => {
    expect(Object.keys(seedPicks(fees, "attendee"))).toEqual(["11"]);
    expect(seedPicks(fees, "household")).toEqual({});
  });
});

describe("fee helpers with add-ons", () => {
  it("computeTotal skips add-on catalog prices and sums attendee + household snapshots", () => {
    const attendees = [
      { age: 40, addOns: buildPurchases(fees, { 9: { size: "XL" }, 11: { color: "navy", mat: "wool" } }) },
      { age: 30, addOns: [] },
    ];
    const household = buildPurchases(fees, { 12: {} });
    expect(computeTotal(fees, attendees, [], household)).toBeCloseTo(100 + 13 + 55 + 6.5);
    expect(computeTotal(fees, attendees, [9, 11, 12])).toBeCloseTo(100 + 13 + 55);
    expect(computeFeeAmount(tee, attendees)).toBe(13);
    expect(computeFeeAmount(mug, attendees, [], household)).toBe(6.5);
    expect(computeFeeAmount(reg, attendees)).toBe(100);
  });

  it("add-ons are never dinner or shirt fees, whatever their label", () => {
    const named = { ...tee, label: "Dinner T-shirt" } as ReunionFee;
    expect(isDinnerFee(named)).toBe(false);
    expect(isShirtFee(named)).toBe(false);
  });

  it("aggregates quantities per variation", () => {
    const items = [...buildPurchases(fees, { 9: { size: "XL" } }), ...buildPurchases(fees, { 9: { size: "XL" } }), ...buildPurchases(fees, { 9: { size: "M" } })];
    expect(aggregatePurchases(items)).toEqual([
      { label: "T-shirt", variation: "Size: XL", quantity: 2, totalCents: 2600 },
      { label: "T-shirt", variation: "Size: M", quantity: 1, totalCents: 1000 },
    ]);
  });
});
