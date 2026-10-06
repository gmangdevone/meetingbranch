import { pgTable, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { reunionsTable, reunionBranchesTable } from "./reunions";

/**
 * A member's election to pay a branch's special fee IN FULL (once per
 * branch). Separate from attendee registrations: no headcount, no dues.
 * At most one active election per branch; released rows are kept as history.
 */
export const branchFeeElectionsTable = pgTable(
  "branch_fee_elections",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    reunionId: integer("reunion_id").notNull().references(() => reunionsTable.id, { onDelete: "cascade" }),
    branchId: integer("branch_id").notNull().references(() => reunionBranchesTable.id, ),
    userId: text("user_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: text("released_by"),
  },
  (t) => [
    uniqueIndex("branch_fee_elections_one_active").on(t.branchId).where(sql`status = 'active'`),
    index("branch_fee_elections_user_idx").on(t.reunionId, t.userId),
  ],
);

export type BranchFeeElection = typeof branchFeeElectionsTable.$inferSelect;
