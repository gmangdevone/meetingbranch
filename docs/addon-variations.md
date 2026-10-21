# Add-on variations rollout

The add-on change is additive. Apply the six column additions in
`lib/db/migrations/0039_addon_variations.sql` before running the new API.
Development has these columns. Publishing must include the corresponding
schema changes; no production data changes have been run from this workspace.

Do not drop the old shirt-size, shirt-choice, or fee-classification columns.
They preserve history and provide compatibility for existing event data.

## Existing events

- Legacy shirt fees are presented as generic items with a Size option group.
- Existing actual purchases are mapped to their original fee price and saved
  size. A size without a purchased fee is only historical information.
- Before a catalog mutation, the API locks the reunion, freezes legacy payment
  credits and purchase snapshots, applies the change, and resynchronizes balances
  in one transaction. This makes the data transition safe without a separate
  production backfill.
- Generic purchases retain their labels, options, and integer-cent unit prices.
  An unchanged selection keeps its saved price; a changed selection uses the
  current catalog. Mandatory items are enforced on new submissions and explicit
  edits, not retroactively on reads.
- Deleting an add-on retires its catalog entry. It does not delete purchases.
- Existing add-ons cannot switch between attendee and household scope. Create a
  new item instead, so historical recipients and prices remain unambiguous.
- Registration pages opened before the update must be refreshed. The API rejects
  outdated shirt-control submissions without saving, rather than silently losing
  a purchase or ignoring a requested opt-out.

## Organizer setup

Under Fees & Dues, select **Add-on item**, enter any item name and base price,
choose attendee or household scope, and set optional or mandatory. Add named
option groups and values with dollar adjustments. For example, a $10 base item
can have S/M/L at +$0 and XL/2XL/3XL at +$3.

No merchandise behavior is inferred from a generic item's name. Dinner and
ordinary age-tier registration fees keep their existing separate rules.
