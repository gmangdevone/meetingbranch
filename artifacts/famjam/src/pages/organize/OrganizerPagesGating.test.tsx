import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReunionRole, ReunionViewerPermissions } from "@workspace/api-client-react";

// Each organizer page is responsible for passing the RIGHT `requiredRole` into
// OrganizerLayout. The shared layout tests prove the gating logic; these tests
// prove every page actually opts into it with the correct role. We render each
// page as a co-organizer WITHOUT the role (expect the access-denied panel) and
// WITH the role (expect the real page content).
//
// `summary` must be a STABLE reference across renders (OrganizerSettings resets
// a form in an effect keyed on it), so each test assigns it once via setSummary.
const hoisted = vi.hoisted(() => ({ summary: null as unknown }));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/organize/1", vi.fn()],
}));

vi.mock("@workspace/api-client-react", () => {
  const noopMutation = () => ({ mutate: vi.fn(), isPending: false });
  const emptyList = () => ({ data: [], isLoading: false });
  return {
    // Layout + Settings + Branches
    useGetReunion: () => ({
      data: hoisted.summary,
      isLoading: false,
      isError: false,
    }),
    getGetReunionQueryKey: (id: number) => ["getReunion", id],
    // Registrations
    useListReunionRegistrations: emptyList,
    getListReunionRegistrationsQueryKey: (id: number) => ["registrations", id],
    useListPaymentSubmissions: emptyList,
    getListPaymentSubmissionsQueryKey: (id: number) => ["payment-submissions", id],
    useUpdateRegistrationPayment: noopMutation,
    useCancelRegistration: noopMutation,
    useTransferRegistration: noopMutation,
    useCreateManagedRegistration: noopMutation,
    useSetAttendeeCheckIn: noopMutation,
    getGetSponsorshipFundQueryKey: (id: number) => ["sponsorshipFund", id],
    useExportReunionRegistrations: () => ({ refetch: vi.fn(), isFetching: false }),
    getGetReunionSummaryQueryKey: (id: number) => ["reunionSummary", id],
    // Reports
    useGetReunionReports: () => ({
      data: {
        totalRegistrations: 0,
        totalAttendees: 0,
        paidCount: 0,
        pendingCount: 0,
        waivedCount: 0,
        dietaryCount: 0,
        byShirtSize: [],
        byGroup: [],
      },
      isLoading: false,
    }),
    getGetReunionReportsQueryKey: (id: number) => ["reports", id],
    // Announcements
    useListReunionAnnouncements: emptyList,
    getListReunionAnnouncementsQueryKey: (id: number) => ["announcements", id],
    useCreateAnnouncement: noopMutation,
    useUpdateAnnouncement: noopMutation,
    useDeleteAnnouncement: noopMutation,
    // Schedule
    useListReunionSchedule: emptyList,
    getListReunionScheduleQueryKey: (id: number) => ["schedule", id],
    useCreateScheduleItem: noopMutation,
    useUpdateScheduleItem: noopMutation,
    useDeleteScheduleItem: noopMutation,
    // Branches
    useCreateBranch: noopMutation,
    useUpdateBranch: noopMutation,
    useDeleteBranch: noopMutation,
    // Settings
    useUpdateReunion: noopMutation,
  useRequestUploadUrl: noopMutation,
    useListReunionOrganizers: emptyList,
    getListReunionOrganizersQueryKey: (id: number) => ["organizers", id],
    useAddReunionOrganizer: noopMutation,
    useRemoveReunionOrganizer: noopMutation,
    useUpdateOrganizerRoles: noopMutation,
    useTransferReunionOwnership: noopMutation,
    useCreateFee: noopMutation,
    useUpdateFee: noopMutation,
    useDeleteFee: noopMutation,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("../../hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { OrganizerRegistrations } from "./OrganizerRegistrations";
import { OrganizerReports } from "./OrganizerReports";
import { OrganizerAnnouncements } from "./OrganizerAnnouncements";
import { OrganizerSchedule } from "./OrganizerSchedule";
import { OrganizerBranches } from "./OrganizerBranches";
import { OrganizerSettings } from "./OrganizerSettings";

function makeViewer(overrides: Partial<ReunionViewerPermissions>): ReunionViewerPermissions {
  return {
    isOwner: false,
    isAdmin: false,
    canManageOrganizers: false,
    roles: [],
    ...overrides,
  };
}

function setSummary(viewer: ReunionViewerPermissions) {
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
      branches: [],
    },
    viewer,
  };
}

const DENIED_TEXT = "You don't have access to this area";

// Every organize page, the role it must require, and the heading that proves
// the real page content rendered.
const PAGES: Array<{
  name: string;
  Component: (props: { params: { reunionId: string } }) => React.ReactElement | null;
  role: ReunionRole;
  otherRole: ReunionRole;
  heading: string | RegExp;
}> = [
  { name: "Registrations", Component: OrganizerRegistrations, role: "registration", otherRole: "reports", heading: "Registrations" },
  { name: "Reports", Component: OrganizerReports, role: "reports", otherRole: "registration", heading: "Reports & Analytics" },
  { name: "Announcements", Component: OrganizerAnnouncements, role: "announcements", otherRole: "schedule", heading: "Announcements" },
  { name: "Schedule", Component: OrganizerSchedule, role: "schedule", otherRole: "announcements", heading: "Schedule Itinerary" },
  { name: "Branches", Component: OrganizerBranches, role: "branches", otherRole: "schedule", heading: "Family Branches" },
  { name: "Settings", Component: OrganizerSettings, role: "power_user", otherRole: "reports", heading: "Settings" },
];

describe.each(PAGES)("$name page role gating", ({ Component, role, otherRole, heading }) => {
  it(`shows the access-denied panel to a co-organizer without the "${role}" role`, () => {
    // Holds SOME role (so this isn't the "no areas assigned" case) — just not
    // the one this page requires.
    setSummary(makeViewer({ roles: [otherRole] }));

    render(<Component params={{ reunionId: "1" }} />);

    expect(screen.getByText(DENIED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: heading })).toBeNull();
  });

  it(`shows the page content to a co-organizer with the "${role}" role`, () => {
    setSummary(makeViewer({ roles: [role] }));

    render(<Component params={{ reunionId: "1" }} />);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByText(DENIED_TEXT)).toBeNull();
  });
});
