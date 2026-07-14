-- Organizer-created ("managed") member accounts: users rows without a Clerk
-- identity, registered by an organizer on behalf of a family member.
-- Idempotent and data-preserving.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_managed boolean NOT NULL DEFAULT false;

COMMIT;
