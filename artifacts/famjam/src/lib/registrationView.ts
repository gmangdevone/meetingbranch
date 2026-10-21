import { RegistrationViewField } from "@workspace/api-client-react";

export type ViewField = RegistrationViewField;

/** Display order of every customizable field/action. */
export const VIEW_FIELDS: ViewField[] = [
  "date", "branch", "attendees", "addons", "checkin", "balance", "payment", "edit", "transfer",
];

export const FIELD_LABEL: Record<ViewField, string> = {
  date: "Date",
  branch: "Branch",
  attendees: "Attendees",
  addons: "Add-ons",
  checkin: "Check-in",
  balance: "Balance",
  payment: "Payment",
  edit: "Edit",
  transfer: "Transfer",
};

export const ACTION_FIELDS: ViewField[] = ["edit", "transfer"];

export const PRESETS = {
  default: { label: "Default", fields: ["date", "balance", "payment"] as ViewField[] },
  checkin: { label: "Check-in", fields: ["checkin", "payment"] as ViewField[] },
  payments: { label: "Payment management", fields: ["balance", "payment", "edit"] as ViewField[] },
} as const;
export type PresetKey = keyof typeof PRESETS;

export const DEFAULT_FIELDS = PRESETS.default.fields;

/** Keep only supported identifiers, drop duplicates, and order canonically. */
export function normalizeFields(fields: readonly unknown[] | null | undefined): ViewField[] {
  const set = new Set((fields ?? []).filter((f): f is ViewField => VIEW_FIELDS.includes(f as ViewField)));
  return VIEW_FIELDS.filter((f) => set.has(f));
}

export function sameFields(a: readonly ViewField[], b: readonly ViewField[]) {
  const na = normalizeFields(a);
  const nb = normalizeFields(b);
  return na.length === nb.length && na.every((f, i) => f === nb[i]);
}

export function matchPreset(fields: readonly ViewField[]): PresetKey | null {
  for (const key of Object.keys(PRESETS) as PresetKey[]) {
    if (sameFields(fields, PRESETS[key].fields)) return key;
  }
  return null;
}
