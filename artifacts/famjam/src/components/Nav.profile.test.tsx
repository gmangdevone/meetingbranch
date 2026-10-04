import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Nav } from "./Nav";

const auth = vi.hoisted(() => ({
  signedIn: true,
  firstName: "",
  openUserProfile: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isSignedIn: auth.signedIn }),
  useUser: () => ({ user: { firstName: auth.firstName } }),
  useClerk: () => auth,
}));
const caps = vi.hoisted(() => ({ admin: false, owner: false }));
vi.mock("@workspace/api-client-react", () => ({
  useAdminListReunions: () => (caps.admin ? { data: [] } : { isError: true }),
  useGetMyPaymentOwnerCapability: () => ({ data: { isPaymentOwner: caps.owner } }),
  getGetMyPaymentOwnerCapabilityQueryKey: () => ["owner"],
  getAdminListReunionsQueryKey: () => ["admin"],
  useGetSettings: () => ({ data: { reunionCreationEnabled: false } }),
}));

beforeEach(() => {
  auth.signedIn = true;
  auth.firstName = "";
  caps.admin = false;
  caps.owner = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("account profile menu", () => {
  it.each([0, 1])("opens the profile editor and closes account menu %i", (index) => {
    render(<Nav />);
    fireEvent.click(screen.getAllByRole("button", { name: "Account" })[index]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage profile" }));
    expect(auth.openUserProfile).toHaveBeenCalledOnce();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("reflects a name updated by the sign-in provider", () => {
    const view = render(<Nav />);
    auth.firstName = "Taylor";
    view.rerender(<Nav />);
    expect(screen.getAllByRole("button", { name: "Taylor" })).toHaveLength(2);
  });

  it("does not offer account actions to signed-out visitors", () => {
    auth.signedIn = false;
    render(<Nav />);
    expect(screen.queryByRole("button", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.queryByText("Manage profile")).not.toBeInTheDocument();
  });
});
describe("payment recipients nav link", () => {
  it("shows for the payment owner even when not an admin", () => {
    caps.owner = true;
    render(<Nav />);
    expect(screen.getByRole("link", { name: /Payment recipients/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Admin$/ })).not.toBeInTheDocument();
  });

  it("is hidden for admins who are not the payment owner", () => {
    caps.admin = true;
    render(<Nav />);
    expect(screen.queryByRole("link", { name: /Payment recipients/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Payees/ })).not.toBeInTheDocument();
  });
});
