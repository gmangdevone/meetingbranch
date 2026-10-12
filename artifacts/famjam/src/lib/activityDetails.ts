export type ActivityDetails = {
  description?: string | null;
  address?: string | null;
  websiteUrl?: string | null;
  mapUrl?: string | null;
};

export type ActivityDraft = { label: string; description: string; address: string; websiteUrl: string; mapUrl: string };

export const emptyDraft = (label = ""): ActivityDraft => ({ label, description: "", address: "", websiteUrl: "", mapUrl: "" });

export const draftFrom = (o: { label: string } & ActivityDetails): ActivityDraft => ({
  label: o.label,
  description: o.description ?? "",
  address: o.address ?? "",
  websiteUrl: o.websiteUrl ?? "",
  mapUrl: o.mapUrl ?? "",
});

/** Returns the URL if it parses as http(s), else null. */
export function safeHttpUrl(value?: string | null): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Validation error for a draft, or null when valid. */
export function validateDraft(d: ActivityDraft): string | null {
  const name = d.label.trim() || "This activity";
  if (!d.label.trim()) return "Activity names cannot be blank.";
  if (d.websiteUrl.trim() && !safeHttpUrl(d.websiteUrl)) return `${name}: Website URL must start with http:// or https://.`;
  if (d.mapUrl.trim() && !safeHttpUrl(d.mapUrl)) return `${name}: Map URL must start with http:// or https://.`;
  return null;
}

/** Payload with explicit nulls for blank optional fields (clears on update). */
export function draftToPayload(d: ActivityDraft) {
  const n = (s: string) => s.trim() || null;
  return {
    label: d.label.trim(),
    description: n(d.description),
    address: n(d.address),
    websiteUrl: d.websiteUrl.trim() ? safeHttpUrl(d.websiteUrl) : null,
    mapUrl: d.mapUrl.trim() ? safeHttpUrl(d.mapUrl) : null,
  };
}

export const hasDetails = (d: ActivityDraft) => Boolean(d.description.trim() || d.address.trim() || d.websiteUrl.trim() || d.mapUrl.trim());

/** Resolved map href: safe mapUrl, else Google Maps search for address, else null. */
export function mapHref(a: ActivityDetails): string | null {
  const safe = safeHttpUrl(a.mapUrl);
  if (safe) return safe;
  const addr = (a.address ?? "").trim();
  return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
}
