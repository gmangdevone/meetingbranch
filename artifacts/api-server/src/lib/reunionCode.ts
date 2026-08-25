import { db, reunionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const EVENT_CODE_MIN_LENGTH = 7;
export const EVENT_CODE_MAX_LENGTH = 32;
export const EVENT_CODE_SPECIAL_CHARACTERS = "*._~-";
export const EVENT_CODE_FORMAT_MESSAGE =
  "Event code must be 7-32 characters and include at least one letter, one number, and one special character (*, ., _, ~, or -).";

// Unambiguous alphabets (no 0/O/1/I) for easy sharing by voice or text.
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALPHANUMERIC = `${LETTERS}${DIGITS}`;
const GENERATED_CODE_LENGTH = 8;
const EVENT_CODE_RE = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[*._~-])[A-Z0-9*._~-]{7,32}$/;

function randomCharacter(alphabet: string): string {
  return alphabet[Math.floor(Math.random() * alphabet.length)];
}

export function normalizeEventCode(code: string): string {
  return code.trim().toUpperCase();
}

export function getEventCodeValidationError(code: unknown): string | null {
  if (typeof code !== "string" || !EVENT_CODE_RE.test(normalizeEventCode(code))) {
    return EVENT_CODE_FORMAT_MESSAGE;
  }
  return null;
}

export function isValidEventCode(code: unknown): code is string {
  return getEventCodeValidationError(code) === null;
}

export function generateCode(length = GENERATED_CODE_LENGTH): string {
  const safeLength = Math.min(
    EVENT_CODE_MAX_LENGTH,
    Math.max(EVENT_CODE_MIN_LENGTH, Math.trunc(length)),
  );
  const characters = [
    randomCharacter(LETTERS),
    randomCharacter(DIGITS),
    "*",
  ];
  while (characters.length < safeLength) {
    characters.push(randomCharacter(ALPHANUMERIC));
  }
  for (let i = characters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join("");
}

/** Generates a format-compliant code that does not match an existing event. */
export async function generateUniqueReunionCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateCode();
    const [existing] = await db
      .select({ id: reunionsTable.id })
      .from(reunionsTable)
      .where(eq(reunionsTable.code, code))
      .limit(1);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique event code");
}
