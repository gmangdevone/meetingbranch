import { describe, expect, it } from "vitest";
import { resolveDinnerSelections } from "./dinnerSelections";
import { computeTotal } from "./fees";

const dinner = { id: 7, label: "Sunday Dinner", isDinner: true, isOptional: false, chargeType: "per_person" as const, dinnerMode: "mandatory" as const, amount: 25, ageTiers: [{ minAge: 0, maxAge: 5, amount: 0 }] };
describe("dinner selection defaults and eligibility", () => {
  it("defaults mandatory new attendees on, including zero-cost children", () => {
    const resolved = resolveDinnerSelections([dinner], [{ name: "Child", age: 4 }], [], false);
    expect(resolved.attendees[0]).toMatchObject({ includeDinner: true, dinnerFeeIds: [7] });
    expect(resolved.selectedFeeIds).toEqual([7]);
    expect(computeTotal([dinner], resolved.attendees, resolved.selectedFeeIds)).toBe(0);
  });
  it("new attendees default on during edit without losing a saved exception", () => {
    const resolved = resolveDinnerSelections([dinner], [{ id: 1, name: "Existing" }, { name: "Added" }], [], false, {
      attendees: [{ id: 1, name: "Existing", includeDinner: false, dinnerFeeIds: [7] }], selectedFeeIds: [7],
    });
    expect(resolved.attendees.map(a => a.includeDinner)).toEqual([false, true]);
  });
  it("organizers may exempt newly registered attendees but members cannot", () => {
    const attendees = [{ name: "Exempt", includeDinner: false }];
    expect(resolveDinnerSelections([dinner], attendees, [], true).attendees[0].includeDinner).toBe(false);
    expect(() => resolveDinnerSelections([dinner], attendees, [], false)).toThrow("mandatory");
  });
  it("never trusts a submitted eligibility snapshot to avoid mandatory dinner", () => {
    expect(() => resolveDinnerSelections([dinner], [{ name: "Tampered", includeDinner: false, dinnerFeeIds: [] }], [], false)).toThrow("mandatory");
  });
  it("allows existing attendees to opt into newly visible dinner", () => {
    const result = resolveDinnerSelections([{ ...dinner, dinnerMode: "optional" }], [{ id: 1, name: "Existing", dinnerFeeIds: [7] }], [], false, {
      attendees: [{ id: 1, name: "Existing", includeDinner: false, dinnerFeeIds: [] }], selectedFeeIds: [],
    });
    expect(result.selectedFeeIds).toEqual([7]);
    expect(result.attendees[0]).toMatchObject({ includeDinner: true, dinnerFeeIds: [7] });
  });
  it("allows optional dinner to be declined independently of mandatory dinner", () => {
    const optional = { ...dinner, id: 8, dinnerMode: "optional" as const };
    const result = resolveDinnerSelections([dinner, optional], [{ name: "Adult", dinnerFeeIds: [7] }], [], false);
    expect(result.attendees[0].dinnerFeeIds).toEqual([7]);
    expect(computeTotal([dinner, optional], result.attendees, result.selectedFeeIds)).toBe(25);
  });
});
