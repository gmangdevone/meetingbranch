import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reunionsTable } from "./reunions";

export const scheduleItemsTable = pgTable("schedule_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time"),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScheduleItemSchema = createInsertSchema(scheduleItemsTable).omit({
  createdAt: true,
});
export type InsertScheduleItem = z.infer<typeof insertScheduleItemSchema>;
export type ScheduleItem = typeof scheduleItemsTable.$inferSelect;
