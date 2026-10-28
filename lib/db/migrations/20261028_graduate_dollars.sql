BEGIN;
CREATE TABLE IF NOT EXISTS graduate_configs (
  reunion_id integer PRIMARY KEY REFERENCES reunions(id) ON DELETE CASCADE,
  visible boolean NOT NULL DEFAULT false,
  open boolean NOT NULL DEFAULT false,
  recipient_id text REFERENCES users(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 0,
  content jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS graduate_submissions (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  reunion_id integer NOT NULL REFERENCES reunions(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  request_id text NOT NULL,
  revision integer NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  zelle text NOT NULL,
  cash_app text NOT NULL,
  answers jsonb NOT NULL,
  links jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  email_status text NOT NULL DEFAULT 'pending',
  email_attempts integer NOT NULL DEFAULT 0,
  email_error text,
  email_attempt_at timestamptz,
  email_recipient_id text,
  email_recipient text,
  provider_message_id text,
  CONSTRAINT graduate_request_unique UNIQUE(reunion_id, user_id, request_id)
);
COMMIT;
