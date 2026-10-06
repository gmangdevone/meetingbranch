import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecordPaymentDialog, isDefiniteRejection } from "./RecordPaymentDialog";

const h = vi.hoisted(() => ({ mutate: vi.fn(), pending: false }));
vi.mock("@workspace/api-client-react", async (orig) => ({
  ...(await orig<object>()),
  useRecordReceipt: () => ({ mutate: h.mutate, isPending: h.pending }),
}));

const ledger = {
  registrationId: 1, chargeCents: 8000, sponsoredCents: 0, confirmedCents: 0, legacyCreditCents: 0, waived: false, waivedCents: 0,
  balanceCents: 8000, creditCents: 0, pendingReportedCents: 3000, status: "unpaid", legacyPending: false, contributions: [],
} as never;

const renderDialog = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordPaymentDialog
        reunionId={5}
        registrations={[{ id: 1, label: "#1 Goudy", ledger }]}
        preset={{ submissionId: 9, amountCents: 3000, method: "cash", receivedDate: "2026-06-01" }}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );

const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status, data: { error: "Rejected by server" } });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("RecordPaymentDialog idempotency", () => {
  it("classifies only explicit server rejections as definite", () => {
    expect(isDefiniteRejection(apiError(409))).toBe(true);
    expect(isDefiniteRejection(apiError(500))).toBe(false);
    expect(isDefiniteRejection(new TypeError("Failed to fetch"))).toBe(false);
    expect(isDefiniteRejection({ status: 400 })).toBe(false); // no body: unreadable response
  });

  it("committed-but-lost response: retries the SAME key and frozen payload, with the form locked", () => {
    // First attempt commits on the server but the response is lost.
    h.mutate.mockImplementationOnce((_v, cb) => cb.onError(new TypeError("Failed to fetch")));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Record \$30\.00/ }));
    const first = h.mutate.mock.calls[0][0];
    expect(first.data).toMatchObject({ amountCents: 3000, submissionId: 9 });
    expect(screen.getByText(/couldn't confirm whether this payment was saved/)).toBeInTheDocument();

    // Fields are locked: the request under this key cannot change.
    const amount = screen.getByLabelText(/Amount received/) as HTMLInputElement;
    expect(amount).toBeDisabled();
    expect(screen.getByLabelText(/Amount for #1 Goudy/)).toBeDisabled();
    expect(screen.getByLabelText(/Reference/)).toBeDisabled();
    fireEvent.change(amount, { target: { value: "35" } });

    // Retry: the server returns the original receipt (duplicate) -> one receipt total.
    h.mutate.mockImplementationOnce((_v, cb) => cb.onSuccess({ receiptId: 77, duplicate: true, ledgers: [] }));
    fireEvent.click(screen.getByRole("button", { name: /Retry the same \$30\.00 payment/ }));
    const second = h.mutate.mock.calls[1][0];
    expect(second).toEqual(first);
    expect(second.data.idempotencyKey).toBe(first.data.idempotencyKey);
    expect(h.mutate).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/\$30\.00 recorded/)).toBeInTheDocument();
  });

  it("5xx is ambiguous too; a definite rejection unlocks and the next attempt uses a new key", () => {
    h.mutate.mockImplementationOnce((_v, cb) => cb.onError(apiError(502)));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Record \$30\.00/ }));
    h.mutate.mockImplementationOnce((_v, cb) => cb.onError(apiError(409)));
    fireEvent.click(screen.getByRole("button", { name: /Retry the same/ }));
    expect(h.mutate.mock.calls[1][0]).toEqual(h.mutate.mock.calls[0][0]);
    expect(screen.getByText("Rejected by server")).toBeInTheDocument();
    const amount = screen.getByLabelText(/Amount received/) as HTMLInputElement;
    expect(amount).not.toBeDisabled();
    fireEvent.change(amount, { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/Amount for #1 Goudy/), { target: { value: "20" } });
    h.mutate.mockImplementationOnce(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: /Record \$20\.00/ }));
    const third = h.mutate.mock.calls[2][0];
    expect(third.data.amountCents).toBe(2000);
    expect(third.data.idempotencyKey).not.toBe(h.mutate.mock.calls[0][0].data.idempotencyKey);
  });
});
