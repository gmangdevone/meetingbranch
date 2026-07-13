---
name: Orval path+query param collision
description: Why an OpenAPI operation with both path and query params breaks the api-zod build in this repo.
---

# Orval path + query param naming collision

If a single OpenAPI operation declares BOTH path parameters AND query parameters, orval emits two
exports that share the same name `<OperationId>Params` — one zod const (path params) in
`lib/api-zod/src/generated/api.ts` and one TS type (query params) in `generated/types/`. The barrel
re-exports both, so `tsc --build` fails with TS2308 "already exported a member named ...Params".

**Why:** orval names the path-param validator `XParams` and the query-param TS type also `XParams`
(query zod is `XQueryParams`, but the type isn't suffixed). Only operations that have both kinds
collide; path-only or query-only operations are fine.

**How to apply:** don't mix path and query params on one operation. Either move filters/pagination to
the client (return the full list), or restructure the endpoint. Family-reunion-scale lists are small,
so returning everything and filtering client-side is the accepted tradeoff here.
