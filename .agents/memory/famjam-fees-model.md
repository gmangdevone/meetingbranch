---
name: FamJam fees & dues model
description: How reunion fees are modeled/computed after replacing the single feePerPerson, and the migration-record convention.
---

# Fees & dues

Reunion pricing is a list of labeled fees (a `reunion_fees` table), NOT a single
per-person number. The old `reunions.fee_per_person` column was fully removed.
Each fee has a charge type (per_person | flat), an optional flag, and a jsonb
`age_tiers` list of brackets `{minAge, maxAge, amount}` (replaced the old single
ageThreshold/amountUnderThreshold pair). An attendee whose age falls in a bracket
pays that amount; anyone else — including null age — pays the base `amount`.
Brackets must not overlap (validated server-side, 400 on violation) and are
stored sorted by minAge. Optional fees a household opts into are stored in a
`registration_fees` join table; mandatory fees always apply.

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

## Dev vs prod fee config
- Fee rows (reunion_fees) are DATA, not schema: publishing syncs schema only, so dev fee setup never reaches prod — organizers must reconfigure fees in the live app.
- Common misconfiguration: creating separate fees per age band ("Registration 18+", "Registration 10-17"). A fee with no age tiers charges everyone, so this double-charges. Correct model: one fee per item with age tiers; base amount covers unmatched ages.

## Test workflows collide
`test` and `api-test` workflows both run the api-server integration tests against the same dev database; running them at the same time makes tests with hardcoded reunion codes (e.g. ZZ99999) fail on unique constraints. Run one at a time; a lone failure like that is usually the collision, not a real bug.
