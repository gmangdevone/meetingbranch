-- Payment submissions can now cover standalone fund chip-ins, including
-- submissions with no registration at all (contribution-only payments).
BEGIN;

ALTER TABLE payment_submissions
  ADD COLUMN contribution_ids integer[] NOT NULL DEFAULT '{}',
  ALTER COLUMN registration_id DROP NOT NULL;

COMMIT;
