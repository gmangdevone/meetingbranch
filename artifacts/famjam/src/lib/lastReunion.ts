import { useSyncExternalStore } from "react";

const KEY = "meetingbranch:lastReunionCode";
const LEGACY_KEY = "famjam:lastReunionCode";
const EVENT = "meetingbranch:lastReunionCode-changed";

const CODE_RE = /^[A-Z0-9]{7}$/;

function notify() {
  window.dispatchEvent(new Event(EVENT));
}

export function saveLastReunionCode(code: string) {
  try {
    const clean = code.trim().toUpperCase();
    if (!CODE_RE.test(clean)) return;
    localStorage.setItem(KEY, clean);
    // Remove legacy key when writing so old value doesn't shadow the new one
    localStorage.removeItem(LEGACY_KEY);
    notify();
  } catch {
    // storage unavailable (private mode etc.) — non-fatal
  }
}

export function getLastReunionCode(): string | null {
  try {
    // Prefer the new key; fall back to the legacy famjam key for existing users
    const code = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    return code && CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function clearLastReunionCode() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
    notify();
  } catch {
    // ignore
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback); // cross-tab changes
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** Reactive hook: re-renders when the stored code changes (same tab or cross-tab). */
export function useLastReunionCode(): string | null {
  return useSyncExternalStore(subscribe, getLastReunionCode, () => null);
}
