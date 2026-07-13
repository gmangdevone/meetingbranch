---
name: Backfill-then-tighten DB migrations
description: How to add NOT NULL foreign keys to tables that already hold data in this Drizzle + PostgreSQL project.
---

# Backfill-then-tighten migrations

When a schema change introduces a new NOT NULL column or FK on a table that already has rows,
`drizzle-kit push` cannot succeed in one shot — the new column has no value for existing rows.

**Rule:** hand-write a data-preserving SQL migration and run it via `psql` inside a single transaction:
1. Add the column as nullable (or with a temporary default).
2. Create/seed the parent rows the FK points to.
3. Backfill the new column on all existing rows.
4. `ALTER ... SET NOT NULL` and add the FK constraint.
5. Drop obsolete columns/enums last.

**Why:** the alternative (push) either refuses or would require dropping data. Doing it as one
transaction keeps existing registrations/announcements/schedule intact.

**How to apply:** after the migration, make the Drizzle schema files match the final state and run
`pnpm --filter @workspace/db run push` — it should report "No changes detected". Match constraint
names to Drizzle's conventions (`<table>_<col>_<reftable>_<refcol>_fk`) so a later push stays clean.
Drizzle addresses columns by name, so exact constraint names only matter for future push cleanliness,
not data safety.
