import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizerAnnouncements } from "./OrganizerAnnouncements";

const state = vi.hoisted(() => ({ rows: [] as any[], fail: false, invalidate: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock("./OrganizerLayout", () => ({ OrganizerLayout: ({ children }: any) => children }));
vi.mock("../../hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", () => ({
  getListReunionAnnouncementsQueryKey: () => ["announcements"],
  useListReunionAnnouncements: () => ({ data: state.rows }),
  useCreateAnnouncement: () => ({ isPending: false, mutate: ({ data }: any, options: any) => {
    if (state.fail) return options.onError();
    state.rows.push({ id: 1, ...data, createdAt: "2026-10-19T00:00:00Z" });
    options.onSuccess();
  } }),
  useUpdateAnnouncement: () => ({ isPending: false, mutate: ({ data }: any, options: any) => {
    state.rows[0] = { ...state.rows[0], ...data }; options.onSuccess();
  } }),
  useDeleteAnnouncement: () => ({ mutate: vi.fn() }),
}));
beforeEach(() => { state.rows = []; state.fail = false; state.invalidate.mockClear(); });
afterEach(cleanup);

it("saves labelled links, displays them after remount, and preserves them during edits", async () => {
  const view = render(<OrganizerAnnouncements params={{ reunionId: "1" }} />);
  fireEvent.click(screen.getByText("New Post"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hotel" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Book [rooms](https://example.com/rooms) today." } });
  fireEvent.click(screen.getByText("Post Announcement"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(state.invalidate).toHaveBeenCalled();
  view.unmount();
  render(<OrganizerAnnouncements params={{ reunionId: "1" }} />);
  expect(screen.getByRole("link", { name: "rooms" }).getAttribute("href")).toBe("https://example.com/rooms");
  fireEvent.click(screen.getByRole("button", { name: "Edit announcement Hotel" }));
  expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(state.rows[0].body);
  fireEvent.click(screen.getByRole("button", { name: "Remove link rooms" }));
  fireEvent.click(screen.getByText("Save Changes"));
  expect(state.rows[0].body).toBe("Book rooms today.");
});

it("keeps edits and shows an inline error when saving fails", () => {
  state.fail = true;
  render(<OrganizerAnnouncements params={{ reunionId: "1" }} />);
  fireEvent.click(screen.getByText("New Post"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Update" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Retain this" } });
  fireEvent.click(screen.getByText("Post Announcement"));
  expect(screen.getByRole("alert").textContent).toContain("Could not save");
  expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Retain this");
});
