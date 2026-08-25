-- Bring every existing event code into the new format before enforcing it.
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
    char_length("code") BETWEEN 7 AND 32
    AND "code" = upper("code")
    AND "code" ~ '[A-Za-z]'
    AND "code" ~ '[0-9]'
    AND "code" ~ '[*._~-]'
    AND "code" ~ '^[A-Za-z0-9*._~-]+$'
  );

COMMIT;