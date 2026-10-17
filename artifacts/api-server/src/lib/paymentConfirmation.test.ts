import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("./ledger", () => ({ rows: vi.fn(), loadLedgers: vi.fn() }));
vi.mock("./email", () => ({ sendPaymentConfirmation: vi.fn() }));
vi.mock("./logger", () => ({ logger: { error: vi.fn() } }));
import { rows, loadLedgers } from "./ledger";
import { sendPaymentConfirmation } from "./email";
import { logger } from "./logger";
import { emailRecordedPayment } from "./paymentConfirmation";

describe("recorded payment confirmation", () => {
  beforeEach(() => vi.resetAllMocks());
  it("sends only each registration's allocated amount and remaining balance", async () => {
    vi.mocked(rows).mockResolvedValue([
      { registration_id: 1, amount_cents: "2500", email: "one@example.test", first_name: "One", reunion_name: "Family Event", method: "cash", received_date: "2026-10-17" },
      { registration_id: 2, amount_cents: "1000", email: "two@example.test", first_name: "Two", reunion_name: "Family Event", method: "cash", received_date: "2026-10-17" },
    ]);
    vi.mocked(loadLedgers).mockResolvedValue(new Map([
      [1, { balanceCents: 5000, contributions: [{ outstandingCents: 300, waived: false }] }],
      [2, { balanceCents: 0, contributions: [] }],
    ]) as any);
    await emailRecordedPayment(42);
    expect(sendPaymentConfirmation).toHaveBeenCalledTimes(2);
    expect(sendPaymentConfirmation).toHaveBeenCalledWith(expect.objectContaining({ registrationId: 1, amountCents: 2500, balanceCents: 5300, receiptId: 42 }));
    expect(sendPaymentConfirmation).toHaveBeenCalledWith(expect.objectContaining({ registrationId: 2, amountCents: 1000, balanceCents: 0 }));
  });
  it("does not fail a payment when email delivery fails", async () => {
    vi.mocked(rows).mockRejectedValue(new Error("unavailable"));
    await expect(emailRecordedPayment(42)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
  it("sends nothing if no reachable registrants have allocations", async () => {
    vi.mocked(rows).mockResolvedValue([]);
    vi.mocked(loadLedgers).mockResolvedValue(new Map());
    await emailRecordedPayment(42);
    expect(sendPaymentConfirmation).not.toHaveBeenCalled();
  });
});
