import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyEvents } from "./MyEvents";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@workspace/api-client-react", () => ({
  useListMyEventMemberships: () => ({ refetch: vi.fn(), ...h.state }),
  getListMyEventMembershipsQueryKey: () => ["k"],
}));
afterEach(cleanup);
const now = new Date("2026-06-01T12:00:00");
const base = { startDate: "2026-07-10", endDate: "2026-07-12", isOrganizer: false, isCoOrganizer: false, activeRegistrationCount: 0 };

describe("MyEvents", () => {
  it("lists every associated event once, with hub links and organize links only for organizers", () => {
    h.state = { isPending: false, isError: false, isSuccess: true, data: [
      { ...base, reunionId: 1, code: "GOUDY26*", name: "Goudy Family", activeRegistrationCount: 3 },
      { ...base, reunionId: 1, code: "GOUDY26*", name: "Goudy Family", activeRegistrationCount: 3 },
      { ...base, reunionId: 2, code: "HALL26*", name: "Hall Reunion", isCoOrganizer: true },
    ] };
    render(<MyEvents now={now} />);
    const cards = screen.getAllByTestId("my-event");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("2 events")).toBeInTheDocument();
    expect(within(cards[0]).getByText("3 registrations")).toBeInTheDocument();
    expect(within(cards[0]).getByRole("link", { name: /Go to Hub/ })).toHaveAttribute("href", "/r/GOUDY26*");
    expect(within(cards[0]).queryByRole("link", { name: /Organize/ })).toBeNull();
    expect(within(cards[1]).getByRole("link", { name: /Organize/ })).toHaveAttribute("href", "/organize/2");
    expect(within(cards[1]).getByText("Co-organizer")).toBeInTheDocument();
  });
  it("shows an error with retry rather than an empty list", () => {
    h.state = { isPending: false, isError: true, isSuccess: false };
    render(<MyEvents now={now} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/);
    expect(screen.queryByText("No reunions yet")).toBeNull();
  });
  it("shows skeletons while loading and a composed empty state when there are none", () => {
    h.state = { isPending: true };
    const { unmount } = render(<MyEvents now={now} />);
    expect(screen.queryByText("No reunions yet")).toBeNull();
    unmount();
    h.state = { isPending: false, isError: false, isSuccess: true, data: [] };
    render(<MyEvents now={now} />);
    expect(screen.getByText("No reunions yet")).toBeInTheDocument();
  });
});
