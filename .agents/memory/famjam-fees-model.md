---
name: FamJam fees & dues model
description: How reunion fees are modeled/computed after replacing the single feePerPerson, and the migration-record convention.
---

# Fees & dues

Reunion pricing is a list of labeled fees (a `reunion_fees` table), NOT a single
per-person number. The old `reunions.fee_per_person` column was fully removed.
Each fee has a charge type (per_person | flat), an optional flag, and an optional
age tier (an age threshold + a separate under-threshold amount). Optional fees a
household opts into are stored in a `registration_fees` join table; mandatory
fees always apply. `attendees.age` drives age tiering (nullable = at-or-over).

**feePerPerson still exists ONLY in the create-reunion input** as a seed value for
the initial "Registration Fee" item — it is gone from the Reunion response and
the update input. Don't reintroduce it elsewhere.

## Fee computation must stay in parity across two files
The compute logic (feeApplies / computeFeeAmount / computeTotal) is duplicated in
the API server and the web app fee helpers. **Why:** the register page shows a
live total and the server computes the confirmation-email total; they must agree.
**How to apply:** any change to the pricing rules (age-tier semantics, flat vs
per-person, null-age handling) must be made in BOTH copies together.

## Migration-record convention (`lib/db/migrations/`)
This project keeps hand-written, data-preserving SQL files here (idempotent,
guarded with IF EXISTS / WHERE NOT EXISTS / DO-block enum guards). They are the
durable record and are applied to the **dev** DB manually via `psql`, then
`drizzle-kit push` is run to confirm parity ("No changes detected"). Follow the
backfill-then-tighten pattern: create new tables/columns, backfill from the old
shape, THEN drop the old column — never drop before backfilling.

**Publish caveat:** the automatic dev→prod publish diff only diffs schema; it does
NOT run these .sql files or backfill data for a column→table restructure. If an
app with real prod data is published after such a change, the old column is
dropped without its data being migrated into the new tables. Warn the user to
handle prod data (or that the restructure is destructive) at publish time.
