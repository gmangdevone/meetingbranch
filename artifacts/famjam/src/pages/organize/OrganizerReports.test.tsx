import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getGetReunionReportsQueryKey } from "@workspace/api-client-react";
import { OrganizerReports } from "./OrganizerReports";

vi.mock("./OrganizerLayout", () => ({
  OrganizerLayout: ({ children, requiredRole }: { children: React.ReactNode; requiredRole: string }) => (
    <main data-testid="layout" data-role={requiredRole}>{children}</main>
  ),
}));
vi.mock("../../components/payments/BranchFeeReport", () => ({
  BranchFeeReport: () => <div data-testid="branch-fees" />,
}));
vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const reports = {
  totalRegistrations: 7, totalAttendees: 23, paidCount: 4,
  pendingCount: 3, waivedCount: 0, dietaryCount: 0,
  byShirtSize: [], byGroup: [],
};
const clients: QueryClient[] = [];
afterEach(() => {
  clients.forEach(client => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

function setup(cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  if (cached) client.setQueryData(getGetReunionReportsQueryKey(7), reports);
  render(<QueryClientProvider client={client}><OrganizerReports params={{ reunionId: "7" }} /></QueryClientProvider>);
  return client;
}

function success() {
  return new Response(JSON.stringify(reports), { status: 200, headers: { "Content-Type": "application/json" } });
}
function failure(status: number) {
  return new Response(JSON.stringify({ error: "Internal details should not appear" }), { status, headers: { "Content-Type": "application/json" } });
}

describe("OrganizerReports request states", () => {
  it("shows initial loading, then renders reports inside the reports permission gate", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { resolve = r; })));
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Loading reports");
    expect(screen.getByTestId("layout")).toHaveAttribute("data-role", "reports");
    resolve(success());
    expect(await screen.findByText("Reports & Analytics")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["network", "server"])("recovers from a %s failure with a disabled retry button while fetching", async kind => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => kind === "network" ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(failure(500)))
      .mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    vi.stubGlobal("fetch", fetch);
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load reports.");
    expect(screen.queryByText("Loading reports...")).not.toBeInTheDocument();
    expect(screen.queryByText(/Internal details/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Retrying..." })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(2);
    resolve(success());
    expect(await screen.findByText("Reports & Analytics")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached reports on refresh failure, labels them stale, and clears the warning on recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(failure(503)).mockImplementationOnce(async () => success()));
    setup(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("These numbers may be out of date.");
    expect(screen.getByText("23")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("23")).toBeInTheDocument();
  });

  it.each([401, 403])("hides cached reports and retry controls after HTTP %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure(status)));
    setup(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have access to these reports");
    expect(screen.queryByText("23")).not.toBeInTheDocument();
    expect(screen.queryByTestId("branch-fees")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to Dashboard" })).toHaveAttribute("href", "/dashboard");
  });
});
