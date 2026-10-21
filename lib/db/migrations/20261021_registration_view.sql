-- Account-owned display preferences only. No registration data is modified.
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_view_fields jsonb;
