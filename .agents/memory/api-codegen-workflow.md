---
name: API codegen workflow
description: How the API contract, generated client, and zod schemas fit together in this monorepo.
---

# Adding or changing an API endpoint

The API surface is contract-first. To add/change an endpoint:

1. Edit the single OpenAPI spec at `lib/api-spec/openapi.yaml` (paths + component schemas).
2. Run `pnpm --filter @workspace/api-spec run codegen` (orval). This regenerates:
   - `lib/api-client-react` — React Query hooks + imperative fetch fns (e.g. `useGetAdminSetupStatus`, `adminSetup`), consumed by the web app as `@workspace/api-client-react`.
   - `lib/api-zod` — zod validators used by the Express server (`@workspace/api-zod`).
   Codegen also runs `typecheck:libs` at the end.
3. Implement the actual Express handler under `artifacts/api-server/src/routes/` and register it in `routes/index.ts`.

**Why:** hooks/validators are generated, not hand-written — hand-editing generated files is wiped on next codegen. A GET operation generates both a query hook AND a plain async fetch fn; use the fetch fn inside `useMutation` when the GET has a side effect (e.g. the first-run admin setup route).

**How to apply:** any time the client needs a new call or a response shape changes, start at the spec, not the generated files.

# Timestamp fields must declare `format: date-time`

Any `createdAt`/`*At` field in openapi.yaml declared as bare `type: string` generates `zod.string()`, and server-side response `.parse()` then throws 500 on Drizzle's Date objects. With `format: date-time`, orval emits `zod.coerce.date()` which accepts Dates.

**Why:** a bare-string poll `createdAt` broke poll creation in both dev and prod with "Expected string, received date".

**How to apply:** every timestamp property in the spec needs `format: date-time` (nullable ones too).
