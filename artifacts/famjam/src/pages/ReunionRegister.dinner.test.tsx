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

describe("configured dinners: independent per-fee choices", () => {
  const SUN = { ...DINNER, id: 20, label: "Sunday Dinner", ageTiers: [], amount: 30, dinnerClassification: "explicit", dinnerMode: "mandatory" };
  const SAT = { ...DINNER, id: 21, label: "Saturday Dinner", ageTiers: [], amount: 10, isOptional: true, dinnerClassification: "explicit", dinnerMode: "optional" };
  const editIt = () => render(<QueryClientProvider client={new QueryClient()}><ReunionRegister params={{ code: "LACEY", editId: "55" }} /></QueryClientProvider>);
  const saved = (selectedFeeIds: number[], dinnerFeeIds: number[] | null, extra: object = {}) => ({
    id: 55, reunionId: 7, branchName: "Lacey", selectedFeeIds,
    attendees: [{ id: 1, name: "Ann Adult", shirtSize: null, age: 40, dietaryRestrictions: null, includeDinner: (dinnerFeeIds ?? []).length > 0, dinnerFeeIds }],
    ...extra,
  });

  it("hidden -> optional: a saved attendee sees the dinner unchecked and can opt in", async () => {
    h.fees = [SAT];
    h.existing = saved([], []);
    editIt();
    const box = await screen.findByTestId("include-dinner-0");
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /Save|Update/ }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const data = h.update.mock.calls[0][0].data;
    expect(data.selectedFeeIds).toContain(21);
    expect(data.attendees[0]).toMatchObject({ id: 1, dinnerFeeIds: [21], includeDinner: true });
  });

  it("mandatory is locked for members while optional toggles independently", async () => {
    h.fees = [SUN, SAT];
    h.existing = saved([20, 21], [20, 21]);
    editIt();
    const sun = await screen.findByTestId("include-dinner-0-20");
    expect(sun).toBeDisabled();
    fireEvent.click(screen.getByTestId("include-dinner-0-21"));
    fireEvent.click(screen.getByRole("button", { name: /Save|Update/ }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0].data.attendees[0].dinnerFeeIds).toEqual([20]);
  });

  it("organizers can exempt mandatory; repeat save keeps hidden saved selections", async () => {
    h.fees = [SUN, { ...SAT, dinnerMode: "hidden" }];
    h.existing = saved([20, 21], [20, 21], { canManageDinner: true });
    editIt();
    const sun = await screen.findByTestId("include-dinner-0-20");
    expect(sun).not.toBeDisabled();
    expect(screen.getByTestId("include-dinner-0-21")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /Save|Update/ }));
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const first = h.update.mock.calls[0][0].data;
    expect(first.selectedFeeIds).toEqual(expect.arrayContaining([20, 21]));
    expect(first.attendees[0].dinnerFeeIds).toEqual([20, 21]);
    fireEvent.click(sun);
    fireEvent.click(screen.getByRole("button", { name: /Save|Update/ }));
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(2));
    const second = h.update.mock.calls[1][0].data;
    expect(second.attendees[0].dinnerFeeIds).toEqual([21]);
    expect(second.selectedFeeIds).toEqual(expect.arrayContaining([20, 21]));
  });

  it("new registrations default every visible dinner selected and never offer hidden", async () => {
    h.fees = [SUN, SAT, { ...SAT, id: 22, label: "Secret Supper", dinnerMode: "hidden" }];
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Pick Lacey" }));
    fill(0, "Ann", "40");
    await waitFor(() => expect(screen.getByTestId("include-dinner-0-21")).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByText("Secret Supper")).toBeNull();
    expect(total()).toBe("$40");
  });
});

describe("generic add-on variations", () => {
  const SHIRT = {
    id: 9, label: "Reunion Tee", chargeType: "per_person", amount: 10, basePriceCents: 1000, isOptional: true, isAddOn: true, retired: false,
    ageTiers: [], isDinner: false, isShirt: false, dinnerClassification: "explicit",
    optionGroups: [{ id: "size", label: "Size", values: [
      { id: "m", label: "M", adjustmentCents: 0, active: true },
      { id: "xl", label: "XL", adjustmentCents: 300, active: true },
      { id: "xs", label: "XS", adjustmentCents: 0, active: false },
    ] }],
  };
  const PIN = { id: 10, label: "Family Pin", chargeType: "flat", amount: 5, basePriceCents: 450, isOptional: false, isAddOn: true, retired: false, ageTiers: [], isDinner: false, dinnerClassification: "explicit", optionGroups: [] };

  it("prices $13 for XL, requires a choice, and sends only ids", async () => {
    h.fees = [SHIRT, PIN];
    renderIt();
    fireEvent.click(screen.getByText("Pick Lacey"));
    fill(0, "Ann Adult", "40");
    // mandatory household pin auto-included
    await waitFor(() => expect(total()).toBe("$4.5"));
    expect(screen.queryByTestId("attendee-0-choice-9-size-xs")).toBeNull();
    fireEvent.click(screen.getByTestId("attendee-0-toggle-addon-9"));
    fireEvent.click(screen.getByRole("button", { name: "Complete Registration" }));
    await waitFor(() => expect(screen.getByTestId("addon-errors")).toHaveTextContent("Choose a size for Reunion Tee"));
    expect(h.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("attendee-0-choice-9-size-xl"));
    expect(screen.getByTestId("attendee-0-price-addon-9")).toHaveTextContent("$13");
    fireEvent.click(screen.getByRole("button", { name: "Complete Registration" }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    const data = h.create.mock.calls[0][0].data;
    expect(data.attendees[0].addOns).toEqual([{ feeId: 9, choices: [{ groupId: "size", valueId: "xl" }] }]);
    expect(data.addOns).toEqual([{ feeId: 10, choices: [] }]);
    expect(data.selectedFeeIds).not.toContain(9);
    expect(data.attendees[0]).not.toHaveProperty("shirtSize");
  });

  it("keeps a saved retired choice and its old price on edit, preserving attendee ids", async () => {
    h.fees = [SHIRT];
    h.existing = { id: 55, reunionId: 7, branchName: "Lacey", selectedFeeIds: [], addOns: [], attendees: [
      { id: 1, name: "Ann Adult", age: 40, dietaryRestrictions: null, includeDinner: true,
        addOns: [{ feeId: 9, label: "Reunion Tee", unitPriceCents: 800, choices: [{ groupId: "size", valueId: "xs", groupLabel: "Size", valueLabel: "XS" }] }] },
    ] };
    render(<QueryClientProvider client={new QueryClient()}><ReunionRegister params={{ code: "LACEY", editId: "55" }} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("attendee-0-price-addon-9")).toHaveTextContent("$8"));
    expect(screen.getByTestId("attendee-0-choice-9-size-xs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save|Update/ }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const a = h.update.mock.calls[0][0].data.attendees[0];
    expect(a.id).toBe(1);
    expect(a.addOns).toEqual([{ feeId: 9, choices: [{ groupId: "size", valueId: "xs" }] }]);
  });
});
