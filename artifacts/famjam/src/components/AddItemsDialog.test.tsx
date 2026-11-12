import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddItemsDialog } from "./AddItemsDialog";

const mocks = vi.hoisted(() => ({
  quote: vi.fn(), save: vi.fn(), pending: false,
  client: {
    fetchQuery: ({ queryFn }: { queryFn: () => unknown }) => queryFn(),
    invalidateQueries: vi.fn(),
  },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => mocks.client }));
vi.mock("./payments/money", () => ({ invalidateRegistrationTotals: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useQuoteRegistrationItems: () => ({ mutateAsync: mocks.quote, isPending: false }),
  useAddRegistrationItems: () => ({ mutateAsync: mocks.save, isPending: mocks.pending }),
  getRegistration: async () => ({
    id: 1, reunionId: 2, reunionCode: "TEST", status: "active", canAddItems: true,
    attendees: [], addOns: [],
  }),
  getReunionByCode: async () => ({ fees: [
    { id: 3, label: "Mug", isAddOn: true, chargeType: "flat", amount: 5, optionGroups: [] },
  ] }),
  getGetRegistrationQueryKey: (id: number) => ["registration", id],
  getGetReunionByCodeQueryKey: (code: string) => ["reunion", code],
}));
vi.mock("./AddOnPicker", () => ({
  AddOnPicker: ({ onChange, disabled }: { onChange: (picks: object) => void; disabled: boolean }) => (
    <button disabled={disabled} onClick={() => onChange({ 3: {} })}>Pick mug</button>
  ),
  AddOnPurchaseList: () => null,
}));
const quoted = {
  registrationId: 1, quoteToken: "quote", lines: [], addedCostCents: 500,
  currentChargeCents: 10000, totalChargeCents: 10500, confirmedCents: 10000,
  legacyCreditCents: 0, sponsoredCents: 0, balanceCents: 500, creditCents: 0, waived: false,
};
const warning = "Please check the confirmation box before saving your items.";
const props = { registrationId: 1, open: true, onOpenChange: vi.fn() };
const scrollTo = vi.fn();

beforeEach(() => {
  mocks.pending = false;
  mocks.quote.mockReset().mockResolvedValue({ ...quoted });
  mocks.save.mockReset().mockResolvedValue({ ...quoted });
  scrollTo.mockReset();
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
});
afterEach(() => vi.restoreAllMocks());

async function review() {
  fireEvent.click(await screen.findByText("Pick mug"));
  fireEvent.click(screen.getByTestId("button-add-items-quote"));
  return screen.findByTestId("button-add-items-save");
}

describe("missing add-item confirmation", () => {
  it.each([false, true])("warns, scrolls and focuses without saving (reduced motion %s)", async (reduced) => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: reduced } as MediaQueryList);
    render(<AddItemsDialog {...props} />);
    const save = await review();
    expect(save).toBeEnabled();
    fireEvent.click(save);
    const checkbox = screen.getByTestId("checkbox-add-items-confirm");
    expect(screen.getByRole("alert")).toHaveTextContent(warning);
    expect(screen.getByRole("alert")).toHaveClass("text-red-700");
    expect(checkbox).toHaveFocus();
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAccessibleDescription(warning);
    expect(scrollTo).toHaveBeenCalledWith({ top: -12, behavior: reduced ? "instant" : "smooth" });
    expect(scrollTo.mock.instances[0]).toBe(screen.getByTestId("add-items-scroll-area"));
    fireEvent.click(save);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(checkbox);
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    fireEvent.click(save);
    await screen.findByTestId("status-add-items-success");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("clears warnings on changed selections, fresh quotes and reopening", async () => {
    const view = render(<AddItemsDialog {...props} />);
    fireEvent.click(await review());
    fireEvent.click(screen.getByText("Pick mug"));
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-add-items-quote"));
    const save = await screen.findByTestId("button-add-items-save");
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    fireEvent.click(save);
    view.rerender(<AddItemsDialog {...props} open={false} />);
    view.rerender(<AddItemsDialog {...props} />);
    await review();
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    expect(screen.getByTestId("checkbox-add-items-confirm")).not.toBeChecked();
  });

  it("keeps pending saves disabled and preserves safe retries", async () => {
    mocks.save.mockRejectedValueOnce(new Error("connection lost"));
    const view = render(<AddItemsDialog {...props} />);
    const save = await review();
    fireEvent.click(screen.getByTestId("checkbox-add-items-confirm"));
    mocks.pending = true;
    view.rerender(<AddItemsDialog {...props} />);
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.pending = false;
    view.rerender(<AddItemsDialog {...props} />);
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveTextContent("Retry save"));
    fireEvent.click(save);
    await screen.findByTestId("status-add-items-success");
    expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0]);
  });
});
