CREATE TABLE IF NOT EXISTS dinner_history (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  fee_id integer NOT NULL,
  fee_label text NOT NULL,
  registration_id integer,
  attendee_name text,
  before_choice text NOT NULL,
  after_choice text NOT NULL
);
CREATE INDEX IF NOT EXISTS dinner_history_reunion_idx ON dinner_history (reunion_id, id);
