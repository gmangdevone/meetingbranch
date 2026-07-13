import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
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
  feePerPerson: integer("fee_per_person").notNull(),
  paymentHandle: text("payment_handle").notNull(),
  paymentUrl: text("payment_url"),
  organizerId: text("organizer_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reunionBranchesTable = pgTable("reunion_branches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertReunionSchema = createInsertSchema(reunionsTable).omit({
  createdAt: true,
});
export const insertReunionBranchSchema = createInsertSchema(reunionBranchesTable);

export type InsertReunion = z.infer<typeof insertReunionSchema>;
export type InsertReunionBranch = z.infer<typeof insertReunionBranchSchema>;
export type Reunion = typeof reunionsTable.$inferSelect;
export type ReunionBranch = typeof reunionBranchesTable.$inferSelect;
