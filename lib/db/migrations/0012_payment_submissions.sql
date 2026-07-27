-- Payment submissions: registrant-recorded payment attempts (Cash App, Zelle,
-- cash, check) used by organizers for manual reconciliation. Creating one never
-- changes registrations.payment_status.
-- Also: reunion payment-method config (organizer's $cashtag, check payee).

ALTER TABLE reunions ADD COLUMN IF NOT EXISTS cash_app_tag text;
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS check_payee text;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cashapp', 'zelle', 'cash', 'check');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS payment_submissions (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  registration_id integer NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  submitted_by text NOT NULL,
  method payment_method NOT NULL,
  reference text,
  given_date text,
  note text,
  amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
