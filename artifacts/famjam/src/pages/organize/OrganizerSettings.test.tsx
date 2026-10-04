import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReunionViewerPermissions } from "@workspace/api-client-react";

// OrganizerSettings pulls in a lot of API hooks. We only care about one piece of
// behavior here: the "Organizers" management section must be hidden from a
// co-organizer who cannot manage organizers (even a power_user), and shown to the
// owner. Mock the whole API client + router + query client + toast so the page
// renders in jsdom against a controllable viewer.
// `summary` must be a STABLE reference across renders: OrganizerSettings has a
// useEffect keyed on it that resets the form, so a fresh object each render would
// loop forever. Each test assigns a new summary object once.
const hoisted = vi.hoisted(() => ({
  summary: null as unknown,
  updateMutate: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/organize/1/settings", vi.fn()],
}));

vi.mock("@workspace/api-client-react", () => {
  const noopMutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
  useGetReunion: () => ({
    data: hoisted.summary,
    isLoading: false,
    isError: false,
  }),
  getGetReunionQueryKey: (id: number) => ["getReunion", id],
  useUpdateReunion: () => ({ mutate: hoisted.updateMutate, isPending: false }),
  useRequestUploadUrl: noopMutation,
  useCreateReunionImage: noopMutation,
  useDeleteReunionImage: noopMutation,
  useListReunionImages: () => ({ data: undefined, isLoading: false }),
  getListReunionImagesQueryKey: (id: number) => ["images", id],
  useListReunionOrganizers: () => ({ data: [], isLoading: false }),
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
      code: "ABC1234*",
      name: "Test Reunion",
      startDate: "2027-07-01",
      endDate: "2027-07-03",
      paymentHandle: null,
      paymentUrl: null,
      paymentRecipient: { reunionId: 1, status: "pending_review", cashAppTag: null, cashAppUrl: null, paymentHandle: null, paymentUrl: null, approvedAt: null },
      registrationsOpen: true,
      allowRegistrantEdits: false,
      fees: [],
    },
    viewer,
  };
}

describe("OrganizerSettings organizers section gating", () => {
  it("renders Settings for a power_user co-organizer but hides the Organizers section", () => {
    setSummary(makeViewer({ roles: ["power_user"] }));

    render(<OrganizerSettings params={{ reunionId: "1" }} />);

    // The page itself renders (power_user can edit reunion details + fees).
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Fees & Dues/ })).toBeInTheDocument();
    // ...but the owner-only organizers roster is not shown.
    expect(screen.queryByRole("heading", { name: "Organizers" })).toBeNull();
  });

  it("shows the Organizers section to the owner", () => {
    setSummary(makeViewer({ isOwner: true, canManageOrganizers: true, roles: ["power_user"] }));

    render(<OrganizerSettings params={{ reunionId: "1" }} />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Organizers" })).toBeInTheDocument();
  });

  it("normalizes and submits an updated Event Code with a link warning", async () => {
    hoisted.updateMutate.mockReset();
    hoisted.updateMutate.mockImplementation(
      (_variables, options) => options?.onSuccess?.(),
    );
    setSummary(makeViewer({ roles: ["power_user"] }));
    render(<OrganizerSettings params={{ reunionId: "1" }} />);

    const codeInput = screen.getByLabelText("Event Code");
    expect(codeInput).toHaveValue("ABC1234*");

    fireEvent.change(codeInput, { target: { value: "family27*" } });

    expect(codeInput).toHaveValue("FAMILY27*");
    expect(
      screen.getByText(/Previously shared links and saved codes will stop working/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(hoisted.updateMutate).toHaveBeenCalled();
    });
    expect(hoisted.updateMutate.mock.calls[0][0]).toMatchObject({
      reunionId: 1,
      data: { code: "FAMILY27*" },
    });
    // Organizers never send receiving-destination fields.
    const sent = hoisted.updateMutate.mock.calls[0][0].data;
    for (const k of ["paymentHandle", "paymentUrl", "cashAppTag"]) expect(sent).not.toHaveProperty(k);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Settings saved. The Event Code and join link have been updated.",
    );
  });

  it("shows a read-only payment destination with platform-owner guidance and no inputs", () => {
    setSummary(makeViewer({ roles: ["power_user"] }));
    render(<OrganizerSettings params={{ reunionId: "1" }} />);
    expect(screen.getByTestId("recipient-status-card")).toHaveTextContent(/contact the platform owner/);
    expect(screen.queryByLabelText(/Cashtag/)).toBeNull();
    expect(screen.queryByLabelText("Payment Link")).toBeNull();
  });
});
