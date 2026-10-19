ALTER TABLE announcements ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
