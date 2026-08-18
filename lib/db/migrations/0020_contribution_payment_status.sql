-- Give sponsorship contributions a payment status so standalone chip-ins are
-- "due" until an organizer marks them received, and only received money counts
-- toward the fund balance.
-- Backfill: cancellation-sourced money was already received (paid);
-- registration-sourced chip-ins follow their registration's payment status;
-- direct (standalone) chip-ins start pending.
BEGIN;

ALTER TABLE sponsorship_contributions
  ADD COLUMN payment_status payment_status;

UPDATE sponsorship_contributions SET payment_status = 'paid'
  WHERE source = 'cancellation';

UPDATE sponsorship_contributions c
  SET payment_status = r.payment_status
  FROM registrations r
  WHERE c.source = 'registration' AND c.registration_id = r.id;

-- registration-sourced rows whose registration was deleted, plus direct rows
UPDATE sponsorship_contributions SET payment_status = 'pending'
  WHERE payment_status IS NULL;

ALTER TABLE sponsorship_contributions
  ALTER COLUMN payment_status SET NOT NULL,
  ALTER COLUMN payment_status SET DEFAULT 'pending';

COMMIT;
