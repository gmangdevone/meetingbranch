type ActivityInput = {
  label: string;
  description?: string | null;
  address?: string | null;
  mapUrl?: string | null;
  websiteUrl?: string | null;
};

/** Undefined means preserve on PATCH; blank and null explicitly clear. */
export function normalizeActivity(input: ActivityInput) {
  const result = { ...input, label: input.label.trim() };
  if (!result.label) throw new Error("Activity names cannot be blank.");
  for (const key of ["description", "address", "mapUrl", "websiteUrl"] as const) {
    if (input[key] !== undefined) result[key] = input[key]?.trim() || null;
  }
  for (const key of ["mapUrl", "websiteUrl"] as const) {
    const value = result[key];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!/^https?:\/\//i.test(value) || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    } catch {
      throw new Error("Map and website links must be valid URLs starting with http:// or https://.");
    }
  }
  return result;
}
