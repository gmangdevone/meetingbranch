-- Registration editing: reunion-level toggle allowing registrants to edit
-- their own active registrations. Organizers/admins can always edit.
BEGIN;

ALTER TABLE reunions
  ADD COLUMN IF NOT EXISTS allow_registrant_edits boolean NOT NULL DEFAULT false;

COMMIT;
