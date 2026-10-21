import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizerSchedule } from "./OrganizerSchedule";
import { ReunionSchedule } from "../ReunionSchedule";

const state = vi.hoisted(() => ({ rows: [] as any[], fail: false, invalidate: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock("./OrganizerLayout", () => ({ OrganizerLayout: ({ children }: any) => children }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("../../hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", () => ({
  getListReunionScheduleQueryKey: () => ["schedule"],
  getGetReunionByCodeQueryKey: () => ["reunion"],
  useGetReunionByCode: () => ({ data: { id: 1, code: "TEST", name: "Test reunion" } }),
  useListReunionSchedule: () => ({ data: state.rows }),
  useCreateScheduleItem: () => ({ isPending: false, mutate: ({ data }: any, options: any) => {
    if (state.fail) return options.onError();
    state.rows.push({ id: 1, ...data }); options.onSuccess();
  } }),
  useUpdateScheduleItem: () => ({ isPending: false, mutate: ({ data }: any, options: any) => {
    state.rows[0] = { ...state.rows[0], ...data }; options.onSuccess();
  } }),
  useDeleteScheduleItem: () => ({ mutate: vi.fn() }),
}));
beforeEach(() => { state.rows = []; state.fail = false; state.invalidate.mockClear(); });
afterEach(cleanup);

it("exposes touch-sized edit and delete actions without hover", () => {
  state.rows = [{ id: 1, title: "Picnic", day: "Saturday", startTime: "12:00" }];
  render(<OrganizerSchedule params={{ reunionId: "1" }} />);
  const edit = screen.getByRole("button", { name: "Edit event Picnic" });
  const remove = screen.getByRole("button", { name: "Delete event Picnic" });
  for (const button of [edit, remove]) {
    expect(button.className).toContain("h-11 w-11");
    expect(button.parentElement?.className).not.toContain("opacity-0");
  }
  fireEvent.click(edit);
  expect((screen.getByLabelText("Event Title") as HTMLInputElement).value).toBe("Picnic");
});

it("creates schedule links, shows them on both pages, and edits/removes them after remount", () => {
  let view = render(<OrganizerSchedule params={{ reunionId: "1" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Add Event" }));
  fireEvent.change(screen.getByLabelText("Event Title"), { target: { value: "Picnic" } });
  fireEvent.change(screen.getByLabelText("Description (Optional)"), { target: { value: "See directions" } });
  const description = screen.getByLabelText("Description (Optional)") as HTMLTextAreaElement;
  description.setSelectionRange(4, 14);
  fireEvent.click(screen.getByText("Insert Link"));
  expect((screen.getByText("Save Event") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Destination URL"), { target: { value: "https://example.com/map" } });
  fireEvent.click(screen.getByText("Apply Link"));
  fireEvent.click(screen.getByText("Save Event"));
  expect(state.rows[0].description).toBe("See [directions](https://example.com/map)");
  expect(state.invalidate).toHaveBeenCalled();
  view.unmount();
  view = render(<ReunionSchedule params={{ code: "TEST" }} />);
  expect(screen.getByRole("link", { name: "directions" }).getAttribute("href")).toBe("https://example.com/map");
  view.unmount();
  render(<OrganizerSchedule params={{ reunionId: "1" }} />);
  expect(screen.getByRole("link", { name: "directions" }).getAttribute("target")).toBe("_blank");
  fireEvent.click(screen.getByRole("button", { name: "Edit event Picnic" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit link directions" }));
  fireEvent.change(screen.getByLabelText("Display text"), { target: { value: "map" } });
  fireEvent.click(screen.getByText("Apply Link"));
  fireEvent.click(screen.getByRole("button", { name: "Remove link map" }));
  fireEvent.click(screen.getByText("Save Event"));
  expect(state.rows[0].description).toBe("See map");
});

it("blocks unsafe links and preserves edits when saving fails", () => {
  render(<OrganizerSchedule params={{ reunionId: "1" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Add Event" }));
  fireEvent.change(screen.getByLabelText("Event Title"), { target: { value: "Picnic" } });
  fireEvent.change(screen.getByLabelText("Description (Optional)"), { target: { value: "[bad](javascript:evil)" } });
  fireEvent.click(screen.getByText("Save Event"));
  expect(screen.getByRole("alert").textContent).toContain("invalid URL");
  expect(state.rows).toHaveLength(0);
  state.fail = true;
  fireEvent.change(screen.getByLabelText("Description (Optional)"), { target: { value: "Retain this" } });
  fireEvent.click(screen.getByText("Save Event"));
  expect(screen.getByRole("alert").textContent).toContain("Could not save");
  expect((screen.getByLabelText("Description (Optional)") as HTMLTextAreaElement).value).toBe("Retain this");
});
