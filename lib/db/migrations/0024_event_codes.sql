-- Bring existing development and fresh-install event codes into the new format.
-- Existing codes are unique, so appending the same literal suffix preserves
-- uniqueness. The suffix guard keeps this migration safe to re-run.
BEGIN;

UPDATE "reunions"
SET "code" = upper("code") || 'FR*'
WHERE "code" !~ 'FR\*$';

ALTER TABLE "reunions"
  DROP CONSTRAINT IF EXISTS "reunions_code_format_check";

ALTER TABLE "reunions"
  ADD CONSTRAINT "reunions_code_format_check"
  CHECK (
    -- Publish applies this schema constraint without replaying the UPDATE above.
    -- Grandfather safe legacy codes created before the format rollout.
    (
      "created_at" < timestamptz '2026-08-27 00:00:00+00'
      AND char_length("code") BETWEEN 7 AND 32
      AND "code" = upper("code")
      AND "code" ~ '[A-Za-z]'
      AND "code" ~ '[0-9]'
      AND "code" ~ '^[A-Za-z0-9]+$'
    )
    OR (
      char_length("code") BETWEEN 7 AND 32
      AND "code" = upper("code")
      AND "code" ~ '[A-Za-z]'
      AND "code" ~ '[0-9]'
      AND "code" ~ '[*._~-]'
      AND "code" ~ '^[A-Za-z0-9*._~-]+$'
    )
  );

COMMIT;