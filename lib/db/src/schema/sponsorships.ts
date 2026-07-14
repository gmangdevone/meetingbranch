import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { reunionsTable } from "./reunions";
import { registrationsTable } from "./registrations";

/**
 * Sponsorship fund: contributions flow IN (from registrants, standalone
 * donors, or cancelled-registration donations); allocations flow OUT
 * (applied by organizers/power users to sponsor a registration).
 *
 * Fund balance = sum(contributions) - sum(allocations where fundedFrom='fund').
 * Direct allocations ("sponsor this attendee individually") do not draw from
 * the pool — they record an out-of-band sponsor covering a household.
 *
 * Amounts are whole dollars (integer), matching reunion_fees.amount.
 * Contributor and sponsored-household details are only exposed via
 * power_user-gated endpoints (fully anonymous to regular members).
 */
export const contributionSourceEnum = pgEnum("sponsorship_contribution_source", [
  "registration",
  "direct",
  "cancellation",
]);

export const allocationFundingEnum = pgEnum("sponsorship_allocation_funding", [
  "fund",
  "direct",
]);

export const sponsorshipContributionsTable = pgTable("sponsorship_contributions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  // Set when the contribution came in alongside a registration or from a
  // cancelled registration's donated payment.
  registrationId: integer("registration_id").references(() => registrationsTable.id, {
    onDelete: "set null",
  }),
  // Clerk user id of the contributor (when known)
  contributorUserId: text("contributor_user_id"),
  contributorName: text("contributor_name"),
  amount: integer("amount").notNull(),
  source: contributionSourceEnum("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sponsorshipAllocationsTable = pgTable("sponsorship_allocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  registrationId: integer("registration_id")
    .notNull()
    .references(() => registrationsTable.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  fundedFrom: allocationFundingEnum("funded_from").notNull(),
  // Only meaningful for direct sponsorships
  sponsorName: text("sponsor_name"),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SponsorshipContribution = typeof sponsorshipContributionsTable.$inferSelect;
export type SponsorshipAllocation = typeof sponsorshipAllocationsTable.$inferSelect;
