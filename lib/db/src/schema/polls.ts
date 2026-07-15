import { pgTable, integer, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reunionsTable } from "./reunions";
import { usersTable } from "./users";

/**
 * Polls let organizers put decisions to the family. Only checked-in members
 * (users whose registration has at least one checked-in attendee) may vote.
 */
export const pollsTable = pgTable("polls", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reunionId: integer("reunion_id")
    .notNull()
    .references(() => reunionsTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  // How many options each member may vote for on this question.
  maxVotesPerMember: integer("max_votes_per_member").notNull().default(1),
  // Open = members can cast/change votes. Closed = votes are frozen.
  isOpen: boolean("is_open").notNull().default(true),
  // When true, summarized results are shown to family members.
  resultsRevealed: boolean("results_revealed").notNull().default(false),
  // When true, family members see current counts updating live while voting is open.
  liveResults: boolean("live_results").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pollOptionsTable = pgTable("poll_options", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  pollId: integer("poll_id")
    .notNull()
    .references(() => pollsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  position: integer("position").notNull().default(0),
});

export const pollVotesTable = pgTable(
  "poll_votes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => pollsTable.id, { onDelete: "cascade" }),
    optionId: integer("option_id")
      .notNull()
      .references(() => pollOptionsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("poll_votes_option_user_unique").on(t.optionId, t.userId)],
);

export const insertPollSchema = createInsertSchema(pollsTable).omit({ createdAt: true });
export type InsertPoll = z.infer<typeof insertPollSchema>;
export type Poll = typeof pollsTable.$inferSelect;
export type PollOption = typeof pollOptionsTable.$inferSelect;
export type PollVote = typeof pollVotesTable.$inferSelect;
