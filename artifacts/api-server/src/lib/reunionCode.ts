import { randomInt } from "node:crypto";

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
  return alphabet[randomInt(alphabet.length)];
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
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join("");
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Makes code generation and insertion one bounded operation, retrying only
 * PostgreSQL uniqueness races. Returning null lets the route send a clear 503.
 */
export async function allocateUniqueEventCode<T>(
  insert: (code: string) => Promise<T>,
  attempts = 20,
): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await insert(generateCode());
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
    }
  }
  return null;
}
