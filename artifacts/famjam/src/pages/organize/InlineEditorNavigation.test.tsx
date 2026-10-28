import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { installUnsavedChangesProtection } from "../../lib/unsavedChanges";
import { OrganizerBranches } from "./OrganizerBranches";
import { OrganizerPolls } from "./OrganizerPolls";
import { OrganizerActivities } from "./OrganizerActivities";
import { FundContentEditor } from "../../components/FundContentEditor";

const mocks = vi.hoisted(() => ({ saveFund: vi.fn().mockResolvedValue({}) }));

vi.mock("./OrganizerLayout", () => ({
  OrganizerLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useUpdateReunion: () => ({ mutateAsync: mocks.saveFund, isPending: false }),
  useGetReunion: () => ({ data: { reunion: { branches: [{ id: 1, name: "Original", sortOrder: 1 }] } } }),
  useListManagePolls: () => ({ data: [{ poll: { id: 1, question: "Where?", options: [], maxVotesPerMember: 1 }, results: [], totalVotes: 0 }] }),
  useListManageActivityChoices: () => ({ data: [{ group: { id: 1, title: "Outdoors", options: [] } }] }),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("inline organizer draft navigation", () => {
  it.each([
    { name: "new branch", Component: OrganizerBranches, input: () => screen.getByPlaceholderText("New branch name...") },
    { name: "poll option", Component: OrganizerPolls, input: () => screen.getByPlaceholderText("Add another option…") },
    { name: "activity", Component: OrganizerActivities, input: () => screen.getByLabelText("Activity name") },
  ])("preserves $name on cancelled Back and allows clean navigation", async ({ Component, input }) => {
    history.replaceState(null, "", "/previous");
    const dispose = installUnsavedChangesProtection();
    history.pushState(null, "", "/editor");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<QueryClientProvider client={new QueryClient()}><Component params={{ reunionId: "1" }} /></QueryClientProvider>);
      fireEvent.change(input(), { target: { value: "Unfinished" } });
      act(() => history.back());
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(location.pathname).toBe("/editor"));
      expect(input()).toHaveValue("Unfinished");
      act(() => history.pushState(null, "", "/event/2"));
      expect(location.pathname).toBe("/editor");
      expect(confirm).toHaveBeenCalledTimes(2);
      fireEvent.change(input(), { target: { value: "" } });
      act(() => history.pushState(null, "", "/event/2"));
      expect(location.pathname).toBe("/event/2");
      expect(confirm).toHaveBeenCalledTimes(2);
    } finally { dispose(); }
  });

  it("guards a branch rename but not an unchanged name", () => {
    history.replaceState(null, "", "/editor");
    const dispose = installUnsavedChangesProtection();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<QueryClientProvider client={new QueryClient()}><OrganizerBranches params={{ reunionId: "1" }} /></QueryClientProvider>);
      fireEvent.click(screen.getByText("Original").parentElement!.querySelector("button")!);
      const input = screen.getByDisplayValue("Original");
      fireEvent.change(input, { target: { value: "Renamed" } });
      act(() => history.pushState(null, "", "/event/2"));
      expect(location.pathname).toBe("/editor");
      expect(input).toHaveValue("Renamed");
      fireEvent.change(input, { target: { value: "Original" } });
      act(() => history.pushState(null, "", "/event/2"));
      expect(location.pathname).toBe("/event/2");
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally { dispose(); }
  });

  it("preserves fund display edits on Back and clears the guard after saving", async () => {
    history.replaceState(null, "", "/previous");
    const dispose = installUnsavedChangesProtection();
    history.pushState(null, "", "/fund");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<QueryClientProvider client={new QueryClient()}><FundContentEditor reunionId={1} /></QueryClientProvider>);
      fireEvent.change(screen.getByLabelText("Fund name"), { target: { value: "Our Fund" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Unfinished description" } });
      act(() => history.back());
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(location.pathname).toBe("/fund"));
      expect(screen.getByLabelText("Fund name")).toHaveValue("Our Fund");
      expect(screen.getByLabelText("Description")).toHaveValue("Unfinished description");
      fireEvent.click(screen.getByRole("button", { name: "Save Fund Details" }));
      await screen.findByText("Fund details saved.");
      act(() => history.back());
      await waitFor(() => expect(location.pathname).toBe("/previous"));
      expect(confirm).toHaveBeenCalledTimes(1);
    } finally { dispose(); }
  });
});
