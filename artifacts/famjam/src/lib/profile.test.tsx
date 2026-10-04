import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true, userId: "u1", sessionId: "s1" }));
const api = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  access: { allowed: true, signInsLocked: false },
}));

vi.mock("@clerk/react", () => ({ useAuth: () => auth }));
vi.mock("@workspace/api-client-react", async () => {
  const rq = await import("@tanstack/react-query");
  return {
    getGetMyProfileQueryKey: () => ["/api/me/profile"],
    getGetMyAccessQueryKey: () => ["/api/me/access"],
    useGetMyProfile: (o: { query: Record<string, unknown> }) =>
      rq.useQuery({ ...o.query, queryKey: o.query.queryKey as unknown[], queryFn: () => api.getProfile() }),
    useGetMyAccess: (o: { query: Record<string, unknown> }) =>
      rq.useQuery({ ...o.query, queryKey: o.query.queryKey as unknown[], queryFn: async () => api.access }),
    useUpdateMyProfile: () => rq.useMutation({ mutationFn: (v: { data: unknown }) => api.updateProfile(v.data) }),
  };
});

import { ProfileProvider, greetingFor, needsName, validateName, useProfile } from "./profile";
import { Greeting } from "../components/Greeting";

function EditButton() {
  const { openNameEditor } = useProfile();
  return openNameEditor ? <button onClick={openNameEditor}>open editor</button> : null;
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfileProvider>
        <Greeting />
        <EditButton />
      </ProfileProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.assign(auth, { isLoaded: true, isSignedIn: true, userId: "u1", sessionId: "s1" });
  api.access = { allowed: true, signInsLocked: false };
  api.getProfile.mockReset();
  api.updateProfile.mockReset();
  window.sessionStorage.clear();
});

describe("name helpers", () => {
  it("greets with first name only", () => {
    expect(greetingFor("Kelly", true)).toBe("Hi Kelly");
    expect(greetingFor(" Kelly ", false)).toBe("Welcome back Kelly");
    expect(greetingFor(null, false)).toBeNull();
    expect(greetingFor("   ", true)).toBeNull();
  });
  it("detects missing names and validates", () => {
    expect(needsName({ firstName: "A", lastName: null, isNewAccount: false })).toBe(true);
    expect(needsName({ firstName: "A", lastName: "B", isNewAccount: false })).toBe(false);
    expect(validateName("  ", "First name")).toBe("First name is required.");
    expect(validateName("x".repeat(101), "Last name")).toMatch(/100 characters/);
    expect(validateName("  O'Brien-Núñez ", "Last name")).toBeNull();
  });
});

describe("ProfileProvider", () => {
  it("shows nothing for signed-out visitors", () => {
    auth.isSignedIn = false;
    renderApp();
    expect(api.getProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("personal-greeting")).not.toBeInTheDocument();
  });

  it("greets returning users without prompting and never shows last name", async () => {
    api.getProfile.mockResolvedValue({ firstName: "Kelly", lastName: "Stone", isNewAccount: false });
    renderApp();
    expect(await screen.findByText("Welcome back Kelly")).toBeInTheDocument();
    expect(screen.queryByText(/Stone/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires names, prefills, validates, saves trimmed and updates greeting", async () => {
    api.getProfile.mockResolvedValue({ firstName: "Kelly", lastName: null, isNewAccount: true });
    api.updateProfile.mockImplementation(async (d) => {
      const saved = { ...d, isNewAccount: false };
      api.getProfile.mockResolvedValue(saved);
      return saved;
    });
    renderApp();
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByLabelText("First name")).toHaveValue("Kelly");
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Last name is required.")).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "  O'Brien " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(api.updateProfile).toHaveBeenCalledWith({ firstName: "Kelly", lastName: "O'Brien" });
    // Wording stays "Hi" for the whole login session even though server flips.
    expect(await screen.findByText("Hi Kelly")).toBeInTheDocument();
  });

  it("shows a save error and allows retry", async () => {
    api.getProfile.mockResolvedValue({ firstName: null, lastName: null, isNewAccount: false });
    api.updateProfile.mockRejectedValueOnce(new Error("boom"));
    renderApp();
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Ruiz" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't save");
    api.updateProfile.mockImplementationOnce(async (d) => {
      const saved = { ...d, isNewAccount: false };
      api.getProfile.mockResolvedValue(saved);
      return saved;
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Welcome back Ana")).toBeInTheDocument();
  });

  it("shows a load error with retry", async () => {
    api.getProfile.mockRejectedValue(new Error("down"));
    renderApp();
    expect(await screen.findByText("We couldn't load your profile.", {}, { timeout: 4000 })).toBeInTheDocument();
    api.getProfile.mockResolvedValue({ firstName: "Lee", lastName: "Park", isNewAccount: false });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Welcome back Lee")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not prompt accounts blocked by the access gate", async () => {
    api.access = { allowed: false, signInsLocked: true };
    api.getProfile.mockResolvedValue({ firstName: null, lastName: null, isNewAccount: true });
    renderApp();
    await waitFor(() => expect(api.getProfile).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens an optional editor that can be cancelled", async () => {
    api.getProfile.mockResolvedValue({ firstName: "Kelly", lastName: "Stone", isNewAccount: false });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "open editor" }));
    expect(screen.getByLabelText("Last name")).toHaveValue("Stone");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not show a previous user's name after switching accounts", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <ProfileProvider><Greeting /></ProfileProvider>
      </QueryClientProvider>
    );
    api.getProfile.mockResolvedValueOnce({ firstName: "Kelly", lastName: "Stone", isNewAccount: false });
    const view = render(tree());
    await screen.findByText("Welcome back Kelly");
    let resolve: (v: unknown) => void = () => {};
    api.getProfile.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    Object.assign(auth, { userId: "u2", sessionId: "s2" });
    view.rerender(tree());
    expect(screen.queryByText(/Kelly/)).not.toBeInTheDocument();
    await act(async () => resolve({ firstName: "Jo", lastName: "Lin", isNewAccount: true }));
    expect(await screen.findByText("Hi Jo")).toBeInTheDocument();
  });
});
