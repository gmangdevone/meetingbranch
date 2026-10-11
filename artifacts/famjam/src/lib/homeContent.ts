import type { HomeContent } from "@workspace/api-client-react";

export const DEFAULT_WELCOME_HEADING = "Welcome to the Hub";
export const HOTEL_BUTTON_LABEL = "Click here to book your hotel room";

/** The legacy dynamic welcome copy, used whenever no custom description is saved. */
export function defaultWelcomeDescription(name: string, registrationsOpen: boolean): string {
  return `This is the central location for everything related to ${name}. ${
    registrationsOpen
      ? "Be sure to register your household so we have a final headcount for food and activities!"
      : "Registration is currently closed."
  }`;
}

/** Returns the URL only when it is a well-formed http(s) link; otherwise null. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Split plain text into paragraphs (blank lines) of lines (single newlines). */
export function toParagraphs(text: string): string[][] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n"))
    .filter((lines) => lines.some((l) => l.trim().length > 0));
}

type ReunionHomeFields = Partial<HomeContent>;

export function homeContentFrom(r: ReunionHomeFields | null | undefined): HomeContent {
  return {
    welcomeHeading: r?.welcomeHeading ?? null,
    welcomeDescription: r?.welcomeDescription ?? null,
    hotelEnabled: r?.hotelEnabled ?? false,
    hotelDescription: r?.hotelDescription ?? null,
    hotelBookingUrl: r?.hotelBookingUrl ?? null,
    hotelImageUrl: r?.hotelImageUrl ?? null,
  };
}

/** Whether the hotel block should render publicly. */
export function hotelVisible(c: ReunionHomeFields | null | undefined): boolean {
  return !!c?.hotelEnabled && !!c.hotelDescription?.trim() && !!safeHttpUrl(c.hotelBookingUrl);
}

export interface HomeContentDraft {
  welcomeHeading: string;
  welcomeDescription: string;
  hotelEnabled: boolean;
  hotelDescription: string;
  hotelBookingUrl: string;
  hotelImageUrl: string | null;
}

export function draftFrom(c: HomeContent): HomeContentDraft {
  return {
    welcomeHeading: c.welcomeHeading ?? "",
    welcomeDescription: c.welcomeDescription ?? "",
    hotelEnabled: c.hotelEnabled,
    hotelDescription: c.hotelDescription ?? "",
    hotelBookingUrl: c.hotelBookingUrl ?? "",
    hotelImageUrl: c.hotelImageUrl ?? null,
  };
}

const nul = (s: string) => (s.trim() ? s.trim() : null);

export function draftToPayload(d: HomeContentDraft): HomeContent {
  return {
    welcomeHeading: nul(d.welcomeHeading),
    welcomeDescription: d.welcomeDescription.trim() ? d.welcomeDescription.replace(/\s+$/, "") : null,
    hotelEnabled: d.hotelEnabled,
    hotelDescription: d.hotelDescription.trim() ? d.hotelDescription.replace(/\s+$/, "") : null,
    hotelBookingUrl: nul(d.hotelBookingUrl),
    hotelImageUrl: d.hotelImageUrl,
  };
}

export interface DraftErrors {
  welcomeHeading?: string;
  welcomeDescription?: string;
  hotelDescription?: string;
  hotelBookingUrl?: string;
}

export function validateDraft(d: HomeContentDraft): DraftErrors {
  const e: DraftErrors = {};
  if (d.welcomeHeading.trim().length > 160) e.welcomeHeading = "Keep the heading under 160 characters.";
  if (d.welcomeDescription.length > 5000) e.welcomeDescription = "Keep the description under 5000 characters.";
  if (d.hotelDescription.length > 5000) e.hotelDescription = "Keep the hotel description under 5000 characters.";
  if (d.hotelBookingUrl.trim() && !safeHttpUrl(d.hotelBookingUrl)) {
    e.hotelBookingUrl = "Enter a full link starting with http:// or https://";
  }
  if (d.hotelEnabled) {
    if (!d.hotelDescription.trim()) e.hotelDescription = "A hotel description is required to show the hotel section.";
    if (!d.hotelBookingUrl.trim()) e.hotelBookingUrl = "A booking link is required to show the hotel section.";
  }
  return e;
}

export function draftsEqual(a: HomeContentDraft, b: HomeContentDraft): boolean {
  return JSON.stringify(draftToPayload(a)) === JSON.stringify(draftToPayload(b));
}
