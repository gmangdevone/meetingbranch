-- Additive only. Legacy purchase mapping is performed transactionally by the
-- application before catalog changes; old columns remain for safe deployment.
ALTER TABLE reunion_fees ADD COLUMN IF NOT EXISTS is_add_on boolean NOT NULL DEFAULT false;
ALTER TABLE reunion_fees ADD COLUMN IF NOT EXISTS option_groups jsonb NOT NULL DEFAULT '[]';
ALTER TABLE reunion_fees ADD COLUMN IF NOT EXISTS retired boolean NOT NULL DEFAULT false;
ALTER TABLE reunion_fees ADD COLUMN IF NOT EXISTS base_price_cents integer;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS add_ons jsonb;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS add_ons jsonb;
