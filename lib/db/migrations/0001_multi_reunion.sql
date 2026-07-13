-- Multi-reunion migration: adds reunions, branches, settings; scopes existing
-- registrations/announcements/schedule to the converted "Lacey Family Reunion".
-- Data-preserving. Idempotent-ish: guarded so re-runs do not duplicate.

BEGIN;

-- ── New tables ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "app_settings" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "reunion_creation_enabled" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "reunions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "fee_per_person" integer NOT NULL,
  "payment_handle" text NOT NULL,
  "payment_url" text,
  "organizer_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reunions_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "reunion_branches" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "reunion_id" integer NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0
);

-- FKs for new tables (guarded)
DO $$ BEGIN
  ALTER TABLE "reunions" ADD CONSTRAINT "reunions_organizer_id_users_id_fk"
    FOREIGN KEY ("organizer_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reunion_branches" ADD CONSTRAINT "reunion_branches_reunion_id_reunions_id_fk"
    FOREIGN KEY ("reunion_id") REFERENCES "reunions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Seed settings ───────────────────────────────────────────────────────────
INSERT INTO "app_settings" ("reunion_creation_enabled")
SELECT true WHERE NOT EXISTS (SELECT 1 FROM "app_settings");

-- ── Convert existing data into the Lacey reunion ────────────────────────────
INSERT INTO "reunions"
  ("code","name","start_date","end_date","fee_per_person","payment_handle","payment_url","organizer_id")
SELECT 'LACEY27','Lacey Family Reunion','2027-07-16','2027-07-19',50,'$goudycgp','https://cash.app/$goudycgp',
  COALESCE(
    (SELECT id FROM users WHERE is_admin = true ORDER BY created_at LIMIT 1),
    (SELECT id FROM users ORDER BY created_at LIMIT 1)
  )
WHERE NOT EXISTS (SELECT 1 FROM "reunions" WHERE code = 'LACEY27');

INSERT INTO "reunion_branches" ("reunion_id","name","sort_order")
SELECT r.id, b.name, b.ord
FROM "reunions" r,
  (VALUES ('John',0),('Louise',1),('Willie Mae',2),('June',3),('Frances',4),
          ('Edna',5),('Loretta',6),('Betty',7),('Dorothy',8),('Richard',9)) AS b(name,ord)
WHERE r.code = 'LACEY27'
  AND NOT EXISTS (SELECT 1 FROM "reunion_branches" rb WHERE rb.reunion_id = r.id);

-- ── registrations: add reunion_id + branch_name, backfill, tighten ──────────
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "reunion_id" integer;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "branch_name" text;

UPDATE "registrations"
SET "reunion_id" = (SELECT id FROM reunions WHERE code = 'LACEY27')
WHERE "reunion_id" IS NULL;

UPDATE "registrations"
SET "branch_name" = "sibling_name"::text
WHERE "branch_name" IS NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'registrations' AND column_name = 'sibling_name'
  );

ALTER TABLE "registrations" ALTER COLUMN "reunion_id" SET NOT NULL;
ALTER TABLE "registrations" ALTER COLUMN "branch_name" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "registrations" ADD CONSTRAINT "registrations_reunion_id_reunions_id_fk"
    FOREIGN KEY ("reunion_id") REFERENCES "reunions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "registrations" DROP COLUMN IF EXISTS "sibling_name";
DROP TYPE IF EXISTS "sibling_name";

-- ── announcements ────────────────────────────────────────────────────────────
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "reunion_id" integer;
UPDATE "announcements"
SET "reunion_id" = (SELECT id FROM reunions WHERE code = 'LACEY27')
WHERE "reunion_id" IS NULL;
ALTER TABLE "announcements" ALTER COLUMN "reunion_id" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "announcements" ADD CONSTRAINT "announcements_reunion_id_reunions_id_fk"
    FOREIGN KEY ("reunion_id") REFERENCES "reunions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── schedule_items ───────────────────────────────────────────────────────────
ALTER TABLE "schedule_items" ADD COLUMN IF NOT EXISTS "reunion_id" integer;
UPDATE "schedule_items"
SET "reunion_id" = (SELECT id FROM reunions WHERE code = 'LACEY27')
WHERE "reunion_id" IS NULL;
ALTER TABLE "schedule_items" ALTER COLUMN "reunion_id" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_reunion_id_reunions_id_fk"
    FOREIGN KEY ("reunion_id") REFERENCES "reunions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
