---
name: FamJam managed member accounts
description: Rules for organizer-created "managed" users (no Clerk identity)
---

Organizers can register family members who can't self-register. This creates a **managed** users row: id `managed_<uuid>`, `isManaged=true`, shared synthetic contact email `<reunion-name-slug>@famjam.cg` (chosen by the user; may be shared by many rows — users.email is NOT unique).

Rules any future feature must respect:
- Managed users can never sign in (no Clerk identity). Never treat them as reachable by email or as login accounts.
- **Exclude `isManaged` users from any email-based account lookup** (e.g. registration transfer targets, co-organizer invites) — matching the shared synthetic email would orphan ownership onto an unauthenticatable account.
- **Why:** review caught transfer-by-email resolving to managed accounts; the fix filters `isManaged` at lookup.
- `AdminRegistration` requires `registrantIsManaged` — every endpoint returning that shape must join users.isManaged (list, payment update, cancel, managed create).
- Organizer-created registrations intentionally bypass the reunion's `registrationsOpen` switch.
