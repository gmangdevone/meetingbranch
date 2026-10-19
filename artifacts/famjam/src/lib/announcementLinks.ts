export type AnnouncementLink = { start: number; end: number; label: string; url: string };

export function safeAnnouncementUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed) || /[\s\u0000-\u001f\u007f]/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Only labelled links are interpreted; HTML and all other formatting remain text.
export function announcementLinks(body: string): AnnouncementLink[] {
  return Array.from(body.matchAll(/\[((?:\\.|[^\]\\\n])+)\]\(([^()\s]+)\)/g), match => ({
    start: match.index!,
    end: match.index! + match[0].length,
    label: match[1].replace(/\\([\\[\]])/g, "$1"),
    url: match[2],
  }));
}

export function encodeAnnouncementLink(label: string, url: string) {
  return `[${label.replace(/[\\[\]]/g, "\\$&")}](${url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}
