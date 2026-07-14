---
name: FamJam sponsorship & cancellation model
description: Fund balance formula, anonymity gating, cancellation resolutions, transfer kinds, and atomicity requirements for money routes.
---

# Sponsorship fund & cancellation model

- Fund balance = sum(sponsorship contributions) − sum(allocations where fundedFrom='fund'). "direct" allocations (individual sponsor) do NOT deduct from the pool.
- Fund balance/ledger is visible only to power_user organizers (owner/platform-admin bypass). Contributions are anonymous to regular members — never return fund data from member-facing endpoints; contribution POST returns only the contributor's own record.
- Cancellation lives in registrations.status ('active'|'cancelled') + cancellationResolution ('refunded'|'donated_to_fund'|'no_payment'); paymentStatus enum untouched. Paid cancellations require an organizer-chosen resolution; the donated amount is the computed fee total (computeTotal).
- Cancelled registrations are excluded from ALL aggregates (summary + every reports query) but still appear in organizer list & CSV export with a status column.
- Transfers: kind='registration' (reassign userId by target email — account must exist) or kind='payment' (move paid→pending/pending→paid between two active registrations in the same reunion). Allowed for owner of the registration or organizer with 'registration' role.

**Why atomicity matters:** code review found races — balance-check-then-insert could overspend the fund; two-step payment transfer could double-pay. All money mutations are wrapped in db.transaction; fund allocation takes `SELECT ... FOR UPDATE` on the reunion row to serialize balance checks; payment transfer re-checks guards inside the transaction and 409s on conflict.

**How to apply:** any new money-affecting route (refunds, fee changes, new contribution paths) must be a single transaction with in-transaction guard re-checks, and must keep the balance formula mirrored in buildSponsorshipFund and the frontend.
