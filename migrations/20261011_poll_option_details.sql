ALTER TABLE poll_options ADD COLUMN IF NOT EXISTS details_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE poll_options ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE poll_options ADD COLUMN IF NOT EXISTS link_url text;
