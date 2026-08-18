-- One payment submission can cover multiple registrations under the same account.
-- Adds registration_ids integer[] (always contains registration_id) with backfill.
BEGIN;

ALTER TABLE payment_submissions ADD COLUMN registration_ids integer[];
UPDATE payment_submissions SET registration_ids = ARRAY[registration_id];
ALTER TABLE payment_submissions ALTER COLUMN registration_ids SET NOT NULL;

COMMIT;
