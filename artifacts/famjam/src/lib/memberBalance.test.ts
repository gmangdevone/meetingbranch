import { describe, expect, it } from "vitest";
import { memberBalance, type MemberRegistration } from "./memberBalance";

const L = (o: Partial<NonNullable<MemberRegistration["ledger"]>>) => ({ status: "unpaid", balanceCents: 0, chargeCents: 8000, contributions: [], ...o });
const reg = (id: number, paymentStatus: string, ledger?: MemberRegistration["ledger"]): MemberRegistration => ({ id, paymentStatus, attendees: [], selectedFeeIds: [], ledger });

describe("memberBalance (hub gating + totals)", () => {
  const branchFee = { status: "unpaid" as const, collecting: true, amountCents: 12000 };

  it("adds the elected branch fee once to registration and chip-in balances", () => {
    const b = memberBalance(
      [reg(1, "pending", L({ balanceCents: 8050, contributions: [{ outstandingCents: 1000 }] }))],
      [{ id: 1, registrationId: 1, paymentStatus: "pending", amount: 10 },
       { id: 2, registrationId: null, paymentStatus: "pending", amount: 5 }],
      [], [branchFee],
    );
    expect(b).toMatchObject({ outstandingCents: 21550, branchFeeCents: 12000, status: "pending", canSubmitPayment: true });
  });

  it("includes fee-only accounts and keeps reported money due until confirmed", () => {
    expect(memberBalance([], [], [], [branchFee])).toMatchObject({
      outstandingCents: 12000, status: "pending", canSubmitPayment: true,
    });
    expect(memberBalance([], [], [], [{ ...branchFee, status: "reported" }])).toMatchObject({
      outstandingCents: 12000, status: "pending", canSubmitPayment: false,
    });
    expect(memberBalance([], [], [], [{ ...branchFee, status: "paid" }])).toMatchObject({
      outstandingCents: 0, status: "paid", canSubmitPayment: false,
    });
  });

  it("does not charge disabled fees and restores dues after a receipt reversal", () => {
    expect(memberBalance([], [], [], [{ ...branchFee, collecting: false }]).outstandingCents).toBe(0);
    const registration = reg(1, "paid", L({ status: "paid" }));
    expect(memberBalance([registration], [], [], [{ ...branchFee, status: "paid" }]).outstandingCents).toBe(0);
    expect(memberBalance([registration], [], [], [{ ...branchFee, status: "reported" }]).outstandingCents).toBe(12000);
  });

  it("offers Submit a Payment for $80 due with no recipient configured and no pending chip-ins", () => {
    const b = memberBalance([reg(1, "pending", L({ balanceCents: 8000 }))], [], []);
    expect(b).toMatchObject({ outstandingCents: 8000, status: "pending", canSubmitPayment: true });
  });

  it("uses the ledger, not the stale status column: 'paid' cache with a balance still owes", () => {
    const b = memberBalance([reg(1, "paid", L({ status: "partial", balanceCents: 2000 }))], [], []);
    expect(b.unpaid.map((r) => r.id)).toEqual([1]);
    expect(b.canSubmitPayment).toBe(true);
  });

  it("includes attached chip-in debt on a fee-paid or waived registration", () => {
    const paid = reg(1, "paid", L({ status: "paid", contributions: [{ outstandingCents: 1500 }] }));
    const waived = reg(2, "waived", L({ status: "waived", contributions: [{ outstandingCents: 1000 }] }));
    const b = memberBalance([paid, waived], [{ id: 9, registrationId: 1, paymentStatus: "pending", amount: 15 }], []);
    expect(b.unpaid.map((r) => r.id)).toEqual([1, 2]);
    expect(b.outstandingCents).toBe(2500); // attached chip-in counted once, via the ledger
  });

  it("counts cents exactly once: partial payments, paid chip-ins and standalone chip-ins", () => {
    const b = memberBalance(
      [reg(1, "pending", L({ status: "partial", balanceCents: 4950, contributions: [{ outstandingCents: 0 }] })), reg(2, "paid", L({ status: "paid" }))],
      [
        { id: 3, registrationId: 1, paymentStatus: "paid", amount: 25 },
        { id: 4, registrationId: null, paymentStatus: "pending", amount: 10 },
        { id: 5, registrationId: null, paymentStatus: "paid", amount: 20 },
      ],
      [],
    );
    expect(b.outstandingCents).toBe(4950 + 1000);
    expect(b.pendingChipIns.map((c) => c.id)).toEqual([4]);
  });

  it("settled accounts hide the form; all-waived reads waived", () => {
    expect(memberBalance([reg(1, "paid", L({ status: "paid" }))], [], [])).toMatchObject({ status: "paid", canSubmitPayment: false, outstandingCents: 0 });
    expect(memberBalance([reg(1, "waived", L({ status: "waived" }))], [], []).status).toBe("waived");
  });
});
