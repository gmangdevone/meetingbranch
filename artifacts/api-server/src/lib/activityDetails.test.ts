import { describe, expect, it } from "vitest";
import { normalizeActivity } from "./activityDetails";

describe("activity details", () => {
  it("preserves omitted fields and clears explicitly empty details", () => {
    expect(normalizeActivity({ label: " Trail " })).toEqual({ label: "Trail" });
    expect(normalizeActivity({ label: "Trail", description: " ", address: null, mapUrl: "", websiteUrl: null })).toEqual({ label: "Trail", description: null, address: null, mapUrl: null, websiteUrl: null });
  });
  it.each(["javascript:alert(1)", "data:text/html,Hi", "//maps.example", "https://", "maps.example", "https://user:pass@example.com"])("rejects unsafe link %s", url => {
    for (const key of ["mapUrl", "websiteUrl"]) expect(() => normalizeActivity({ label: "Trail", [key]: url })).toThrow();
  });
  it("accepts HTTP(S) links and trims plain text", () => {
    expect(normalizeActivity({ label: "Trail", description: " A walk ", address: " 123 Main St ", mapUrl: " https://maps.example/path ", websiteUrl: "http://example.com" })).toMatchObject({ description: "A walk", address: "123 Main St", mapUrl: "https://maps.example/path" });
    expect(() => normalizeActivity({ label: " " })).toThrow();
  });
});
