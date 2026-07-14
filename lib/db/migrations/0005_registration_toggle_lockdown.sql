-- Adds the per-reunion registration open/closed switch and the platform-wide
-- sign-in lockdown settings (flag + tester email allowlist).
-- Idempotent and data-preserving.

BEGIN;

ALTER TABLE reunions
  ADD COLUMN IF NOT EXISTS registrations_open boolean NOT NULL DEFAULT true;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS sign_ins_locked boolean NOT NULL DEFAULT false;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS tester_emails text[] NOT NULL DEFAULT '{}';

COMMIT;
