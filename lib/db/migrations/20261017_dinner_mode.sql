-- Nullable preserves legacy billing. Selections are materialized transactionally
-- when an organizer first configures dinner, not during schema deployment.
ALTER TABLE reunion_fees ADD COLUMN IF NOT EXISTS dinner_mode text;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS dinner_fee_ids integer[];
