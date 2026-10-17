import { describe, it, expect } from "vitest";
import { hydrateDinnerIds } from "./dinnerChoices";
import type { ReunionFee } from "@workspace/api-client-react";

const fee = { id: 7, label: "Dinner", chargeType: "per_person", isDinner: true, isOptional: false, dinnerMode: "optional" } as ReunionFee;
describe("saved dinner choice compatibility", () => {
  it("does not reselect a saved opt-out with a legacy eligibility snapshot", () => {
    expect(hydrateDinnerIds([fee], [7], { includeDinner: false, dinnerFeeIds: [7] })).toEqual([]);
  });
  it("does not select an optional legacy fee absent from the saved household", () => {
    expect(hydrateDinnerIds([{ ...fee, dinnerMode: null, isOptional: true }], [], { includeDinner: true, dinnerFeeIds: [7] })).toEqual([]);
  });
  it("preserves previously selected hidden dinner", () => {
    expect(hydrateDinnerIds([{ ...fee, dinnerMode: "hidden" }], [7], { includeDinner: true, dinnerFeeIds: [7] })).toEqual([7]);
  });
});
