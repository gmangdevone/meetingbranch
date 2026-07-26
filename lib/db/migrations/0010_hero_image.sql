-- Custom hub hero background image per reunion (object storage path).
-- NULL means the default gradient background.
BEGIN;

ALTER TABLE reunions
  ADD COLUMN IF NOT EXISTS hero_image_url text;

COMMIT;
