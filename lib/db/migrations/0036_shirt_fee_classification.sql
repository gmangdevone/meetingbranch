-- Nullable for legacy-safe publishing: existing fees retain label detection.
-- Editing a fee locks its effective classification before renaming.
ALTER TABLE reunion_fees ADD COLUMN IF NOT EXISTS is_shirt boolean;
