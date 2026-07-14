import { pgTable, integer, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Single-row table holding platform-wide settings.
export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionCreationEnabled: boolean("reunion_creation_enabled").notNull().default(true),
  // Lockdown mode: when true, only platform admins, reunion organizers
  // (owners + co-organizers), and allowlisted tester emails may use the app
  // while signed in. Everyone else is blocked after sign-in.
  signInsLocked: boolean("sign_ins_locked").notNull().default(false),
  // Lower-cased emails of predetermined test users exempt from the lockdown.
  testerEmails: text("tester_emails").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({
  updatedAt: true,
});
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;
