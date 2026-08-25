import { describe, expect, it } from "vitest";
import {
  allocateUniqueEventCode,
  EVENT_CODE_FORMAT_MESSAGE,
  generateCode,
  getEventCodeValidationError,
  isValidEventCode,
  normalizeEventCode,
} from "./reunionCode";

describe("event code rules", () => {
  it("generates codes that always satisfy the required format", () => {
    for (let i = 0; i < 250; i++) {
      const code = generateCode();
      expect(code).toHaveLength(8);
      expect(isValidEventCode(code)).toBe(true);
    }
  });

  it("normalizes surrounding whitespace and letter case", () => {
    expect(normalizeEventCode("  abcd23*  ")).toBe("ABCD23*");
    expect(getEventCodeValidationError("  abcd23*  ")).toBeNull();
  });

  it.each([
    ["too short", "ABC1*"],
    ["missing a letter", "2345678*"],
    ["missing a number", "ABCDEFG*"],
    ["missing a special character", "ABCD2345"],
    ["contains a URL separator", "ABC1234/"],
  ])("rejects a code that is %s", (_reason, code) => {
    expect(getEventCodeValidationError(code)).toBe(EVENT_CODE_FORMAT_MESSAGE);
    expect(isValidEventCode(code)).toBe(false);
  });

  it("retries PostgreSQL uniqueness collisions and returns the inserted value", async () => {
    let calls = 0;
    const result = await allocateUniqueEventCode(async (code) => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      return code;
    });

    expect(calls).toBe(3);
    expect(result).not.toBeNull();
    expect(isValidEventCode(result)).toBe(true);
  });

  it("returns null after the allocation retry budget is exhausted", async () => {
    let calls = 0;
    const result = await allocateUniqueEventCode(async () => {
      calls += 1;
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    }, 4);

    expect(calls).toBe(4);
    expect(result).toBeNull();
  });

  it("does not hide non-uniqueness database failures", async () => {
    await expect(
      allocateUniqueEventCode(async () => {
        throw Object.assign(new Error("database unavailable"), { code: "08006" });
      }),
    ).rejects.toThrow("database unavailable");
  });
});