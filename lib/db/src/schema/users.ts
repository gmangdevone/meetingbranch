import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(), // Clerk userId
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  isAdmin: boolean("is_admin").notNull().default(false),
  // True for accounts created by an organizer on behalf of a family member
  // (no Clerk identity — they can never sign in themselves).
  isManaged: boolean("is_managed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
