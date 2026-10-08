-- Per-attendee dinner opt-out and explicit dinner fee classification.
-- Schema-only and additive: no data is rewritten.
--  * reunion_fees.is_dinner stays NULL for existing fees; the app treats a NULL
--    per_person fee whose label contains "dinner" (e.g. "Sunday Dinner") as a
--    dinner fee, so legacy configs keep working until an organizer classifies
--    them explicitly (which then survives renames).
--  * attendees.include_dinner defaults to TRUE so every existing total is unchanged.
ALTER TABLE reunion_fees ADD COLUMN IF NOT EXISTS is_dinner boolean;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS include_dinner boolean NOT NULL DEFAULT true;
