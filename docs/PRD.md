# FamJam — Product Requirements Document

**Version:** 1.0  
**Last updated:** July 2026  
**Status:** Active development

---

## 1. Product Overview

### 1.1 Vision

FamJam is a web application that makes running a family reunion effortless — from first invite to last memory. Organizers create a hub, share a 7-character code, and let families self-register. The platform handles headcounts, fees & dues, schedules, announcements, sponsorship funds, check-in, and live voting so organizers can focus on the reunion itself, not spreadsheets.

### 1.2 Target Users

| Persona | Description |
|---|---|
| **Platform Admin** | The technical operator who provisions the platform, controls which emails can sign in, and grants or revokes admin status. |
| **Reunion Owner** | The family member who creates and fully controls a reunion — the primary organizer. |
| **Co-organizer** | A trusted family member delegated specific management areas by the owner. |
| **Family Member** | A registered attendee who uses the app to RSVP, pay, check the schedule, vote, and track the sponsorship fund. |

### 1.3 Core Value Propositions

- **Zero-friction registration** — family members enter a code, fill in attendee details, and they're done.
- **Transparent money tracking** — a ledger-based sponsorship fund makes it clear who contributed and who was helped.
- **Real-time coordination** — announcements, schedule, and live polls keep everyone aligned before and during the event.
- **Delegable management** — owners can give trusted co-organizers scoped access without handing over full control.

---

## 2. User Roles & Permissions

### 2.1 Platform Roles

| Role | How Granted | Scope |
|---|---|---|
| **Platform Admin** | `isAdmin` flag in `users` table set via Admin Area | Full platform access |
| **Reunion Owner** | Creates a reunion | Full control over that reunion |
| **Co-organizer** | Added by reunion owner with specific roles | Scoped to granted roles within one reunion |
| **Family Member** | Registers for a reunion | Read-only access to public reunion data + own registration |

### 2.2 Co-organizer Permission Areas

An owner may grant any combination of the following roles to a co-organizer:

| Role token | What it unlocks |
|---|---|
| `registration` | View, create (managed), export, update payment status, check in, cancel, transfer registrations |
| `announcements` | Create, edit, delete announcements |
| `schedule` | Create, edit, delete schedule items |
| `branches` | Create, edit, delete branch/family-tree entries |
| `reports` | View reporting dashboard |
| `power_user` | Edit reunion details, payment info, fees & dues, sponsorship allocations |

### 2.3 Ownership Transfer

A reunion owner may transfer full ownership to another registered user. The transfer is permanent and immediate. (The platform warns before executing.) Platform admins may bypass this from the Admin Area.

---

## 3. Feature Specifications

### 3.1 Platform Setup & Admin Area

**Admin Bootstrap**

The first time the platform runs, no admin exists. Any signed-in user may visit `/admin/setup` to claim the first admin seat. Once an admin exists, the endpoint is locked.

**Admin Area (`/admin`)**

- View all reunions with owner, dates, registration count, and join code
- View all registered users; grant or revoke platform-admin status
- Cannot remove admin from yourself (prevents total lockout)
- Remove a user account (cascades through all reunions and registrations)
- Edit platform settings:
  - `reunionCreationEnabled` — toggle whether non-admins can create new reunions
  - `signInsLocked` — lockdown mode; when on, only admins, organizers, and allowlisted tester emails may use the app
  - `testerEmails` — comma-separated allowlist for lockdown mode

**Mobile Access**

Admins see an Admin entry in the mobile bottom navigation bar (portrait orientation supported).

---

### 3.2 Reunion Creation & Management

**Creating a Reunion**

- Reunion creation may be restricted to admins via platform settings
- Required fields: name, start date, end date, payment handle (e.g. Venmo/Zelle), optional payment URL
- A unique 7-character alphanumeric join code is generated automatically
- Owner is automatically recorded; reunion appears on their Dashboard

**Reunion Settings (`power_user` only)**

- Edit name, dates, payment handle, payment URL
- Toggle `registrationsOpen` to open/close new registrations at any time

**Branches**

Family tree branches (e.g. "Smith side", "Jones side") are defined by the organizer. Registrations are tagged to exactly one branch.

**Fees & Dues (`power_user` only)**

Each fee has:
- `label` (e.g. "Registration Fee", "T-Shirt")
- `chargeType`: `per_person` or `flat` (per household)
- `isOptional`: mandatory or opt-in
- `amount` (whole dollars)
- Optional age tiering: attendees under `ageThreshold` are charged `amountUnderThreshold` instead

Multiple fees can coexist on a reunion.

---

### 3.3 Registration Flow (Family Member)

1. Family member visits the app and enters the 7-character join code
2. If `registrationsOpen` is false, a clear message is shown; registration is blocked
3. Registration form collects:
   - Branch affiliation
   - Per-attendee: name, shirt size (XS–3XL), dietary restrictions, age (optional)
   - Optional fee selections (mandatory fees are shown but pre-selected)
   - Optional sponsorship contribution (whole dollar amount, `> 0`)
4. A registration confirmation email is sent (via Resend/Brevo)
5. Registration appears on the member's Dashboard with payment instructions

**Payment**

Payment is handled entirely outside the app (Venmo, Zelle, etc.). The organizer marks payment status as `pending` → `paid` → `waived` within the app.

**Managed Registrations**

Organizers (`registration` role) can register family members who don't have accounts. These "managed" accounts use a synthetic email and `isManaged = true`; they cannot sign in independently.

**Registration Transfer**

A registered member may transfer their registration to another FamJam user (by email). The receiving user must already have a FamJam account.

**Cancellation**

Organizers can cancel a registration and choose a resolution:
- `refunded` — organizer handles the refund externally
- `donated_to_fund` — payment is moved to the sponsorship fund (a contribution record is created)
- `no_payment` — nothing was paid; nothing to do

**CSV Export**

Organizers can export all registrations as a CSV (name, branch, attendee count, shirt sizes, dietary restrictions, payment status, etc.).

---

### 3.4 Check-In

Organizers with `registration` permission check in attendees at the event:

- Per-attendee toggle (`checkedInAt` timestamp)
- Checking in any attendee in a household makes that household eligible to vote in polls
- Check-in data informs headcount and food/seating reports

---

### 3.5 Announcements

- Organizers (`announcements` role) create, edit, and delete announcements
- Each announcement has a `title`, rich `body`, and an optional `pinned` flag
- Pinned announcements sort to the top of the family-facing Announcements page
- All registered and unregistered visitors can read announcements (no auth required)

---

### 3.6 Schedule

- Organizers (`schedule` role) create, edit, and delete schedule items
- Each item has: `day` (free text), `startTime`, optional `endTime`, `title`, optional `description` and `location`, and a `sortOrder`
- Public-facing schedule page groups items by day

---

### 3.7 Sponsorship Fund

The fund is a double-entry ledger. All amounts are whole dollars.

**Contributions (money in)**

| Source | How it enters |
|---|---|
| `registration` | A family member adds a contribution amount at registration time |
| `direct` | An organizer manually records a standalone donation |
| `cancellation` | A cancelled registration's payment is donated to the fund |

**Fund balance** = `sum(contributions)` − `sum(allocations where fundedFrom = 'fund')`

**Allocations (money out)**

Organizers (`power_user` role) allocate from the fund to a specific registration (household):

- `fundedFrom = 'fund'` — draws from the shared pool (blocked if amount would exceed current balance)
- `fundedFrom = 'direct'` — records a direct, out-of-band sponsor covering a household (does not reduce the pool)
- Optional `sponsorName` and `note` fields for record-keeping

**Visibility**

- Contributor names and allocation details visible only to `power_user`-level organizers
- Family members see only the aggregate fund balance and fund goal (when set); individual contribution history is visible to the contributor themselves
- Family members can contribute directly from the app

---

### 3.8 Polls & Voting

**Creation (organizer)**

- Organizers create a poll with a question and at least 2 options
- `maxVotesPerMember` controls how many options each member may choose
- Organizers can add or remove options; removing requires ≥ 2 options to remain

**Poll Lifecycle**

| State | Meaning |
|---|---|
| Open + results hidden | Members can vote; no one sees counts |
| Open + live results | Members can vote; counts update live every 3 seconds |
| Open + revealed | Members can vote; counts visible after each vote |
| Closed | Votes frozen; results remain as set |

**Voting (family member)**

- Only members whose registration has at least one checked-in attendee may vote
- Members can change their vote while the poll is open
- Ballot is atomic; partial votes within the max are allowed

**Organizer View**

- Organizers see full voter names alongside counts at all times
- Results auto-refresh every 3 seconds (pauses when the tab is in the background)

**Visibility Controls (organizer)**

| Toggle | Effect |
|---|---|
| **Reveal results** | Family sees summarized counts (no voter names) |
| **Go live to family** | Counts stream live to the family page even before formal reveal |
| **Open/Close** | Opens or freezes voting |

---

### 3.9 Reports

Organizers with `reports` permission view aggregate statistics:
- Total registrations, attendees, cancellations
- Payment status breakdown
- Branch distribution
- Shirt size distribution
- Dietary restriction summary

---

### 3.10 Member Dashboard

Signed-in family members see:
- All their active and cancelled registrations across all reunions
- Payment status and instructions for each registration
- Link to the reunion hub for each registration

---

### 3.11 Reunion Hub (Member View)

A family member navigates to their reunion hub via the join code or Dashboard. The hub contains tabs for:
- **Announcements** — pinned first, then chronological
- **Schedule** — grouped by day
- **Family Vote** — open polls where they can participate
- **FAQ** — platform help content

---

### 3.12 Notifications & Email

- Registration confirmation email sent on successful self-registration (Resend/Brevo integration)
- Email template includes reunion name, attendee list, payment handle, and payment URL

---

## 4. Non-Functional Requirements

### 4.1 Security

- Authentication via Clerk (OAuth providers + email magic link); no passwords stored by the app
- Session tokens verified server-side on every request
- Admin endpoints protected by `requireAdmin` middleware
- Organizer endpoints protected by `requireManage` + `requireReunionPermission` middleware; all checks are server-side
- Poll vote endpoint uses a `FOR UPDATE` row lock to prevent race conditions
- Fund allocation validates balance atomically before inserting

### 4.2 Performance

- TanStack Query caches API responses client-side with appropriate stale times
- Organizer poll results auto-refetch every 3 s; member live results refetch conditionally only when `liveResults` is enabled on at least one visible poll
- Background tab polling is suspended (`refetchIntervalInBackground: false`)

### 4.3 Accessibility & Responsive Design

- Mobile-first responsive layout
- Separate desktop top nav (≥ `md`) and mobile bottom nav (< `md`)
- Admin link visible in both orientations on mobile (bottom nav) and desktop

### 4.4 Data Integrity

- Amounts validated to be positive integers (`> 0`)
- Fund allocation blocked server-side if amount exceeds current balance
- Poll options minimum of 2 enforced server-side
- Registration transfers validated: receiving user must exist and not already be registered for the same reunion

---

## 5. Out of Scope (Current Version)

- In-app payment processing (payments handled externally)
- Push notifications
- Photo gallery / media sharing
- Mobile native app
- Multi-language / i18n
- Offline support

---

## 6. Success Metrics

| Metric | Target |
|---|---|
| Registration completion rate | > 90% of families who start complete registration |
| Organizer satisfaction | Organizers can run a reunion without spreadsheets |
| Poll participation | > 70% of checked-in households vote when a poll is open |
| Sponsorship fund utilization | Allocated ≥ 80% of contributed funds by event close |

---

## 7. Glossary

| Term | Definition |
|---|---|
| **Reunion** | A managed family event with its own join code, dates, fees, and content |
| **Join code** | A unique 7-character alphanumeric string used to look up a reunion |
| **Registration** | A household's RSVP, covering one or more attendees |
| **Attendee** | An individual person within a registration |
| **Branch** | A family-tree sub-group (e.g. a surname line) defined by the organizer |
| **Managed account** | A FamJam account created by an organizer for a family member with no Clerk identity |
| **Sponsorship fund** | A shared pool of donated money used to help families cover registration costs |
| **Contribution** | Money added to the sponsorship fund |
| **Allocation** | Money drawn from the sponsorship fund and applied to a registration |
| **Power user** | Co-organizer role that grants access to financial and high-impact settings |
| **Lockdown mode** | Platform setting that restricts sign-ins to admins, organizers, and allowlisted testers |
