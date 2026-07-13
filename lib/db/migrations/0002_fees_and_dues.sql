-- Fees & dues migration: replaces the single reunions.fee_per_person with a
-- list of labeled fees (reunion_fees), records which OPTIONAL fees each
-- registration opted into (registration_fees), and adds attendees.age for
-- age-tiered pricing.
-- Data-preserving: each reunion's existing fee_per_person is backfilled into a
-- default "Registration Fee" item before the old column is dropped.
-- Idempotent-ish: guarded so re-runs do not duplicate or fail.

BEGIN;

-- Fee charge model: per attendee, or a flat amount per household/registration
DO $$ BEGIN
  CREATE TYPE "fee_charge_type" AS ENUM ('per_person', 'flat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── New tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reunion_fees" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "reunion_id" integer NOT NULL,
  "label" text NOT NULL,
  "charge_type" "fee_charge_type" NOT NULL DEFAULT 'per_person',
  "is_optional" boolean NOT NULL DEFAULT false,
  "amount" integer NOT NULL,
  "age_threshold" integer,
  "amount_under_threshold" integer,
  "sort_order" integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "registration_fees" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "registration_id" integer NOT NULL,
  "fee_id" integer NOT NULL
);

-- FKs (guarded)
DO $$ BEGIN
  ALTER TABLE "reunion_fees" ADD CONSTRAINT "reunion_fees_reunion_id_reunions_id_fk"
    FOREIGN KEY ("reunion_id") REFERENCES "reunions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "registration_fees" ADD CONSTRAINT "registration_fees_registration_id_registrations_id_fk"
    FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "registration_fees" ADD CONSTRAINT "registration_fees_fee_id_reunion_fees_id_fk"
    FOREIGN KEY ("fee_id") REFERENCES "reunion_fees"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Age per attendee (nullable; legacy rows stay NULL and count as at-or-over any tier)
ALTER TABLE "attendees" ADD COLUMN IF NOT EXISTS "age" integer;

-- ── Backfill legacy per-person fee into a default fee item ───────────────────
-- Guarded on the old column still existing so re-runs after the drop are no-ops.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reunions' AND column_name = 'fee_per_person'
  ) THEN
    EXECUTE $backfill$
      INSERT INTO "reunion_fees"
        ("reunion_id","label","charge_type","is_optional","amount","sort_order")
      SELECT id, 'Registration Fee', 'per_person', false, fee_per_person, 0
      FROM "reunions"
      WHERE NOT EXISTS (
        SELECT 1 FROM "reunion_fees" rf WHERE rf.reunion_id = reunions.id
      )
    $backfill$;
  END IF;
END $$;

-- ── Drop the obsolete single-fee column ─────────────────────────────────────
ALTER TABLE "reunions" DROP COLUMN IF EXISTS "fee_per_person";

COMMIT;
