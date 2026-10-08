import { describe, it, expect } from "vitest";
import { computeTotal, isDinnerFee } from "./fees";

// Parity with the API server copy (artifacts/api-server/src/lib/fees.dinner.test.ts).
const fee = (o: Record<string, unknown>) => ({ id: 1, reunionId: 1, sortOrder: 0, isOptional: false, chargeType: "per_person", amount: 30, ageTiers: [], label: "Fee", isDinner: false, dinnerClassification: "explicit", ...o }) as never;

describe("web fee helpers: dinner opt-out", () => {
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
