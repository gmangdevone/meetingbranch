import { describe, expect, it, vi } from "vitest";
import { dinnerModeChoice, dinnerSelectionChanges, recordDinnerChanges } from "./dinnerHistory";
import { resolveDinnerSelections } from "./dinnerSelections";

const fees = [{ id: 1, label: "Dinner", chargeType: "per_person", isDinner: true, isOptional: false, dinnerMode: "mandatory" as const }];
describe("dinner history", () => {
  it("records removal and restoration with the saved attendee matched by ID, even after rename", () => {
    const old = { id: 10, name: "Before", includeDinner: true, dinnerFeeIds: [1] };
    const resolved = resolveDinnerSelections(fees, [{ id: 10, name: "After", dinnerFeeIds: [] }], [1], true, { attendees: [old], selectedFeeIds: [1] });
    expect(dinnerSelectionChanges(fees, resolved.attendees, resolved.previous, [1], [1])).toEqual([
      { feeId: 1, feeLabel: "Dinner", attendeeName: "After", beforeChoice: "Included", afterChoice: "Excluded" },
    ]);
    expect(dinnerSelectionChanges(fees, [old], [{ ...old, includeDinner: false }], [1], [1])[0].afterChoice).toBe("Included");
  });
  it("does not record no-op edits or preserved exceptions", () => {
    const attendee = { name: "Member", includeDinner: false, dinnerFeeIds: [] };
    expect(dinnerSelectionChanges(fees, [attendee], [attendee], [1], [1])).toEqual([]);
  });
  it("resolves legacy selections and records new attendee exceptions", () => {
    expect(dinnerSelectionChanges(fees, [{ name: "Member", includeDinner: false }], [{ name: "Member" }], [1], [1])).toHaveLength(1);
    expect(dinnerSelectionChanges(fees, [{ name: "New", dinnerFeeIds: [], includeDinner: false }], [undefined], [], [1])).toHaveLength(1);
    expect(dinnerModeChoice({ isOptional: true })).toBe("Legacy optional");
  });
  it("records each dinner independently", () => {
    const two = [...fees, { ...fees[0], id: 2 }];
    expect(dinnerSelectionChanges(two, [{ name: "Member", dinnerFeeIds: [2] }], [{ name: "Member", dinnerFeeIds: [1, 2] }], [1, 2], [1, 2]).map(c => c.feeId)).toEqual([1]);
  });
  it("skips no-op modes and propagates failures so the enclosing transaction rolls back", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("storage failed"));
    const change = { feeId: 1, feeLabel: "Dinner", beforeChoice: "optional", afterChoice: "optional" };
    await recordDinnerChanges({ execute }, 1, "actor", "mode", [change]);
    expect(execute).not.toHaveBeenCalled();
    await expect(recordDinnerChanges({ execute }, 1, "actor", "mode", [{ ...change, afterChoice: "mandatory" }])).rejects.toThrow("storage failed");
  });
});
