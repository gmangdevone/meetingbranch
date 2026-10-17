import { pgTable, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { reunionsTable } from "./reunions";

// Snapshot labels and identifiers deliberately survive fee/attendee replacement.
export const dinnerHistoryTable = pgTable("dinner_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id").notNull().references(() => reunionsTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull(),
  feeId: integer("fee_id").notNull(),
  feeLabel: text("fee_label").notNull(),
  registrationId: integer("registration_id"),
  attendeeName: text("attendee_name"),
  beforeChoice: text("before_choice").notNull(),
  afterChoice: text("after_choice").notNull(),
}, table => [index("dinner_history_reunion_idx").on(table.reunionId, table.id)]);

export const insertDinnerHistorySchema = createInsertSchema(dinnerHistoryTable).omit({ createdAt: true });
export type DinnerHistory = typeof dinnerHistoryTable.$inferSelect;
