import { eq, desc, inArray } from "drizzle-orm";
import {
  db,
  reunionsTable,
  paymentRecipientsTable,
  paymentRecipientAuditTable,
  type PaymentRecipientRow,
} from "@workspace/db";
import {
  isCashAppHost,
  resolvePublicRecipient,
  type PublicRecipient,
  type RecipientStatus,
  type RecipientValues,
} from "./validation";
import { getConfiguredPaymentOwnerId } from "./owner";
import { cashAppAvailable, zelleAvailable } from "./validation";

/**
 * Fresh server check for submissions that name a receiving method. Returns an
 * error message when Cash App or Zelle is chosen without a current approved
 * destination, otherwise null. Cash and check are always accepted.
 */
export async function unavailableMethodError(method: string, reunionId: number): Promise<string | null> {
  if (method !== "cashapp" && method !== "zelle") return null;
  const r = await resolveRecipient(reunionId);
  if (method === "cashapp" && !cashAppAvailable(r)) {
    return "Cash App is not configured for this reunion. Choose another payment method.";
  }
  if (method === "zelle" && !zelleAvailable(r)) {
    return "Zelle is not configured for this reunion. Choose another payment method.";
  }
  return null;
}

/** Freshly resolve one reunion's approved destination (never cached). */
export async function resolveRecipient(reunionId: number): Promise<PublicRecipient> {
  const [row] = await db
    .select()
    .from(paymentRecipientsTable)
    .where(eq(paymentRecipientsTable.reunionId, reunionId));
  return resolvePublicRecipient(reunionId, row ?? null);
}

export async function resolveRecipients(ids: number[]): Promise<Map<number, PublicRecipient>> {
  const out = new Map<number, PublicRecipient>();
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(paymentRecipientsTable)
    .where(inArray(paymentRecipientsTable.reunionId, ids));
  const byId = new Map(rows.map((r) => [r.reunionId, r]));
  for (const id of ids) out.set(id, resolvePublicRecipient(id, byId.get(id) ?? null));
  return out;
}

/**
 * Overlays a raw reunion row with ONLY the resolved destination, so legacy
 * reunions.cash_app_tag / payment_handle / payment_url never leak as a usable
 * fallback in any API response.
 */
export function withResolvedRecipient<T extends object>(reunion: T, recipient: PublicRecipient) {
  return {
    ...reunion,
    cashAppTag: recipient.cashAppTag,
    paymentHandle: recipient.paymentHandle,
    paymentUrl: recipient.paymentUrl,
    paymentRecipient: recipient,
  };
}

function statusOf(row: PaymentRecipientRow | undefined): RecipientStatus {
  return row ? row.status : "pending_review";
}

type RawValues = {
  cashAppTag: string | null;
  paymentHandle: string | null;
  paymentUrl: string | null;
  zelleRecipientName?: string | null;
  zelleContact?: string | null;
  paymentInstructions?: string | null;
};

function valuesOf(row: RawValues | undefined): RecipientValues {
  return {
    zelleRecipientName: row?.zelleRecipientName?.trim() || null,
    zelleContact: row?.zelleContact?.trim() || null,
    paymentInstructions: row?.paymentInstructions?.trim() || null,
    cashAppTag: row?.cashAppTag?.trim().replace(/^\$/, "") || null,
    paymentHandle: row?.paymentHandle?.trim() || null,
    paymentUrl: row?.paymentUrl?.trim() || null,
  };
}

export async function listOwnerRecipients() {
  const reunions = await db
    .select({
      id: reunionsTable.id,
      name: reunionsTable.name,
      code: reunionsTable.code,
      startDate: reunionsTable.startDate,
      legacyTag: reunionsTable.cashAppTag,
      legacyHandle: reunionsTable.paymentHandle,
      legacyUrl: reunionsTable.paymentUrl,
    })
    .from(reunionsTable)
    .orderBy(desc(reunionsTable.createdAt));
  const rows = await db.select().from(paymentRecipientsTable);
  const byId = new Map(rows.map((r) => [r.reunionId, r]));
  return reunions.map((r) => {
    const row = byId.get(r.id);
    return {
      reunionId: r.id,
      reunionName: r.name,
      reunionCode: r.code,
      startDate: r.startDate,
      status: statusOf(row),
      cashAppTag: row?.cashAppTag ?? null,
      zelleContact: row?.zelleContact ?? null,
      hasLegacyValues: !!(r.legacyTag?.trim() || r.legacyHandle?.trim() || r.legacyUrl?.trim()),
      version: row?.version ?? 0,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  });
}

export async function getOwnerRecipientDetail(reunionId: number) {
  const [reunion] = await db.select().from(reunionsTable).where(eq(reunionsTable.id, reunionId));
  if (!reunion) return null;
  const [row] = await db
    .select()
    .from(paymentRecipientsTable)
    .where(eq(paymentRecipientsTable.reunionId, reunionId));
  return {
    reunionId,
    reunionName: reunion.name,
    reunionCode: reunion.code,
    startDate: reunion.startDate,
    endDate: reunion.endDate,
    status: statusOf(row),
    current: valuesOf(row),
    legacy: valuesOf({
      cashAppTag: reunion.cashAppTag,
      paymentHandle: reunion.paymentHandle,
      paymentUrl: reunion.paymentUrl,
    }),
    version: row?.version ?? 0,
    updatedAt: row ? row.updatedAt.toISOString() : null,
    resolved: resolvePublicRecipient(reunionId, row ?? null),
  };
}

export class StaleVersionError extends Error {
  constructor(public currentVersion: number) {
    super("This recipient was changed by someone else. Reload to see the latest values before saving.");
  }
}
export class ReunionNotFoundError extends Error {}

type AuditValue = { status: RecipientStatus } & RecipientValues;

/**
 * Atomically writes the recipient and its audit entry. The reunion row is
 * locked FOR UPDATE so concurrent first-time saves serialize, and the write
 * only succeeds when expectedVersion matches. Any failure (including the
 * audit insert) rolls back the whole transaction.
 */
export async function writeRecipient(params: {
  reunionId: number;
  actorUserId: string;
  expectedVersion: number;
  next: AuditValue & { status: "approved" | "disabled" };
  note: string | null;
  /** Explicit audit action; derived from the transition when omitted. */
  action?: "disable_cashapp" | "disable_zelle";
}): Promise<void> {
  const { reunionId, actorUserId, expectedVersion, next, note } = params;
  await db.transaction(async (tx) => {
    const [reunion] = await tx
      .select({ id: reunionsTable.id })
      .from(reunionsTable)
      .where(eq(reunionsTable.id, reunionId))
      .for("update");
    if (!reunion) throw new ReunionNotFoundError("Reunion not found");
    const [existing] = await tx
      .select()
      .from(paymentRecipientsTable)
      .where(eq(paymentRecipientsTable.reunionId, reunionId))
      .for("update");
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== expectedVersion) throw new StaleVersionError(currentVersion);

    const versionAfter = currentVersion + 1;
    const now = new Date();
    const values = {
      status: next.status,
      cashAppTag: next.cashAppTag,
      paymentHandle: next.paymentHandle,
      paymentUrl: next.paymentUrl,
      zelleRecipientName: next.zelleRecipientName,
      zelleContact: next.zelleContact,
      paymentInstructions: next.paymentInstructions ?? null,
      version: versionAfter,
      updatedBy: actorUserId,
      updatedAt: now,
    };
    if (existing) {
      await tx.update(paymentRecipientsTable).set(values).where(eq(paymentRecipientsTable.reunionId, reunionId));
    } else {
      await tx.insert(paymentRecipientsTable).values({ reunionId, ...values });
    }
    const previousValue: AuditValue | null = existing
      ? { status: existing.status, ...valuesOf(existing) }
      : null;
    const action =
      params.action ??
      (next.status === "disabled" ? "disable" : existing?.status === "approved" ? "change" : "approve");
    await tx.insert(paymentRecipientAuditTable).values({
      reunionId,
      actorUserId,
      action,
      previousValue,
      newValue: {
        status: next.status,
        cashAppTag: next.cashAppTag,
        paymentHandle: next.paymentHandle,
        paymentUrl: next.paymentUrl,
        zelleRecipientName: next.zelleRecipientName,
        zelleContact: next.zelleContact,
        paymentInstructions: next.paymentInstructions ?? null,
      },
      versionAfter,
      note,
    });
  });
}

export async function listRecipientHistory(reunionId: number) {
  const rows = await db
    .select()
    .from(paymentRecipientAuditTable)
    .where(eq(paymentRecipientAuditTable.reunionId, reunionId))
    .orderBy(desc(paymentRecipientAuditTable.createdAt), desc(paymentRecipientAuditTable.id));
  const owner = getConfiguredPaymentOwnerId();
  return rows.map((r) => ({
    id: r.id,
    reunionId: r.reunionId,
    // Never expose account ids; label the actor instead.
    actor: owner && r.actorUserId === owner ? "Platform owner" : "Previous owner account",
    action: r.action,
    previousValue: (r.previousValue as AuditValue | null) ?? null,
    newValue: r.newValue as AuditValue,
    versionAfter: r.versionAfter,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Computes the values left after removing only Cash App from an approved
 * recipient: the tag, any cash.app link and a "$tag" label go away; approved
 * generic destinations stay. Returns null when nothing would remain.
 */
export function withoutCashApp(current: RecipientValues): RecipientValues | null {
  const url = current.paymentUrl;
  let urlIsCashApp = false;
  if (url) {
    try {
      urlIsCashApp = isCashAppHost(new URL(url).hostname);
    } catch {
      urlIsCashApp = true;
    }
  }
  const next: RecipientValues = {
    ...current,
    cashAppTag: null,
    paymentHandle: current.paymentHandle && /^\$[A-Za-z0-9]+$/.test(current.paymentHandle) ? null : current.paymentHandle,
    paymentUrl: urlIsCashApp ? null : url,
  };
  // Instructions are preserved only alongside another real destination; a
  // method-disable never silently leaves an instructions-only approval.
  return next.paymentHandle || next.paymentUrl || next.zelleContact ? next : null;
}

/**
 * Values left after removing only Zelle. Cash App and generic destinations
 * stay untouched. Returns null when nothing would remain.
 */
export function withoutZelle(current: RecipientValues): RecipientValues | null {
  const next: RecipientValues = { ...current, zelleRecipientName: null, zelleContact: null };
  return next.cashAppTag || next.paymentHandle || next.paymentUrl ? next : null;
}
