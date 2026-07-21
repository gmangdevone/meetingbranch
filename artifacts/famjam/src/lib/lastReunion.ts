import { useSyncExternalStore } from "react";

const KEY = "famjam:lastReunionCode";
const EVENT = "famjam:lastReunionCode-changed";

const CODE_RE = /^[A-Z0-9]{7}$/;

function notify() {
  window.dispatchEvent(new Event(EVENT));
}

export function saveLastReunionCode(code: string) {
  try {
    const clean = code.trim().toUpperCase();
    if (!CODE_RE.test(clean)) return;
    localStorage.setItem(KEY, clean);
    notify();
  } catch {
    // storage unavailable (private mode etc.) — non-fatal
  }
}

export function getLastReunionCode(): string | null {
  try {
    const code = localStorage.getItem(KEY);
    return code && CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function clearLastReunionCode() {
  try {
    localStorage.removeItem(KEY);
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
