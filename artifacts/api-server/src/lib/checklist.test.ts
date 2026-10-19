import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./ledger", () => ({
  rows: vi.fn(), loadLedgers: vi.fn(),
  fmtCents: (c: number) => `$${(c / 100).toFixed(2)}`,
}));
vi.mock("./branchFees", () => ({ loadMyElections: vi.fn() }));
import { rows, loadLedgers } from "./ledger";
import { loadMyElections } from "./branchFees";
import { checklistAutomaticStatus } from "./checklist";

const ledger = (overrides: object = {}) => ({
  balanceCents: 0, confirmedCents: 8000, legacyCreditCents: 0, pendingReportedCents: 0,
  contributions: [], ...overrides,
});
const election = (overrides: object = {}) => ({
  collecting: true, status: "unpaid", amountCents: 2500, ...overrides,
});
function setup({ regs = [{ id: 1, attendee_count: 2 }], ledgers = [ledger()], contributions = [], elections = [] }:
  { regs?: object[]; ledgers?: object[]; contributions?: object[]; elections?: object[] } = {}) {
  vi.mocked(rows).mockResolvedValueOnce(regs).mockResolvedValueOnce(contributions);
  vi.mocked(loadLedgers).mockResolvedValue(new Map(ledgers.map((l, i) => [i + 1, l])) as any);
  vi.mocked(loadMyElections).mockResolvedValue(elections as any);
}
describe("automatic checklist payment status", () => {
  beforeEach(() => vi.resetAllMocks());
  it("does not complete either automatic item before registration or obligations exist", async () => {
    setup({ regs: [], ledgers: [] });
    const state = await checklistAutomaticStatus({ execute: vi.fn() }, 1, "user");
    expect(state.registration.completed).toBe(false);
    expect(state.payment.completed).toBe(false);
  });
  it("keeps an elected branch fee outstanding even after registration is paid", async () => {
    setup({ elections: [election({ status: "reported" })] });
    const { payment } = await checklistAutomaticStatus({ execute: vi.fn() }, 1, "user");
    expect(payment).toEqual({ completed: false, statusText: "Awaiting organizer confirmation — $25.00 remaining" });
  });
  it("finishes when elected fees are confirmed and ignores disabled unpaid fees", async () => {
    setup({ elections: [election({ status: "paid" }), election({ collecting: false })] });
    expect((await checklistAutomaticStatus({ execute: vi.fn() }, 1, "user")).payment).toEqual({ completed: true, statusText: "Paid in full" });
  });
  it("includes attached fund pledges and does not count waived pledges as owed", async () => {
    setup({ ledgers: [ledger({ contributions: [
      { outstandingCents: 1000, waived: false, confirmedCents: 0 },
      { outstandingCents: 3000, waived: true, confirmedCents: 0 },
    ] })] });
    expect((await checklistAutomaticStatus({ execute: vi.fn() }, 1, "user")).payment)
      .toEqual({ completed: false, statusText: "Payment needed — $10.00 remaining" });
  });
  it("distinguishes waived or sponsored fees from actual payments", async () => {
    setup({ ledgers: [ledger({ confirmedCents: 0 })] });
    expect((await checklistAutomaticStatus({ execute: vi.fn() }, 1, "user")).payment)
      .toEqual({ completed: true, statusText: "No payment due" });
  });
  it("sums balances across multiple registrations", async () => {
    setup({ regs: [{ id: 1, attendee_count: 1 }, { id: 2, attendee_count: 1 }],
      ledgers: [ledger({ balanceCents: 2500 }), ledger({ balanceCents: 3000 })] });
    expect((await checklistAutomaticStatus({ execute: vi.fn() }, 1, "user")).payment)
      .toEqual({ completed: false, statusText: "Payment needed — $55.00 remaining" });
  });
});
