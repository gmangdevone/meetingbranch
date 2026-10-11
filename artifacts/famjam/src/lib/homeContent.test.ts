import { describe, expect, it } from "vitest";
import { safeHttpUrl, toParagraphs, validateDraft, draftToPayload, hotelVisible, defaultWelcomeDescription } from "./homeContent";

const base = { welcomeHeading: "", welcomeDescription: "", hotelEnabled: false, hotelDescription: "", hotelBookingUrl: "", hotelImageUrl: null };

describe("homeContent helpers", () => {
  it("accepts only http(s) URLs", () => {
    expect(safeHttpUrl("https://hotel.example/book")).toBe("https://hotel.example/book");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("hotel.example")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
  });
  it("splits paragraphs and lines", () => {
    expect(toParagraphs("a\nb\n\nc")).toEqual([["a", "b"], ["c"]]);
  });
  it("requires description and url when enabled", () => {
    const e = validateDraft({ ...base, hotelEnabled: true });
    expect(e.hotelDescription).toBeTruthy();
    expect(e.hotelBookingUrl).toBeTruthy();
    expect(validateDraft({ ...base, hotelBookingUrl: "ftp://x" }).hotelBookingUrl).toBeTruthy();
  });
  it("nulls blanks so defaults apply", () => {
    expect(draftToPayload(base)).toEqual({ welcomeHeading: null, welcomeDescription: null, hotelEnabled: false, hotelDescription: null, hotelBookingUrl: null, hotelImageUrl: null });
  });
  it("hides hotel unless enabled and complete", () => {
    expect(hotelVisible({ hotelEnabled: true, hotelDescription: "x", hotelBookingUrl: "https://a.b" })).toBe(true);
    expect(hotelVisible({ hotelEnabled: false, hotelDescription: "x", hotelBookingUrl: "https://a.b" })).toBe(false);
    expect(hotelVisible({ hotelEnabled: true, hotelDescription: "x", hotelBookingUrl: "javascript:x" })).toBe(false);
  });
  it("keeps dynamic default copy", () => {
    expect(defaultWelcomeDescription("Lacey", false)).toContain("Registration is currently closed.");
  });
});
