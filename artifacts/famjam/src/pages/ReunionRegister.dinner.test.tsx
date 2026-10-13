import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, useContext, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReunionRegister } from "./ReunionRegister";
import { getGetRegistrationLedgerQueryKey, getGetRegistrationQueryKey, getGetReunionReportsQueryKey, getListReunionRegistrationsQueryKey, getListMyRegistrationsQueryKey, getGetReunionSummaryQueryKey } from "@workspace/api-client-react";

// Per-attendee dinner opt-out in the registration form.
const h = vi.hoisted(() => ({
  collectShirtSizes: false,
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
      collectShirtSizes: h.collectShirtSizes,
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
  h.collectShirtSizes = false;
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

  it("shows T-shirt sizes when enabled and blocks submission until selected", async () => {
    h.collectShirtSizes = true;
    h.fees = [{ ...DINNER, isOptional: true }];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fill(0, "Ann Adult", "40");
    fireEvent.click(screen.getByLabelText("T-Shirt — Ann Adult"));
    expect(screen.getByText("T-Shirt Size")).toBeInTheDocument();
    const addOnsCard = screen.getByText("Optional Add-ons").parentElement!.parentElement!;
    expect(addOnsCard).toContainElement(screen.getByText("T-Shirt Size"));
    expect(addOnsCard).toHaveTextContent("Ann Adult");
    expect(screen.getByText("Sunday Dinner").compareDocumentPosition(
      screen.getByText("T-Shirt Size"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("T-Shirt Size").compareDocumentPosition(
      screen.getByRole("button", { name: /Add Another Person/ }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Complete Registration" }));
    await waitFor(() => expect(screen.getByText("Please select a T-shirt size")).toBeInTheDocument());
    expect(h.create).not.toHaveBeenCalled();
  });

  it("shows the add-ons card for size collection without fees and adds a selector for each person", () => {
    h.collectShirtSizes = true;
    h.fees = [];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    expect(screen.getByText("Optional Add-ons")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("T-Shirt — Person 1"));
    expect(screen.getAllByText("T-Shirt Size")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Add Another Person/ }));
    fireEvent.click(screen.getByLabelText("T-Shirt — Person 2"));
    const card = screen.getByText("Optional Add-ons").parentElement!.parentElement!;
    expect(screen.getAllByText("T-Shirt Size")).toHaveLength(2);
    for (const label of screen.getAllByText("T-Shirt Size")) expect(card).toContainElement(label);
    expect(card).toHaveTextContent("Person 2");
  });

  it("charges and saves a shirt only for James, not Charlette", async () => {
    h.collectShirtSizes = true;
    h.fees = [{ ...REG, id: 9, label: "T-Shirt", amount: 20, ageTiers: [], isOptional: true }];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fill(0, "James", "40");
    fireEvent.click(screen.getByRole("button", { name: /Add Another Person/ }));
    fill(1, "Charlette", "35");
    fireEvent.click(screen.getByLabelText(/T-Shirt — James/));
    fireEvent.click(screen.getByText("Pick L"));
    expect(screen.getAllByText("T-Shirt Size")).toHaveLength(1);
    await waitFor(() => expect(total()).toBe("$20"));
    fireEvent.click(screen.getByRole("button", { name: "Complete Registration" }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0][0].data).toMatchObject({
      selectedFeeIds: [9],
      attendees: [{ name: "James", includeShirt: true, shirtSize: "L" }, { name: "Charlette", includeShirt: false }],
    });
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
    expect(screen.queryByText("T-Shirt Size")).toBeNull();
    expect(sent.every((a: { shirtSize?: string | null }) => a.shirtSize == null)).toBe(true);
    expect(sent.map((a: { includeDinner: boolean }) => a.includeDinner)).toEqual([true, false]);
  });

  it("no checkbox without an applicable dinner fee; an optional dinner needs the household opt-in first", async () => {
    h.fees = [REG, { ...DINNER, isOptional: true, isDinner: true, dinnerClassification: "explicit" }];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fill(0, "Ann Adult", "40");
    expect(screen.queryByTestId("include-dinner-0")).toBeNull();
    expect(screen.getByText("Optional Add-ons")).toBeInTheDocument();
    expect(screen.getByText("Optional Add-ons").compareDocumentPosition(
      screen.getByRole("button", { name: /Add Another Person/ }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Choose any extras for your household.")).toBeNull();
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

  it("does not opt legacy size records into an unselected T-shirt fee on edit", async () => {
    h.collectShirtSizes = true;
    h.fees = [{ ...REG, id: 9, label: "T-Shirt", amount: 20, ageTiers: [], isOptional: true }];
    h.existing = existing;
    render(<QueryClientProvider client={new QueryClient()}><ReunionRegister params={{ code: "LACEY", editId: "55" }} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/T-Shirt — Ann Adult/)).toHaveAttribute("aria-checked", "false"));
    expect(screen.queryByText("T-Shirt Size")).toBeNull();
    expect(total()).toBe("$0");
  });

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
