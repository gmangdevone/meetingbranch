-- 0025: Activities & Choices

CREATE TABLE IF NOT EXISTS activity_choice_groups (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  max_selections_per_registrant integer NOT NULL DEFAULT 1,
  is_open boolean NOT NULL DEFAULT true,
  results_revealed boolean NOT NULL DEFAULT false,
  live_results boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_choice_options (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  group_id integer NOT NULL REFERENCES activity_choice_groups(id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activity_choice_selections (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  group_id integer NOT NULL REFERENCES activity_choice_groups(id) ON DELETE CASCADE,
  option_id integer NOT NULL REFERENCES activity_choice_options(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_choice_selections_option_user_unique UNIQUE (option_id, user_id)
);