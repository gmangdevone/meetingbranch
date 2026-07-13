import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reunionsTable } from "./reunions";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendeesTable = pgTable("attendees", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  registrationId: integer("registration_id").notNull(),
  name: text("name").notNull(),
  shirtSize: shirtSizeEnum("shirt_size").notNull(),
  dietaryRestrictions: text("dietary_restrictions"),
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
