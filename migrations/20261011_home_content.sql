-- Additive; existing events retain default welcome copy and no hotel section.
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS welcome_heading text;
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS welcome_description text;
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS hotel_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS hotel_description text;
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS hotel_booking_url text;
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS hotel_image_url text;
