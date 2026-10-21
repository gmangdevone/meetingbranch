import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdminArea } from "./AdminArea";

const mocks = vi.hoisted(() => ({ toggle: vi.fn(), remove: vi.fn() }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ userId: "admin" }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/admin", vi.fn()], Link: ({ children }: any) => children }));
vi.mock("../../hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/ContentTextSize", () => ({ ContentTextSizeSetting: () => null }));
vi.mock("@workspace/api-client-react", () => ({
  useAdminListReunions: () => ({ data: [] }),
  useAdminGetSettings: () => ({ data: { testerEmails: [], reunionCreationEnabled: true, signInsLocked: false } }),
  useAdminListUsers: () => ({ data: [
    { id: "member", email: "member@example.test", firstName: "Test", lastName: "Member", registrationCount: 2, attendeeCount: 4, isAdmin: false },
  ] }),
  useAdminUpdateSettings: () => ({ mutate: vi.fn() }),
  useAdminToggleAdminFlag: () => ({ mutate: mocks.toggle }),
  useAdminRemoveUser: () => ({ mutate: mocks.remove }),
  getAdminListReunionsQueryKey: () => ["reunions"],
  getAdminGetSettingsQueryKey: () => ["admin-settings"],
  getAdminListUsersQueryKey: () => ["users"],
  getGetSettingsQueryKey: () => ["settings"],
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("starts closed, expands and collapses with linked accessible state", () => {
  render(<AdminArea />);
  const trigger = screen.getByRole("button", { name: "Users" });
  expect(screen.getByRole("heading", { name: "Users" })).toBeVisible();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("member@example.test")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "All Reunions" })).toBeVisible();
  expect(screen.getByText("Total Users: 1")).toBeVisible();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBeVisible();
  expect(screen.getByText("member@example.test")).toBeVisible();
  expect(screen.getByText("2 regs")).toBeVisible();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("member@example.test")).not.toBeInTheDocument();
});

it("resets to closed on a fresh visit", () => {
  const view = render(<AdminArea />);
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  view.unmount();
  render(<AdminArea />);
  expect(screen.getByRole("button", { name: "Users" })).toHaveAttribute("aria-expanded", "false");
});

it("preserves admin controls and the removal confirmation when expanded", () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<AdminArea />);
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  const row = screen.getByText("member@example.test").closest("tr")!;
  fireEvent.click(within(row).getByRole("switch"));
  expect(mocks.toggle).toHaveBeenCalledWith({ id: "member", data: { isAdmin: true } }, expect.anything());
  fireEvent.click(within(row).getByTitle("Remove user"));
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByText("Keep registrations")).toBeVisible();
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
