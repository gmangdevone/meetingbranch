-- Owner-controlled payment recipients (additive, data-preserving).
-- Legacy reunions.cash_app_tag / payment_handle / payment_url are NOT modified
-- or copied: a reunion with no payment_recipients row is "pending owner review"
-- and has no live payment destination until the platform owner approves one.
DO $$ BEGIN
  CREATE TYPE payment_recipient_status AS ENUM ('approved', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_recipient_audit_action AS ENUM ('approve', 'change', 'disable', 'disable_cashapp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE payment_recipient_audit_action ADD VALUE IF NOT EXISTS 'disable_cashapp';

CREATE TABLE IF NOT EXISTS payment_recipients (
  reunion_id integer PRIMARY KEY REFERENCES reunions(id) ON DELETE CASCADE,
  status payment_recipient_status NOT NULL,
  cash_app_tag text,
  payment_handle text,
  payment_url text,
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_recipient_audit (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reunion_id integer NOT NULL,
  actor_user_id text NOT NULL,
  action payment_recipient_audit_action NOT NULL,
  previous_value jsonb,
  new_value jsonb NOT NULL,
  version_after integer NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_recipient_audit_reunion_idx
  ON payment_recipient_audit (reunion_id, created_at);

-- Audit rows are append-only by application design: no code path or API
-- route updates or deletes them. No database trigger is installed.
