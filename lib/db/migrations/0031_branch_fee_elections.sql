-- Branch fee revision: the fee is paid IN FULL by ONE member who elects it
-- (not pooled). A stable election row per branch owns the obligation.
-- Additive: legacy pooled allocations (branch_id set, no election) stay as-is
-- for organizer review and never count as the fee being paid.
CREATE TABLE IF NOT EXISTS branch_fee_elections (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  branch_id integer NOT NULL REFERENCES reunion_branches(id) ON DELETE RESTRICT,
  user_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by text
);
-- Once per branch: at most one active election.
CREATE UNIQUE INDEX IF NOT EXISTS branch_fee_elections_one_active ON branch_fee_elections (branch_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS branch_fee_elections_user_idx ON branch_fee_elections (reunion_id, user_id);

ALTER TABLE payment_receipt_allocations ADD COLUMN IF NOT EXISTS branch_fee_election_id integer REFERENCES branch_fee_elections(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS payment_receipt_alloc_election_idx ON payment_receipt_allocations (branch_fee_election_id);
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS branch_fee_election_id integer REFERENCES branch_fee_elections(id) ON DELETE RESTRICT;

-- History-preserving FKs use NO ACTION (checked at statement end) so deleting
-- a whole reunion cascades cleanly, while deleting a branch alone with fee
-- history is still refused (the API archives such branches instead).
ALTER TABLE branch_fee_elections DROP CONSTRAINT IF EXISTS branch_fee_elections_branch_id_fkey;
ALTER TABLE branch_fee_elections ADD CONSTRAINT branch_fee_elections_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES reunion_branches(id);
ALTER TABLE payment_receipt_allocations DROP CONSTRAINT IF EXISTS payment_receipt_allocations_branch_fee_election_id_fkey;
ALTER TABLE payment_receipt_allocations ADD CONSTRAINT payment_receipt_allocations_branch_fee_election_id_fkey FOREIGN KEY (branch_fee_election_id) REFERENCES branch_fee_elections(id);
ALTER TABLE payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_branch_fee_election_id_fkey;
ALTER TABLE payment_submissions ADD CONSTRAINT payment_submissions_branch_fee_election_id_fkey FOREIGN KEY (branch_fee_election_id) REFERENCES branch_fee_elections(id);
ALTER TABLE payment_receipt_allocations DROP CONSTRAINT IF EXISTS payment_receipt_allocations_branch_id_fkey;
ALTER TABLE payment_receipt_allocations ADD CONSTRAINT payment_receipt_allocations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES reunion_branches(id);
ALTER TABLE payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_branch_fee_branch_id_fkey;
ALTER TABLE payment_submissions ADD CONSTRAINT payment_submissions_branch_fee_branch_id_fkey FOREIGN KEY (branch_fee_branch_id) REFERENCES reunion_branches(id);
