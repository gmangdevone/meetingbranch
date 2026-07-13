-- Organizer role delegation: co-organizers can now be granted a set of specific
-- management areas (roles) instead of blanket full access.
-- Data-preserving: adds a `roles` column to reunion_organizers defaulting to an
-- EMPTY set — existing co-organizers start with NO roles and the owner must
-- assign them explicitly (deliberate behavior change).
-- Idempotent: guarded so re-runs do not fail.

BEGIN;

-- Delegable management areas for a co-organizer.
DO $$ BEGIN
  CREATE TYPE "reunion_role" AS ENUM (
    'registration', 'announcements', 'schedule', 'branches', 'reports', 'power_user'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per co-organizer role set. Existing rows backfill to '{}' (no roles).
ALTER TABLE "reunion_organizers"
  ADD COLUMN IF NOT EXISTS "roles" "reunion_role"[] NOT NULL DEFAULT '{}';

COMMIT;
