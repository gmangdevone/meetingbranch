import { pgTable, integer, text, timestamp, unique, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const reunionsTable = pgTable("reunions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Unique 7-character alphanumeric join code
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  // ISO date strings (YYYY-MM-DD) to avoid timezone drift
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  paymentHandle: text("payment_handle").notNull(),
  paymentUrl: text("payment_url"),
  organizerId: text("organizer_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// How a fee is applied: once per attendee, or a flat amount per household/registration.
export const feeChargeTypeEnum = pgEnum("fee_charge_type", ["per_person", "flat"]);

/**
 * Labeled fees & dues for a reunion (e.g. "Registration Fee", "T-Shirt", "Facility Dues").
 * Replaces the old single `reunions.fee_per_person`.
 * Age tiering: when `ageThreshold` is set, attendees under it are charged
 * `amountUnderThreshold`, everyone at-or-over pays `amount`. (Only meaningful for
 * per-person fees; flat fees ignore age.)
 */
export const reunionFeesTable = pgTable("reunion_fees", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  chargeType: feeChargeTypeEnum("charge_type").notNull().default("per_person"),
  isOptional: boolean("is_optional").notNull().default(false),
  amount: integer("amount").notNull(),
  ageThreshold: integer("age_threshold"),
  amountUnderThreshold: integer("amount_under_threshold"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const reunionBranchesTable = pgTable("reunion_branches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * The delegable management areas a co-organizer can be granted. The reunion
 * owner (and platform admins) always have every area implicitly; these roles
 * only ever apply to *added* co-organizers.
 * - registration:  manage the Registrations page (view, CSV export, payment status)
 * - announcements: create/edit/delete announcements
 * - schedule:      create/edit/delete schedule items
 * - branches:      create/edit/delete branches
 * - reports:       view reporting
 * - power_user:    edit reunion details, payment info, and fees & dues
 *   (NOT managing organizers/roles or transferring ownership — those stay owner-only)
 */
export const reunionRoleEnum = pgEnum("reunion_role", [
  "registration",
  "announcements",
  "schedule",
  "branches",
  "reports",
  "power_user",
]);

export const REUNION_ROLES = reunionRoleEnum.enumValues;
export type ReunionRole = (typeof reunionRoleEnum.enumValues)[number];

/**
 * Co-organizers granted management access to a reunion.
 * The reunion's creator/owner stays in `reunions.organizerId`; this table holds
 * the *additional* organizers. Each co-organizer holds a set of `roles` that
 * scope which areas they can manage (empty = no access until the owner assigns).
 */
export const reunionOrganizersTable = pgTable(
  "reunion_organizers",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    reunionId: integer("reunion_id")
      .notNull()
      .references(() => reunionsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id),
    roles: reunionRoleEnum("roles").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.reunionId, t.userId)],
);

export const insertReunionSchema = createInsertSchema(reunionsTable).omit({
  createdAt: true,
});
export const insertReunionFeeSchema = createInsertSchema(reunionFeesTable);
export const insertReunionBranchSchema = createInsertSchema(reunionBranchesTable);
export const insertReunionOrganizerSchema = createInsertSchema(reunionOrganizersTable).omit({
  createdAt: true,
});

export type InsertReunion = z.infer<typeof insertReunionSchema>;
export type InsertReunionBranch = z.infer<typeof insertReunionBranchSchema>;
export type InsertReunionOrganizer = z.infer<typeof insertReunionOrganizerSchema>;
export type InsertReunionFee = z.infer<typeof insertReunionFeeSchema>;
export type Reunion = typeof reunionsTable.$inferSelect;
export type ReunionFee = typeof reunionFeesTable.$inferSelect;
export type ReunionBranch = typeof reunionBranchesTable.$inferSelect;
export type ReunionOrganizer = typeof reunionOrganizersTable.$inferSelect;
