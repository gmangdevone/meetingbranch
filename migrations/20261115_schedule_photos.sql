-- Optional thumbnails preserve existing schedule entries.
ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS photo_path text;
