ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS content_text_size text NOT NULL DEFAULT 'larger';
