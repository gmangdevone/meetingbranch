import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PostLoginLanding } from "./PostLoginLanding";
import { clearOrganizerChoice, readOrganizerChoice, saveOrganizerChoice } from "../lib/organizerSession";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown>, refetch: vi.fn() }));
const auth = vi.hoisted(() => ({ userId: "user1", sessionId: "session1", isLoaded: true }));
vi.mock("@clerk/react", () => ({ useAuth: () => auth }));
vi.mock("@workspace/api-client-react", () => ({
  useListMyEventMemberships: () => ({ refetch: h.refetch, ...h.state }),
  getListMyEventMembershipsQueryKey: () => ["/api/me/event-memberships"],
}));
afterEach(cleanup);
beforeEach(() => { clearOrganizerChoice(); auth.userId = "user1"; auth.sessionId = "session1"; });

const ok = (data: unknown[]) => ({ isSuccess: true, isError: false, isFetching: false, isFetchedAfterMount: true, data });
const mem = (reunionId: number, code: string) => ({ reunionId, code, name: code, startDate: "2026-07-01", endDate: "2026-07-01", isOrganizer: false, isCoOrganizer: false, activeRegistrationCount: 2 });

function run(chooseEvent = false) {
  const loc = memoryLocation({ path: "/", record: true });
  render(<Router hook={loc.hook}><PostLoginLanding chooseEvent={chooseEvent} /></Router>);
  return loc;
}

describe("PostLoginLanding", () => {
  const managed = (id: number) => ({ ...mem(id, `Event${id}`), isCoOrganizer: true, canViewReports: true });
  it("prioritizes the only Reports event over ordinary memberships", () => {
    h.state = ok([mem(1, "Member"), managed(2)]);
    expect(run().history.at(-1)).toBe("/organize/2/reports");
  });
  it("prompts for multiple eligible events and remembers the choice across remounts", () => {
    h.state = ok([managed(1), managed(2), mem(3, "Member")]);
    const loc = run();
    expect(screen.getByTestId("organizer-event-chooser")).toBeInTheDocument();
    expect(screen.queryByTestId("button-choose-event-3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-choose-event-2"));
    expect(loc.history.at(-1)).toBe("/organize/2/reports");
    cleanup();
    expect(run().history.at(-1)).toBe("/organize/2/reports");
  });
  it("prompts again for a new sign-in session or a different user", () => {
    h.state = ok([managed(1), managed(2)]);
    saveOrganizerChoice("user1", "session1", 2);
    auth.sessionId = "session2";
    run();
    expect(screen.getByTestId("organizer-event-chooser")).toBeInTheDocument();
    cleanup();
    auth.sessionId = "session1";
    auth.userId = "user2";
    run();
    expect(screen.getByTestId("organizer-event-chooser")).toBeInTheDocument();
  });
  it("lets the organizer switch events despite an existing selection", () => {
    h.state = ok([managed(1), managed(2)]);
    saveOrganizerChoice("user1", "session1", 2);
    const loc = run(true);
    fireEvent.click(screen.getByTestId("button-choose-event-1"));
    expect(loc.history.at(-1)).toBe("/organize/1/reports");
  });
  it("clears revoked selections and falls back to member routing", () => {
    saveOrganizerChoice("user1", "session1", 2);
    h.state = ok([mem(2, "Member")]);
    expect(run().history.at(-1)).toBe("/r/MEMBER");
    expect(readOrganizerChoice("user1", "session1")).toBeNull();
  });
  it("prompts when a removed selection leaves multiple eligible events", () => {
    saveOrganizerChoice("user1", "session1", 3);
    h.state = ok([managed(1), managed(2)]);
    run();
    expect(screen.getByTestId("organizer-event-chooser")).toBeInTheDocument();
    expect(readOrganizerChoice("user1", "session1")).toBeNull();
  });
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
