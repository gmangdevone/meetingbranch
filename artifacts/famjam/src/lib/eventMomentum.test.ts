import { describe, expect, it } from "vitest";
import {
  getEventCountdownLabel,
  getRegistrationMomentumLabel,
  millisecondsUntilNextDay,
} from "./eventMomentum";

describe("event momentum", () => {
  const start = new Date(2026, 8, 12, 9);
  const end = new Date(2026, 8, 14, 17);

  it("counts calendar days until the event", () => {
    expect(getEventCountdownLabel(start, end, new Date(2026, 8, 9, 23, 59))).toBe("3 days to go");
    expect(getEventCountdownLabel(start, end, new Date(2026, 8, 11, 8))).toBe("1 day to go");
  });

  it("describes event day, an event in progress, and a past event", () => {
    expect(getEventCountdownLabel(start, end, new Date(2026, 8, 12, 1))).toBe("Event starts today");
    expect(getEventCountdownLabel(start, end, new Date(2026, 8, 13, 12))).toBe("Event happening now");
    expect(getEventCountdownLabel(start, end, new Date(2026, 8, 15, 0))).toBe("Event has ended");
  });

  it("pluralizes registration momentum copy", () => {
    expect(getRegistrationMomentumLabel(1)).toBe("1 registrant and counting");
    expect(getRegistrationMomentumLabel(30)).toBe("30 registrants and counting");
  });

  it("schedules a refresh just after the next local midnight", () => {
    expect(millisecondsUntilNextDay(new Date(2026, 8, 11, 23, 59, 59, 500))).toBe(1500);
  });
});