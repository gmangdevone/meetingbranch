import { describe, expect, it } from "vitest";
import * as server from "./fees";

for (const [name, helpers] of [["server", server]] as const) {
  describe(`${name} T-shirt fee classification`, () => {
    const fee = { id: 1, reunionId: 1, sortOrder: 0, label: "Keepsake", chargeType: "per_person" as const, amount: 20, ageTiers: [{ minAge: 0, maxAge: 12, amount: 10 }], isOptional: true, isShirt: true, shirtClassification: "explicit" as const, isDinner: false, dinnerClassification: "explicit" as const };
    it("honors explicit flags, legacy detection, and flat boundaries", () => {
      expect(helpers.isShirtFee(fee)).toBe(true);
      expect(helpers.isShirtFee({ ...fee, label: "T-shirt", isShirt: false })).toBe(false);
      for (const label of ["T-Shirt", "tee", "T shirts"]) {
        expect(helpers.isShirtFee({ ...fee, label, isShirt: null })).toBe(true);
      }
      expect(helpers.isShirtFee({ ...fee, chargeType: "flat" })).toBe(false);
    });
    it("keeps optional choices, age tiers, missing legacy choices, and opt-outs", () => {
      const attendees = [{ age: 40, includeShirt: true }, { age: 35, includeShirt: false }, { age: 8 }];
      expect(helpers.computeTotal([fee], attendees, [1])).toBe(30);
      expect(helpers.computeTotal([fee], attendees, [])).toBe(0);
      expect(helpers.computeTotal([{ ...fee, isOptional: false }], attendees, [])).toBe(30);
      expect(helpers.computeTotal([{ ...fee, chargeType: "flat" }], attendees, [1])).toBe(20);
    });
  });
}
