import { describe, it, expect, afterEach, vi } from "vitest";
import {
  normalizeCashtag,
  cashAppUrlError,
  paymentUrlError,
  validateRecipientInput,
  resolvePublicRecipient,
  cashAppAvailable,
  findDestinationKeys,
} from "./validation";
import { getConfiguredPaymentOwnerId, isPaymentOwner } from "./owner";
import { withoutCashApp } from "./store";

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
    expect(r).toEqual({ ok: true, values: { cashAppTag: null, paymentHandle: "Family Fund at First Bank", paymentUrl: "https://pay.example.org/reunion" } });
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
    expect(withoutCashApp({ cashAppTag: "FamilyFund", paymentHandle: "Bank transfer", paymentUrl: "https://cash.app/$FamilyFund" }))
      .toEqual({ cashAppTag: null, paymentHandle: "Bank transfer", paymentUrl: null });
    expect(withoutCashApp({ cashAppTag: "FamilyFund", paymentHandle: "$FamilyFund", paymentUrl: "https://pay.example.org" }))
      .toEqual({ cashAppTag: null, paymentHandle: null, paymentUrl: "https://pay.example.org" });
  });
  it("returns null when nothing else is approved", () => {
    expect(withoutCashApp({ cashAppTag: "FamilyFund", paymentHandle: "$FamilyFund", paymentUrl: null })).toBeNull();
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
