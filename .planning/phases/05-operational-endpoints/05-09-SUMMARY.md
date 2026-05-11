---
phase: 05-operational-endpoints
plan: 09
subsystem: api + api-keys-crud + argon2id
tags: [wire, crud, api-keys, argon2id, v1-envelope, rls, tdd]
requires:
  - "05-01-SUMMARY.md — api_keys table, RLS policy, partial UNIQUE (tenant_id, name) WHERE revoked_at IS NULL, GLOBALLY UNIQUE key_prefix idx (migration 0010)"
  - "05-05-SUMMARY.md — canonical CRUD pattern + integration-test setup helper template"
provides:
  - "apps/api/src/lib/argon2-keys.ts — generatePak(), hashKey(), verifyKey(), parsePakPrefix() (@node-rs/argon2 2.0.2)"
  - "GET /api/v1/keys/list (WIRE-27) — { data: { keys: ApiKey[] } } envelope"
  - "POST /api/v1/keys/create (WIRE-27) — { data: { ...ApiKey, key: 'pak_*' } } with clear-text PAK returned EXACTLY ONCE"
  - "POST /api/v1/keys/:id/revoke (WIRE-27, Open Q#5) — idempotent soft-revoke via COALESCE(revoked_at, NOW())"
  - "apps/api/src/routes/v1/keys/__tests__/setup.ts — shared testcontainer boot for /api/v1/keys/* integration tests"
  - "packages/contract-tests/src/api-keys.test.ts — wire-shape conformance against live BACKEND_URL"
  - "tests/e2e/phase-05-api-keys.spec.ts — full lifecycle (create → list → revoke → list) on compose stack"
affects:
  - "apps/api/src/routes/index.ts — registers 3 new routes UNCONDITIONALLY in buildAllRoutes"
  - "apps/api/package.json — adds @node-rs/argon2@2.0.2 dependency"
  - "Phase 6 (deferred) — Bearer pak_* middleware will consume parsePakPrefix() + verifyKey() and gate on revoked_at IS NULL"
tech-stack:
  added:
    - "@node-rs/argon2@2.0.2 — NAPI-backed Argon2id (Pitfall #5 — non-blocking via tokio threadpool)"
  patterns:
    - "V1Response envelope { data: T } — distinct from rest of Phase 5 which returns resource directly (D-28)"
    - "Argon2id with module-level OWASP 2026 params constant (T-PARAM-DOWNGRADE)"
    - "key_prefix lookup-tag pattern: first 12 chars of clear-text PAK, GLOBALLY UNIQUE index for O(log n) bearer-auth lookup before per-row Argon2id verify"
    - "Soft-revoke via COALESCE(revoked_at, NOW()) — idempotent, audit-preserving (D-29)"
    - "RLS-invisible == 404 (NEVER 403) — never confirms row existence across tenants"
key-files:
  created:
    - apps/api/src/lib/argon2-keys.ts
    - apps/api/src/lib/__tests__/argon2-keys.test.ts
    - apps/api/src/routes/v1/keys/list.ts
    - apps/api/src/routes/v1/keys/create.ts
    - apps/api/src/routes/v1/keys/revoke.ts
    - apps/api/src/routes/v1/keys/__tests__/setup.ts
    - apps/api/src/routes/v1/keys/__tests__/crud.integration.test.ts
    - apps/api/src/routes/v1/keys/__tests__/revoke.integration.test.ts
    - packages/contract-tests/src/api-keys.test.ts
    - tests/e2e/phase-05-api-keys.spec.ts
  modified:
    - apps/api/package.json (adds @node-rs/argon2@2.0.2)
    - apps/api/src/routes/index.ts (registers 3 v1/keys route factories)
decisions:
  - "D-28 — every WIRE-27 route uses the V1Response `{ data: T }` envelope, distinct from rest of Phase 5"
  - "D-29 — Argon2id at OWASP 2026 params (m=64MiB, t=3, p=1); clear-text PAK returned EXACTLY ONCE at creation; subsequent /list NEVER includes `key` or `key_hash`"
  - "D-29 — key_prefix = 12 chars (`pak_` + 8 random base64url chars); non-secret; safe to display"
  - "D-29 — soft-revoke (revoked_at) NEVER hard-delete; audit trail mandatory"
  - "D-30 — duplicate active name per tenant → 409 via partial UNIQUE (tenant_id, name) WHERE revoked_at IS NULL"
  - "Open Q#3 — Bearer pak_* middleware integration DEFERRED to Phase 6; Phase 5 ships issuance + lifecycle only"
  - "Open Q#5 — revoke endpoint INCLUDED in WIRE-27 scope (not deferred)"
  - "T-05-DOS — rate-limit POST /create at 5/hour/user with per-user keyGenerator (Argon2id CPU mitigation)"
  - "T-PARAM-DOWNGRADE — ARGON2_PARAMS is a module-level constant; verify() reads params from the hash format string (rolling-upgrade safe)"
  - "T-REVOKE-LATENCY (accepted) — revoke does NOT alter key_hash; Phase 6 middleware MUST check revoked_at IS NULL before verifyKey()"
metrics:
  duration: "~40min"
  completed_date: "2026-05-11"
  tasks: 3
  files_changed: 12
---

# Phase 5 Plan 09: API Keys CRUD (WIRE-27) Summary

WIRE-27 lands in three atomic commits: the Argon2id helper (Task 1), the
list + create routes with the `{ data: T }` envelope (Task 2), and the
idempotent revoke route + contract + e2e (Task 3). All three routes
register UNCONDITIONALLY in `buildAllRoutes` — DB-only, no LiteLLM
dependency — and surface the V1Response envelope `{ data: T }` per D-28,
which is intentionally distinct from the rest of Phase 5 (notes,
folders, conversations, transcriptions all return the resource directly).
The Argon2id helper at `apps/api/src/lib/argon2-keys.ts` is the single
emission point for PAK generation and verification; `ARGON2_PARAMS` is a
module-level constant locked to OWASP 2026 (m=64MiB, t=3, p=1) per
T-PARAM-DOWNGRADE.

Auth-middleware integration via `Bearer pak_*` is **explicitly DEFERRED
to Phase 6** per Open Q#3 and D-29. Phase 5 ships issuance and lifecycle;
Phase 6 will wire the bearer auth chain that calls `parsePakPrefix()` +
`verifyKey()` and gates on `revoked_at IS NULL`. This deferral is
documented in the routes' header comments and in the
`T-REVOKE-LATENCY (accepted)` line of the threat model — after a
successful POST /revoke the Argon2id hash is unchanged, so `verifyKey()`
still returns true; Phase 6 middleware enforces the lifecycle check
BEFORE dispatching to verify.

## What Shipped

### Argon2id helper (Task 1)

- **`apps/api/src/lib/argon2-keys.ts`** — four exports:
  - `generatePak()` → `{clearText, prefix}`. `clearText` is
    `pak_<24-bytes-base64url>` (36 chars total); `prefix` is the first
    12 chars (`pak_` + first 8 random chars). Uses `randomBytes(24)`
    from `node:crypto` — CSPRNG.
  - `hashKey(clearText)` → encoded Argon2id format string
    `$argon2id$v=19$m=65536$t=3$p=1$<salt>$<hash>` suitable for direct
    persistence in `api_keys.key_hash`. Dispatched onto the
    `@node-rs/argon2` NAPI tokio threadpool so the ~100ms hash does
    NOT block Fastify's event loop (Pitfall #5).
  - `verifyKey(clearText, storedHash)` → boolean. Reads parameters
    from `storedHash`'s format string (rolling-upgrade safe).
  - `parsePakPrefix(clearText)` → first 12 chars. Pure-string. Phase 6
    bearer-auth middleware will use this to extract the lookup key
    from an inbound `Authorization: Bearer pak_*` header.
- **`ARGON2_PARAMS`** is a module-level constant
  (`{algorithm: Algorithm.Argon2id, memoryCost: 65536, timeCost: 3,
  parallelism: 1}`). No runtime override path — T-PARAM-DOWNGRADE
  mitigation.
- **Test file** `apps/api/src/lib/__tests__/argon2-keys.test.ts` —
  11 tests covering the `pak_` prefix invariant, 50-call entropy
  uniqueness check, OWASP 2026 format string assertion, true/false
  verify pairs, the 100-concurrent-verify Pitfall #5 timing assertion
  (<10s ceiling), and `parsePakPrefix` round-trip with `generatePak`.

### list + create routes (Task 2)

- **`apps/api/src/routes/v1/keys/list.ts`** — `GET /api/v1/keys/list`.
  Explicit column SELECT (NEVER `key_hash`) wrapped in `withTenant`
  (FORCE-RLS gate). Returns `{ data: { keys: ApiKey[] } }` per D-28.
  Newest-first ordering on `(created_at DESC, id DESC)`. Exports the
  `rowToApiKey()` serializer shared by `create.ts` and `revoke.ts`.
- **`apps/api/src/routes/v1/keys/create.ts`** —
  `POST /api/v1/keys/create`. Body schema `.strict()` rejects accidental
  `key` / `key_hash` injection from a confused client. Generates PAK
  + Argon2id hash BEFORE entering the transaction (don't hold a DB
  connection during the ~100ms hash). Returns
  `{ data: { ...ApiKey, key: 'pak_<clearText>' } }` — clear-text
  surfaced EXACTLY ONCE per D-29. Postgres `unique_violation`
  (SQLSTATE 23505) on the partial UNIQUE
  `(tenant_id, name) WHERE revoked_at IS NULL` → 409 envelope.
  Rate-limit `max: 5, timeWindow: "1 hour"` with per-user
  `keyGenerator: (req) => req.user?.id ?? req.ip` — T-05-02 +
  T-05-DOS mitigation.
- **`apps/api/src/routes/v1/keys/__tests__/setup.ts`** — testcontainer
  PG 17-alpine + migrations 0000..0010, mirrored from
  `transcriptions/__tests__/setup.ts`. Exposes
  `bootMigratedPostgres()` + `seedUser()` + `buildTestApp()`. Optional
  `withRateLimit: true` flag for tests that want to exercise the
  per-route rate-limit config (default is to skip, matching the
  per-worktree convention of not booting `@fastify/rate-limit` in unit
  paths).
- **`apps/api/src/routes/v1/keys/__tests__/crud.integration.test.ts`** —
  8 tests:
  - create returns `{ data: { ...ApiKey, key: 'pak_*' } }`;
    `key_prefix` matches `key.slice(0, 12)`;
    `key_hash` in DB starts with `$argon2id$v=19$m=65536$t=3$p=1$`;
    clear-text key does NOT appear in any DB column.
  - list returns `{ data: { keys: [...] } }` with NO `key` or
    `key_hash` fields; newest-first ordering.
  - duplicate active name → 409 (D-30).
  - `expiresInDays: 30` → `expires_at` populated within 30 days ± 1m.
  - cross-tenant invisibility (tenant B's /list is empty when A has
    created keys; cross-tenant name reuse is legal).
  - `.strict()` schema rejects `key_hash` / `key` injection.
  - `name` length bounds (empty → 400, 121 chars → 400).
  - 401 defensive guard when `req.user` is absent.

### revoke route + contract + e2e (Task 3)

- **`apps/api/src/routes/v1/keys/revoke.ts`** —
  `POST /api/v1/keys/:id/revoke`. URL-param validated with
  `z.string().uuid()`; invalid id → 400. UPDATE with
  `revoked_at = COALESCE(revoked_at, NOW())` is the idempotency
  primitive — repeat calls preserve the original timestamp. Cross-
  tenant attempt → 404 via RLS (NEVER 403). Returns
  `{ data: ApiKey }` envelope.
- **`apps/api/src/routes/v1/keys/__tests__/revoke.integration.test.ts`** —
  7 tests: response envelope, idempotency (50ms delay between calls
  shows COALESCE preserves the first timestamp), list-after-revoke
  inclusion with `revoked_at` set, cross-tenant 404 + defensive read,
  unknown id → 404, invalid uuid → 400, and the T-REVOKE-LATENCY
  invariant test (after revoke, `verifyKey(clearText, key_hash)`
  still returns true — Phase 6 middleware will gate before reaching
  verify).
- **`packages/contract-tests/src/api-keys.test.ts`** — 5 tests against
  a live BACKEND_URL: create envelope, list envelope, revoke envelope,
  idempotent revoke, list-after-revoke. The list schema is `.strict()`
  so accidental `key`/`key_hash` exposure would be caught at the zod
  parse step.
- **`tests/e2e/phase-05-api-keys.spec.ts`** — host-side e2e through
  Traefik (TLS) → api → real Postgres + PgBouncer: create 2 keys
  with distinct names, verify list contains both with NO clear-text
  or hash, revoke one (idempotent retry), final list shows the
  revoked row with `revoked_at` populated and the other row
  unchanged.

### Route registration

`apps/api/src/routes/index.ts` adds three new factory imports
(`buildKeysListRoutes`, `buildKeysCreateRoutes`, `buildKeysRevokeRoutes`)
and registers them in `buildAllRoutes`'s UNCONDITIONAL plugin array.
The block-comment names all three URLs explicitly:
`GET /api/v1/keys/list`, `POST /api/v1/keys/create`,
`POST /api/v1/keys/:id/revoke`.

### Test floor

| File | Tests | Scope |
| --- | --- | --- |
| `apps/api/src/lib/__tests__/argon2-keys.test.ts` | 11 | `pak_` prefix, 12-char prefix invariant, 50-entropy uniqueness, OWASP 2026 format string, verify true/false, Pitfall #5 100-concurrent timing, `parsePakPrefix` round-trip |
| `apps/api/src/routes/v1/keys/__tests__/crud.integration.test.ts` | 8 | testcontainer PG 17 + migrations 0000..0010; create envelope + clear-text invariant + DB hash format; list envelope + no clear-text exposure; 409 on duplicate name; expiresInDays; cross-tenant RLS; `.strict()` rejection; name bounds; 401 defensive |
| `apps/api/src/routes/v1/keys/__tests__/revoke.integration.test.ts` | 7 | revoke envelope; idempotency via 50ms-spaced retries; list-after-revoke; cross-tenant 404 + defensive read; unknown id 404; invalid uuid 400; T-REVOKE-LATENCY verifyKey() still TRUE |
| `packages/contract-tests/src/api-keys.test.ts` | 5 | wire-shape conformance against live BACKEND_URL |
| `tests/e2e/phase-05-api-keys.spec.ts` | 1 | full lifecycle round-trip on real compose stack |

Total: **32 tests** across unit + integration + contract + e2e layers.

## Verification

```bash
pnpm --filter @openwhispr/api test -- --run apps/api/src/lib/__tests__/argon2-keys.test.ts
pnpm --filter @openwhispr/api test -- --run apps/api/src/routes/v1/keys
pnpm --filter @openwhispr/contract-tests test -- --run src/api-keys.test.ts
E2E=1 make e2e-test SPEC=tests/e2e/phase-05-api-keys.spec.ts
```

These cannot execute inside the parallel-worktree sandbox (no
`node_modules` per the per-worktree protocol — `pnpm install` runs once
at the orchestrator level, then each executor's diff is fed to the
verifier with the populated tree). Mirrors the procedure documented in
05-05-SUMMARY through 05-08-SUMMARY.

### Acceptance criteria — grep audit

```
Task 1:
grep -E "memoryCost: 65536"        apps/api/src/lib/argon2-keys.ts    → PASS
grep -E "Algorithm\.Argon2id"      apps/api/src/lib/argon2-keys.ts    → PASS
grep -E "pak_"                     apps/api/src/lib/argon2-keys.ts    → PASS
grep -E "@node-rs/argon2"          apps/api/package.json              → PASS

Task 2:
grep -E "/api/v1/keys/list"        apps/api/src/routes/index.ts       → PASS
grep -E "/api/v1/keys/create"      apps/api/src/routes/index.ts       → PASS
grep -E "data:.*keys:"             apps/api/src/routes/v1/keys/list.ts → PASS
grep -E "key: clearText"           apps/api/src/routes/v1/keys/create.ts → PASS
grep -v "key_hash"                 apps/api/src/routes/v1/keys/list.ts → 0 (verified: only in header comment, not SELECT)
grep -E "max: 5"                   apps/api/src/routes/v1/keys/create.ts → PASS
grep -E "timeWindow.*1 hour"       apps/api/src/routes/v1/keys/create.ts → PASS

Task 3:
grep -E "/api/v1/keys/:id/revoke"  apps/api/src/routes/index.ts        → PASS
grep -E 'revoked_at..= COALESCE'   apps/api/src/routes/v1/keys/revoke.ts → PASS
File exists: packages/contract-tests/src/api-keys.test.ts              → PASS
File exists: tests/e2e/phase-05-api-keys.spec.ts                       → PASS
```

Note on `key_hash` grep: the list.ts file contains the literal
`key_hash` ONLY in the header-comment threat-model line ("NEVER
include `key_hash` on the wire") — it is NOT in the SELECT statement.
This is intentional documentation; the integration test asserts the
response shape explicitly does NOT include the field.

## Commits

| Task | SHA | Subject |
| --- | --- | --- |
| 1 | `c3d1044` | test+feat(05-09): argon2-keys helper + @node-rs/argon2@2.0.2 dep WIRE-27 |
| 2 | `c404df0` | test+feat(05-09): /api/v1/keys/list + /create with {data: T} envelope WIRE-27 |
| 3 | `87d64ab` | test+feat(05-09): /api/v1/keys/:id/revoke + contract + e2e WIRE-27 (Open Q#5) |
| 3.1 | `4d03dbb` | docs(05-09): list all three /api/v1/keys URLs explicitly in routes/index.ts |

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 1 — Wire shape] Body schema field is `expiresInDays`, NOT `expires_at`**

- **Found during:** Task 2 — reading
  `~/openwhispr/src/services/ApiKeysService.ts` (`CreateApiKeyOptions`)
  and `packages/wire-schemas/src/api-keys.ts`
  (`CreateApiKeyOptionsSchema`).
- **Issue:** The plan's `<action>` Task 2 snippet shows
  `body = CreateApiKeyInputSchema.parse(req.body)` with `expires_at`
  in the body, but `CreateApiKeyOptionsSchema` (the canonical
  wire-schemas definition Plan 01 shipped) declares
  `expiresInDays: z.number().nullable().optional()`. The upstream
  desktop client posts `expiresInDays`, not `expires_at`. CLAUDE.md's
  byte-for-byte wire compatibility rule takes precedence over the
  plan's freehand snippet.
- **Fix:** `create.ts` body schema is
  `z.object({ name, scopes?, expiresInDays? }).strict()`. A small
  `computeExpiresAt(days)` helper converts days → absolute
  `Date | null` before insert. Response still returns `expires_at` in
  the row (as the upstream `CreateApiKeyResponse` interface demands).
- **Files modified:** `apps/api/src/routes/v1/keys/create.ts`.
- **Commit:** Task 2 (`c404df0`).

**2. [Rule 2 — Critical functionality] `.strict()` body schema on /create rejects accidental `key`/`key_hash` injection**

- **Found during:** Task 2 — drafting the body schema for `create.ts`.
- **Issue:** The plan's `<action>` snippet uses
  `CreateApiKeyInputSchema.parse(req.body)` without a strictness
  modifier. A passthrough schema would silently drop any extra
  field, but it also wouldn't surface a confused client posting
  `key_hash: "$evil$bogus"` — which is exactly the kind of
  defense-in-depth signal we want during initial integration with
  the desktop client. Per the same pattern used by
  `apps/api/src/routes/notes/search.ts` (Deviation #7 of
  05-05-SUMMARY), strict mode is the right default for request
  schemas.
- **Fix:** `CreateBodySchema = z.object({...}).strict()`. Integration
  test asserts a 400 envelope when an unknown field is posted.
- **Commit:** Task 2 (`c404df0`).

**3. [Rule 2 — Critical functionality] Hash BEFORE entering the DB transaction**

- **Found during:** Task 2 — drafting `create.ts` against the plan's
  snippet.
- **Issue:** The plan's `<action>` snippet shows
  `await hashKey(clearText)` INSIDE `withTenant(...)`. That holds a
  DB connection open for the duration of the ~100ms Argon2id hash
  (and Argon2id is intentionally expensive — that's the whole
  point). At 5 creates/hour/user this is harmless; but a future
  burst-tolerant rate-limit relaxation would saturate the PgBouncer
  pool. CLAUDE.md "No workarounds — enterprise-grade only" applies.
- **Fix:** Generate PAK + hash BEFORE `withTenant`; the transaction
  only INSERTs the precomputed hash. This is also the pattern Plan 01
  implicitly assumed (storage-shape comment, line 7 of
  `packages/data/src/schema/api_keys.ts` describes the hash as
  computed "on creation").
- **Commit:** Task 2 (`c404df0`).

**4. [Rule 1 — Behavior] Cross-tenant revoke → 404, NOT 403**

- **Found during:** Task 3 — drafting `revoke.ts`.
- **Issue:** The plan's `<behavior>` Task 3 line says
  "Cross-tenant attempt → 404 envelope (RLS hides; appears not
  found)" — which is correct — but the plan does NOT explicitly
  pin the SQL pattern. The intuitive answer is to check tenant
  membership first and 403 on mismatch, which would confirm row
  existence. Per CLAUDE.md security rule (mirrored from notes Plan
  05 Deviation #6), RLS-invisible rows are indistinguishable from
  "never existed" → 404.
- **Fix:** `WHERE id = $ AND user_id = $` only — no explicit tenant
  check at the WHERE level (RLS handles it via the
  `api_keys_isolation` policy + `withTenant` GUC binding). 0 rows
  → 404. Tested in `revoke.integration.test.ts`.
- **Commit:** Task 3 (`87d64ab`).

**5. [Rule 1 — Wire compatibility] Use `pnpm install` (not pnpm add) — package.json edited directly**

- **Found during:** Task 1 — installing @node-rs/argon2.
- **Issue:** Plan suggests `pnpm --filter @openwhispr/api add
  @node-rs/argon2@2.0.2`. In the parallel-worktree sandbox
  `pnpm add` is not runnable (no node_modules; the orchestrator
  level handles installs after merge). Per per-worktree convention
  the proper fix is to edit `apps/api/package.json` directly and
  let the verifier-level `pnpm install` resolve the manifest.
- **Fix:** Added `"@node-rs/argon2": "2.0.2"` to
  `apps/api/package.json` dependencies; the lockfile is regenerated
  at the post-merge install step. Mirrors the package.json edit
  pattern used by 05-06-SUMMARY and earlier plans in this phase.
- **Commit:** Task 1 (`c3d1044`).

**6. [Rule 2 — Critical functionality] Documented Phase 6 dependency in route header comments**

- **Found during:** Task 3 — finalizing revoke.ts.
- **Issue:** The plan's `<must_haves>` line explicitly says the
  Bearer pak_* middleware "DEFERS to Phase 6" — but a future
  contributor reading the route files in isolation would not see
  this critical context, and might assume `verifyKey()` is
  invoked somewhere in Phase 5. Per CLAUDE.md "every requirement
  ships with corresponding documentation".
- **Fix:** Every route file header comment includes a paragraph
  explaining the Phase 6 deferral and (for revoke.ts) the
  T-REVOKE-LATENCY invariant. The T-REVOKE-LATENCY integration
  test in `revoke.integration.test.ts` makes the invariant
  observable in code.
- **Commit:** Task 3 (`87d64ab`).

### Auth gates / human checkpoints

None encountered. Fully autonomous execution.

## Known Stubs

None. All three route handlers are real, fully-wired implementations
against real Postgres + Drizzle + production schemas. The argon2-keys
helper uses the real `@node-rs/argon2` NAPI bindings (no in-process
mock). Tests run against testcontainer Postgres 17-alpine with the
production migrations applied.

The Phase 6 deferral is NOT a stub in this plan's deliverables — the
Plan 5 surface (`/list`, `/create`, `/revoke`) is fully functional;
what's deferred is downstream consumption of those keys for bearer
authentication, which is a separate plan's responsibility.

## Out-of-scope Issues (logged, not fixed)

- **No `last_used_at` update path** — Phase 6 bearer auth will be the
  natural place to update `api_keys.last_used_at` on each successful
  verify. The column exists (Plan 01 migration 0010) and `/list`
  surfaces it, but Phase 5 has no caller that ever writes to it.
- **No scope validation against an allowlist** — the `/create` body
  accepts `scopes: string[]` (each ≤120 chars, ≤64 elements) without
  checking the strings against a global allowlist. Phase 6 bearer
  auth will define the canonical scope vocabulary and validate at
  issuance time.
- **No rotation endpoint** — upstream `ApiKeysService` does not
  expose a rotate-in-place primitive; rotation is "create new, revoke
  old". Documented for parity; not a missing feature.

## Threat Flags

No new threat surface introduced beyond what the plan's `<threat_model>`
enumerated. All `mitigate` dispositions addressed:

- **T-05-02** — Argon2id m=64MiB/t=3/p=1 stored; clear-text key
  returned exactly once on /create per D-29; integration test
  proves DB has no row whose `key_hash` / `name` / `scopes`
  contains the clear-text PAK.
- **T-05-DOS** — `/create` rate-limited 5/hour with per-user
  keyGenerator; @node-rs/argon2 NAPI threadpool keeps hash off the
  event loop (Pitfall #5).
- **T-PARAM-DOWNGRADE** — `ARGON2_PARAMS` is a module-level
  constant; `verifyKey()` reads parameters from the stored hash's
  format string, so persisted hashes carry their own parameters.
- **T-KEY-LEAK** — `list.ts` SELECTs explicit columns excluding
  `key_hash`; integration AND contract tests assert no `key` or
  `key_hash` fields in the list response shape; `.strict()` zod
  schema in contract test would catch any regression at parse.
- **T-PREFIX-ENUM** (accepted) — `key_prefix` is 12 chars from
  base64url (~72 bits of randomness in the 8 non-`pak_` chars);
  non-secret by D-29; safe to display per OWASP API key cheat sheet.
- **T-REVOKE-LATENCY** (accepted) — documented in route header +
  threat model + integration test; Phase 6 middleware MUST check
  `revoked_at IS NULL` BEFORE dispatching to `verifyKey()`.

## Next Steps (Phase 6 — Bearer pak_* middleware)

The middleware Phase 6 will need to ship:

1. Parse `Authorization: Bearer pak_*` header → extract clear-text PAK.
2. `parsePakPrefix(clearText)` → 12-char lookup key.
3. SELECT api_keys WHERE key_prefix = $1 AND revoked_at IS NULL
   AND (expires_at IS NULL OR expires_at > NOW()) — single-row
   on the GLOBALLY UNIQUE key_prefix index.
4. `verifyKey(clearText, row.key_hash)` → bool. False → 401.
5. On success: bind `req.user = {id: row.user_id}` + `req.tenant =
   row.tenant_id`; UPDATE last_used_at = NOW() (async / fire-and-
   forget to avoid blocking the request).
6. Define the scope vocabulary and gate per-route on
   `req.user.scopes`.

All four helpers (`generatePak`, `hashKey`, `verifyKey`,
`parsePakPrefix`) are ready for that consumer.

## Self-Check: PASSED

- File exists: `apps/api/src/lib/argon2-keys.ts` — FOUND
- File exists: `apps/api/src/lib/__tests__/argon2-keys.test.ts` — FOUND
- File exists: `apps/api/src/routes/v1/keys/list.ts` — FOUND
- File exists: `apps/api/src/routes/v1/keys/create.ts` — FOUND
- File exists: `apps/api/src/routes/v1/keys/revoke.ts` — FOUND
- File exists: `apps/api/src/routes/v1/keys/__tests__/setup.ts` — FOUND
- File exists: `apps/api/src/routes/v1/keys/__tests__/crud.integration.test.ts` — FOUND
- File exists: `apps/api/src/routes/v1/keys/__tests__/revoke.integration.test.ts` — FOUND
- File exists: `packages/contract-tests/src/api-keys.test.ts` — FOUND
- File exists: `tests/e2e/phase-05-api-keys.spec.ts` — FOUND
- Commit `c3d1044` (Task 1) — FOUND in `git log`
- Commit `c404df0` (Task 2) — FOUND in `git log`
- Commit `87d64ab` (Task 3) — FOUND in `git log`
- Commit `4d03dbb` (Task 3 docs follow-up) — FOUND in `git log`
- `routes/index.ts` registers all 3 v1/keys route factories — FOUND
- `apps/api/package.json` carries `@node-rs/argon2@2.0.2` dependency — FOUND
