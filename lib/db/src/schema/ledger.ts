import { pgTable, text, integer, timestamp, pgEnum, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { reunionsTable, reunionBranchesTable } from "./reunions";
import { registrationsTable } from "./registrations";
import { paymentSubmissionsTable } from "./payments";
import { sponsorshipContributionsTable } from "./sponsorships";
import { branchFeeElectionsTable } from "./branchFeeElections";

/**
 * Confirmed-money ledger. All amounts are exact integer cents.
 *
 * - payment: money an authorized organizer confirmed as actually received.
 * - legacy_credit: opening credit for a registration that was marked paid
 *   before the ledger existed. Has no method/date (never fabricated).
 * - transfer: moves confirmed money between two registrations (allocations
 *   are signed: negative on the source, positive on the target).
 *
 * Receipts and allocations are append-only. A mistake is corrected by a
 * reversal row (with a required reason) and, optionally, a replacement
 * receipt that points back at the original.
 */
export const receiptKindEnum = pgEnum("payment_receipt_kind", ["payment", "legacy_credit", "transfer"]);
export const receiptMethodEnum = pgEnum("payment_receipt_method", ["cashapp", "zelle", "cash", "check", "other"]);

export const paymentReceiptsTable = pgTable(
  "payment_receipts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    reunionId: integer("reunion_id").notNull().references(() => reunionsTable.id, { onDelete: "cascade" }),
    kind: receiptKindEnum("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: receiptMethodEnum("method"),
    receivedDate: text("received_date"),
    reference: text("reference"),
    note: text("note"),
    submissionId: integer("submission_id").references(() => paymentSubmissionsTable.id, { onDelete: "set null" }),
    replacesReceiptId: integer("replaces_receipt_id"),
    idempotencyKey: text("idempotency_key"),
    recordedBy: text("recorded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_receipts_idem_uq").on(t.reunionId, t.idempotencyKey),
    index("payment_receipts_reunion_idx").on(t.reunionId),
    check("payment_receipts_amount_ck", sql`${t.amountCents} >= 0`),
  ],
);

export const paymentReceiptAllocationsTable = pgTable(
  "payment_receipt_allocations",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    receiptId: integer("receipt_id").notNull().references(() => paymentReceiptsTable.id, { onDelete: "cascade" }),
    reunionId: integer("reunion_id").notNull().references(() => reunionsTable.id, { onDelete: "cascade" }),
    registrationId: integer("registration_id").references(() => registrationsTable.id, { onDelete: "cascade" }),
    contributionId: integer("contribution_id").references(() => sponsorshipContributionsTable.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents").notNull(),
    branchId: integer("branch_id").references(() => reunionBranchesTable.id),
    payerRegistrationId: integer("payer_registration_id").references(() => registrationsTable.id, { onDelete: "set null" }),
    // New-model branch fee money: the full fee paid by the electing member.
    branchFeeElectionId: integer("branch_fee_election_id").references(() => branchFeeElectionsTable.id),
  },
  (t) => [
    index("payment_receipt_alloc_branch_idx").on(t.branchId),
    index("payment_receipt_alloc_reg_idx").on(t.registrationId),
    index("payment_receipt_alloc_receipt_idx").on(t.receiptId),
  ],
);

export const paymentReceiptReversalsTable = pgTable(
  "payment_receipt_reversals",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    receiptId: integer("receipt_id").notNull().references(() => paymentReceiptsTable.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    reversedBy: text("reversed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_receipt_reversals_receipt_uq").on(t.receiptId)],
);

export type PaymentReceipt = typeof paymentReceiptsTable.$inferSelect;
export type PaymentReceiptAllocation = typeof paymentReceiptAllocationsTable.$inferSelect;
