import { describe, expect, it } from "vitest";
import type { ReunionFee } from "@workspace/api-client-react";
import { attendeeAddOns, registrationAddOns } from "./registrationAddOns";

const fees = [
  { id: 1, label: "Admission", isOptional: false, chargeType: "per_person", amount: 10 },
  { id: 2, label: "Dinner", isOptional: true, chargeType: "per_person", isDinner: true, amount: 20 },
  { id: 3, label: "Souvenir", isOptional: true, chargeType: "per_person", amount: 5 },
  { id: 4, label: "Family photo", isOptional: true, chargeType: "flat", amount: 15 },
] as ReunionFee[];

describe("registration add-on quantities and recipients", () => {
  it("counts per-person units and household items once, excluding dinner opt-outs", () => {
    const items = registrationAddOns(fees, [2, 3, 4, 4], [
      { age: 40, includeDinner: true }, { age: 8, includeDinner: false },
    ]);
    expect(items.map(item => [item.fee.label, item.quantity])).toEqual([
      ["Dinner", 1], ["Souvenir", 2], ["Family photo", 1],
    ]);
  });
  it("shows only the attendee's selected individual add-ons", () => {
    expect(attendeeAddOns(fees, [2, 3, 4], { includeDinner: false })).toEqual(["Souvenir"]);
    expect(attendeeAddOns(fees, [2, 3, 4], {})).toEqual(["Dinner", "Souvenir"]);
    expect(attendeeAddOns(fees, [], {})).toEqual([]);
  });
  it("does not mistake a free age tier for an opt-out", () => {
    const freeDinner = { ...fees[1], ageTiers: [{ minAge: 0, maxAge: 5, amount: 0 }] };
    expect(registrationAddOns([freeDinner], [2], [{ age: 3 }])[0].quantity).toBe(1);
  });
  it("counts and assigns T-shirts only to opted-in attendees", () => {
    const shirt = { ...fees[2], label: "T-Shirt" };
    expect(registrationAddOns([shirt], [3], [{ includeShirt: true }, { includeShirt: false }])[0].quantity).toBe(1);
    expect(attendeeAddOns([shirt], [3], { includeShirt: false })).toEqual([]);
  });
});
