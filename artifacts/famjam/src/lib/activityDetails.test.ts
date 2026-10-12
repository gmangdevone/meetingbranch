import { describe, expect, it } from "vitest";
import { draftFrom, draftToPayload, emptyDraft, safeHttpUrl, validateDraft } from "./activityDetails";

describe("activityDetails", () => {
  it("accepts only http(s) URLs", () => {
    expect(safeHttpUrl("https://a.example")).toBe("https://a.example/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("ftp://x")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
  it("validates unsafe URLs before mutation", () => {
    expect(validateDraft({ ...emptyDraft("Zoo"), websiteUrl: "javascript:x" })).toMatch(/Website URL/);
    expect(validateDraft({ ...emptyDraft("Zoo"), mapUrl: "data:x" })).toMatch(/Map URL/);
    expect(validateDraft(emptyDraft(" "))).toMatch(/blank/);
    expect(validateDraft({ ...emptyDraft("Zoo"), websiteUrl: "https://z.example" })).toBeNull();
  });
  it("maps blanks to explicit null and trims values", () => {
    expect(draftToPayload({ label: " Zoo ", description: " ", address: " 1 Main ", websiteUrl: "", mapUrl: "https://m.example/x" }))
      .toEqual({ label: "Zoo", description: null, address: "1 Main", websiteUrl: null, mapUrl: "https://m.example/x" });
  });
  it("initializes drafts from existing nullable data", () => {
    expect(draftFrom({ label: "Zoo", description: null, address: "A" })).toEqual({ label: "Zoo", description: "", address: "A", websiteUrl: "", mapUrl: "" });
  });
});
