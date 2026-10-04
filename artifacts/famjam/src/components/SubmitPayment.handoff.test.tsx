import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitPayment } from "./SubmitPayment";

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  getRecipient: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreatePaymentSubmission: () => ({ mutate: h.mutate, isPending: false }),
  useCreateContributionPaymentSubmission: () => ({ mutate: vi.fn(), isPending: false }),
  getReunionPaymentRecipient: h.getRecipient,
}));

const win = { opener: {}, location: { href: "" }, close: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  win.location.href = "";
  vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
  h.mutate.mockImplementation((_v, cb) => cb.onSuccess());
});
afterEach(cleanup);

function payWithCashApp() {
  render(<SubmitPayment reunionId={7} registrations={[{ id: 1, label: "A", amount: 40 }]} cashAppAvailable checkPayee={null} />);
  fireEvent.click(screen.getByRole("button", { name: /Cash App/ }));
  fireEvent.change(screen.getByLabelText(/Your own \$cashtag/), { target: { value: "$payer" } });
  fireEvent.click(screen.getByRole("button", { name: /Submit & Open Cash App/ }));
}

describe("Cash App handoff", () => {
  it("opens the destination resolved fresh from the server, not a client value", async () => {
    h.getRecipient.mockResolvedValue({ status: "approved", cashAppUrl: "https://cash.app/$FamilyFund" });
    payWithCashApp();
    expect(h.mutate.mock.calls[0][0].data.reference).toBe("$payer");
    await waitFor(() => expect(win.location.href).toBe("https://cash.app/$FamilyFund/40"));
    expect(h.getRecipient).toHaveBeenCalledWith(7);
    expect(screen.getByText(/stays/)).toHaveTextContent(/pending/);
  });

  it("does not open anything when the recipient was disabled after page load", async () => {
    h.getRecipient.mockResolvedValue({ status: "disabled", cashAppUrl: null });
    payWithCashApp();
    expect(await screen.findByText(/not configured for this reunion right now/)).toBeInTheDocument();
    expect(win.close).toHaveBeenCalled();
    expect(win.location.href).toBe("");
  });

  it("rechecks the recipient when retrying instead of reopening a stale link", async () => {
    h.getRecipient.mockResolvedValueOnce({ status: "approved", cashAppUrl: "https://cash.app/$FamilyFund" });
    payWithCashApp();
    await screen.findByRole("button", { name: /tap here to open Cash App/ });
    win.location.href = "";
    h.getRecipient.mockResolvedValueOnce({ status: "disabled", cashAppUrl: null });
    fireEvent.click(screen.getByRole("button", { name: /tap here to open Cash App/ }));
    expect(await screen.findByText(/not configured for this reunion right now/)).toBeInTheDocument();
    expect(win.location.href).toBe("");
    expect(win.close).toHaveBeenCalled();
  });

  it("hides the Cash App method when no approved tag exists", () => {
    render(<SubmitPayment reunionId={7} registrations={[{ id: 1, label: "A", amount: 40 }]} cashAppAvailable={false} checkPayee={null} />);
    expect(screen.queryByRole("button", { name: /Cash App/ })).toBeNull();
  });
});
