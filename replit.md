# FamJam – Lacey Family Reunion 2027

A mobile-first family reunion web app for the Lacey Family Reunion (July 16–19, 2027). Participants register, view the schedule, read announcements, and receive email confirmations with a Cash App payment link.

## Getting Started

### Set up the first admin

The admin dashboard is locked until at least one administrator exists. To claim it (no environment variables or SQL required):

1. Open the app and **sign in / create your account** as normal.
2. While signed in, visit **`/api/admin/setup`** in the same browser (e.g. `https://<your-app-domain>/api/admin/setup`).
3. You'll see a success message and the admin dashboard is now unlocked for your account.

This route is a one-time bootstrap: it promotes the first signed-in user to admin **only if no admin exists yet**. Once any admin exists, the route refuses (HTTP 409) and can no longer be used to gain access — add further admins from the admin dashboard's Users page instead.

> Advanced (optional): setting the `ADMIN_USER_ID` environment variable to a Clerk user ID still auto-promotes that user on their next request. The setup route above is the recommended, no-config path.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/famjam run dev` — run the FamJam web app (port 19634)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — rebuild lib declarations (run after changing lib/* schemas)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Clerk auth middleware
- Auth: Clerk (Replit-managed, auto-provisioned keys)
- DB: PostgreSQL + Drizzle ORM
- Email: Brevo (requires BREVO_API_KEY secret and BREVO_FROM_EMAIL env var)
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Frontend: React + Vite, TanStack Query, Wouter, shadcn/ui, Tailwind v4

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `lib/db/src/schema/` — Drizzle schema files (users, registrations, attendees, announcements, schedule_items)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/email.ts` — Brevo email confirmation builder
- `artifacts/api-server/src/middlewares/requireAuth.ts` — Clerk auth middleware
- `artifacts/famjam/src/pages/` — All frontend pages
- `lib/api-client-react/src/generated/` — Generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — Generated Zod schemas for server validation (do not edit)

## Architecture decisions

- Contract-first OpenAPI: all API types flow from `lib/api-spec/openapi.yaml` → codegen → frontend hooks + server Zod schemas
- Clerk is Replit-managed; keys are auto-provisioned. Never touch dashboard.clerk.com manually.
- Email sends are non-blocking fire-and-forget; the registration is saved even if email fails
- Admin flag (`is_admin`) on the users table gates the admin dashboard (Task #2)
- `generatedAlwaysAsIdentity()` primary keys are excluded from Drizzle insert schemas automatically; do not call `.omit({ id: true })` on those schemas
- Validation: `api-test` runs `pnpm --filter @workspace/api-server run test` on task completion. The user-removal integration test (`artifacts/api-server/src/routes/admin.remove-user.integration.test.ts`) exercises the real dev database and is gated by `describe.skipIf(!process.env.DATABASE_URL)` — in environments without a database it skips cleanly instead of failing

## Product

- **Home** – Live countdown to July 16, 2027, hero image, CTA to register
- **Register** – Sibling group dropdown (10 names), dynamic per-person attendee rows (name, shirt size, dietary restrictions), server-timestamped on submit
- **Dashboard** – User's registrations, summary stats
- **Schedule** – Full 3-day reunion schedule (Thu–Sat)
- **Announcements** – Family news, pinned items at top
- **FAQ** – Static Q&A accordion
- **Registration Detail** – Attendee list, $50/person fee calc, Cash App payment button

## User preferences

- Cash App handle: $goudycgp (https://cash.app/$goudycgp)
- Reunion fee: $50.00 per person
- Reunion dates: July 16–19, 2027
- Sibling names dropdown: John, Louise, Willie Mae, June, Frances, Edna, Loretta, Betty, Dorothy, Richard

## Gotchas

- After changing `lib/db/src/schema/`, run `pnpm run typecheck:libs` before typechecking artifact packages — stale lib declarations cause false TS2305 errors
- After changing `lib/api-spec/openapi.yaml`, always re-run codegen before touching generated files
- Clerk dev-key warning in console is normal in development — expected behavior, not a bug
- `BREVO_API_KEY` must be set as a secret and `BREVO_FROM_EMAIL` as an env var for confirmation emails to send; if missing, emails are skipped with a warning log but registrations still save
- The verified sender (`BREVO_FROM_EMAIL`) must be added in Brevo → Senders & IPs before emails will deliver
- First-run admin setup: visit `/api/admin/setup` while signed in — promotes the first user to admin, then permanently closes
