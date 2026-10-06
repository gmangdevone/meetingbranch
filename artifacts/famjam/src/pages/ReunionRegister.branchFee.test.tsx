import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, useContext, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReunionRegister } from "./ReunionRegister";

// Branch fee step in the registration flow: branch -> yes/no -> attendees.
const h = vi.hoisted(() => ({
  options: [] as unknown[],
  elect: vi.fn(),
  create: vi.fn(),
  refetch: vi.fn(),
  nav: vi.fn(),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/", h.nav] }));
vi.mock("../hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", async (orig) => ({
  ...(await orig<object>()),
  useGetReunionByCode: () => ({
    isLoading: false,
    data: {
      id: 7, code: "LACEY", name: "Lacey Reunion", registrationsOpen: true, paymentRecipient: null,
      fees: [{ id: 1, label: "Registration", chargeType: "flat", amount: 80, isOptional: false }],
      branches: [{ id: 11, name: "Lacey", sortOrder: 0 }, { id: 12, name: "Goudy", sortOrder: 1 }],
    },
  }),
  useGetRegistration: () => ({ data: undefined, isLoading: false }),
  useCreateRegistration: () => ({ mutate: h.create, isPending: false }),
  useUpdateRegistration: () => ({ mutate: vi.fn(), isPending: false }),
  useElectBranchFee: () => ({ mutate: h.elect, isPending: false }),
  useListBranchFeeOptions: () => ({ data: { options: h.options }, refetch: h.refetch }),
}));
// Radix Select doesn't run in jsdom; render each option as a button.
const Ctx = createContext<(v: string) => void>(() => undefined);
vi.mock("../components/ui/select", () => ({
  Select: ({ onValueChange, children }: { onValueChange: (v: string) => void; children: ReactNode }) => <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { value: string }) => {
    const on = useContext(Ctx);
    return <button type="button" onClick={() => on(value)}>Pick {value}</button>;
  },
}));

const opt = (branchId: number, branchName: string, state: string, amountCents = 2000) => ({ branchId, branchName, label: "Sibling Fee", amountCents, state, electionId: null });
const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReunionRegister params={{ code: "LACEY" }} />
    </QueryClientProvider>,
  );
const question = () => screen.queryByTestId("branch-fee-question");
const attendeesShown = () => screen.queryByRole("heading", { name: "Attendees" }) != null;

beforeEach(() => {
  vi.clearAllMocks();
  h.options = [opt(11, "Lacey", "available"), opt(12, "Goudy", "available", 1500)];
});
afterEach(cleanup);

describe("registration branch fee step", () => {
  it("asks after the branch and before attendees", () => {
    renderIt();
    expect(question()).toBeNull();
    fireEvent.click(screen.getByText("Pick Lacey"));
    expect(question()).not.toBeNull();
    expect(attendeesShown()).toBe(false);
  });

  it("No: continues to attendees, no fee line, and still requires a real attendee", async () => {
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(attendeesShown()).toBe(true);
    expect(screen.queryByTestId("summary-branch-fee")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Complete Registration" }));
    await waitFor(() => expect(screen.getByText("Name is required")).toBeInTheDocument());
    expect(h.elect).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("Yes, fee only: elects the full fee with no attendee and no registration", () => {
    h.elect.mockImplementation((_v, cb) => cb.onSuccess({}));
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fireEvent.click(screen.getByRole("radio", { name: /Yes/ }));
    expect(screen.getByTestId("summary-branch-fee")).toHaveTextContent("$20.00");
    fireEvent.click(screen.getByRole("radio", { name: /Fee only/ }));
    expect(attendeesShown()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Pay the Sibling Fee only \(\$20\.00\)/ }));
    expect(h.elect.mock.calls[0][0]).toEqual({ reunionId: 7, data: { branchId: 11, expectedAmountCents: 2000 } });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.nav).toHaveBeenCalledWith(expect.stringContaining("branchFee=1"));
  });

  it("Yes with attendees: fee is a separate line on top of attendee costs", () => {
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fireEvent.click(screen.getByRole("radio", { name: /Yes/ }));
    expect(attendeesShown()).toBe(true);
    expect(screen.getByTestId("summary-branch-fee")).toHaveTextContent("Sibling Fee");
  });

  it("paid or claimed fees are skipped: no question, straight to attendees", () => {
    h.options = [opt(11, "Lacey", "paid"), opt(12, "Goudy", "yours_unpaid", 1500)];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    expect(question()).toBeNull();
    expect(screen.getByTestId("branch-fee-status")).toHaveTextContent(/already paid/);
    expect(attendeesShown()).toBe(true);
    fireEvent.click(screen.getByText("Pick Goudy"));
    expect(screen.getByTestId("branch-fee-status")).toHaveTextContent(/won't be charged twice/);
  });

  it("switching branch discards the stale answer and re-checks fee status", () => {
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fireEvent.click(screen.getByRole("radio", { name: /Yes/ }));
    fireEvent.click(screen.getByText("Pick Goudy"));
    expect(h.refetch).toHaveBeenCalled();
    expect(screen.queryByTestId("summary-branch-fee")).toBeNull();
    expect(screen.getByRole("radio", { name: /Yes/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/\$15\.00/)).toBeInTheDocument();
    expect(attendeesShown()).toBe(false);
  });

  it("a raced election (already paid) stops the flow without registering", () => {
    h.elect.mockImplementation((_v, cb) => cb.onError(Object.assign(new Error("409"), { status: 409, data: { error: "already paid" } })));
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fireEvent.click(screen.getByRole("radio", { name: /Yes/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Fee only/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pay the Sibling Fee only/ }));
    expect(h.create).not.toHaveBeenCalled();
    expect(h.nav).not.toHaveBeenCalled();
    expect(h.refetch).toHaveBeenCalled();
    expect(question()).not.toBeNull();
  });
});

describe("registration branch fee: visible errors", () => {
  it("a raced election shows an inline error, not just a toast", () => {
    h.elect.mockImplementation((_v, cb) => cb.onError(Object.assign(new Error("409"), { status: 409, data: { error: "This branch fee is already paid." } })));
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fireEvent.click(screen.getByRole("radio", { name: /Yes/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Fee only/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pay the Sibling Fee only/ }));
    expect(screen.getByTestId("register-flow-error")).toHaveTextContent(/already paid.*Nothing was saved/);
  });

  it("fee chosen but registration failed: explains the saved fee choice and links to the hub", async () => {
    h.elect.mockImplementation((_v, cb) => cb.onSuccess({}));
    h.create.mockImplementation((_v, cb) => cb.onError(Object.assign(new Error("400"), { status: 400, data: { error: "Registration is full." } })));
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fireEvent.click(screen.getByRole("radio", { name: /Yes/ }));
    fireEvent.change(screen.getByPlaceholderText("Jane Doe"), { target: { value: "Amy Lacey" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 34"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete Registration" }));
    await waitFor(() => expect(screen.getByTestId("register-flow-error")).toHaveTextContent(/Registration is full\..*Sibling Fee WAS saved/));
    fireEvent.click(screen.getByRole("button", { name: "Go to the hub" }));
    expect(h.nav).toHaveBeenCalled();
  });

  it("under review and disabled fees are not offered", () => {
    h.options = [opt(11, "Lacey", "under_review"), opt(12, "Goudy", "yours_disabled", 1500)];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    expect(question()).toBeNull();
    expect(screen.getByTestId("branch-fee-status")).toHaveTextContent(/being reviewed/);
    fireEvent.click(screen.getByText("Pick Goudy"));
    expect(screen.getByTestId("branch-fee-status")).toHaveTextContent(/isn't being collected/);
  });
});
