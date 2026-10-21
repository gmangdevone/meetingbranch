# Personal registration views

Apply the additive `lib/db/migrations/20261021_registration_view.sql` migration
before serving the new API. It adds one nullable JSON field to users; existing
accounts use the default view without a data backfill. Development has been
migrated. No production data was changed.

Preferences are account-owned and independent of names, roles, registrations,
and payment records. The authenticated identity determines ownership; clients
cannot send another user's ID. Changing a view never grants access.

Default visible fields are Date, Balance, and Payment, alongside the always-visible
Registrant and registration menu. An empty custom field list is valid. Unknown
fields are rejected on writes; malformed stored data returns the default with an
explicit notice flag instead of silently claiming the saved view was loaded.
