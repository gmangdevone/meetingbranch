import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReunionRole, ReunionViewerPermissions } from "@workspace/api-client-react";

// Each organizer page is responsible for passing the RIGHT `requiredRole` into
// OrganizerLayout. The shared layout tests prove the gating logic; these tests
// prove every page actually opts into it with the correct role. We render each
// page as a co-organizer WITHOUT the role (expect the access-denied panel) and
// WITH the role (expect the real page content).
//
// `summary` must be a STABLE reference across renders (OrganizerSettings resets
// a form in an effect keyed on it), so each test assigns it once via setSummary.
const hoisted = vi.hoisted(() => ({ summary: null as unknown, registrations: [] as unknown[] }));

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
    useAdminListReunions: () => ({ data: undefined }),
    getAdminListReunionsQueryKey: () => ["adminReunions"],
    useGetReunion: () => ({
      data: hoisted.summary,
      isLoading: false,
      isError: false,
    }),
    getGetReunionQueryKey: (id: number) => ["getReunion", id],
    // Registrations
    useListReunionRegistrations: () => ({ data: hoisted.registrations, isLoading: false }),
    getListReunionRegistrationsQueryKey: (id: number) => ["registrations", id],
    useListPaymentSubmissions: emptyList,
    getListPaymentSubmissionsQueryKey: (id: number) => ["payment-submissions", id],
    useListBranchFees: () => ({ data: undefined, isLoading: false }),
    getListBranchFeesQueryKey: (id: number) => ["branch-fees", id],
    useUpdateRegistrationPayment: noopMutation,
    useUpdateDinnerMode: noopMutation,
    useListDinnerHistory: () => ({ data: [], isLoading: false }),
    getListDinnerHistoryQueryKey: (id: number) => ["dinner-history", id],
    useUpdateContributionPayment: noopMutation,
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
    useReorderAnnouncements: noopMutation,
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
    useGetChecklistConfig: () => ({ data: { enabled: false, items: [] }, isLoading: false, isError: false }),
    getGetChecklistConfigQueryKey: (id: number) => ["checklistConfig", id],
    useSaveChecklistConfig: noopMutation,
  useRequestUploadUrl: noopMutation,
  useCreateReunionImage: noopMutation,
  useDeleteReunionImage: noopMutation,
  useListReunionImages: () => ({ data: undefined, isLoading: false }),
  getListReunionImagesQueryKey: (id: number) => ["images", id],
    useListReunionOrganizers: emptyList,
    getListReunionOrganizersQueryKey: (id: number) => ["organizers", id],
    useAddReunionOrganizer: noopMutation,
    useRemoveReunionOrganizer: noopMutation,
    useUpdateOrganizerRoles: noopMutation,
    useTransferReunionOwnership: noopMutation,
    useCreateFee: noopMutation,
    useUpdateFee: noopMutation,
    useDeleteFee: noopMutation,
    // Vendors
    useListVendors: () => ({ data: { vendors: [] }, isLoading: false }),
    getListVendorsQueryKey: (id: number) => ["vendors", id],
    useCreateVendor: noopMutation,
    useUpdateVendor: noopMutation,
    useDeleteVendor: noopMutation,
    useCreateVendorContract: noopMutation,
    useDeleteVendorContract: noopMutation,
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
import { OrganizerVendors } from "./OrganizerVendors";

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
      code: "ABC1234*",
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

it("shows add-on quantities and the correct recipients in the check-in dialog", () => {
  setSummary(makeViewer({ roles: ["registration"] }));
  (hoisted.summary as any).reunion.fees = [
    { id: 2, label: "Dinner", chargeType: "per_person", isOptional: true, isDinner: true, amount: 20, ageTiers: [] },
    { id: 3, label: "Photo package", chargeType: "flat", isOptional: true, amount: 10, ageTiers: [] },
  ];
  hoisted.registrations = [{
    id: 10, status: "active", branchName: "Test", userName: "Alex", userEmail: "alex@example.test",
    createdAt: "2027-01-01T00:00:00Z", paymentStatus: "pending", attendeeCount: 2, selectedFeeIds: [2, 3],
    attendees: [
      { id: 20, name: "Alex Adult", age: 40, includeDinner: true, shirtSize: "L", checkedInAt: null },
      { id: 21, name: "Sam Child", age: 8, includeDinner: false, shirtSize: "S", checkedInAt: null },
    ],
  }];
  try {
    render(<OrganizerRegistrations params={{ reunionId: "1" }} />);
    expect(screen.getByText("2 add-ons")).toBeInTheDocument();
    expect(screen.getByText("Dinner × 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /0\/2/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Alex Adult").parentElement).toHaveTextContent("Dinner: Included");
    expect(dialog.getByText("Alex Adult").parentElement).toHaveTextContent("T-Shirt Size: L");
    expect(dialog.getByText("Sam Child").parentElement).toHaveTextContent("No individual add-ons");
    expect(dialog.getByText("Sam Child").parentElement).toHaveTextContent("Dinner: Not included");
    expect(dialog.getByText("Sam Child").parentElement).toHaveTextContent("T-Shirt Size: S");
    expect(dialog.getByText("Household add-ons")).toBeInTheDocument();
    expect(dialog.getByText("Photo package × 1")).toBeInTheDocument();
  } finally {
    hoisted.registrations = [];
  }
});

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
  { name: "Vendors", Component: OrganizerVendors, role: "scout", otherRole: "power_user", heading: "Vendors" },
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
