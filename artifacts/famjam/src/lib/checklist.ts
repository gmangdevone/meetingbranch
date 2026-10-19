import type { ChecklistItem, ChecklistItemKind } from "@workspace/api-client-react";

/** Returns the URL only if it is an absolute http(s) link; otherwise null. */
export function safeChecklistLink(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export const KIND_LABELS: Record<ChecklistItemKind, string> = {
  manual: "Manual check-off",
  registration: "Automatic: registration",
  payment: "Automatic: payment",
};

export function isAutomatic(kind: ChecklistItemKind): boolean {
  return kind !== "manual";
}

export function checklistButtonLabel(completed: number, total: number): string {
  return total > 0 && completed >= total
    ? "My Checklist · All complete"
    : `My Checklist · ${completed} of ${total} complete`;
}

export const CHECKLIST_TEMPLATES: Array<Pick<ChecklistItem, "title" | "description" | "kind">> = [
  { title: "Register attendees", description: "Add everyone in your household who is coming.", kind: "registration" },
  { title: "Complete payments", description: "Settle your registration balance.", kind: "payment" },
  { title: "Book hotel", description: "Reserve your room in the group block.", kind: "manual" },
  { title: "Review schedule", description: "Look over the weekend plan so nothing sneaks up on you.", kind: "manual" },
];

export interface DraftItem {
  key: string;
  id?: number;
  title: string;
  description: string;
  link: string;
  kind: ChecklistItemKind;
  visible: boolean;
}

let keySeq = 0;
export const newDraftKey = () => `new-${++keySeq}`;

export function toDraft(items: ChecklistItem[]): DraftItem[] {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({
      key: i.id != null ? `id-${i.id}` : newDraftKey(),
      id: i.id,
      title: i.title,
      description: i.description ?? "",
      link: i.link ?? "",
      kind: i.kind,
      visible: i.visible,
    }));
}

/** Validation error for a draft item, or null when valid. */
export function draftError(d: DraftItem): string | null {
  if (!d.title.trim()) return "Add a title.";
  if (d.title.trim().length > 160) return "Title must be 160 characters or fewer.";
  if (d.description.length > 2000) return "Description must be 2000 characters or fewer.";
  if (d.link.trim() && !safeChecklistLink(d.link)) return "Links must start with http:// or https://.";
  return null;
}

/** Builds the save payload. Saved items keep their IDs so wording edits preserve member progress. */
export function draftToItems(drafts: DraftItem[]): ChecklistItem[] {
  return drafts.map((d, index) => ({
    ...(d.id != null ? { id: d.id } : {}),
    title: d.title.trim(),
    description: d.description.trim() || null,
    link: safeChecklistLink(d.link),
    kind: d.kind,
    visible: d.visible,
    sortOrder: index,
  }));
}

export function errorMessage(error: unknown, fallback: string): string {
  return (error as { data?: { error?: string } })?.data?.error ?? fallback;
}
