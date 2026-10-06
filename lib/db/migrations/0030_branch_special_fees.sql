-- Branch special fee: ONE shared, one-time, opt-in fee per branch (not per
-- registration). Additive only; legacy branches default to no fee.
ALTER TABLE reunion_branches ADD COLUMN IF NOT EXISTS special_fee_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE reunion_branches ADD COLUMN IF NOT EXISTS special_fee_label text;
ALTER TABLE reunion_branches ADD COLUMN IF NOT EXISTS special_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE reunion_branches ADD COLUMN IF NOT EXISTS archived_at timestamptz;
DO $$ BEGIN
  ALTER TABLE reunion_branches ADD CONSTRAINT reunion_branches_special_fee_ck CHECK (special_fee_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Confirmed branch-fee money: allocation rows targeting the branch. The payer
-- registration is kept privately for organizers. RESTRICT: financial history
-- outlives the branch (branches with money are archived, never deleted).
ALTER TABLE payment_receipt_allocations ADD COLUMN IF NOT EXISTS branch_id integer REFERENCES reunion_branches(id) ON DELETE RESTRICT;
ALTER TABLE payment_receipt_allocations ADD COLUMN IF NOT EXISTS payer_registration_id integer REFERENCES registrations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payment_receipt_alloc_branch_idx ON payment_receipt_allocations (branch_id);

-- Self-reported branch fee portion of a payment submission (informational).
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS branch_fee_branch_id integer REFERENCES reunion_branches(id) ON DELETE RESTRICT;
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS branch_fee_cents integer;
