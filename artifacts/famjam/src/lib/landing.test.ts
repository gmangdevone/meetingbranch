import { describe, expect, it } from "vitest";
import { resolveLanding, uniqueMemberships } from "./landing";

const m = (reunionId: number, code = `CODE${reunionId}*`) => ({
  reunionId, code, name: `R${reunionId}`, startDate: "2026-07-01", endDate: "2026-07-02",
  isOrganizer: false, isCoOrganizer: false, activeRegistrationCount: 1,
});

describe("resolveLanding", () => {
  it("keeps the welcome flow with no events", () => expect(resolveLanding([])).toEqual({ kind: "welcome" }));
  it("opens the hub for exactly one event", () => expect(resolveLanding([m(4, "FAM2026*")])).toEqual({ kind: "hub", code: "FAM2026*" }));
  it("treats duplicate rows for the same reunion id as one event", () =>
    expect(resolveLanding([m(4), { ...m(4), isOrganizer: true }])).toEqual({ kind: "hub", code: "CODE4*" }));
  it("goes to the dashboard for multiple events", () => expect(resolveLanding([m(1), m(2)])).toEqual({ kind: "dashboard" }));
  it("dedupes by id, not code or name", () => expect(uniqueMemberships([m(1, "A1*"), m(2, "A1*")])).toHaveLength(2));
});
