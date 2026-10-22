import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CurrentEventHome, EventHomeLanding } from "./EventHomeLanding";
import { homeDestination } from "../lib/homeNavigation";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown>, recent: {} as Record<string, unknown>, refetch: vi.fn() }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ userId: "one", sessionId: "session" }) }));
vi.mock("@workspace/api-client-react", () => ({
  useListMyEventMemberships: () => ({ ...h.state, refetch: h.refetch }),
  getListMyEventMembershipsQueryKey: () => ["memberships"],
  useGetReunion: () => ({ ...h.state, refetch: h.refetch }),
  getGetReunionQueryKey: (id: number) => ["event", id],
  useGetReunionByCode: () => ({ ...h.recent, refetch: h.refetch }),
  getGetReunionByCodeQueryKey: (code: string) => ["code", code],
}));
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const event = (id: number) => ({ reunionId: id, code: `FAMILY-${id}`, name: `Family ${id}`, isOrganizer: true, canViewReports: true });
const ok = (data: unknown) => ({ data, isSuccess: true, isFetchedAfterMount: true, isFetching: false });
function run(id?: string) {
  const loc = memoryLocation({ path: id ? `/home/event/${id}` : "/home", record: true });
  render(<Router hook={loc.hook}>{id ? <CurrentEventHome params={{ reunionId: id }} /> : <EventHomeLanding />}</Router>);
  return loc;
}

describe("explicit Home navigation", () => {
  it("returns an unregistered invitation visitor to their verified event from Dashboard", () => {
    localStorage.setItem("meetingbranch:lastReunionCode", "INVITE-2027");
    h.state = ok([]);
    h.recent = ok({ id: 9, code: "INVITE-2027", name: "Invitation" });
    expect(homeDestination("/dashboard", true)).toBe("/home");
    expect(run().history.at(-1)).toBe("/r/INVITE-2027");
  });
  it("offers the visited invitation alongside a different account membership", () => {
    localStorage.setItem("meetingbranch:lastReunionCode", "INVITE-2027");
    h.state = ok([event(1)]);
    h.recent = ok({ id: 9, code: "INVITE-2027", name: "Invitation" });
    const loc = run();
    expect(screen.getByRole("button", { name: /Open event home for Family 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open event home for Invitation/ }));
    expect(loc.history.at(-1)).toBe("/r/INVITE-2027");
  });
  it("does not silently substitute another event when the visited code fails validation", () => {
    localStorage.setItem("meetingbranch:lastReunionCode", "REMOVED-2027");
    h.state = ok([event(1)]);
    h.recent = { isError: true };
    const loc = run();
    expect(screen.getByText(/recently visited event couldn't be loaded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open event home for Family 1/ })).toBeInTheDocument();
    expect(loc.history).toEqual(["/home"]);
  });
  it.each(["reports", "registrations", "home-page", "settings"])("uses the active organizer event on %s with stale history", page => {
    localStorage.setItem("meetingbranch:lastReunionCode", "WRONG-2027");
    expect(homeDestination(`/organize/23/${page}`, true)).toBe("/home/event/23");
  });
  it("works without browser storage and preserves event deep links", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(homeDestination("/organize/23/reports", true)).toBe("/home/event/23");
    expect(homeDestination("/r/FAMILY%2D1/register/edit/9", true)).toBe("/r/FAMILY-1");
    expect(homeDestination("/admin", true)).toBe("/home");
    expect(homeDestination("/r/FAMILY-1", false)).toBe("/");
  });
  it("reproduces and fixes fresh-session Home looping to Reports", () => {
    expect(homeDestination("/organize/23/reports", true)).not.toBe("/");
    h.state = ok({ reunion: { code: "CURRENT-2027" } });
    expect(run("23").history.at(-1)).toBe("/r/CURRENT-2027");
    cleanup();
    expect(run("23").history.at(-1)).toBe("/r/CURRENT-2027");
  });
  it("opens the only membership's home even when it grants Reports", () => {
    h.state = ok([event(1)]);
    expect(run().history.at(-1)).toBe("/r/FAMILY-1");
  });
  it("offers every associated event, not only Reports events", () => {
    h.state = ok([event(1), { ...event(2), isOrganizer: false, canViewReports: false }]);
    const loc = run();
    expect(screen.getByRole("heading", { name: /Which event home/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open event home for Family 2/ }));
    expect(loc.history.at(-1)).toBe("/r/FAMILY-2");
  });
  it("offers Join and dashboard for no memberships without redirecting", () => {
    h.state = ok([]);
    const loc = run();
    expect(screen.getByRole("link", { name: "Join an event" })).toHaveAttribute("href", "/join");
    expect(screen.getByRole("link", { name: "My dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(loc.history).toEqual(["/home"]);
  });
  it("waits for fresh membership results", () => {
    h.state = { ...ok([event(1)]), isFetchedAfterMount: false, isFetching: true };
    expect(run().history).toEqual(["/home"]);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
  it("reports failed event loads without silently opening another event", () => {
    h.state = { isError: true, data: { reunion: { code: "STALE-2027" } } };
    const loc = run("23");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.refetch).toHaveBeenCalled();
    expect(loc.history).toEqual(["/home/event/23"]);
  });
});
