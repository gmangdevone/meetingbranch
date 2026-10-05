import { describe, expect, it } from "vitest";
import { mergeMemberships } from "./memberships";

const r = (id: number, startDate = "2026-07-01") => ({ id, code: `C${id}`, name: `Reunion ${id}`, startDate, endDate: startDate });

describe("mergeMemberships", () => {
  it("returns nothing without associations", () => {
    expect(mergeMemberships({ owned: [], coOrganized: [], registrations: [] })).toEqual([]);
  });
  it("counts multiple registrations in one reunion as one event", () => {
    const out = mergeMemberships({ owned: [], coOrganized: [], registrations: [{ status: "active", reunion: r(1) }, { status: "active", reunion: r(1) }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reunionId: 1, activeRegistrationCount: 2, isOrganizer: false });
  });
  it("excludes cancelled-only registrations", () => {
    expect(mergeMemberships({ owned: [], coOrganized: [], registrations: [{ status: "cancelled", reunion: r(1) }] })).toEqual([]);
  });
  it("keeps an event with a cancelled registration when another association is active", () => {
    const out = mergeMemberships({ owned: [], coOrganized: [r(1)], registrations: [{ status: "cancelled", reunion: r(1) }] });
    expect(out).toEqual([expect.objectContaining({ reunionId: 1, isCoOrganizer: true, activeRegistrationCount: 0 })]);
  });
  it("merges organizer, co-organizer and registrant roles by reunion id and sorts by start date", () => {
    const out = mergeMemberships({
      owned: [r(2, "2026-09-01")],
      coOrganized: [r(2, "2026-09-01"), r(3, "2026-05-01")],
      registrations: [{ status: "active", reunion: r(2, "2026-09-01") }],
    });
    expect(out.map((m) => m.reunionId)).toEqual([3, 2]);
    expect(out[1]).toMatchObject({ isOrganizer: true, isCoOrganizer: true, activeRegistrationCount: 1 });
  });
});
