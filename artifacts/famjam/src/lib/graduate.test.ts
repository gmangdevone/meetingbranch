import { describe, it, expect } from "vitest";
import { safeHttpUrl, contrastRatio, contrastLabel, move, zelleError, cashAppError, EMAIL_STATUS_COPY } from "./graduate";

describe("graduate helpers", () => {
  it("accepts only credential-free http(s) urls", () => {
    expect(safeHttpUrl("https://example.org/a")).toBe("https://example.org/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("https://u:p@example.org")).toBeNull();
    expect(safeHttpUrl("example.org")).toBeNull();
  });
  it("computes contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#zzz", "#FFFFFF")).toBeNull();
    expect(contrastLabel(2).tone).toBe("poor");
  });
  it("reorders without mutation", () => {
    const a = [1, 2, 3];
    expect(move(a, 0, 1)).toEqual([2, 1, 3]);
    expect(move(a, 0, -1)).toBe(a);
  });
  it("validates payout references", () => {
    expect(zelleError("")).toBeNull();
    expect(zelleError("a@b.co")).toBeNull();
    expect(zelleError("(555) 123-4567")).toBeNull();
    expect(zelleError("nope")).not.toBeNull();
    expect(cashAppError("$abc123")).toBeNull();
    expect(cashAppError("$1abc")).not.toBeNull();
  });
  it("does not claim failed email never went out", () => {
    expect(EMAIL_STATUS_COPY.failed.detail).not.toMatch(/did not go out/);
  });
});
