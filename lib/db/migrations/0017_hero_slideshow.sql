-- Hero slideshow: up to 5 ordered hero images + rotation interval (3-8s).
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS hero_image_urls text[] NOT NULL DEFAULT '{}';
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS hero_rotation_seconds integer NOT NULL DEFAULT 3;

-- Backfill: carry each reunion's existing hero image over as the first slide.
UPDATE reunions
SET hero_image_urls = ARRAY[hero_image_url]
WHERE hero_image_url IS NOT NULL
  AND hero_image_urls = '{}';
