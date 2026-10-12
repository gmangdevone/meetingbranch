-- Nullable additions preserve existing activities and historical selections.
ALTER TABLE activity_choice_options ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE activity_choice_options ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE activity_choice_options ADD COLUMN IF NOT EXISTS map_url text;
ALTER TABLE activity_choice_options ADD COLUMN IF NOT EXISTS website_url text;
