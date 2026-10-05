-- Additive: owner-approved public plain-text payment instructions.
-- Nullable; existing rows keep NULL (no instructions) until the owner adds them.
ALTER TABLE payment_recipients ADD COLUMN IF NOT EXISTS payment_instructions text;
