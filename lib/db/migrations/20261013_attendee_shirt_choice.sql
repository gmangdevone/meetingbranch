-- Retain the previous all-attendees pricing for existing registrations.
-- New forms explicitly send false until the attendee opts in.
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS include_shirt boolean NOT NULL DEFAULT true;
