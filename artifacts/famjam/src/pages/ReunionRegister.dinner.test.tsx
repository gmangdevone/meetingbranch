import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, useContext, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReunionRegister } from "./ReunionRegister";
import { getGetRegistrationLedgerQueryKey, getGetRegistrationQueryKey, getGetReunionReportsQueryKey, getListReunionRegistrationsQueryKey, getListMyRegistrationsQueryKey, getGetReunionSummaryQueryKey } from "@workspace/api-client-react";

// Per-attendee dinner opt-out in the registration form.
const h = vi.hoisted(() => ({
  options: [] as unknown[],
  fees: [] as unknown[],
  existing: undefined as unknown,
  update: vi.fn(),
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
      fees: h.fees,
      branches: [{ id: 11, name: "Lacey", sortOrder: 0 }, { id: 12, name: "Goudy", sortOrder: 1 }],
    },
  }),
  useGetRegistration: () => ({ data: h.existing, isLoading: false }),
  useCreateRegistration: () => ({ mutate: h.create, isPending: false }),
  useUpdateRegistration: () => ({ mutate: h.update, isPending: false }),
  useElectBranchFee: () => ({ mutate: h.elect, isPending: false }),
  useListBranchFeeOptions: () => ({ data: { options: h.options }, refetch: h.refetch }),
}));
// Radix Select doesn't run in jsdom; render each option as a button.
const Ctx = createContext<(v: string) => void>(() => undefined);
vi.mock("../components/ui/select", () => ({
  Select: ({ onValueChange, children }: { onValueChange: (v: string) => void; children: ReactNode }) => <Ctx.Provider value={onValueChange}>{children}<button type="button" onClick={() => onValueChange("")}>Simulate empty select event</button></Ctx.Provider>,
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

const tiers = [{ minAge: null, maxAge: 5, amount: 0 }, { minAge: 6, maxAge: 12, amount: 20 }];
const REG = { id: 1, label: "Registration Fee", chargeType: "per_person", amount: 50, isOptional: false, ageTiers: [{ minAge: null, maxAge: 5, amount: 0 }, { minAge: 6, maxAge: 12, amount: 25 }], isDinner: false, dinnerClassification: "explicit" };
const DINNER = { id: 2, label: "Sunday Dinner", chargeType: "per_person", amount: 30, isOptional: false, ageTiers: tiers, isDinner: true, dinnerClassification: "detected" };
const total = () => screen.getAllByText("Total").map((e) => e.nextElementSibling?.textContent).find((t) => t?.startsWith("$"));
const fill = (i: number, name: string, age: string) => {
  fireEvent.change(screen.getAllByPlaceholderText("Jane Doe")[i], { target: { value: name } });
  fireEvent.change(screen.getAllByPlaceholderText("e.g. 34")[i], { target: { value: age } });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.options = [];
  h.fees = [REG, DINNER];
  h.existing = undefined;
});
afterEach(cleanup);

describe("registration dinner opt-out", () => {
  it("each attendee gets an Include dinner checkbox (default on) priced by age tier; opting out removes only dinner", async () => {
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fill(0, "Ann Adult", "40");
    const box = screen.getByTestId("include-dinner-0");
    expect(box).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(total()).toBe("$80"));
    fireEvent.click(box);
    await waitFor(() => expect(total()).toBe("$50"));
    fireEvent.click(box);
    await waitFor(() => expect(total()).toBe("$80"));
  });

  it("mixed household: exact tiers and the submitted includeDinner flags", async () => {
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fill(0, "Ann Adult", "40");
    fireEvent.click(screen.getByRole("button", { name: /Add Another Person/ }));
    fill(1, "Cy Child", "8");
    await waitFor(() => expect(total()).toBe("$125"));
    expect(screen.getAllByText("$20").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("include-dinner-1"));
    await waitFor(() => expect(total()).toBe("$105"));
    fireEvent.click(screen.getByRole("button", { name: "Complete Registration" }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    const sent = h.create.mock.calls[0][0].data.attendees;
    expect(sent.map((a: { includeDinner: boolean }) => a.includeDinner)).toEqual([true, false]);
  });

  it("no checkbox without an applicable dinner fee; an optional dinner needs the household opt-in first", async () => {
    h.fees = [REG, { ...DINNER, isOptional: true, isDinner: true, dinnerClassification: "explicit" }];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fill(0, "Ann Adult", "40");
    expect(screen.queryByTestId("include-dinner-0")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Sunday Dinner/));
    expect(screen.getByTestId("include-dinner-0")).toBeInTheDocument();
  });

  it("flat fees never get a dinner checkbox, even if labeled dinner", () => {
    h.fees = [REG, { id: 3, label: "Dinner Hall", chargeType: "flat", amount: 100, isOptional: false, ageTiers: [], isDinner: false, dinnerClassification: "explicit" }];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    expect(screen.queryByTestId("include-dinner-0")).toBeNull();
  });
});

describe("editing an existing registration (regressions)", () => {
  const existing = { id: 55, reunionId: 7, branchName: "Lacey", selectedFeeIds: [], attendees: [
    { id: 1, name: "Ann Adult", shirtSize: "L", age: 40, dietaryRestrictions: null, includeDinner: true },
    { id: 2, name: "Ben Adult", shirtSize: "M", age: 35, dietaryRestrictions: null, includeDinner: true },
  ] };

  it("shows the saved branch's attendee controls without reselecting the branch, even when a branch fee is open", async () => {
    h.existing = existing;
    h.options = [{ branchId: 11, branchName: "Lacey", label: "Sibling Fee", amountCents: 2000, state: "available", electionId: null }];
    render(<QueryClientProvider client={new QueryClient()}><ReunionRegister params={{ code: "LACEY", editId: "55" }} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("include-dinner-1")).toBeInTheDocument());
    // Radix's hidden form select can emit an empty value during hydration.
    // That must not clear the saved branch and hide the attendee editor.
    fireEvent.click(screen.getAllByRole("button", { name: "Simulate empty select event" })[0]);
    expect(screen.getByTestId("include-dinner-1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ben Adult")).toBeInTheDocument();
  });

  it("saving an opt-out refreshes the ledger, reports, lists and summary caches", async () => {
    h.existing = existing;
    h.update.mockImplementation((_v, cb) => cb.onSuccess({}));
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(<QueryClientProvider client={qc}><ReunionRegister params={{ code: "LACEY", editId: "55" }} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("include-dinner-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("include-dinner-0"));
    fireEvent.click(screen.getByTestId("include-dinner-1"));
    await waitFor(() => expect(total()).toBe("$100"));
    fireEvent.click(screen.getByRole("button", { name: /Save|Update/ }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0].data.attendees.map((a: { includeDinner: boolean }) => a.includeDinner)).toEqual([false, false]);
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const k of [getGetRegistrationLedgerQueryKey(55), getGetRegistrationQueryKey(55), getGetReunionReportsQueryKey(7), getListReunionRegistrationsQueryKey(7), getListMyRegistrationsQueryKey(), getGetReunionSummaryQueryKey(7)])
      expect(keys).toContain(JSON.stringify(k));
  });
});
