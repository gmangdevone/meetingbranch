import { describe, it, expect } from "vitest";
import { computeTotal, isDinnerFee, isShirtFee } from "./fees";

// Parity with the API server copy (artifacts/api-server/src/lib/fees.dinner.test.ts).
const fee = (o: Record<string, unknown>) => ({ id: 1, reunionId: 1, sortOrder: 0, isOptional: false, chargeType: "per_person", amount: 30, ageTiers: [], label: "Fee", isDinner: false, dinnerClassification: "explicit", ...o }) as never;

describe("web fee helpers: dinner opt-out", () => {
  it("renamed shirt fees keep individual opt-outs and age tiers without splitting flat fees", () => {
    const shirt = fee({ label: "Keepsake", isShirt: true, amount: 20, isOptional: true, ageTiers: [{ minAge: 0, maxAge: 12, amount: 10 }] });
    const attendees = [{ age: 40, includeShirt: true }, { age: 35, includeShirt: false }, { age: 8 }];
    expect(isShirtFee(shirt)).toBe(true);
    expect(isShirtFee({ chargeType: "per_person", label: "T-Shirt", isShirt: false })).toBe(false);
    expect(isShirtFee({ chargeType: "per_person", label: "tee" })).toBe(true);
    expect(computeTotal([shirt], attendees, [1])).toBe(30);
    expect(computeTotal([shirt], attendees, [])).toBe(0);
    expect(computeTotal([fee({ label: "Keepsake", isShirt: true, chargeType: "flat", amount: 20 })], attendees, [])).toBe(20);
  });
  it("classification matches the server", () => {
    expect(isDinnerFee({ chargeType: "per_person", label: "Sunday Dinner" })).toBe(true);
    expect(isDinnerFee({ chargeType: "per_person", label: "Supper", isDinner: true })).toBe(true);
    expect(isDinnerFee({ chargeType: "flat", label: "Dinner", isDinner: true })).toBe(false);
  });
  it("opt-out removes only dinner shares", () => {
    const fees = [fee({ id: 1, amount: 50 }), fee({ id: 2, amount: 30, isDinner: true, ageTiers: [{ minAge: 6, maxAge: 12, amount: 20 }] })];
    expect(computeTotal(fees, [{ age: 40 }, { age: 8, includeDinner: false }], [])).toBe(50 + 50 + 30);
  });
});
