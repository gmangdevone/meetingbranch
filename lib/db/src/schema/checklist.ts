import { pgTable, serial, integer, text, boolean, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { reunionsTable } from "./reunions";
import { usersTable } from "./users";

export const checklistItemsTable = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  reunionId: integer("reunion_id").notNull().references(() => reunionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  link: text("link"),
  kind: text("kind").notNull().default("manual"),
  visible: boolean("visible").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const checklistProgressTable = pgTable("checklist_progress", {
  itemId: integer("item_id").notNull().references(() => checklistItemsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  completed: boolean("completed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.itemId, t.userId] })]);
