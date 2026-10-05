import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PostLoginLanding } from "./PostLoginLanding";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown>, refetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useListMyEventMemberships: () => ({ refetch: h.refetch, ...h.state }),
  getListMyEventMembershipsQueryKey: () => ["/api/me/event-memberships"],
}));
afterEach(cleanup);

const ok = (data: unknown[]) => ({ isSuccess: true, isError: false, isFetching: false, isFetchedAfterMount: true, data });
const mem = (reunionId: number, code: string) => ({ reunionId, code, name: code, startDate: "2026-07-01", endDate: "2026-07-01", isOrganizer: false, isCoOrganizer: false, activeRegistrationCount: 2 });

function run() {
  const loc = memoryLocation({ path: "/", record: true });
  render(<Router hook={loc.hook}><PostLoginLanding /></Router>);
  return loc;
}

describe("PostLoginLanding", () => {
  it("waits while loading instead of assuming zero events", () => {
    h.state = { isSuccess: false, isError: false, isFetching: true, isFetchedAfterMount: false };
    const loc = run();
    expect(screen.getByLabelText("Finding your reunions")).toBeInTheDocument();
    expect(loc.history).toEqual(["/"]);
  });
  it("does not decide from stale cached data still refetching", () => {
    h.state = { ...ok([mem(1, "ONE2026*")]), isFetchedAfterMount: false, isFetching: true };
    expect(run().history).toEqual(["/"]);
  });
  it("sends a single-event member to that event hub", () => {
    h.state = ok([mem(1, "ONE2026*")]);
    expect(run().history.at(-1)).toBe("/r/ONE2026*");
  });
  it("sends multi-event members to the dashboard", () => {
    h.state = ok([mem(1, "ONE2026*"), mem(2, "TWO2026*")]);
    expect(run().history.at(-1)).toBe("/dashboard");
  });
  it("keeps the welcome flow (dashboard) for users with no events", () => {
    h.state = ok([]);
    expect(run().history.at(-1)).toBe("/dashboard");
  });
  it("shows a retry on error and never redirects", () => {
    h.state = { isSuccess: false, isError: true, isFetching: false };
    const loc = run();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.refetch).toHaveBeenCalled();
    expect(loc.history).toEqual(["/"]);
    expect(screen.getByRole("link", { name: "My dashboard" })).toHaveAttribute("href", "/dashboard");
  });
});
