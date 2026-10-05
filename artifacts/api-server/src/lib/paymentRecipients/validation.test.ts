import { describe, it, expect, afterEach, vi } from "vitest";
import {
  normalizePaymentInstructions,
  normalizeCashtag,
  cashAppUrlError,
  paymentUrlError,
  validateRecipientInput,
  resolvePublicRecipient,
  cashAppAvailable,
  zelleAvailable,
  normalizeZelleContact,
  findDestinationKeys,
} from "./validation";
import { getConfiguredPaymentOwnerId, isPaymentOwner } from "./owner";
import { withoutCashApp, withoutZelle } from "./store";

const now = new Date("2026-03-01T00:00:00Z");

describe("normalizeCashtag", () => {
  it("accepts tags with or without $ and keeps case", () => {
    expect(normalizeCashtag("$FamilyFund")).toBe("FamilyFund");
    expect(normalizeCashtag("  fam2027 ")).toBe("fam2027");
  });
  it.each(["", "$", "123456", "$has space", "a".repeat(21), "$a-b", "$$abc", "<script>", null, 42])(
    "rejects %s",
    (v) => expect(normalizeCashtag(v)).toBeNull(),
  );
});

describe("cash.app link validation", () => {
  it("accepts a matching link (case-insensitive tag, optional amount)", () => {
    expect(cashAppUrlError("https://cash.app/$familyfund", "FamilyFund")).toBeNull();
    expect(cashAppUrlError("https://www.cash.app/$FamilyFund/25", "FamilyFund")).toBeNull();
  });
  it.each([
    ["http://cash.app/$FamilyFund", "https"],
    ["https://cash.app.evil.com/$FamilyFund", "cash.app"],
    ["https://evilcash.app/$FamilyFund", "cash.app"],
    ["https://user:pw@cash.app/$FamilyFund", "credentials"],
    ["https://cash.app:8443/$FamilyFund", "port"],
    ["https://cash.app/$FamilyFund?x=1", "query"],
    ["https://cash.app/$Other", "same $Cashtag"],
    ["https://cash.app/pay/$FamilyFund", "look like"],
    ["https://cash.app/$Family%E0%A4%A", "encoding"],
    ["javascript:alert(1)", "https"],
    ["not a url", "spaces"],
  ])("rejects %s", (url, msg) => {
    expect(cashAppUrlError(url, "FamilyFund")).toContain(msg);
  });
  it("never throws on malformed percent-encoding", () => {
    expect(() => cashAppUrlError("https://cash.app/%", "FamilyFund")).not.toThrow();
  });
  it("requires a tag for cash.app links", () => {
    expect(paymentUrlError("https://cash.app/$FamilyFund", null)).toContain("requires an approved $Cashtag");
  });
});

describe("generic destinations", () => {
  it("allows a safe generic https link without a Cash App tag", () => {
    const r = validateRecipientInput({ paymentHandle: "Family Fund at First Bank", paymentUrl: "https://pay.example.org/reunion" });
    expect(r).toEqual({ ok: true, values: { cashAppTag: null, paymentHandle: "Family Fund at First Bank", paymentUrl: "https://pay.example.org/reunion", zelleRecipientName: null, zelleContact: null, paymentInstructions: null } });
  });
  it.each([
    "http://pay.example.org",
    "https://localhost/pay",
    "https://127.0.0.1/pay",
    "https://u:p@pay.example.org",
    "https://pay.example.org:8080/",
    "https://pay.example.org/a b",
    "https://pay.example.org/\u0007",
    "data:text/html,hi",
    "https://cash.app.evil.example/$FamilyFund",
    "https://cashapp-pay.example.net/x",
  ])("rejects unsafe generic link %s", (url) => {
    expect(validateRecipientInput({ paymentUrl: url }).ok).toBe(false);
  });
  it("requires at least one destination", () => {
    expect(validateRecipientInput({}).ok).toBe(false);
    expect(validateRecipientInput({ cashAppTag: "", paymentHandle: " ", paymentUrl: "" }).ok).toBe(false);
  });
  it("rejects a $label for a different tag, or with no tag", () => {
    expect(validateRecipientInput({ cashAppTag: "FamilyFund", paymentHandle: "$Attacker" }).ok).toBe(false);
    expect(validateRecipientInput({ paymentHandle: "$Attacker" }).ok).toBe(false);
  });
  it("rejects links and markup in the label", () => {
    expect(validateRecipientInput({ paymentHandle: "pay at https://x.example.com" }).ok).toBe(false);
    expect(validateRecipientInput({ paymentHandle: "<b>x</b>" }).ok).toBe(false);
  });
  it("rejects an invalid tag even when generic fields are fine", () => {
    expect(validateRecipientInput({ cashAppTag: "bad tag", paymentUrl: "https://pay.example.org" }).ok).toBe(false);
  });
});

describe("resolvePublicRecipient (fail closed)", () => {
  it("treats a missing row (legacy reunion) as pending review with no destination", () => {
    const r = resolvePublicRecipient(5, null);
    expect(r).toMatchObject({ status: "pending_review", cashAppTag: null, cashAppUrl: null, paymentHandle: null, paymentUrl: null });
    expect(cashAppAvailable(r)).toBe(false);
  });
  it("hides everything when disabled", () => {
    const r = resolvePublicRecipient(5, { status: "disabled", cashAppTag: "FamilyFund", paymentHandle: "x", paymentUrl: null, updatedAt: now });
    expect(r.cashAppTag).toBeNull();
    expect(r.paymentHandle).toBeNull();
  });
  it("hides an approved row whose stored values no longer validate", () => {
    const r = resolvePublicRecipient(5, { status: "approved", cashAppTag: "FamilyFund", paymentHandle: null, paymentUrl: "https://cash.app/$Other", updatedAt: now });
    expect(r.status).toBe("pending_review");
    expect(r.paymentUrl).toBeNull();
  });
  it("builds the canonical Cash App link from the approved tag", () => {
    const r = resolvePublicRecipient(5, { status: "approved", cashAppTag: "FamilyFund", paymentHandle: null, paymentUrl: null, updatedAt: now });
    expect(r).toMatchObject({ status: "approved", cashAppUrl: "https://cash.app/$FamilyFund", paymentHandle: "$FamilyFund", paymentUrl: "https://cash.app/$FamilyFund" });
    expect(cashAppAvailable(r)).toBe(true);
  });
  it("serves generic-only destinations without enabling Cash App", () => {
    const r = resolvePublicRecipient(5, { status: "approved", cashAppTag: null, paymentHandle: "Bank transfer", paymentUrl: "https://pay.example.org", updatedAt: now });
    expect(r.paymentUrl).toBe("https://pay.example.org");
    expect(cashAppAvailable(r)).toBe(false);
  });
});

describe("withoutCashApp", () => {
  it("keeps generic destinations and drops Cash App ones", () => {
    expect(withoutCashApp({ cashAppTag: "FamilyFund", paymentHandle: "Bank transfer", paymentUrl: "https://cash.app/$FamilyFund" , zelleRecipientName: null, zelleContact: null }))
      .toEqual({ cashAppTag: null, paymentHandle: "Bank transfer", paymentUrl: null , zelleRecipientName: null, zelleContact: null });
    expect(withoutCashApp({ cashAppTag: "FamilyFund", paymentHandle: "$FamilyFund", paymentUrl: "https://pay.example.org" , zelleRecipientName: null, zelleContact: null }))
      .toEqual({ cashAppTag: null, paymentHandle: null, paymentUrl: "https://pay.example.org" , zelleRecipientName: null, zelleContact: null });
  });
  it("returns null when nothing else is approved", () => {
    expect(withoutCashApp({ cashAppTag: "FamilyFund", paymentHandle: "$FamilyFund", paymentUrl: null , zelleRecipientName: null, zelleContact: null })).toBeNull();
  });
});

describe("findDestinationKeys", () => {
  it("detects destination keys even when null", () => {
    expect(findDestinationKeys({ name: "x", cashAppTag: null })).toEqual(["cashAppTag"]);
    expect(findDestinationKeys({ name: "x" })).toEqual([]);
  });
});

describe("owner configuration (fail closed)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("denies everyone when unset, blank or malformed", () => {
    for (const v of ["", "   ", "admin", "user_", "user_abc def123456", "*"]) {
      vi.stubEnv("PAYMENT_OWNER_USER_ID", v);
      expect(getConfiguredPaymentOwnerId()).toBeNull();
      expect(isPaymentOwner("user_abc")).toBe(false);
    }
  });
  it("matches only the exact configured id", () => {
    vi.stubEnv("PAYMENT_OWNER_USER_ID", "user_TestOwner000001");
    expect(isPaymentOwner("user_TestOwner000001")).toBe(true);
    expect(isPaymentOwner("user_testowner000001")).toBe(false);
    expect(isPaymentOwner(undefined)).toBe(false);
  });
});

describe("Zelle recipient", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it.each([
    ["Treasurer@Example.ORG", "treasurer@example.org"],
    ["312-555-0147", "(312) 555-0147"],
    ["+1 (312) 555-0147", "(312) 555-0147"],
    ["13125550147", "(312) 555-0147"],
    ["312.555.0147", "(312) 555-0147"],
  ])("normalizes %s", (input, out) => expect(normalizeZelleContact(input)).toBe(out));
  it.each(["", "not-an-email", "a@b", "a..b@example.org", "555-0147", "012-555-0147", "312-155-0147", "+44 20 7946 0958", "3125550147x", "https://zelle.example/x", "a@example.org<script>"])(
    "rejects invalid contact %j",
    (input) => expect(normalizeZelleContact(input)).toBeNull(),
  );
  it("requires name and contact together", () => {
    expect(validateRecipientInput({ zelleRecipientName: "Rhonda Goudy" }).ok).toBe(false);
    expect(validateRecipientInput({ zelleContact: "rhonda@example.org" }).ok).toBe(false);
    expect(validateRecipientInput({ zelleRecipientName: "Rhonda Goudy", zelleContact: "555" }).ok).toBe(false);
    expect(validateRecipientInput({ zelleRecipientName: "https://x.example", zelleContact: "rhonda@example.org" }).ok).toBe(false);
    expect(validateRecipientInput({ zelleRecipientName: "<b>R</b>", zelleContact: "rhonda@example.org" }).ok).toBe(false);
  });
  it("accepts a Zelle-only destination and normalizes it", () => {
    expect(validateRecipientInput({ zelleRecipientName: "  Rhonda   Goudy ", zelleContact: "(312) 555-0147" })).toEqual({
      ok: true,
      values: { cashAppTag: null, paymentHandle: null, paymentUrl: null, zelleRecipientName: "Rhonda Goudy", zelleContact: "(312) 555-0147", paymentInstructions: null },
    });
  });
  it("resolves Zelle only for approved valid rows", () => {
    const row = { status: "approved" as const, cashAppTag: null, paymentHandle: null, paymentUrl: null, zelleRecipientName: "Rhonda Goudy", zelleContact: "rhonda@example.org", updatedAt: now };
    const r = resolvePublicRecipient(9, row);
    expect(r).toMatchObject({ status: "approved", zelleRecipientName: "Rhonda Goudy", zelleContact: "rhonda@example.org", cashAppTag: null, paymentUrl: null });
    expect(zelleAvailable(r)).toBe(true);
    expect(cashAppAvailable(r)).toBe(false);
    expect(zelleAvailable(resolvePublicRecipient(9, { ...row, status: "disabled" }))).toBe(false);
    expect(resolvePublicRecipient(9, { ...row, zelleContact: "bogus" })).toMatchObject({ status: "pending_review", zelleContact: null });
    expect(zelleAvailable(resolvePublicRecipient(9, null))).toBe(false);
  });
  it("disabling one method keeps the other", () => {
    const both = { cashAppTag: "FamilyFund", paymentHandle: null, paymentUrl: null, zelleRecipientName: "Rhonda Goudy", zelleContact: "rhonda@example.org" };
    expect(withoutCashApp(both)).toEqual({ ...both, cashAppTag: null });
    expect(withoutZelle(both)).toEqual({ ...both, zelleRecipientName: null, zelleContact: null });
    expect(withoutZelle({ ...both, cashAppTag: null })).toBeNull();
  });
  it("treats Zelle fields as destination keys", () => {
    expect(findDestinationKeys({ zelleContact: "x", zelleRecipientName: "y" })).toEqual(["zelleRecipientName", "zelleContact"]);
  });
});

describe("special payment instructions", () => {
  it("normalizes line endings, trailing spaces and blank runs; blank clears", () => {
    expect(normalizePaymentInstructions("  a  \r\n\r\n\r\n\r\nb\rc ")).toEqual({ ok: true, value: "a\n\nb\nc" });
    expect(normalizePaymentInstructions("  \n\t ")).toEqual({ ok: true, value: null });
    expect(normalizePaymentInstructions(null)).toEqual({ ok: true, value: null });
  });
  it("rejects non-text, over-length and invisible/control characters", () => {
    expect(normalizePaymentInstructions(5).ok).toBe(false);
    expect(normalizePaymentInstructions("x".repeat(2001)).ok).toBe(false);
    expect(normalizePaymentInstructions("x".repeat(2000)).ok).toBe(true);
    for (const bad of ["a\u0000b", "a\u202eb", "a\u200bb"]) expect(normalizePaymentInstructions(bad).ok).toBe(false);
  });
  it("keeps HTML-looking text literally (rendering escapes it)", () => {
    expect(normalizePaymentInstructions("<b>hi</b>")).toEqual({ ok: true, value: "<b>hi</b>" });
  });
  it("allows instructions as the only approved content and resolves them publicly", () => {
    const v = validateRecipientInput({ paymentInstructions: "Pay cash at check-in" });
    expect(v.ok).toBe(true);
    const pub = resolvePublicRecipient(1, { status: "approved", cashAppTag: null, paymentHandle: null, paymentUrl: null, paymentInstructions: "Pay cash", updatedAt: new Date() });
    expect(pub).toMatchObject({ status: "approved", paymentInstructions: "Pay cash" });
  });
  it("hides instructions when disabled or unapproved", () => {
    expect(resolvePublicRecipient(1, { status: "disabled", cashAppTag: null, paymentHandle: null, paymentUrl: null, paymentInstructions: "x", updatedAt: new Date() }).paymentInstructions).toBeNull();
    expect(resolvePublicRecipient(1, null).paymentInstructions).toBeNull();
  });
  it("method disables preserve instructions only when another destination remains", () => {
    const base = { cashAppTag: "Fund1", paymentHandle: null, paymentUrl: null, zelleRecipientName: "Rhonda Goudy", zelleContact: "r@example.org", paymentInstructions: "note" };
    expect(withoutCashApp(base)?.paymentInstructions).toBe("note");
    expect(withoutZelle(base)?.paymentInstructions).toBe("note");
    expect(withoutZelle({ ...base, cashAppTag: null })).toBeNull();
  });
  it("is a blocked destination key on ordinary routes", () => {
    expect(findDestinationKeys({ paymentInstructions: "x" })).toEqual(["paymentInstructions"]);
  });
});
