# Production test-registration cleanup

**Status: prepared only. No production records have been deleted. No production
backup has been created or verified by the agent. No maintenance window has started.**

The user confirmed on October 1, 2026 that all existing registrations are test
data. This is a one-time data cleanup, not a schema migration, database reset,
user deletion, or permanent admin feature. Never place this SQL in a migration,
startup hook, publish command, or automatic workflow.

## Reviewed production scope

Read-only inspection across **all** reunions and statuses found one reunion:
ID 1, Lacey Family Reunion, event code `LACEY27FR*`.

| Records | Remove | Preserve |
|---|---:|---:|
| Registrations (all currently cancelled) | 21 | 0 |
| Attendees | 49 | 0 |
| Contributions still linked to those registrations | 8 | 0 |
| Unlinked contributions | 0 | 7 |
| Payment submissions | 0 | 0 |
| Selected registration fees | 0 | 0 |
| Sponsorship allocations | 0 | 0 |
| Users | 0 | 13 |
| App settings | 0 | 1 |
| Reunions and their configuration | 0 | 1 |
| Poll votes | 0 | 5 |
| Activity selections | 0 | 0 |

All organizer roles, fee definitions, branches, schedules, announcements,
images, vendors/contracts, poll definitions/options, and activity groups/options
remain unchanged. Authentication accounts are not touched. Counts are a reviewed
snapshot, not permission to remove subsequently created registrations.

### Frozen IDs

- Registrations: **1, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, 26, 27**.
- Attendees: **1, 12–25, 31–64** (49 records).
- Linked contributions: **1, 3, 8, 10, 12, 13, 14, 15**.
- Preserved contributions: **2, 4, 5, 6, 7, 9, 11**.

The eight linked contributions total **$213**: **$190 paid** and **$23 pending**.
Deleting them changes the recorded fund balance from **$6,825 to $6,635**.
No external money is moved, refunded, or cancelled by this SQL.

Contribution **2** is a **$5,000 paid** registration-source record whose
registration link is already null. It cannot be reliably attributed to the
current registration IDs, so it is preserved, along with six direct contributions
totalling $1,635. The five poll votes are user-linked, not registration-linked,
and remain in poll totals. This is a clean **registration list**, not a reset of
all financial or voting history. Clearing these separate records requires a new
scope decision; it is not required to remove registrations from CSV exports.

## Before execution — mandatory

1. Review the exact scope above, including removal of linked contributions.
   The SQL defaults to a rollback-only rehearsal; it does not authorize itself.
2. In Replit's **Database** tool select **Production**, not Development.
   The agent's production query tool is read-only. A human operator must use the
   production SQL runner; never supply credentials in chat or bypass that access
   boundary. If the SQL runner cannot run a complete PostgreSQL DO statement,
   stop rather than executing individual DELETE statements.
3. Arrange a short no-writes maintenance window: pause incoming application
   traffic and organizer changes, and drain in-flight requests. Closing public
   registrations alone does **not** stop organizer-created registrations,
   donations, payments, or already-started requests. Do not change persistent
   settings as part of the cleanup. If you cannot establish a quiet window, stop.
4. **Confirm a restorable production backup/restore point immediately before
   cleanup.** Record its identifier/time and restoration procedure securely,
   outside this repository. Verify availability for this actual deployment in
   the Database tool's recovery/settings interface. If unavailable, arrange a
   complete PostgreSQL backup with a trusted database operator and validate it
   can restore into an isolated database before proceeding. Do not assume an
   ordinary code checkpoint includes current production data.
5. A registration CSV is useful as a secondary record but is **not** a restorable
   backup: it omits keys, selected fees, payment evidence, and other dependencies.
   Never commit full-row backups, names, emails, payment references, or credentials
   to the project or expose them through public assets.

Reference: [Working with your data](https://docs.replit.com/features/data-and-storage/work-with-your-data)
and [Data recovery](https://docs.replit.com/features/data-and-storage/data-recovery).

## Rehearsal

1. Keep the no-writes window in effect.
2. Open `cleanup.sql` beside this guide. Leave `dry_run := true`,
   `backup_verified := false`, and the approval string empty.
3. Paste and execute the **entire single DO statement** in the production SQL
   runner. It obtains short-lived write-blocking table locks, checks the exact
   record manifests/full-row fingerprints and actual foreign keys, performs
   the proposed deletion in a subtransaction, verifies preserved data, and
   deliberately rolls the deletion back.
   Use autocommit, with no surrounding transaction. If the client opened an
   explicit transaction, issue **ROLLBACK** when the rehearsal finishes (or
   errors) to release the outer transaction's table locks. Do not leave it open:
   rolling back the rehearsal's deletes alone does not release those locks.
4. Expected notice: **REHEARSAL PASSED ... Nothing removed.** If the UI suppresses
   notices, run `verify.sql` and confirm the original 21 registrations, 49
   attendees, and 15 contributions remain; inspect execution status for errors.
5. Any error, lock timeout, unknown dependency, or changed fingerprint is a
   **stop condition**. Do not remove assertions, change the expected IDs/hashes,
   or broaden the DELETE predicates to get past it. Refresh the read-only
   inventory and have the package reviewed again.

The script deliberately refuses even unrelated new payment submissions and
contributions. This is conservative: today's empty payment tables mean there
are no mixed registration/chip-in payments to split. Any new payment requires
review of both primary IDs and array references.

## Apply — only after backup and scope approval

In a copy of `cleanup.sql`, change only these three declarations:

```sql
dry_run boolean := false;
backup_verified boolean := true;
approval text := 'REMOVE 21 TEST REGISTRATIONS, 49 ATTENDEES, AND 8 LINKED CONTRIBUTIONS';
```

Run the complete single DO statement, with no surrounding long-lived transaction,
in the **production** SQL runner. A successful statement commits atomically.
An error rolls back its changes. If the UI/client opens an explicit transaction,
do not leave it open: only commit after the successful APPLY notice; roll back
on any error. Do not run this from the development Shell against a guessed URL.

Expected notice: **APPLY PASSED: removed 21 registrations, 49 attendees,
8 linked contributions. All preserved tables unchanged.**

The script never deletes users/settings/reunions or resets ID sequences. It
explicitly deletes attendees because their registration ID has no foreign key,
and deletes the eight linked contributions before their registrations because
the contribution FK would otherwise set their registration link to null.
Any second execution fails safely because the reviewed snapshot no longer exists.

## Verify before allowing traffic again

- Run the SELECT statements in `verify.sql`. Registration/attendee counts should
  be zero; the seven preserved contributions and five poll votes remain.
- The SQL itself checks before/after fingerprints of **all preserved public
  tables**, not just their counts. Any change within the operation rolls back.
- Reload the organizer registration page: it should show **No registrations found**.
  The current UI disables **Export CSV** when there are no registrations. The
  authenticated export endpoint still returns the header row and no data rows;
  once real registrations begin, exports should contain only those new records.
- Existing users can sign in again and register normally once traffic resumes.
  Registration numbers will continue from the sequence; they will not restart at 1.
- Ask the agent for read-only production verification after execution. Do not
  interpret this prepared package or a successful rehearsal as proof of deletion.

## Recovery

Before successful commit, any exception rolls back the entire SQL operation.
After commit, preserve the maintenance window and restore using the verified
production backup/restore point with the database operator. Restoring the whole
database also rewinds unrelated changes after that restore point—another reason
not to resume traffic until verification is complete. Do not try to reconstruct
registrations from the CSV or use development-database rollback as a substitute.

## Local validation

Run `python3 scripts/test-registration-cleanup.py` to test the actual cleanup
statement against a disposable local PostgreSQL fixture. The test does not use
DATABASE_URL, production credentials, or the development database. Fixture-only
fingerprints replace the production fingerprints in memory; the reviewed SQL
file is never modified by the tests.