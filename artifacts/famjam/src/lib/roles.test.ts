import { describe, it, expect } from "vitest";
import type { ReunionViewerPermissions } from "@workspace/api-client-react";
import { viewerHasRole, viewerHasAnyRole, FULL_ACCESS_VIEWER } from "./roles";

function viewer(overrides: Partial<ReunionViewerPermissions>): ReunionViewerPermissions {
  return {
    isOwner: false,
    isAdmin: false,
    canManageOrganizers: false,
    roles: [],
    ...overrides,
  };
}

describe("viewerHasRole", () => {
  it("grants a role a co-organizer explicitly holds", () => {
    expect(viewerHasRole(viewer({ roles: ["announcements"] }), "announcements")).toBe(true);
  });

  it("denies a role a co-organizer does not hold", () => {
    expect(viewerHasRole(viewer({ roles: ["announcements"] }), "reports")).toBe(false);
  });

  it("lets the owner bypass every role check", () => {
    const owner = viewer({ isOwner: true });
    expect(viewerHasRole(owner, "reports")).toBe(true);
    expect(viewerHasRole(owner, "power_user")).toBe(true);
  });

  it("lets a platform admin bypass every role check", () => {
    const admin = viewer({ isAdmin: true });
    expect(viewerHasRole(admin, "branches")).toBe(true);
  });

  it("treats a missing viewer as full access (never locks the owner out)", () => {
    expect(viewerHasRole(undefined, "power_user")).toBe(true);
    expect(FULL_ACCESS_VIEWER.roles).toContain("power_user");
  });
});

describe("viewerHasAnyRole", () => {
  it("is false for a co-organizer with no roles yet", () => {
    expect(viewerHasAnyRole(viewer({ roles: [] }))).toBe(false);
  });

  it("is true for a co-organizer with at least one role", () => {
    expect(viewerHasAnyRole(viewer({ roles: ["schedule"] }))).toBe(true);
  });

  it("is true for the owner even with no explicit roles", () => {
    expect(viewerHasAnyRole(viewer({ isOwner: true, roles: [] }))).toBe(true);
  });
});
