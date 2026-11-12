import { pgTable, integer, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { registrationsTable } from "./registrations";

export const registrationItemRequestsTable = pgTable("registration_item_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  registrationId: integer("registration_id").notNull().references(() => registrationsTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  requestId: text("request_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique("registration_item_request_unique").on(t.registrationId, t.actorId, t.requestId)]);
export const insertRegistrationItemRequestSchema = createInsertSchema(registrationItemRequestsTable);
