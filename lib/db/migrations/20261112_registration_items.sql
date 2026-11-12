-- Nullable permission preserves existing restrictions on schema-only publishes.
ALTER TABLE reunions ADD COLUMN IF NOT EXISTS allow_post_registration_add_ons boolean;
CREATE TABLE IF NOT EXISTS registration_item_requests (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_id integer NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  request_id text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_item_request_unique UNIQUE (registration_id, actor_id, request_id)
);
