---
name: FamJam frontend gotchas
description: Non-obvious behaviors in the artifacts/famjam web app.
---

# FamJam web app gotchas

- **Toaster is not mounted.** The shadcn `useToast`/`toast` hooks exist under `src/hooks` and `src/components/ui/toaster.tsx`, but `<Toaster />` is not rendered anywhere in the app tree. Calling `toast(...)` is a silent no-op. Use inline UI state for user feedback, or mount `<Toaster />` first if you need toasts.

- **Admin access is inferred, not fetched as a flag.** There is no "am I admin" endpoint. `AdminGuard` calls an admin-only query (`useAdminGetReports`) and treats a 403/error as "not admin". Whether *any* admin exists at all is a separate public read (`/admin/setup-status`). After promoting a user, invalidate React Query caches so the guard re-evaluates.

**Why:** these are easy to trip over — you can wire up `toast()` and see nothing, or assume a user role flag exists on the client when it doesn't.

- **Reunion organizer permissions have two independent gates.** A co-organizer's `roles` (enum-array on `reunion_organizers`) gate *management areas*; owners are NOT rows in that table, so their full access is implicit (owner + platform admin bypass all role checks). Client-side nav/page gating relies on the `viewer` permission block, which is populated ONLY on `GET /reunions/:id` — not on `/reunions/mine` or admin list responses. Frontend must fall back to full access when `viewer` is missing so an owner is never locked out.

**Why:** wiring a new organize page or a role-aware UI without reading `viewer` from the detail endpoint (or assuming it's on `/mine`) silently breaks gating.

- **Frontend UI tests run under vitest + jsdom + React Testing Library** (config per artifact, e.g. `artifacts/famjam/vitest.config.ts`; run via that package's `test` script). Two gotchas that cost real time: (1) the mocked `useGetReunion` must return a **stable `data` object reference** across renders — pages with a `useEffect` keyed on the summary (e.g. form-reset effects) will infinite-loop → OOM if you build a fresh object each render. (2) jsdom lacks `ResizeObserver`/`matchMedia`, which some Radix primitives touch on mount — stub them in the test setup file or renders throw during layout effects. Also alias `@` → `src` in the vitest config, and exclude `*.test.tsx`/`src/test/**` from the app tsconfig so typecheck stays clean.

**Why:** these bit hard when adding the first component tests; without them the suite either hangs or fails on unrelated DOM APIs.
