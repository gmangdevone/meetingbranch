# Partial registration payments (receipt ledger)

Balance (exact cents, server-authoritative, `api-server/src/lib/ledger.ts`):
`balance = charge - sponsored - confirmed - legacyCredit` (0 when waived; never negative).
Money confirmed above the charge shows as `creditCents` for organizer review. No automatic refund.

- Tables: `payment_receipts` (payment | legacy_credit | transfer), `payment_receipt_allocations`
  (signed cents per registration fee or attached chip-in), and `payment_receipt_reversals`
  (append-only, with a required reason). Receipts are never edited or deleted.
- Pending reported submissions (`payment_submissions`) never reduce the balance.
  `POST /reunions/:id/receipts` with `submissionId` confirms one. Only one live receipt is allowed per submission.
- Duplicate protection: `idempotencyKey` is unique per reunion. Writes lock the reunion row, then the registration rows.
- Legacy data: rows marked paid before the ledger existed show a virtual opening credit of max(0, charge - sponsored).
  Before the first money/charge change, `ensureLedgerInitialized` freezes it into a labeled `legacy_credit` receipt.
  It has no method or date. Waived is kept as the organizer's decision.
- Schema-only publishing: migration 0029 is additive. No backfill is required, because initialization is lazy and
  reads are safe on uninitialized rows.
- PATCH payment status: "paid" is rejected (record a receipt instead). "waived" is allowed. "pending" is allowed
  unless the registration has confirmed money.
- Attached chip-ins reach the fund only through allocated cents. Standalone chip-ins stay all-or-nothing.
- Cancel: the refund/donation is the actual confirmed cents. Transfer: a transfer receipt with -X/+X;
  X defaults to min(source confirmed, target balance).
