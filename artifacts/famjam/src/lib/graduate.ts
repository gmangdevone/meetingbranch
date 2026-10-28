import { useEffect } from "react";
import type { GraduateBlock, GraduateContent, GraduateQuestion } from "@workspace/api-client-react";

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Only absolute http(s) links without embedded credentials are rendered as links. */
export function safeHttpUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number | null {
  if (!HEX_RE.test(a) || !HEX_RE.test(b)) return null;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
export function contrastLabel(ratio: number | null): { label: string; tone: "good" | "ok" | "poor" } {
  if (ratio == null) return { label: "Invalid color", tone: "poor" };
  const r = ratio.toFixed(1);
  if (ratio >= 7) return { label: `${r}:1 Excellent`, tone: "good" };
  if (ratio >= 4.5) return { label: `${r}:1 Readable`, tone: "good" };
  if (ratio >= 3) return { label: `${r}:1 Large text only`, tone: "ok" };
  return { label: `${r}:1 Hard to read`, tone: "poor" };
}

export const PALETTE = [
  "#FFFDF6", "#F4EFE3", "#EADFC9", "#1E2A33", "#1F5D8C", "#0F3B5C",
  "#E2673A", "#B9472A", "#2F6B4F", "#D9A441", "#6B3E75", "#FFFFFE",
];

export const THEME_PRESETS: { name: string; background: string; foreground: string; accent: string }[] = [
  { name: "Parchment", background: "#FFFDF6", foreground: "#1E2A33", accent: "#1F5D8C" },
  { name: "Commencement", background: "#0F3B5C", foreground: "#F4EFE3", accent: "#D9A441" },
  { name: "Ember", background: "#F4EFE3", foreground: "#2B1A12", accent: "#B9472A" },
  { name: "Ivy", background: "#EEF3EC", foreground: "#1C2B22", accent: "#2F6B4F" },
];

export const FONT_STACK: Record<string, string> = {
  sans: '"Mulish", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
};
export const SPACING_PAD: Record<string, string> = { compact: "8px", comfortable: "18px", spacious: "34px" };

export function uid(prefix: string) {
  return `${prefix}-${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 12)}`;
}

export function newBlock(kind: GraduateBlock["kind"]): GraduateBlock {
  return {
    id: uid("b"),
    kind,
    text: kind === "heading" ? "New heading" : kind === "link" ? "Learn more" : "Write something for the family.",
    url: kind === "link" ? "https://" : "",
    background: "",
    foreground: "",
    font: kind === "heading" ? "serif" : "sans",
    size: kind === "heading" ? 32 : 17,
    weight: kind === "heading" ? "bold" : "normal",
    align: "left",
    width: "full",
    spacing: "comfortable",
  };
}

export function newQuestion(): GraduateQuestion {
  return { id: uid("q"), label: "", help: "", kind: "short", required: false };
}

export function emptyContent(): GraduateContent {
  return { revision: 0, background: "#FFFDF6", foreground: "#1E2A33", accent: "#1F5D8C", blocks: [], questions: [] };
}

export function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function apiStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}
export function apiMessage(err: unknown, fallback: string): string {
  const e = err as { data?: { error?: string } | null; message?: string } | null;
  return e?.data?.error || fallback;
}

export const ZELLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ZELLE_PHONE_RE = /^\+?[\d ().-]{7,25}$/;
export const CASHAPP_RE = /^\$?[A-Za-z][A-Za-z0-9]{0,19}$/;
export function zelleError(v: string): string | null {
  const s = v.trim();
  if (!s || ZELLE_EMAIL_RE.test(s) || ZELLE_PHONE_RE.test(s)) return null;
  return "Enter an email address or phone number.";
}
export function cashAppError(v: string): string | null {
  const s = v.trim();
  if (!s || CASHAPP_RE.test(s)) return null;
  return "Enter a valid Cash App tag (up to 20 letters/numbers).";
}

/** Sets document.title while mounted and restores the previous title afterwards. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
}

export const EMAIL_STATUS_COPY: Record<string, { label: string; detail: string; className: string }> = {
  pending: { label: "Email queued", detail: "Waiting to be handed to the email provider.", className: "bg-amber-100 text-amber-900" },
  sending: { label: "Sending", detail: "Being handed to the email provider now.", className: "bg-sky-100 text-sky-900" },
  accepted: { label: "Accepted by provider", detail: "The email provider accepted it. Inbox delivery is not confirmed.", className: "bg-emerald-100 text-emerald-900" },
  failed: { label: "Email not confirmed", detail: "The application is saved. The provider did not confirm acceptance; if the attempt timed out the email may still have been sent, so a resend could produce a duplicate.", className: "bg-red-100 text-red-800" },
};
