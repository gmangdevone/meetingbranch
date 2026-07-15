-- 0007: Attendee check-in + family polls/voting
-- Record of the schema change applied via drizzle-kit push (additive, data-preserving).

ALTER TABLE attendees ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

CREATE TABLE IF NOT EXISTS polls (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  question text NOT NULL,
  max_votes_per_member integer NOT NULL DEFAULT 1,
  is_open boolean NOT NULL DEFAULT true,
  results_revealed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_options (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  poll_id integer NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poll_votes (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  poll_id integer NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id integer NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT poll_votes_option_user_unique UNIQUE (option_id, user_id)
);

-- Added later: per-poll toggle streaming live counts to family members.
ALTER TABLE "polls" ADD COLUMN IF NOT EXISTS "live_results" boolean NOT NULL DEFAULT false;
