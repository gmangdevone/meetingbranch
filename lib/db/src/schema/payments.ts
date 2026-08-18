import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { reunionsTable } from "./reunions";
import { registrationsTable } from "./registrations";

/**
 * Payment submissions: a registrant's record that they sent (or handed over)
 * a payment. Purely informational — creating one NEVER changes the
 * registration's payment_status; organizers reconcile manually and flip the
 * status to paid/waived themselves.
 *
 * `reference` is the method-specific reconciliation key:
 *   - cashapp: the payer's $cashtag
 *   - zelle:   the payer's Zelle ID (email/phone)
 *   - cash:    who the cash was handed to
 *   - check:   optional check number / payer name
 * `givenDate` is only used for cash (date handed over).
 * Amounts are whole dollars, matching reunion_fees.amount.
 */
export const paymentMethodEnum = pgEnum("payment_method", [
  "cashapp",
  "zelle",
  "cash",
  "check",
]);

export const paymentSubmissionsTable = pgTable("payment_submissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  registrationId: integer("registration_id")
    .notNull()
    .references(() => registrationsTable.id, { onDelete: "cascade" }),
  // All registrations this payment covers (always includes registrationId).
  // One transaction can pay for several of an account's registrations.
  registrationIds: integer("registration_ids").array().notNull(),
  // Clerk user id of the submitter
  submittedBy: text("submitted_by").notNull(),
  method: paymentMethodEnum("method").notNull(),
  reference: text("reference"),
  givenDate: text("given_date"),
  note: text("note"),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentSubmission = typeof paymentSubmissionsTable.$inferSelect;
