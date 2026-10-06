import { describe, it, expect } from "vitest";
import { parseDollarsToCents, isValidCents, fmtCents } from "./ledger";

describe("cents parsing", () => {
  it("accepts dollars and cents exactly", () => {
    expect(parseDollarsToCents("30")).toBe(3000);
    expect(parseDollarsToCents("30.5")).toBe(3050);
    expect(parseDollarsToCents("$1,234.07")).toBe(123407);
    expect(parseDollarsToCents(0.1 + 0.2 > 0.3 ? 0.3 : 0.3)).toBe(30);
    expect(parseDollarsToCents(19.99)).toBe(1999);
  });
  it("rejects zero, negative, malformed and over-precise values", () => {
    for (const v of ["0", "0.00", "-5", "abc", "1.234", "", "1e3", NaN, Infinity, null, "100000000"]) expect(parseDollarsToCents(v)).toBeNull();
  });
  it("validates integer cents and formats", () => {
    expect(isValidCents(1)).toBe(true);
    expect(isValidCents(1.5)).toBe(false);
    expect(isValidCents(0)).toBe(false);
    expect(fmtCents(5000)).toBe("$50.00");
    expect(fmtCents(-1)).toBe("-$0.01");
  });
});
