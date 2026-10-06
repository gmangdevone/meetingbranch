-- Partial registration payments: confirmed-receipt ledger (additive only).
-- No data backfill: legacy paid registrations are converted to a labeled
-- opening credit lazily by the API (see docs/partial-payments.md).
DO $$ BEGIN
  CREATE TYPE payment_receipt_kind AS ENUM ('payment', 'legacy_credit', 'transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_receipt_method AS ENUM ('cashapp', 'zelle', 'cash', 'check', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS ledger_initialized_at timestamptz;
ALTER TABLE sponsorship_contributions ADD COLUMN IF NOT EXISTS amount_cents integer;
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS amount_cents integer;

CREATE TABLE IF NOT EXISTS payment_receipts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  kind payment_receipt_kind NOT NULL,
  amount_cents integer NOT NULL,
  method payment_receipt_method,
  received_date text,
  reference text,
  note text,
  submission_id integer REFERENCES payment_submissions(id) ON DELETE SET NULL,
  replaces_receipt_id integer,
  idempotency_key text,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_receipts_amount_ck CHECK (amount_cents >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_idem_uq ON payment_receipts (reunion_id, idempotency_key);
CREATE INDEX IF NOT EXISTS payment_receipts_reunion_idx ON payment_receipts (reunion_id);

CREATE TABLE IF NOT EXISTS payment_receipt_allocations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id integer NOT NULL REFERENCES payment_receipts(id) ON DELETE CASCADE,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  registration_id integer REFERENCES registrations(id) ON DELETE CASCADE,
  contribution_id integer REFERENCES sponsorship_contributions(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_receipt_alloc_reg_idx ON payment_receipt_allocations (registration_id);
CREATE INDEX IF NOT EXISTS payment_receipt_alloc_receipt_idx ON payment_receipt_allocations (receipt_id);

CREATE TABLE IF NOT EXISTS payment_receipt_reversals (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id integer NOT NULL REFERENCES payment_receipts(id) ON DELETE CASCADE,
  reason text NOT NULL,
  reversed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipt_reversals_receipt_uq ON payment_receipt_reversals (receipt_id);
