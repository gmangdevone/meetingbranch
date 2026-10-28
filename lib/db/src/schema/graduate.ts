import { pgTable, integer, text, timestamp, boolean, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { reunionsTable } from "./reunions";
import { usersTable } from "./users";

// JSON documents are validated against the API contract before persistence.
export const graduateConfigsTable = pgTable("graduate_configs", {
  reunionId: integer("reunion_id").primaryKey().references(() => reunionsTable.id, { onDelete: "cascade" }),
  visible: boolean("visible").notNull().default(false),
  open: boolean("open").notNull().default(false),
  recipientId: text("recipient_id").references(() => usersTable.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(0),
  content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
});
export const graduateSubmissionsTable = pgTable("graduate_submissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id").notNull().references(() => reunionsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  requestId: text("request_id").notNull(),
  revision: integer("revision").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  zelle: text("zelle").notNull(),
  cashApp: text("cash_app").notNull(),
  answers: jsonb("answers").$type<{ questionId: string; label: string; value: string }[]>().notNull(),
  links: jsonb("links").$type<{ label: string; url: string }[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  emailStatus: text("email_status").notNull().default("pending"),
  emailAttempts: integer("email_attempts").notNull().default(0),
  emailError: text("email_error"),
  emailAttemptAt: timestamp("email_attempt_at", { withTimezone: true }),
  emailRecipientId: text("email_recipient_id"),
  emailRecipient: text("email_recipient"),
  providerMessageId: text("provider_message_id"),
}, t => [unique("graduate_request_unique").on(t.reunionId, t.userId, t.requestId)]);
export const insertGraduateConfigSchema = createInsertSchema(graduateConfigsTable);
export const insertGraduateSubmissionSchema = createInsertSchema(graduateSubmissionsTable);
export type GraduateSubmissionRow = typeof graduateSubmissionsTable.$inferSelect;
