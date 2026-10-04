import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitPayment } from "./SubmitPayment";

const h = vi.hoisted(() => ({ mutate: vi.fn(), getRecipient: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
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
  render(<SubmitPayment reunionId={7} registrations={[{ id: 1, label: "A", amount: 40 }]} cashAppAvailable={false} zelle={zelle} checkPayee={null} />);

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
