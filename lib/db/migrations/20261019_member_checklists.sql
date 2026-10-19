ALTER TABLE reunions ADD COLUMN IF NOT EXISTS checklist_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS checklist_items (
  id serial PRIMARY KEY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  link text,
  kind text NOT NULL DEFAULT 'manual',
  visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS checklist_progress (
  item_id integer NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);
