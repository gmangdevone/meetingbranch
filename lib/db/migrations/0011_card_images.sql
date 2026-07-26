-- Custom background images for the hub page cards (Schedule, Announcements, Family Vote).
-- Nullable object paths like /objects/uploads/<uuid>; NULL means the default card look.
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS schedule_card_image_url text;
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS announcements_card_image_url text;
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS polls_card_image_url text;
