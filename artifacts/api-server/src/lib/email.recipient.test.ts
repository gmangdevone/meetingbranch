import { describe, it, expect } from "vitest";
import { buildEmailHtml, type SendConfirmationEmailParams } from "./email";
import { resolvePublicRecipient } from "./paymentRecipients/validation";

const fee = { id: 1, reunionId: 1, label: "Registration Fee", chargeType: "per_person", isOptional: false, amount: 50, ageTiers: [], sortOrder: 0 } as any;

function params(recipient: SendConfirmationEmailParams["reunion"]["recipient"]): SendConfirmationEmailParams {
  return {
    toEmail: "guest@example.com",
    toName: "Guest",
    branchName: "A",
    attendees: [{ name: "Guest", shirtSize: "M" }],
    selectedFeeIds: [],
    registrationId: 1,
    registeredAt: new Date("2026-01-01T00:00:00Z"),
    reunion: { name: "Reunion", startDate: "2027-07-16", endDate: "2027-07-19", fees: [fee], recipient },
  };
}
const t = new Date("2026-01-01T00:00:00Z");

describe("confirmation email payment instructions", () => {
  it("uses the approved recipient link", () => {
    const html = buildEmailHtml(params(resolvePublicRecipient(1, { status: "approved", cashAppTag: "FamilyFund", paymentHandle: null, paymentUrl: null, updatedAt: t })));
    expect(html).toContain("https://cash.app/$FamilyFund");
    expect(html).not.toContain("not configured");
  });
  it("shows no destination for a legacy/unapproved reunion", () => {
    const html = buildEmailHtml(params(resolvePublicRecipient(1, null)));
    expect(html).not.toContain("cash.app");
    expect(html).toContain("not configured");
  });
  it("shows no destination when disabled", () => {
    const html = buildEmailHtml(params(resolvePublicRecipient(1, { status: "disabled", cashAppTag: null, paymentHandle: null, paymentUrl: null, updatedAt: t })));
    expect(html).not.toContain("cash.app");
    expect(html).toContain("not configured");
  });
  it("renders an approved generic destination", () => {
    const html = buildEmailHtml(params(resolvePublicRecipient(1, { status: "approved", cashAppTag: null, paymentHandle: "Family Fund", paymentUrl: "https://pay.example.org/r", updatedAt: t })));
    expect(html).toContain("https://pay.example.org/r");
    expect(html).toContain("Family Fund");
  });
  it("adds approved Zelle details alongside Cash App with no Zelle link", () => {
    const html = buildEmailHtml(params(resolvePublicRecipient(1, { status: "approved", cashAppTag: "FamilyFund", paymentHandle: null, paymentUrl: null, zelleRecipientName: "Rhonda Goudy", zelleContact: "rhonda@example.org", updatedAt: t })));
    expect(html).toContain("https://cash.app/$FamilyFund");
    expect(html).toContain("Rhonda Goudy");
    expect(html).toContain("rhonda@example.org");
    expect(html).not.toMatch(/href="[^"]*zelle/i);
  });
  it("renders Zelle-only instructions instead of not configured", () => {
    const html = buildEmailHtml(params(resolvePublicRecipient(1, { status: "approved", cashAppTag: null, paymentHandle: null, paymentUrl: null, zelleRecipientName: "Rhonda Goudy", zelleContact: "(312) 555-0147", updatedAt: t })));
    expect(html).toContain("(312) 555-0147");
    expect(html).toContain("own bank");
    expect(html).not.toContain("not configured");
    expect(html).not.toContain("cash.app");
  });
  it("hides Zelle when the recipient is disabled", () => {
    const html = buildEmailHtml(params(resolvePublicRecipient(1, { status: "disabled", cashAppTag: null, paymentHandle: null, paymentUrl: null, zelleRecipientName: "Rhonda Goudy", zelleContact: "rhonda@example.org", updatedAt: t })));
    expect(html).not.toContain("rhonda@example.org");
  });
});
