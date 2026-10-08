import { describe, it, expect } from "vitest";
import { computeTotal, isDinnerFee, serializeFee } from "./fees";
import { buildEmailHtml } from "./email";

const fee = (o: Record<string, unknown>) => ({ id: 1, isOptional: false, chargeType: "per_person", amount: 30, ageTiers: [], label: "Fee", isDinner: null, ...o }) as never;

describe("dinner fee classification and opt-out math", () => {
  it("detects legacy per_person dinner labels; explicit wins; flat never dinner", () => {
    expect(isDinnerFee({ chargeType: "per_person", label: "Sunday Dinner", isDinner: null })).toBe(true);
    expect(isDinnerFee({ chargeType: "per_person", label: "Sunday Supper", isDinner: true })).toBe(true);
    expect(isDinnerFee({ chargeType: "per_person", label: "Sunday Dinner", isDinner: false })).toBe(false);
    expect(isDinnerFee({ chargeType: "flat", label: "Dinner", isDinner: true })).toBe(false);
    expect(serializeFee({ chargeType: "per_person", label: "x", isDinner: null })).toMatchObject({ isDinner: false, dinnerClassification: "detected" });
  });

  it("opt-out removes only dinner shares; registration and flat fees still charge", () => {
    const fees = [
      fee({ id: 1, label: "Registration Fee", amount: 50 }),
      fee({ id: 2, label: "Sunday Dinner", amount: 30, ageTiers: [{ minAge: 6, maxAge: 12, amount: 20 }] }),
      fee({ id: 3, label: "Dinner Hall Rental", chargeType: "flat", amount: 100 }),
    ];
    const people = [{ age: 40, includeDinner: true }, { age: 8, includeDinner: false }, { age: 30 }];
    expect(computeTotal(fees, people, [])).toBe(50 * 3 + 30 + 30 + 100);
  });

  it("an unselected optional dinner charges nobody regardless of opt-outs", () => {
    const fees = [fee({ id: 9, isOptional: true, isDinner: true, amount: 10 })];
    expect(computeTotal(fees, [{ age: 40, includeDinner: true }], [])).toBe(0);
    expect(computeTotal(fees, [{ age: 40, includeDinner: true }, { age: 9, includeDinner: false }], [9])).toBe(10);
  });

  it("confirmation email total and attendee row reflect the opt-out", () => {
    const html = buildEmailHtml({
      toEmail: "a@x.test", toName: "Amy", branchName: "Lacey", selectedFeeIds: [], registrationId: 1, registeredAt: new Date("2026-01-01T00:00:00Z"),
      attendees: [{ name: "Ann", shirtSize: "L", age: 40, includeDinner: true }, { name: "Ben", shirtSize: "M", age: 35, includeDinner: false }],
      reunion: {
        name: "R", startDate: "2027-07-01", endDate: "2027-07-03",
        fees: [fee({ id: 1, label: "Registration Fee", amount: 50 }), fee({ id: 2, label: "Sunday Dinner", amount: 30 })],
        recipient: { reunionId: 1, status: "approved", cashAppTag: null, cashAppUrl: null, paymentHandle: "$x", paymentUrl: null, zelleRecipientName: null, zelleContact: null, approvedAt: null } as never,
      },
    });
    expect(html).toContain("$130.00");
    expect(html).toContain("(no dinner)");
  });
});
