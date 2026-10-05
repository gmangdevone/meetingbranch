import { pgTable, integer, text, timestamp, pgEnum, jsonb, index } from "drizzle-orm/pg-core";
import { reunionsTable } from "./reunions";

/**
 * Owner-controlled payment recipient for a reunion, keyed by the immutable
 * reunion id. Only the platform owner (PAYMENT_OWNER_USER_ID) may write this
 * table. A reunion with NO row here is "pending owner review": its legacy
 * reunions.cash_app_tag / payment_handle / payment_url values are preserved
 * for review but are never used as a live payment destination.
 */
export const paymentRecipientStatusEnum = pgEnum("payment_recipient_status", [
  "approved",
  "disabled",
]);

export const paymentRecipientsTable = pgTable("payment_recipients", {
  reunionId: integer("reunion_id")
    .primaryKey()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  status: paymentRecipientStatusEnum("status").notNull(),
  // Canonical Cash App tag without the leading "$". Null when Cash App is off.
  cashAppTag: text("cash_app_tag"),
  // Optional generic "pay via" label shown with the approved destination.
  paymentHandle: text("payment_handle"),
  // Optional https://cash.app/$tag link; must agree with cashAppTag.
  paymentUrl: text("payment_url"),
  // Owner-approved Zelle recipient display name and contact (email or US
  // phone, stored normalized). Both null, or both set. Payers send from their
  // own banking app; the app never builds a Zelle link.
  zelleRecipientName: text("zelle_recipient_name"),
  zelleContact: text("zelle_contact"),
  // Owner-written public plain-text payment instructions (max 2000 chars,
  // line breaks allowed). Never rendered as HTML. Null when none.
  paymentInstructions: text("payment_instructions"),
  // Optimistic concurrency counter. Starts at 1 on first owner write.
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentRecipientAuditActionEnum = pgEnum("payment_recipient_audit_action", [
  "approve",
  "change",
  "disable",
  "disable_cashapp",
  "disable_zelle",
]);

/** Append-only history of every owner recipient write. Never updated or deleted by the app. */
export const paymentRecipientAuditTable = pgTable(
  "payment_recipient_audit",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // Intentionally no FK cascade: history survives even if a reunion is removed.
    reunionId: integer("reunion_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    action: paymentRecipientAuditActionEnum("action").notNull(),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value").notNull(),
    versionAfter: integer("version_after").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payment_recipient_audit_reunion_idx").on(t.reunionId, t.createdAt)],
);

export type PaymentRecipientRow = typeof paymentRecipientsTable.$inferSelect;
export type PaymentRecipientAuditRow = typeof paymentRecipientAuditTable.$inferSelect;
