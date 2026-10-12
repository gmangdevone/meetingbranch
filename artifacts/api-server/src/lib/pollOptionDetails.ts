type OptionInput = { label: string; detailsEnabled?: boolean; description?: string | null; linkUrl?: string | null };

export function normalizePollOption(input: string | OptionInput) {
  const value = typeof input === "string" ? { label: input } : input;
  return {
    label: value.label.trim(),
    ...(value.detailsEnabled === undefined ? {} : { detailsEnabled: value.detailsEnabled }),
    ...(value.description === undefined ? {} : { description: value.description?.trim() || null }),
    ...(value.linkUrl === undefined ? {} : { linkUrl: value.linkUrl?.trim() || null }),
  };
}

export function pollOptionError(value: OptionInput): string | null {
  if (!value.label.trim()) return "Option labels cannot be blank.";
  if (value.linkUrl) {
    try {
      const url = new URL(value.linkUrl);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    } catch {
      return "Option links must be valid http:// or https:// URLs without embedded credentials.";
    }
  }
  if (value.detailsEnabled && !value.description?.trim() && !value.linkUrl?.trim()) {
    return "Add a description or link before enabling option details.";
  }
  return null;
}
