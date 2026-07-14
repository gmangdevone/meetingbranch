-- Registration cancellation + sponsorship fund.
-- Data-preserving and idempotent: only adds enums, columns, and tables.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "registration_status" AS ENUM ('active', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "cancellation_resolution" AS ENUM ('refunded', 'donated_to_fund', 'no_payment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "sponsorship_contribution_source" AS ENUM ('registration', 'direct', 'cancellation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "sponsorship_allocation_funding" AS ENUM ('fund', 'direct');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing registrations backfill to 'active'.
ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "status" "registration_status" NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "cancellation_resolution" "cancellation_resolution";

CREATE TABLE IF NOT EXISTS "sponsorship_contributions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "reunion_id" integer NOT NULL REFERENCES "reunions"("id") ON DELETE CASCADE,
  "registration_id" integer REFERENCES "registrations"("id") ON DELETE SET NULL,
  "contributor_user_id" text,
  "contributor_name" text,
  "amount" integer NOT NULL,
  "source" "sponsorship_contribution_source" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sponsorship_allocations" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "reunion_id" integer NOT NULL REFERENCES "reunions"("id") ON DELETE CASCADE,
  "registration_id" integer NOT NULL REFERENCES "registrations"("id") ON DELETE CASCADE,
  "amount" integer NOT NULL,
  "funded_from" "sponsorship_allocation_funding" NOT NULL,
  "sponsor_name" text,
  "note" text,
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

COMMIT;
