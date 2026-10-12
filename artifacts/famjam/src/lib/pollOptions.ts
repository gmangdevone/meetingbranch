import type { PollOption, PollOptionInput } from "@workspace/api-client-react";

export interface PollOptionDraft {
  label: string;
  detailsEnabled: boolean;
  description: string;
  linkUrl: string;
}

export const DESCRIPTION_MAX = 2000;
export const LINK_MAX = 2048;

export const emptyOptionDraft = (): PollOptionDraft => ({ label: "", detailsEnabled: false, description: "", linkUrl: "" });

export const draftFromOption = (o: Pick<PollOption, "label" | "detailsEnabled" | "description" | "linkUrl">): PollOptionDraft => ({
  label: o.label,
  detailsEnabled: !!o.detailsEnabled,
  description: o.description ?? "",
  linkUrl: o.linkUrl ?? "",
});

/** Returns an error message for an unsafe/invalid link, or null when acceptable. */
export function validateLinkUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > LINK_MAX) return `Link must be ${LINK_MAX} characters or fewer.`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full link starting with https:// or http://.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Only http:// or https:// links are allowed.";
  if (url.username || url.password) return "Links cannot include a username or password.";
  if (!url.hostname) return "Enter a valid link.";
  return null;
}

export interface OptionDraftErrors {
  label?: string;
  description?: string;
  linkUrl?: string;
  details?: string;
}

export function validateOptionDraft(d: PollOptionDraft): OptionDraftErrors {
  const errors: OptionDraftErrors = {};
  if (!d.label.trim()) errors.label = "Option label cannot be blank.";
  if (d.detailsEnabled) {
    const desc = d.description.trim();
    const link = d.linkUrl.trim();
    if (!desc && !link) errors.details = "Add a description or a link, or turn details off.";
    if (desc.length > DESCRIPTION_MAX) errors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
    const linkErr = validateLinkUrl(link);
    if (linkErr) errors.linkUrl = linkErr;
  }
  return errors;
}

export const hasErrors = (e: OptionDraftErrors) => Object.keys(e).length > 0;

/** Text is preserved when details are off so organizers can re-enable without retyping. */
export function draftToInput(d: PollOptionDraft): PollOptionInput {
  const desc = d.description.trim();
  const link = d.linkUrl.trim();
  return {
    label: d.label.trim(),
    detailsEnabled: d.detailsEnabled,
    description: desc || null,
    linkUrl: link || null,
  };
}

/** Members see details only when enabled and at least one field is present. */
export function visibleDetails(o: Pick<PollOption, "detailsEnabled" | "description" | "linkUrl">) {
  if (!o.detailsEnabled) return null;
  const description = o.description?.trim() || null;
  const linkUrl = o.linkUrl?.trim() && !validateLinkUrl(o.linkUrl) ? o.linkUrl.trim() : null;
  if (!description && !linkUrl) return null;
  return { description, linkUrl };
}
