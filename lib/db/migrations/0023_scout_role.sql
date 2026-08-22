-- 0023: Add the Scout organizer role for vendor management.
--
-- PostgreSQL enum additions preserve all existing reunion_organizers.roles
-- arrays. IF NOT EXISTS keeps this migration safe to re-run.

ALTER TYPE "reunion_role" ADD VALUE IF NOT EXISTS 'scout';