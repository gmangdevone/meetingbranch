-- Owner-approved Zelle destination (additive, nullable, data-preserving).
-- Existing recipients keep their values and simply have no Zelle until the
-- platform owner approves one.
ALTER TABLE payment_recipients ADD COLUMN IF NOT EXISTS zelle_recipient_name text;
ALTER TABLE payment_recipients ADD COLUMN IF NOT EXISTS zelle_contact text;
ALTER TYPE payment_recipient_audit_action ADD VALUE IF NOT EXISTS 'disable_zelle';
