import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReunionRole, ReunionViewerPermissions } from "@workspace/api-client-react";

// The layout reads the reunion (with the viewer's permissions) from the API and
// the current path from the router. Mock both so we can drive the gating logic
// directly. `hoisted` is referenced inside vi.mock factories, so it must be
// created via vi.hoisted to survive hoisting.
const hoisted = vi.hoisted(() => ({
  summary: null as unknown,
  isLoading: false,
  isError: false,
  location: "/organize/1",
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => [hoisted.location, vi.fn()],
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetReunion: () => ({
    data: hoisted.summary,
    isLoading: hoisted.isLoading,
    isError: hoisted.isError,
  }),
  getGetReunionQueryKey: (id: number) => ["getReunion", id],
}));

import { OrganizerLayout } from "./OrganizerLayout";

function makeViewer(overrides: Partial<ReunionViewerPermissions>): ReunionViewerPermissions {
  return {
    isOwner: false,
    isAdmin: false,
    canManageOrganizers: false,
    roles: [],
    ...overrides,
  };
}

function setReunion(viewer: ReunionViewerPermissions) {
  hoisted.summary = {
    reunion: {
      id: 1,
      code: "ABC1234",
      name: "Test Reunion",
      startDate: "2027-07-01",
      endDate: "2027-07-03",
      paymentHandle: "@test",
      paymentUrl: null,
      fees: [],
    },
    viewer,
  };
  hoisted.isLoading = false;
  hoisted.isError = false;
}

const ALL_AREAS = [
  "Overview",
  "Registrations",
  "Reports",
  "Announcements",
  "Schedule",
  "Branches",
  "Settings",
];

function visibleNavLabels(): string[] {
  return ALL_AREAS.filter((label) =>
    screen.queryByRole("link", { name: label }) !== null,
  );
}

beforeEach(() => {
  hoisted.location = "/organize/1";
});

describe("OrganizerLayout nav filtering", () => {
  it("shows a co-organizer only the areas they hold, plus Overview", () => {
    setReunion(makeViewer({ roles: ["announcements", "schedule"] }));

    render(
      <OrganizerLayout reunionId={1}>
        <div data-testid="content">Overview content</div>
      </OrganizerLayout>,
    );

    expect(visibleNavLabels().sort()).toEqual(
      ["Announcements", "Overview", "Schedule"].sort(),
    );
    // Areas they don't hold are absent from the sidebar.
    expect(screen.queryByRole("link", { name: "Registrations" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Reports" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Branches" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("shows the Settings link to a power_user co-organizer", () => {
    setReunion(makeViewer({ roles: ["power_user"] }));

    render(
      <OrganizerLayout reunionId={1}>
        <div>content</div>
      </OrganizerLayout>,
    );

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeNull();
  });

  it("shows every area to the owner", () => {
    setReunion(makeViewer({ isOwner: true, canManageOrganizers: true, roles: [] }));

    render(
      <OrganizerLayout reunionId={1}>
        <div>content</div>
      </OrganizerLayout>,
    );

    expect(visibleNavLabels().sort()).toEqual([...ALL_AREAS].sort());
  });

  it("shows every area to a platform admin", () => {
    setReunion(makeViewer({ isAdmin: true, canManageOrganizers: true, roles: [] }));

    render(
      <OrganizerLayout reunionId={1}>
        <div>content</div>
      </OrganizerLayout>,
    );

    expect(visibleNavLabels().sort()).toEqual([...ALL_AREAS].sort());
  });
});

describe("OrganizerLayout access gating", () => {
  it("renders the page content when the viewer holds the required role", () => {
    setReunion(makeViewer({ roles: ["reports"] }));

    render(
      <OrganizerLayout reunionId={1} requiredRole={"reports" as ReunionRole}>
        <div data-testid="content">Reports content</div>
      </OrganizerLayout>,
    );

    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to this area")).toBeNull();
  });

  it("shows the access-denied panel (not the content) for a denied area", () => {
    setReunion(makeViewer({ roles: ["announcements"] }));

    render(
      <OrganizerLayout reunionId={1} requiredRole={"reports" as ReunionRole}>
        <div data-testid="content">Reports content</div>
      </OrganizerLayout>,
    );

    expect(screen.getByText("You don't have access to this area")).toBeInTheDocument();
    expect(screen.queryByTestId("content")).toBeNull();
  });

  it("shows the 'no areas assigned yet' panel for a co-organizer with no roles", () => {
    setReunion(makeViewer({ roles: [] }));

    render(
      <OrganizerLayout reunionId={1}>
        <div data-testid="content">Overview content</div>
      </OrganizerLayout>,
    );

    expect(screen.getByText("No areas assigned yet")).toBeInTheDocument();
    expect(screen.queryByTestId("content")).toBeNull();
  });

  it("shows the Overview content to the owner even with no explicit roles", () => {
    setReunion(makeViewer({ isOwner: true, canManageOrganizers: true, roles: [] }));

    render(
      <OrganizerLayout reunionId={1}>
        <div data-testid="content">Overview content</div>
      </OrganizerLayout>,
    );

    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(screen.queryByText("No areas assigned yet")).toBeNull();
  });
});
