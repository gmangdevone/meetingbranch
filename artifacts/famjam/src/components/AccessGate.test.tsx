import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AccessGate } from "./AccessGate";

const state = vi.hoisted(() => ({
  access: undefined as { allowed: boolean; signInsLocked: boolean } | undefined,
  isLoading: false,
  signOut: vi.fn(),
}));
vi.mock("@clerk/react", () => ({ useClerk: () => ({ signOut: state.signOut }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetMyAccess: () => ({ data: state.access, isLoading: state.isLoading }),
  getGetMyAccessQueryKey: () => ["access"],
  // No admin capability anywhere: the gate must rely solely on /me/access.
  useAdminListReunions: () => ({ isError: true }),
}));
vi.mock("./Layout", () => ({ Layout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

afterEach(() => {
  cleanup();
  state.access = undefined;
  state.isLoading = false;
});

const renderGate = () =>
  render(
    <AccessGate>
      <h1>Payment recipients</h1>
    </AccessGate>,
  );

describe("AccessGate", () => {
  it("renders the owner screen when the API allows access despite lockdown and no admin", () => {
    state.access = { allowed: true, signInsLocked: true };
    renderGate();
    expect(screen.getByRole("heading", { name: "Payment recipients" })).toBeTruthy();
    expect(screen.queryByText("Temporarily Closed")).toBeNull();
  });

  it("blocks a denied member during lockdown", () => {
    state.access = { allowed: false, signInsLocked: true };
    renderGate();
    expect(screen.getByText("Temporarily Closed")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Payment recipients" })).toBeNull();
    screen.getByRole("button", { name: "Sign out" }).click();
    expect(state.signOut).toHaveBeenCalled();
  });

  it("shows the checking state while loading", () => {
    state.isLoading = true;
    renderGate();
    expect(screen.getByText("Checking access...")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Payment recipients" })).toBeNull();
  });
});
