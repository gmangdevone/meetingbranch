import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reunionsTable, reunionFeesTable } from "./reunions";

export const shirtSizeEnum = pgEnum("shirt_size", [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "waived",
]);

export const registrationStatusEnum = pgEnum("registration_status", [
  "active",
  "cancelled",
]);

/**
 * What happened to the household's money when the registration was cancelled.
 * - refunded: organizer settles the refund outside the app
 * - donated_to_fund: amount was added to the reunion's sponsorship fund
 * - no_payment: nothing had been paid, nothing to resolve
 */
export const cancellationResolutionEnum = pgEnum("cancellation_resolution", [
  "refunded",
  "donated_to_fund",
  "no_payment",
]);

export const registrationsTable = pgTable("registrations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  // Free-form branch name, validated against the reunion's own branch list
  branchName: text("branch_name").notNull(),
  attendeeCount: integer("attendee_count").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
  status: registrationStatusEnum("status").notNull().default("active"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationResolution: cancellationResolutionEnum("cancellation_resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendeesTable = pgTable("attendees", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  registrationId: integer("registration_id").notNull(),
  name: text("name").notNull(),
  shirtSize: shirtSizeEnum("shirt_size").notNull(),
  dietaryRestrictions: text("dietary_restrictions"),
  // Age at registration; nullable (legacy rows + optional). Used for age-tiered fees.
  age: integer("age"),
  // Set when an organizer checks the attendee in at the event (food/seating counts,
  // and gates voting eligibility for the household's account). Null = not checked in.
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
});

/**
 * Records which OPTIONAL fees a registration opted into.
 * Mandatory fees always apply and are not stored here.
 */
export const registrationFeesTable = pgTable("registration_fees", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  registrationId: integer("registration_id")
    .notNull()
    .references(() => registrationsTable.id, { onDelete: "cascade" }),
  feeId: integer("fee_id")
    .notNull()
    .references(() => reunionFeesTable.id, { onDelete: "cascade" }),
});

// generatedAlwaysAsIdentity columns are excluded from insert schema automatically
export const insertRegistrationSchema = createInsertSchema(registrationsTable).omit({
  createdAt: true,
});
export const insertAttendeeSchema = createInsertSchema(attendeesTable);

export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;
export type InsertAttendee = z.infer<typeof insertAttendeeSchema>;
export type Registration = typeof registrationsTable.$inferSelect;
export type Attendee = typeof attendeesTable.$inferSelect;
export type RegistrationFee = typeof registrationFeesTable.$inferSelect;
