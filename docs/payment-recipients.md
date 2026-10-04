# Owner-controlled payment recipients

Only the platform owner can decide where reunion money is sent. Organizers, co-organizers and admins cannot set or change payment destinations.

## Who counts as the owner
- The owner is set by the server environment variable `PAYMENT_OWNER_USER_ID`, which holds a sign-in provider user id (format `user_` followed by letters and numbers).
- The `isAdmin` flag, the first-admin setup page, `ADMIN_USER_ID`, and organizer roles never give owner rights.
- If the variable is missing, empty, or badly formatted, nobody is the owner. Owner screens return 403, and payers see "not configured".
- The API never returns the owner's id or email. `GET /api/me/payment-owner` only returns `{ isPaymentOwner: boolean }`.
- To change the owner, update the secret in each environment and restart the API. No data migration is needed. History entries written by the old account show as "Previous owner account".

## What the owner can approve (per reunion)
- **Cash App $Cashtag**: 1-20 letters or numbers, with at least one letter. Payers get a link to `https://cash.app/$Tag`.
- **Payment label**: optional display text, for example "Family Fund at First Bank". A label that looks like a `$tag` must match the approved tag.
- **Payment link**: optional. It must:
  - use `https`, with no username, password, port, spaces, or control characters
  - use a public domain name; lookalike Cash App domains are rejected
- Any `cash.app` link must use exactly the approved tag, as `/$Tag` with an optional whole-dollar amount.
- At least one of the three fields is required. Generic (non-Cash App) destinations can be approved without a Cash App tag.
- Every save asks the owner to confirm the before/after values. The save is checked against a version number, so a stale edit gets a 409 with "Reload latest".
- **Disable Cash App only**: removes the tag and any cash.app link or `$tag` label. Approved generic destinations stay live. If nothing else is approved, payments become unavailable.
- **Disable all payment links**: payers and emails show no destination.
- Every change writes an audit row in the same transaction; if the audit insert fails, the recipient change rolls back. History is append-only by application design: the API has no route that edits or deletes audit rows, and no code path updates them. This is not enforced by a database trigger, so direct database access (operators with SQL credentials) could still alter it; restrict DB credentials accordingly.

## What payers see
- Every read, every reunion response, and every confirmation email shows only the approved destination, resolved fresh on the server.
- Reunions that were never reviewed, are disabled, or hold invalid stored values show "Online payment is not configured".
- When a payer submits a Cash App payment, the client fetches `GET /api/reunions/{id}/payment-recipient` again and opens that link.
  - Opening Cash App never marks anything paid. Status stays pending until an organizer confirms it.
  - The payer's own `$cashtag` reference field stays editable. It only identifies who paid.
- Cash App submissions are rejected (409) when no approved tag exists.
- Any request that includes destination keys (`paymentHandle`, `paymentUrl`, `cashAppTag`) on reunion create/update or payment submissions is rejected.

## Rollout
1. Development schema changes have been applied. Publishing applies the managed production schema diff for `payment_recipients` and `payment_recipient_audit`; do not run a production migration script. The SQL file records the additive schema changes. Existing `reunions` payment columns are not changed.
2. Confirm `PAYMENT_OWNER_USER_ID` is set in each environment, then deploy.
3. Right after deploy, every existing reunion is **Needs review**: payers see "not configured" until the owner approves it. Plan the review before deploying, or soon after.
4. Sign in as the owner and open **Payment recipients** (top nav or the bottom nav "Payees").
   - Filter by "Needs review".
   - For each reunion, compare the legacy values shown for review. Confirm the destination with the treasurer through a separate channel.
   - Use "Copy into form" or type the values, then confirm.
   - Add an audit note describing how you verified it.
5. New reunions start as Needs review. Organizers see a read-only card telling them to contact the platform owner.

Rollback: redeploying the previous build leaves the new tables unused. Legacy columns were never modified.
