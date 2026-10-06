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

beforeEach(() => { vi.clearAllMocks(); h.mutate.mockReset(); });
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

  it("single fee line: typing $20 against $120 updates the sole allocation; no split editing needed", () => {
    h.mutate.mockImplementationOnce(() => undefined);
    const l120 = { ...(ledger as object), chargeCents: 12000, balanceCents: 12000, pendingReportedCents: 0 } as never;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordPaymentDialog reunionId={5} registrations={[{ id: 1, label: "#1 Goudy", ledger: l120 }]} preset={{ method: "cash", receivedDate: "2026-06-01" } as never} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/Amount received/), { target: { value: "20" } });
    expect((screen.getByLabelText(/Amount for #1 Goudy/) as HTMLInputElement).value).toBe("20.00");
    fireEvent.click(screen.getByRole("button", { name: /Record \$20\.00/ }));
    expect(h.mutate.mock.calls[0][0].data).toMatchObject({ amountCents: 2000, allocations: [{ registrationId: 1, contributionId: null, amountCents: 2000 }] });
  });

  it("'already recorded' conflict keeps the form locked and never rotates the key", () => {
    h.mutate.mockImplementationOnce((_v, cb) => cb.onError(new TypeError("Failed to fetch")));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Record \$30\.00/ }));
    const conflict = Object.assign(new Error("HTTP 409"), { status: 409, data: { error: "This payment was already recorded.", code: "already_recorded" } });
    expect(isDefiniteRejection(conflict)).toBe(false);
    h.mutate.mockImplementationOnce((_v, cb) => cb.onError(conflict));
    fireEvent.click(screen.getByRole("button", { name: /Retry the same/ }));
    expect(screen.getByText("This payment was already recorded.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount received/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Record|Retry/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Close and check history/ })).toBeInTheDocument();
  });
});

describe("RecordPaymentDialog branch special fee", () => {
  const renderFee = (preset: Parameters<typeof RecordPaymentDialog>[0]["preset"], registrations: Parameters<typeof RecordPaymentDialog>[0]["registrations"] = []) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecordPaymentDialog reunionId={5} registrations={registrations} preset={preset} onClose={() => undefined} />
      </QueryClientProvider>,
    );

  it("a single $20 branch fee auto-allocates $20 and records a branch allocation with the chosen payer", () => {
    renderFee({ method: "cash", branchFee: { branchId: 11, branchName: "Lacey", label: "Sibling Fee", remainingCents: 2000, payerRegistrationId: 4, payerOptions: [{ id: 4, label: "Amy" }] } });
    expect(screen.getByText(/shared, once per branch/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Amount received/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /Record \$20\.00/ }));
    expect(h.mutate.mock.calls[0][0].data).toMatchObject({ amountCents: 2000, allocations: [{ branchId: 11, payerRegistrationId: 4, amountCents: 2000 }] });
  });

  it("mixed report splits exactly: branch fee takes the reported portion, the rest goes to dues", () => {
    renderFee(
      { submissionId: 3, amountCents: 8800, method: "cash", receivedDate: "2026-06-01", branchFee: { branchId: 11, branchName: "Lacey", label: "Sibling Fee", remainingCents: 2000, reportedCents: 800 } },
      [{ id: 1, label: "#1 Goudy", ledger }],
    );
    fireEvent.click(screen.getByRole("button", { name: /Record \$88\.00/ }));
    expect(h.mutate.mock.calls[0][0].data.allocations).toEqual([
      { branchId: 11, payerRegistrationId: null, amountCents: 800 },
      { registrationId: 1, contributionId: null, amountCents: 8000 },
    ]);
  });
});
