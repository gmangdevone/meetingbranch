ALTER TABLE users ADD COLUMN IF NOT EXISTS name_saved_by_user boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS greeting_initialized boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS initial_greeting_session text;