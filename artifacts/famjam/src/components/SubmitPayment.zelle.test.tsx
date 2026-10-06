import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitPayment } from "./SubmitPayment";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
const qc = new QueryClient();
const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
const withQc = (ui: ReactElement) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
void invalidateSpy;

const h = vi.hoisted(() => ({ mutate: vi.fn(), getRecipient: vi.fn() }));
vi.mock("@workspace/api-client-react", async (orig) => ({
  ...(await orig<object>()),
  useCreatePaymentSubmission: () => ({ mutate: h.mutate, isPending: false }),
  useCreateContributionPaymentSubmission: () => ({ mutate: vi.fn(), isPending: false }),
  getReunionPaymentRecipient: h.getRecipient,
}));

const ZELLE = { name: "Rhonda Goudy", contact: "rhonda@example.org" };
const writeText = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText } });
  writeText.mockResolvedValue(undefined);
  vi.spyOn(window, "open");
  h.mutate.mockImplementation((_v, cb) => cb.onSuccess());
});
afterEach(cleanup);

const renderPay = (zelle: typeof ZELLE | null) =>
  render(withQc(<SubmitPayment reunionId={7} registrations={[{ id: 1, label: "A", amount: 40 }]} cashAppAvailable={false} zelle={zelle} checkPayee={null} />));

describe("Zelle payments", () => {
  it("hides Zelle when no approved Zelle recipient exists", () => {
    renderPay(null);
    expect(screen.queryByRole("button", { name: /Zelle/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Cash$/ })).toBeInTheDocument();
  });

  it("shows the approved recipient name and copies the contact, with no Zelle link", async () => {
    renderPay(ZELLE);
    fireEvent.click(screen.getByRole("button", { name: /Zelle/ }));
    const card = screen.getByTestId("zelle-recipient-card");
    expect(card).toHaveTextContent("Rhonda Goudy");
    expect(card).toHaveTextContent("rhonda@example.org");
    expect(card).toHaveTextContent(/own bank's app/);
    expect(card.querySelector("a")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Copy Zelle contact/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("rhonda@example.org"));
    expect(await screen.findAllByText("Copied")).not.toHaveLength(0);
  });

  it("keeps the payer's own Zelle reference separate and re-resolves the recipient after saving", async () => {
    h.getRecipient.mockResolvedValue({ status: "approved", zelleRecipientName: "Rhonda Goudy", zelleContact: "(312) 555-0147" });
    renderPay(ZELLE);
    fireEvent.click(screen.getByRole("button", { name: /Zelle/ }));
    fireEvent.change(screen.getByLabelText(/Your Zelle ID/), { target: { value: "payer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Save|Submit|Record/ }));
    const data = h.mutate.mock.calls[0][0].data;
    expect(data).toMatchObject({ method: "zelle", reference: "payer@example.com" });
    expect(data).not.toHaveProperty("zelleContact");
    expect(h.getRecipient).toHaveBeenCalledWith(7);
    // Fresh server value wins over the page-load hint.
    expect(await screen.findByText("(312) 555-0147")).toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("warns instead of showing stale details when Zelle was disabled after page load", async () => {
    h.getRecipient.mockResolvedValue({ status: "approved", zelleRecipientName: null, zelleContact: null });
    renderPay(ZELLE);
    fireEvent.click(screen.getByRole("button", { name: /Zelle/ }));
    fireEvent.change(screen.getByLabelText(/Your Zelle ID/), { target: { value: "payer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Save|Submit|Record/ }));
    expect(await screen.findByText(/Zelle is not configured for this reunion right now/)).toBeInTheDocument();
    expect(screen.queryByText("rhonda@example.org")).toBeNull();
  });
});

describe("special payment instructions in the payment form", () => {
  it("shows the owner's note before and after submitting, as text", async () => {
    render(withQc(<SubmitPayment reunionId={7} registrations={[{ id: 1, label: "A", amount: 40 }]} cashAppAvailable={false} instructions={"Hand cash to Rhonda.\n<b>x</b>"} checkPayee={null} />));
    expect(screen.getByTestId("special-payment-instructions")).toHaveTextContent("Hand cash to Rhonda.");
    expect(document.querySelector("[data-testid=special-payment-instructions] b")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cash$/ }));
    fireEvent.change(screen.getByLabelText(/Who did you give/), { target: { value: "Rhonda" } });
    fireEvent.change(screen.getByLabelText(/Date given/), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(h.mutate.mock.calls[0][0].data).not.toHaveProperty("paymentInstructions");
    expect(await screen.findByTestId("special-payment-instructions")).toBeInTheDocument();
  });
  it("shows nothing when no instructions are provided", () => {
    render(withQc(<SubmitPayment reunionId={7} registrations={[{ id: 1, label: "A", amount: 40 }]} cashAppAvailable={false} checkPayee={null} />));
    expect(screen.queryByTestId("special-payment-instructions")).toBeNull();
  });
});

describe("SubmitPayment without any online recipient", () => {
  it("still offers cash, and saving refreshes balances so the reported amount shows immediately", () => {
    renderPay(null);
    expect(screen.queryByRole("button", { name: /Cash App/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cash$/ }));
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe("40.00");
    for (const input of screen.getAllByRole("textbox")) {
      if (!(input as HTMLInputElement).value) fireEvent.change(input, { target: { value: "Handed to Aunt May" } });
    }
    const date = document.querySelector('input[type="date"]') as HTMLInputElement | null;
    if (date) fireEvent.change(date, { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Save|Submit|Record/ }));
    expect(h.mutate).toHaveBeenCalled();
    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys.some((k) => k.includes("registrations/1/ledger"))).toBe(true);
    expect(keys.some((k) => k.includes("/api/registrations"))).toBe(true);
    expect(keys.some((k) => k.includes("contributions"))).toBe(true);
  });
});
