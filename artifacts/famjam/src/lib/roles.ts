import type { ReunionRole, ReunionViewerPermissions } from "@workspace/api-client-react";

/**
 * The delegable co-organizer roles, in display order, with human-facing labels
 * and a short description of what each unlocks. Mirrors the ReunionRole enum in
 * the API/DB — keep in sync if roles are added or renamed.
 */
export const ROLE_OPTIONS: {
  value: ReunionRole;
  label: string;
  description: string;
}[] = [
  {
    value: "registration",
    label: "Registration",
    description: "View registrations, export the roster, and update payment status.",
  },
  {
    value: "announcements",
    label: "Announcements",
    description: "Post, edit, and delete reunion announcements.",
  },
  {
    value: "schedule",
    label: "Schedule",
    description: "Manage the reunion schedule of events.",
  },
  {
    value: "branches",
    label: "Branches",
    description: "Manage the family branches for the reunion.",
  },
  {
    value: "reports",
    label: "Reports",
    description: "View reporting and analytics.",
  },
  {
    value: "power_user",
    label: "Power User",
    description: "Edit reunion details, payment info, and fees & dues.",
  },
];

export const ROLE_LABELS: Record<ReunionRole, string> = ROLE_OPTIONS.reduce(
  (acc, r) => {
    acc[r.value] = r.label;
    return acc;
  },
  {} as Record<ReunionRole, string>,
);

/**
 * A permissive fallback used only when viewer permissions are missing from the
 * API response (they should always be present on the manage detail endpoint).
 * Treating a missing viewer as full access avoids ever locking the owner out.
 */
export const FULL_ACCESS_VIEWER: ReunionViewerPermissions = {
  isOwner: true,
  isAdmin: true,
  canManageOrganizers: true,
  roles: ROLE_OPTIONS.map((r) => r.value),
};

export function viewerHasRole(
  viewer: ReunionViewerPermissions | undefined,
  role: ReunionRole,
): boolean {
  const v = viewer ?? FULL_ACCESS_VIEWER;
  return v.isOwner || v.isAdmin || v.roles.includes(role);
}

export function viewerHasAnyRole(viewer: ReunionViewerPermissions | undefined): boolean {
  const v = viewer ?? FULL_ACCESS_VIEWER;
  return v.isOwner || v.isAdmin || v.roles.length > 0;
}
