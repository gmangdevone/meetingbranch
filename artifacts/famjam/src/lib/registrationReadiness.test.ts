import { describe, expect, it } from "vitest";
import { registrationPricingReady as ready } from "./registrationReadiness";

describe("registration total readiness", () => {
  it("does not price blank or partly filled attendees", () => {
    for (const age of [undefined, null, "", " ", -1, 121, 1.5, "bad"]) {
      expect(ready([{ name: "Person", age }], undefined)).toBe(false);
    }
    expect(ready([{ name: "", age: 30 }], undefined)).toBe(false);
    expect(ready([], undefined)).toBe(false);
  });
  it("accepts infants and valid entered ages", () => {
    expect(ready([{ name: "Infant", age: "0" }], "")).toBe(true);
    expect(ready([{ name: "Adult", age: 30 }], 10)).toBe(true);
  });
  it("waits again when an incomplete attendee is added", () => {
    expect(ready([{ name: "Adult", age: 30 }, { name: "", age: undefined }], 0)).toBe(false);
  });
  it("does not quote invalid contribution amounts", () => {
    expect(ready([{ name: "Adult", age: 30 }], -1)).toBe(false);
    expect(ready([{ name: "Adult", age: 30 }], "bad")).toBe(false);
  });
});