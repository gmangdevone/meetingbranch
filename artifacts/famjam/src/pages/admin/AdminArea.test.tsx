import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminArea } from "./AdminArea";

const mocks = vi.hoisted(() => ({
  toggle: vi.fn(), remove: vi.fn(),
  reunions: vi.fn(), settings: vi.fn(), users: vi.fn(),
  retrySettings: vi.fn(), retryUsers: vi.fn(),
}));
const settingsData = { testerEmails: [], reunionCreationEnabled: true, signInsLocked: false };
const usersData = [
  { id: "member", email: "member@example.test", firstName: "Test", lastName: "Member", registrationCount: 2, attendeeCount: 4, isAdmin: false },
];
beforeEach(() => {
  mocks.reunions.mockReturnValue({ data: [] });
  mocks.settings.mockReturnValue({ data: settingsData, refetch: mocks.retrySettings });
  mocks.users.mockReturnValue({ data: usersData, refetch: mocks.retryUsers });
});
vi.mock("@clerk/react", () => ({ useAuth: () => ({ userId: "admin" }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/admin", vi.fn()], Link: ({ children }: any) => children }));
vi.mock("../../hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/ContentTextSize", () => ({ ContentTextSizeSetting: () => null }));
vi.mock("@workspace/api-client-react", () => ({
  useAdminListReunions: mocks.reunions,
  useAdminGetSettings: mocks.settings,
  useAdminListUsers: mocks.users,
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

it.each(["users", "settings"] as const)("shows a %s error and recovers after retry without opening Users", (resource) => {
  const retry = resource === "users" ? mocks.retryUsers : mocks.retrySettings;
  const data = resource === "users" ? usersData : settingsData;
  mocks[resource].mockReturnValue({ isError: true, refetch: retry });
  const view = render(<AdminArea />);
  expect(screen.getByRole("alert")).toHaveTextContent(`Could not load ${resource}`);
  expect(screen.queryByText("Loading admin area...")).not.toBeInTheDocument();
  expect(screen.queryByText("Allow New Reunions")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: `Retry ${resource}` }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(resource === "users" ? mocks.retrySettings : mocks.retryUsers).not.toHaveBeenCalled();

  mocks[resource].mockReturnValue({ isError: true, isFetching: true, refetch: retry });
  view.rerender(<AdminArea />);
  expect(screen.getByRole("button", { name: `Retrying ${resource}...` })).toBeDisabled();
  mocks[resource].mockReturnValue({ data, isError: false, refetch: retry });
  view.rerender(<AdminArea />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Allow New Reunions")).toBeVisible();
  expect(screen.getByRole("button", { name: "Users" })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  expect(screen.getByText("member@example.test")).toBeVisible();
});

it("offers independent retries when both requests fail and keeps a repeated failure actionable", () => {
  mocks.users.mockReturnValue({ isError: true, refetch: mocks.retryUsers });
  mocks.settings.mockReturnValue({ isError: true, refetch: mocks.retrySettings });
  const view = render(<AdminArea />);
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Retry settings" }));
  expect(mocks.retrySettings).toHaveBeenCalledTimes(1);
  mocks.settings.mockReturnValue({ data: settingsData, refetch: mocks.retrySettings });
  view.rerender(<AdminArea />);
  expect(screen.queryByRole("button", { name: "Retry settings" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry users" }));
  view.rerender(<AdminArea />);
  expect(screen.getByRole("button", { name: "Retry users" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry users" }));
  expect(mocks.retryUsers).toHaveBeenCalledTimes(2);
});

it.each(["loading", "denied"] as const)("preserves the access gate while %s even if dependent requests failed", (state) => {
  mocks.reunions.mockReturnValue({ isLoading: state === "loading", isError: state === "denied" });
  mocks.users.mockReturnValue({ isError: true, refetch: mocks.retryUsers });
  mocks.settings.mockReturnValue({ isError: true, refetch: mocks.retrySettings });
  render(<AdminArea />);
  expect(screen.getByText(state === "loading" ? "Loading admin area..." : "Access Denied")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Allow New Reunions")).not.toBeInTheDocument();
  expect(mocks.users).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }));
  expect(mocks.settings).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }));
});

it("keeps loading distinct from an error while dependent data is pending", () => {
  mocks.users.mockReturnValue({ isLoading: true });
  render(<AdminArea />);
  expect(screen.getByText("Loading admin area...")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
