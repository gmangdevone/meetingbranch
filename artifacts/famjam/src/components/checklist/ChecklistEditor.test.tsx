import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChecklistEditor } from "./ChecklistEditor";
const h = vi.hoisted(() => ({ data: { enabled: false, items: [] as any[] }, mutate: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useGetChecklistConfig: () => ({ data: h.data, isLoading: false, isError: false }),
  getGetChecklistConfigQueryKey: (id: number) => ["checklistConfig", id],
  useSaveChecklistConfig: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock("../../hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const mount = () => render(<QueryClientProvider client={new QueryClient()}><ChecklistEditor reunionId={7} /></QueryClientProvider>);
beforeEach(() => { h.data = { enabled: false, items: [] }; h.mutate.mockReset(); });
afterEach(cleanup);
describe("checklist editor", () => {
  it("builds and enables a suggested checklist without writing before Save", () => {
    mount();
    fireEvent.click(screen.getByText("Book hotel"));
    fireEvent.click(screen.getByRole("switch"));
    expect(h.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-save-checklist"));
    expect(h.mutate.mock.calls[0][0]).toMatchObject({
      reunionId: 7, data: { enabled: true, items: [{ title: "Book hotel", kind: "manual", visible: true, sortOrder: 0 }] },
    });
    expect(h.mutate.mock.calls[0][0].data.items[0].id).toBeUndefined();
  });
  it("preserves saved IDs on wording changes and hiding", () => {
    h.data = { enabled: true, items: [{ id: 5, title: "Book hotel", kind: "manual", visible: true, sortOrder: 0 }] };
    mount();
    fireEvent.change(screen.getByLabelText("Item 1 title"), { target: { value: "Reserve your room" } });
    fireEvent.click(screen.getByLabelText("Hide item 1"));
    fireEvent.click(screen.getByTestId("button-save-checklist"));
    expect(h.mutate.mock.calls[0][0].data.items[0]).toMatchObject({ id: 5, title: "Reserve your room", visible: false });
  });
  it("rejects unsafe links and keeps edits after a server failure", () => {
    h.data = { enabled: true, items: [{ id: 5, title: "Book hotel", kind: "manual", visible: true, sortOrder: 0 }] };
    mount();
    fireEvent.change(screen.getByLabelText("Item 1 link"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByTestId("button-save-checklist"));
    expect(h.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Item 1 link"), { target: { value: "https://example.test/hotel" } });
    h.mutate.mockImplementation((_data, callbacks) => callbacks.onError({ data: { error: "Could not save checklist" } }));
    fireEvent.click(screen.getByTestId("button-save-checklist"));
    expect(screen.getByText("Could not save checklist")).toBeTruthy();
    expect(screen.getByLabelText("Item 1 link")).toHaveValue("https://example.test/hotel");
  });
});
