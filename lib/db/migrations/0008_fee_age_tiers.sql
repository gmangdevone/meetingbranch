-- Fee age tiers: replace the single under-threshold tier
-- (age_threshold + amount_under_threshold) with a jsonb list of age brackets
-- [{"minAge": int, "maxAge": int, "amount": int}, ...].
-- Backfill-then-tighten: add the column, backfill from the old shape, then drop
-- the old columns. Idempotent.

BEGIN;

ALTER TABLE reunion_fees
  ADD COLUMN IF NOT EXISTS age_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: an old "under N pays X" tier becomes the bracket 0..(N-1) at X.
UPDATE reunion_fees
SET age_tiers = jsonb_build_array(
      jsonb_build_object(
        'minAge', 0,
        'maxAge', age_threshold - 1,
        'amount', amount_under_threshold
      )
    )
WHERE age_tiers = '[]'::jsonb
  AND age_threshold IS NOT NULL
  AND age_threshold >= 1
  AND amount_under_threshold IS NOT NULL;

ALTER TABLE reunion_fees DROP COLUMN IF EXISTS age_threshold;
ALTER TABLE reunion_fees DROP COLUMN IF EXISTS amount_under_threshold;

COMMIT;
