import { pgTable, integer, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reunionsTable } from "./reunions";
import { usersTable } from "./users";

export const activityChoiceGroupsTable = pgTable("activity_choice_groups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  maxSelectionsPerRegistrant: integer("max_selections_per_registrant").notNull().default(1),
  isOpen: boolean("is_open").notNull().default(true),
  resultsRevealed: boolean("results_revealed").notNull().default(false),
  liveResults: boolean("live_results").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityChoiceOptionsTable = pgTable("activity_choice_options", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  groupId: integer("group_id")
    .notNull()
    .references(() => activityChoiceGroupsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  position: integer("position").notNull().default(0),
});

export const activityChoiceSelectionsTable = pgTable(
  "activity_choice_selections",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    groupId: integer("group_id")
      .notNull()
      .references(() => activityChoiceGroupsTable.id, { onDelete: "cascade" }),
    optionId: integer("option_id")
      .notNull()
      .references(() => activityChoiceOptionsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("activity_choice_selections_option_user_unique").on(t.optionId, t.userId),
  ],
);

export const insertActivityChoiceGroupSchema = createInsertSchema(
  activityChoiceGroupsTable,
).omit({ createdAt: true });
export type InsertActivityChoiceGroup = z.infer<typeof insertActivityChoiceGroupSchema>;
export type ActivityChoiceGroup = typeof activityChoiceGroupsTable.$inferSelect;
export type ActivityChoiceOption = typeof activityChoiceOptionsTable.$inferSelect;
export type ActivityChoiceSelection = typeof activityChoiceSelectionsTable.$inferSelect;