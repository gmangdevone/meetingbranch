const EVENT_CODE_RE = /^[A-Z0-9*._~-]{7,32}$/;
const ASCII_LETTER_RE = /[A-Z]/;
const DIGIT_RE = /\d/;
const SPECIAL_RE = /[*._~-]/;

export const EVENT_CODE_FORMAT_MESSAGE =
  "Use 7–32 characters with at least one letter, one number, and one special character (*, ., _, ~, or -).";

/** Normalizes an event code for display, validation, and API lookups. */
export function normalizeEventCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Returns whether a code meets the public Event Code format. */
export function isValidEventCode(code: string): boolean {
  const normalized = normalizeEventCode(code);
  return (
    EVENT_CODE_RE.test(normalized) &&
    ASCII_LETTER_RE.test(normalized) &&
    DIGIT_RE.test(normalized) &&
    SPECIAL_RE.test(normalized)
  );
}

/** Builds a safely encoded public event route, optionally including a route suffix. */
export function eventCodePath(code: string, suffix = ""): string {
  return `/r/${encodeURIComponent(normalizeEventCode(code))}${suffix}`;
}