/**
 * Pure validation/resolution helpers for owner-controlled payment recipients.
 * Nothing here touches the database so it is safe to unit test exhaustively.
 */
export type RecipientStatus = "approved" | "pending_review" | "disabled";

export interface RecipientValues {
  cashAppTag: string | null;
  paymentHandle: string | null;
  paymentUrl: string | null;
  zelleRecipientName: string | null;
  zelleContact: string | null;
}

export interface PublicRecipient extends RecipientValues {
  reunionId: number;
  status: RecipientStatus;
  cashAppUrl: string | null;
  approvedAt: string | null;
}

const ZELLE_NAME_MAX = 80;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;

/**
 * Normalizes a Zelle contact: an email (lowercased) or a US phone number
 * formatted as "(312) 555-0147". Returns null when neither is valid.
 */
export function normalizeZelleContact(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  if (!v || v.length > 254) return null;
  if (v.includes("@")) {
    if (!EMAIL.test(v) || v.includes("..")) return null;
    const [local] = v.split("@");
    if (local.length > 64 || local.startsWith(".") || local.endsWith(".")) return null;
    return v.toLowerCase();
  }
  if (!/^[+0-9().\s-]+$/.test(v)) return null;
  let digits = v.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  else if (v.startsWith("+")) return null; // non-US country code
  // NANP: area code and exchange cannot start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Cash App cashtags: 1-20 letters/digits, at least one letter. */
const CASHTAG = /^(?=.*[A-Za-z])[A-Za-z0-9]{1,20}$/;
const ALLOWED_CASH_APP_HOSTS = new Set(["cash.app", "www.cash.app"]);

/** Returns the canonical tag (no "$", original case) or null when invalid. */
export function normalizeCashtag(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const withoutDollar = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  return CASHTAG.test(withoutDollar) ? withoutDollar : null;
}

export function sameCashtag(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The only shape of Cash App link the app ever produces. */
export function buildCashAppUrl(tag: string, amount?: number): string {
  const base = `https://cash.app/$${encodeURIComponent(tag)}`;
  if (amount !== undefined && Number.isInteger(amount) && amount > 0) return `${base}/${amount}`;
  return base;
}

/** Control chars, whitespace and angle brackets never appear in a safe link. */
const UNSAFE_URL_CHARS = /[\u0000-\u0020\u007f<>"'`\\]/;

export function isCashAppHost(hostname: string): boolean {
  return ALLOWED_CASH_APP_HOSTS.has(hostname.toLowerCase());
}

/** Parses an https URL with no credentials, port or unsafe characters. */
function parseSafeHttpsUrl(url: string): { ok: true; url: URL } | { ok: false; error: string } {
  if (url.length > 300) return { ok: false, error: "Payment link must be 300 characters or fewer." };
  if (UNSAFE_URL_CHARS.test(url)) return { ok: false, error: "Payment link contains spaces or unsupported characters." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Payment link must be a valid URL." };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "Payment link must use https." };
  if (parsed.username || parsed.password) return { ok: false, error: "Payment link must not include credentials." };
  if (parsed.port) return { ok: false, error: "Payment link must not include a port." };
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || /^[\d.]+$/.test(host) || host.startsWith("[")) {
    return { ok: false, error: "Payment link must use a public domain name." };
  }
  return { ok: true, url: parsed };
}

/**
 * Validates a Cash App link against the canonical tag: https only, host
 * cash.app/www.cash.app, no credentials/port/query/fragment, path exactly
 * /$tag or /$tag/<whole amount>. Returns an error message or null.
 */
export function cashAppUrlError(url: string, tag: string | null): string | null {
  const safe = parseSafeHttpsUrl(url);
  if (!safe.ok) return safe.error;
  const parsed = safe.url;
  if (!isCashAppHost(parsed.hostname)) return "Payment link must point to cash.app.";
  if (!tag) return "A cash.app link requires an approved $Cashtag. Enter the $Cashtag first.";
  if (parsed.search || parsed.hash) return "Cash App links must not include query strings or fragments.";
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return "Payment link has invalid character encoding.";
  }
  const m = /^\/\$([A-Za-z0-9]{1,20})(?:\/\d{1,6})?\/?$/.exec(path);
  if (!m) return "Cash App links must look like https://cash.app/$yourtag.";
  if (!sameCashtag(m[1], tag)) return "Cash App link must use the same $Cashtag as the approved recipient.";
  return null;
}

/**
 * Validates any owner-approved payment link. Generic https destinations
 * (e.g. a bank or fundraising page) are allowed; anything on cash.app must
 * agree with the canonical tag.
 */
export function paymentUrlError(url: string, tag: string | null): string | null {
  const safe = parseSafeHttpsUrl(url);
  if (!safe.ok) return safe.error;
  if (isCashAppHost(safe.url.hostname)) return cashAppUrlError(url, tag);
  // Lookalike hosts (cash.app.example.com, cashapp-pay.net) are never generic.
  if (/cash\.?app/i.test(safe.url.hostname)) return "Payment link looks like Cash App but is not on cash.app.";
  return null;
}

const HANDLE_MAX = 120;
// Control characters and angle brackets are never valid in a display label.
const UNSAFE_HANDLE = /[\u0000-\u001f\u007f<>]/;

export type ValidationResult =
  | { ok: true; values: RecipientValues }
  | { ok: false; error: string };

/**
 * Validates an owner save request. Each field is optional, but at least one
 * destination (Cash App tag, payment label, or payment link) is required.
 */
export function validateRecipientInput(input: {
  cashAppTag?: unknown;
  paymentHandle?: unknown;
  paymentUrl?: unknown;
  zelleRecipientName?: unknown;
  zelleContact?: unknown;
}): ValidationResult {
  let tag: string | null = null;
  if (input.cashAppTag != null && !(typeof input.cashAppTag === "string" && input.cashAppTag.trim() === "")) {
    tag = normalizeCashtag(input.cashAppTag);
    if (!tag) {
      return { ok: false, error: "Enter a valid $Cashtag: 1-20 letters or numbers, including at least one letter." };
    }
  }
  let handle: string | null = null;
  if (input.paymentHandle != null && input.paymentHandle !== "") {
    if (typeof input.paymentHandle !== "string") return { ok: false, error: "Payment label must be text." };
    const h = input.paymentHandle.trim();
    if (h.length > HANDLE_MAX) return { ok: false, error: `Payment label must be ${HANDLE_MAX} characters or fewer.` };
    if (UNSAFE_HANDLE.test(h)) return { ok: false, error: "Payment label contains unsupported characters." };
    if (/https?:\/\/|\bcash\.app\//i.test(h)) return { ok: false, error: "Put links in the payment link field, not the label." };
    // A label that looks like a cashtag must match the approved tag.
    const handleTag = /^\$([A-Za-z0-9]+)$/.exec(h);
    if (handleTag && (!tag || !sameCashtag(handleTag[1], tag))) {
      return { ok: false, error: "Payment label names a $Cashtag that does not match the approved Cash App recipient." };
    }
    handle = h || null;
  }
  let url: string | null = null;
  if (input.paymentUrl != null && input.paymentUrl !== "") {
    if (typeof input.paymentUrl !== "string") return { ok: false, error: "Payment link must be text." };
    const u = input.paymentUrl.trim();
    if (u) {
      const err = paymentUrlError(u, tag);
      if (err) return { ok: false, error: err };
      url = u;
    }
  }
  const blank = (x: unknown) => x == null || (typeof x === "string" && x.trim() === "");
  let zelleName: string | null = null;
  let zelleContact: string | null = null;
  const hasName = !blank(input.zelleRecipientName);
  const hasContact = !blank(input.zelleContact);
  if (hasName !== hasContact) {
    return { ok: false, error: "Zelle needs both the recipient name and the email or US phone registered with Zelle." };
  }
  if (hasName) {
    if (typeof input.zelleRecipientName !== "string") return { ok: false, error: "Zelle recipient name must be text." };
    const n = input.zelleRecipientName.trim().replace(/\s+/g, " ");
    if (n.length > ZELLE_NAME_MAX) return { ok: false, error: `Zelle recipient name must be ${ZELLE_NAME_MAX} characters or fewer.` };
    if (UNSAFE_HANDLE.test(n) || /[<>]/.test(n)) return { ok: false, error: "Zelle recipient name contains unsupported characters." };
    if (/https?:\/\/|@|www\./i.test(n)) return { ok: false, error: "Zelle recipient name should be the account holder's name, not a link or email." };
    if (!/[A-Za-z]/.test(n)) return { ok: false, error: "Zelle recipient name must include letters." };
    zelleName = n;
    zelleContact = normalizeZelleContact(input.zelleContact);
    if (!zelleContact) {
      return { ok: false, error: "Enter a valid Zelle email address or 10-digit US phone number." };
    }
  }
  if (!tag && !handle && !url && !zelleContact) {
    return { ok: false, error: "Enter at least one destination: a $Cashtag, Zelle details, a payment label, or a payment link." };
  }
  return {
    ok: true,
    values: { cashAppTag: tag, paymentHandle: handle, paymentUrl: url, zelleRecipientName: zelleName, zelleContact },
  };
}

export interface StoredRecipient {
  status: "approved" | "disabled";
  cashAppTag: string | null;
  paymentHandle: string | null;
  paymentUrl: string | null;
  zelleRecipientName?: string | null;
  zelleContact?: string | null;
  updatedAt: Date | string;
}

/**
 * Resolves what payers may see. Fail closed: anything other than an approved
 * row whose stored values still validate yields no destination at all.
 */
export function resolvePublicRecipient(
  reunionId: number,
  row: StoredRecipient | null | undefined,
): PublicRecipient {
  const none = (status: RecipientStatus): PublicRecipient => ({
    reunionId,
    status,
    cashAppTag: null,
    cashAppUrl: null,
    paymentHandle: null,
    paymentUrl: null,
    zelleRecipientName: null,
    zelleContact: null,
    approvedAt: null,
  });
  if (!row) return none("pending_review");
  if (row.status !== "approved") return none("disabled");
  const check = validateRecipientInput(row);
  if (!check.ok) return none("pending_review");
  const { cashAppTag: tag, paymentHandle, paymentUrl, zelleRecipientName, zelleContact } = check.values;
  const cashAppUrl = tag ? buildCashAppUrl(tag) : null;
  return {
    reunionId,
    status: "approved",
    cashAppTag: tag,
    cashAppUrl,
    paymentHandle: paymentHandle ?? (tag ? `$${tag}` : null),
    paymentUrl: paymentUrl ?? cashAppUrl,
    zelleRecipientName,
    zelleContact,
    approvedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** True when payers may use Cash App: approved AND a valid tag is on file. */
export function cashAppAvailable(r: PublicRecipient): boolean {
  return r.status === "approved" && !!r.cashAppTag && !!r.cashAppUrl;
}

/** True when payers may use Zelle: approved AND a valid name+contact pair is on file. */
export function zelleAvailable(r: PublicRecipient): boolean {
  return r.status === "approved" && !!r.zelleRecipientName && !!r.zelleContact;
}

/** Body keys that would set a receiving destination through a non-owner API. */
export const DESTINATION_KEYS = ["paymentHandle", "paymentUrl", "cashAppTag", "zelleRecipientName", "zelleContact", "paymentRecipient"] as const;

export function findDestinationKeys(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  return DESTINATION_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
}
