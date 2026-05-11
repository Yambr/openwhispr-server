---
phase: 05-operational-endpoints
plan: 10
subsystem: contract-tests + docs
tags: [wire-29, wire-16, contract-01, negative-matrix, conventions, traceability]
dependency-graph:
  requires: [05-02, 05-03, 05-04, 05-05, 05-06, 05-07, 05-08, 05-09]
  provides:
    - "CONTRACT-01 negative matrix proving envelope passthrough invariant (WIRE-16) across the full Phase 2-5 surface (WIRE-29)"
    - "Pitfall #6 enumeration sanity test: future routes added without negative-matrix coverage fail CI loudly"
    - "docs/conventions.md — canonical CRUD conventions for future resource families"
    - "docs/wire-contract.md — v1 implemented + v2 deferred + known v1 limitations reference"
    - "REQUIREMENTS.md Phase 5 traceability (Plans 05-01..05-10) — WIRE-08..29 flipped Pending → Complete"
  affects:
    - "every new /api/* route added in Phase 6+: MUST update PHASE_5_ROUTES inventory or Pitfall #6 test fails"
    - "v2-deferred Stripe/referrals paths: matrix locks 404 + envelope behavior — implementing them must update OUT_OF_SCOPE_PATHS"
tech-stack:
  added: []
  patterns:
    - "Tolerant envelope matcher: z.union of {error:string} (D-34 default) and {error:{message,code?}} (BACKEND_SPEC.md:745 structured) — locks union as contract"
    - "Runtime route enumeration via /api/_test/route-list returning app.printRoutes({commonPrefix:false}) — gated by OPENWHISPR_TEST_ROUTES"
    - "Route inventory + tolerant matcher extracted to non-test module (negative-matrix.ts) for shared import between matrix test and enumeration test"
key-files:
  created:
    - packages/contract-tests/src/negative-matrix.ts
    - packages/contract-tests/src/negative-matrix.test.ts
    - packages/contract-tests/src/__tests__/negative-matrix-enumeration.test.ts
    - tests/e2e/phase-05-negative-matrix.spec.ts
    - docs/conventions.md
    - docs/wire-contract.md
  modified:
    - apps/api/src/routes/test-only.ts (added /api/_test/route-list seam)
    - .planning/REQUIREMENTS.md (WIRE-08..29 Pending → Complete + Phase 5 traceability section)
decisions:
  - "D-33 (locked in this plan): TolerantEnvelope = z.union of {error:string} + {error:{message,code?}} — matrix asserts union, not single shape"
  - "D-34 (carried): every Phase 5 endpoint emits {error:string} only; structured shape is permitted by union but not used"
  - "D-35 (carried): synthetic /api/nonexistent-{uuid} → 404 + envelope via Phase 2 setNotFoundHandler — asserted by matrix"
  - "D-36 (carried): 401 / 503 special-case behavior preserved — both fully envelope-conformant"
  - "Pitfall #6 mitigation: enumeration sanity test fetches runtime fastify printRoutes via /api/_test/route-list and asserts every /api/* route is covered by PHASE_5_ROUTES ∪ PHASE_2_4_BASELINE_ROUTES"
metrics:
  tasks_completed: 2
  files_created: 6
  files_modified: 2
  duration_minutes: 25
  completed_date: 2026-05-11
---

# Phase 5 Plan 10: CONTRACT-01 Negative Matrix + Phase Close Docs Summary

CONTRACT-01 negative matrix proving the envelope passthrough invariant
(WIRE-16) holds across the entire Phase 2-5 wire surface; Phase 5
phase-close docs (`docs/conventions.md`, `docs/wire-contract.md`) and
`REQUIREMENTS.md` traceability finalization.

## What Shipped

### Negative matrix (Task 1)

`packages/contract-tests/src/negative-matrix.test.ts` walks the full
Phase 5 route inventory and asserts envelope conformance on three
classes of failure:

1. **(a) No-auth** — every route, no `Authorization` header → `[400, 401, 405, 415]`
   status + body parses as `TolerantEnvelope`.
2. **(b) Authed malformed body** — every route with a JSON body,
   signed in as the fixture user, body = `{"__invalid_field__":true}`
   → `[400, 415, 422]` + envelope.
3. **Synthetic 404** — `/api/nonexistent-${randomUUID()}` → 404 +
   envelope (D-35 proof — Phase 2 `setNotFoundHandler` still active).
4. **Out-of-scope 404** — `/api/stripe/{checkout,portal,switch-plan,preview-switch}`
   and `/api/referrals/{stats,invite,invites}` all → 404 + envelope
   (CONTEXT.md v2-deferred surfaces; T-OUT-OF-SCOPE-LEAK mitigation).

The `TolerantEnvelope` matcher (extracted to
`packages/contract-tests/src/negative-matrix.ts`) is a `z.union` of
the two acceptable envelope shapes per D-33:

```ts
z.object({ error: z.string() })                                         // D-34 default
z.object({ error: z.object({ message: z.string(), code: z.string().optional() }) })  // BACKEND_SPEC.md:745
```

Phase 5 endpoints emit only the default `{error: string}`; the
structured shape is reserved for future structured-error sites and
the matrix locks the union as the contract for the whole surface.

### Pitfall #6 enumeration sanity (Task 1)

`packages/contract-tests/src/__tests__/negative-matrix-enumeration.test.ts`
mitigates the race between route registration and matrix inventory:

1. Fetches `GET /api/_test/route-list` (new — added in this plan).
2. The route-list endpoint returns
   `app.printRoutes({ commonPrefix: false })` as JSON.
3. The test parses the Fastify route tree and asserts every
   registered `/api/*` or `/v1/*` leaf appears in
   `PHASE_5_ROUTES ∪ PHASE_2_4_BASELINE_ROUTES`.
4. Path matching tolerates UUID-substituted `:param` segments and
   `/api/auth/*` wildcards.

The route-list endpoint is gated by the same
`OPENWHISPR_TEST_ROUTES=true` env flag as the rest of `/api/_test/*`
— production deployments always 404 it.

### E2E (Task 1)

`tests/e2e/phase-05-negative-matrix.spec.ts` runs a representative
negative case per WIRE-* requirement (WIRE-08, 09, 10, 11, 12, 22, 23,
24, 25, 26, 27, 16, 29) against the live compose stack via Traefik
HTTPS. Asserts the envelope invariant survives the TLS hop +
request-log pipeline.

### Conventions doc (Task 2)

`docs/conventions.md` documents the Phase 5-established CRUD
conventions for future resource families:

- Soft-delete (`deleted_at` + filter on every read path)
- Client-id idempotency (`client_<resource>_id` + partial unique index;
  duplicate create returns existing row at 200, NOT 409)
- Keyset pagination (`(created_at, id)` tuple; `limit ≤ 200`)
- Full-text search (`tsvector GENERATED STORED + GIN`; query path uses
  `websearch_to_tsquery('simple', $1)` ONLY — never `to_tsquery` or
  `plainto_tsquery`)
- Batch ops (500-item cap)
- Error envelope (`{error: string}` default; `{data: T}` ONLY for
  `/api/v1/keys/*` per D-28)
- RLS (`FORCE ROW LEVEL SECURITY` + `current_setting('app.tenant_id')`
  policy + property test)
- TDD + ≥ 90/90/90/90 coverage + e2e mandatory
- Argon2id OWASP 2026 params (m=64MiB, t=3, p=1)
- File layout

### Wire contract doc (Task 2)

`docs/wire-contract.md` documents:

- **v1 implemented**: every Phase 2-5 route, mapped to WIRE-IDs
- **v2 deferred**: Stripe + referrals 404 + envelope behavior locked
  in this plan's negative matrix
- **Known v1 limitations** (each with planned remediation phase):
  - `'simple'` tsvector — no en/ru morphological stemming (Pitfall #9)
  - `notes/delete-all` 1000-row inline cap (BullMQ async → Phase 6)
  - `Bearer pak_*` API key middleware deferred to Phase 6
  - 100-message-per-conversation cap on `?include=messages` (Open Q#2)
  - Yandex Search adapter — live reference pending vendor sandbox
  - Settings tables: READ-only in v1 (PUT/PATCH → Phase 7 UI)

### REQUIREMENTS.md traceability (Task 2)

WIRE-08, 09, 10, 11, 12, 16, 22, 23, 24, 25, 26, 27, 28, 29 all
flipped Pending → Complete. Appended Phase 5 traceability table
(`Plan(s)` + `Primary Artifacts` per requirement) and wave structure
in the established Phase 1 / Phase 2 format.

## Decisions Made

- **D-33** (locked here): `TolerantEnvelope = z.union([{error: string}, {error: {message, code?}}])` — the matrix asserts the union, locking both shapes as the contract for the whole surface.
- **Pitfall #6** mitigation strategy: runtime fastify route enumeration via a test-only HTTP endpoint (avoids the workspace dependency cycle that would arise from `@openwhispr/contract-tests` directly importing `@openwhispr/api`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Inventory + matcher extracted to non-test module**

- **Found during:** Task 1 implementation
- **Issue:** The plan's behavior block required both `negative-matrix.test.ts`
  AND `__tests__/negative-matrix-enumeration.test.ts` to reference the
  same `PHASE_5_ROUTES` inventory + `TolerantEnvelope` matcher.
  Re-declaring in each test would drift; importing a `.test.ts` from
  another `.test.ts` is fragile (vitest may discover it twice).
- **Fix:** Extracted constants (`PHASE_5_ROUTES`,
  `PHASE_2_4_BASELINE_ROUTES`, `OUT_OF_SCOPE_PATHS`, `TolerantEnvelope`)
  into `packages/contract-tests/src/negative-matrix.ts` (non-test
  module). Both test files import from it.
- **Files modified:** `packages/contract-tests/src/negative-matrix.ts` (new)
- **Commit:** `f20d9fd`

**2. [Rule 3 - Blocking] Added /api/_test/route-list endpoint for enumeration**

- **Found during:** Task 1 design
- **Issue:** The enumeration test (per plan AC) MUST grep
  `printRoutes|fastify\.routes` in
  `packages/contract-tests/src/__tests__/negative-matrix-enumeration.test.ts`.
  Calling `app.printRoutes()` requires constructing the Fastify app
  in-process — but `@openwhispr/contract-tests` does NOT depend on
  `@openwhispr/api` (apps/api depends on contract-tests; adding the
  reverse would create a workspace cycle).
- **Fix:** Added `GET /api/_test/route-list` to
  `apps/api/src/routes/test-only.ts` returning
  `app.printRoutes({ commonPrefix: false })` as JSON. Gated by the
  same `OPENWHISPR_TEST_ROUTES=true` env flag as the rest of
  `/api/_test/*`. The enumeration test fetches the endpoint via HTTP
  and parses the route tree.
- **Files modified:** `apps/api/src/routes/test-only.ts`
- **Commit:** `f20d9fd`

## Self-Check: PASSED

Files created (verified on disk):

- `packages/contract-tests/src/negative-matrix.ts` — FOUND
- `packages/contract-tests/src/negative-matrix.test.ts` — FOUND
- `packages/contract-tests/src/__tests__/negative-matrix-enumeration.test.ts` — FOUND
- `tests/e2e/phase-05-negative-matrix.spec.ts` — FOUND
- `docs/conventions.md` — FOUND
- `docs/wire-contract.md` — FOUND

Files modified:

- `apps/api/src/routes/test-only.ts` — FOUND (added route-list endpoint)
- `.planning/REQUIREMENTS.md` — FOUND (WIRE-08..29 flipped + Phase 5 table appended)

Commits:

- `f20d9fd` — `test(05-10): CONTRACT-01 negative matrix WIRE-29 + WIRE-16 envelope passthrough` — FOUND
- `b7b0f45` — `docs(05-10): conventions + wire-contract + REQUIREMENTS.md WIRE-08..29 traceability for Phase 5 close` — FOUND

AC grep verifications (Task 1):

- `z\.union` in `negative-matrix.test.ts` — 2 matches
- `/api/nonexistent-` in `negative-matrix.test.ts` — 3 matches
- `/api/stripe/checkout|/api/referrals/stats` in `negative-matrix.test.ts` — 2 matches
- `method:.*POST.*web-search` in `negative-matrix.test.ts` — 1 match
- `printRoutes|fastify\.routes` in `negative-matrix-enumeration.test.ts` — 5 matches

AC grep verifications (Task 2):

- `websearch_to_tsquery` in `docs/conventions.md` — 2 matches
- `client_<resource>_id|client_note_id` in `docs/conventions.md` — 8 matches
- `FORCE ROW LEVEL SECURITY` in `docs/conventions.md` — 2 matches
- `/api/stripe` in `docs/wire-contract.md` — 4 matches
- `WIRE-22.*Complete` in `.planning/REQUIREMENTS.md` — 2 matches
- `WIRE-29` in `.planning/REQUIREMENTS.md` — 3 matches
