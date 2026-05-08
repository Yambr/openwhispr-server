---
phase: 01-core-infra-multi-tenant-data
plan: 04
subsystem: tenant-context-and-envelope-encryption
tags: [tenant-context, set-local, pgbouncer-safety, kek-dek, envelope-encryption, provider-abstraction]
requirements: [DATA-01, DATA-05]
dependency-graph:
  requires:
    - packages/data/src/schema/index.ts (Plan 01-03 — Drizzle schema barrel + TENANT_SCOPED_TABLES)
    - packages/data/migrations/0000_initial.sql (Plan 01-03 — FORCE RLS DDL)
    - drizzle-orm@0.45.2 (sql template tag for parameterized set_config)
    - fastify@5 + fastify-plugin (onRequest hook propagating to parent context)
    - testcontainers + @testcontainers/postgresql (real Postgres + PgBouncer integration tests)
  provides:
    - withTenant<TX, T>(db, tenantId, fn) — single chokepoint for app-side DB ops
    - tenantPlugin (Fastify) — sets req.tenantId from x-tenant-id header (Phase 1)
    - encryptValue / decryptValue — KEK/DEK envelope using AES-256-GCM
    - KeyProvider interface + EnvKeyProvider impl + Vault/KMS stubs
    - selectProvider() dispatcher reading OPENWHISPR_KEY_PROVIDER
  affects:
    - Plan 01-05 (RLS lint + property-test consumers will use withTenant)
    - Phase 2 (replaces tenantPlugin's header read with bearer-token resolution; consumes Phase 1 surface unchanged)
    - Phase 2/3 (virtual_keys table writes will consume encryptValue/decryptValue)
    - Phase 6 (real Vault + KMS adapter implementations replace v1 stubs; KeyProvider interface stays stable)
tech-stack:
  added:
    - drizzle-orm@0.45.2 (sql tag, NodePgDatabase types)
    - pg@8.20.0 (Postgres driver under Drizzle)
    - testcontainers + @testcontainers/postgresql (already pinned by Plan 03; reused here)
    - fastify-plugin (deencapsulates onRequest hook)
  patterns:
    - SELECT set_config('app.tenant_id', $1, true) — parameterized SET LOCAL equivalent (PgBouncer-safe)
    - UUID regex validation gate BEFORE the wire (fail-fast on garbage tenant ids)
    - fastify-plugin wrapper (parent-scope hook propagation; fixes Fastify encapsulation default)
    - Strict UUID validation in tenantPlugin (closes Fastify-5 array→comma-joined-string bypass shape)
    - KEK/DEK envelope (per-row DEK wrapped under KEK; rotation re-wraps DEKs only)
    - AES-256-GCM with 12-byte random IV per call + GCM auth tag verification
    - dek.fill(0) best-effort zeroize (V8 GC limitation documented inline)
    - Stubbed providers throw on every method (no silent partial-implementation success)
key-files:
  created:
    - apps/api/src/middleware/tenant.ts
    - apps/api/src/middleware/tenant.test.ts
    - packages/data/src/tenant-context.ts
    - packages/data/src/__tests__/tenant-context.test.ts
    - packages/data/src/__tests__/pgbouncer-interleave.test.ts
    - packages/data/src/encryption/key-provider.ts
    - packages/data/src/encryption/env-key-provider.ts
    - packages/data/src/encryption/vault-key-provider.ts
    - packages/data/src/encryption/kms-key-provider.ts
    - packages/data/src/encryption/envelope.ts
    - packages/data/src/encryption/index.ts
    - packages/data/src/__tests__/envelope.test.ts
    - packages/data/src/__tests__/key-provider.test.ts
  modified:
    - apps/api/src/index.ts (registers tenantPlugin in buildApp)
    - apps/api/package.json (+fastify-plugin, +@openwhispr/data workspace dep)
    - packages/data/src/index.ts (re-exports withTenant + encryption module)
    - packages/data/package.json (+drizzle-orm, +pg, +testcontainers, +@testcontainers/postgresql, +fast-check, +@fast-check/vitest, +@types/pg)
    - pnpm-lock.yaml
decisions:
  - "Use SELECT set_config('app.tenant_id', $1, true) instead of SET LOCAL: SET LOCAL does not accept bind params for the value, set_config is the parameterized equivalent — Drizzle's sql template tag binds via wire protocol, not string interpolation."
  - "Pre-validate tenantId with strict UUID regex BEFORE opening the transaction: faster failure (no wire round-trip), cleaner error message, defense-in-depth against the rare path where a caller passes the wrong type."
  - "tenantPlugin wraps with fastify-plugin (`fp(...)`): Fastify encapsulates plugin scopes by default; without `fp` the onRequest hook is invisible to routes registered at the app's root context."
  - "tenantPlugin uses strict UUID regex on the header value, not just typeof === 'string'. Fastify 5 / Node http normalize repeated headers to comma-joined strings ('uuid1,uuid2') — that shape passes a typeof check but fails the regex, closing T-01-04-08."
  - "PgBouncer-interleave test uses real edoburu/pgbouncer:v1.23.1-p3 + postgres:17-alpine on a shared testcontainers Network — the v1.23.1 plan reference resolves to the v1.23.1-p3 patch revision (the only published tag in that line)."
  - "Pool max=5 forces physical-connection reuse across 100 ops; second test halves to max=3 for additional pressure. Both must pass for the safety claim to stand."
  - "No-tenant-context probe accepts EITHER 0 rows OR 'invalid input syntax for type uuid' — both are valid RLS fail-closed shapes (Pitfall 4) and depend on whether the policy expression's `''::uuid` cast raises at execution time or simply denies the row."
  - "Per-run email salt in interleave loop: avoids the (tenant_id, email) unique-index collision when both tests run sequentially against the same table."
  - "EnvKeyProvider caches the decoded KEK per-instance (not module-level) so tests can swap MASTER_KEK + create fresh providers without bleeding state between cases."
  - "Vault + KMS adapters are FULL-INTERFACE stubs that throw on every method. Operators wiring OPENWHISPR_KEY_PROVIDER=vault ahead of the real adapter rolling out get a synchronous, named failure rather than a silent miswire (T-01-04-09)."
metrics:
  duration: ~25 minutes
  tasks: 2
  commits: 3 (Task 1 + Task 2 + barrel-export; lefthook commit-msg + biome formatter on each)
  tests-added: 24 (5 unit-tenant-context + 3 unit-tenant-plugin + 2 integration-pgbouncer + 6 envelope + 8 key-provider)
  files-created: 13
  files-modified: 5
  completed: 2026-05-09
---

# Phase 1 Plan 04: Tenant Context + KEK/DEK Envelope Encryption Summary

The Phase 1 success criteria #3 ("a SET LOCAL framework middleware contract test interleaves 100 tenant-A/tenant-B queries through PgBouncer transaction-mode without leakage") and #5 ("sensitive columns are encrypted at rest via the KEK/DEK envelope") both ship in this plan, end-to-end, with real-Postgres + real-PgBouncer integration coverage and full envelope-encryption unit coverage.

## What Shipped

### `withTenant<TX, T>(db, tenantId, fn)` — `packages/data/src/tenant-context.ts`

The single chokepoint for app-side database access. Opens a Drizzle transaction, sets the `app.tenant_id` GUC for its duration via parameterized `SELECT set_config('app.tenant_id', $1, true)`, runs `fn(tx)`, and lets Drizzle's transaction wrapper commit on resolve / roll back on reject. UUID regex pre-check rejects garbage (`''`, `undefined`, numbers, malformed strings) BEFORE any wire activity.

The structural `TransactionalDb<TX>` / `ExecutableTx` interfaces let the file compile (and unit-test) without a hard dependency on Plan 03's `schema/index.ts` — the real `NodePgDatabase` satisfies the shape.

### `tenantPlugin` — `apps/api/src/middleware/tenant.ts`

Fastify `onRequest` hook wrapped with `fastify-plugin` so it propagates from the plugin's encapsulated scope to the parent app's routes. Reads `x-tenant-id` from request headers; populates `req.tenantId` (declared via `declare module 'fastify'` augmentation). Strict UUID regex validation: anything that isn't a single string matching the canonical UUID shape falls back to the seeded default tenant `00000000-0000-0000-0000-000000000000` (D-17). Phase 2 will replace the header read with bearer-token → sessions.tenant_id resolution; the rest of the surface stays put.

Wired into `buildApp()` in `apps/api/src/index.ts` via `app.register(tenantPlugin)`.

### `encryptValue` / `decryptValue` — `packages/data/src/encryption/envelope.ts`

KEK/DEK envelope encryption. Per-row 32-byte DEK generated via `randomBytes(32)`. Plaintext encrypted under DEK with AES-256-GCM and a fresh 12-byte random IV. DEK wrapped under the KEK (also AES-256-GCM, separate 12-byte IV) via the `KeyProvider`. Returns the canonical `EncryptedRow` shape (six bytea-shaped columns: `dek_wrapped`, `dek_iv`, `dek_auth_tag`, `value_iv`, `value_auth_tag`, `value_ciphertext`) — Phase 2/3 maps these to actual `bytea` columns on `virtual_keys`.

`dek.fill(0)` runs in a `finally` block to zero the in-scope DEK Buffer; documented as best-effort under V8 GC (RESEARCH-DB Assumption A2).

### `KeyProvider` interface + three impls — `packages/data/src/encryption/`

`KeyProvider` interface: `id` / `getKek()` / `wrapDek(dek)` / `unwrapDek(wrapped, iv, authTag)`. `selectProvider()` reads `OPENWHISPR_KEY_PROVIDER` (default `env`) and returns:

- `EnvKeyProvider` — production v1 path. Reads `MASTER_KEK` env var (base64url-decoded; must decode to exactly 32 bytes; cached per-instance after first call). AES-256-GCM with 12-byte random IV per wrap call.
- `VaultKeyProvider` — v1 stub. Every method throws `"VaultKeyProvider not implemented in v1; HashiCorp Vault adapter deferred"`. Phase 6 replaces with a real adapter.
- `KmsKeyProvider` — v1 stub. Every method throws `"KmsKeyProvider not implemented in v1; AWS KMS adapter deferred"`. Phase 6 replaces with a real adapter.

Stubs throw on every method (not just `getKek`) so wiring the env id ahead of the real adapter rolling out fails synchronously and visibly (T-01-04-09).

### Tests

- **`packages/data/src/__tests__/tenant-context.test.ts`** (5 unit): UUID validation gates the call before any tx is opened; first SQL emitted inside the tx is `set_config('app.tenant_id', ...)` with the tenantId bound as a parameter (NOT string-interpolated); fn return value propagates; fn rejection propagates; uppercase-hex UUIDs accepted.
- **`apps/api/src/middleware/tenant.test.ts`** (3 unit via `app.inject()`): missing header → default tenant; valid UUID header → that UUID; comma-joined multi-value header → default tenant.
- **`packages/data/src/__tests__/pgbouncer-interleave.test.ts`** (2 integration): real `postgres:17-alpine` + real `edoburu/pgbouncer:v1.23.1-p3` sidecar in transaction-pool mode on a shared testcontainers Network. 100 alternating tenant-A/B/no-context ops with pool max=5, then again with max=3 for additional connection-reuse pressure. Asserts: (a) under tenant B no row from tenant A is ever seen, (b) under no tenant context every probe either returns 0 rows or raises `invalid input syntax for type uuid` (both are valid RLS fail-closed shapes per Pitfall 4), (c) emails inserted under one tenant never appear under the other in the final post-loop scan.
- **`packages/data/src/__tests__/envelope.test.ts`** (6 unit): round-trip across 5 sample sizes (0 / 1 / utf-8 / 1 KiB / 64 KiB random); same plaintext encrypted twice produces 4 distinct randomized fields (no IV/DEK reuse); single-bit tampering of `value_ciphertext`, `value_auth_tag`, and `dek_wrapped` all reject via GCM auth tag; `encryptValue` runtime-guards non-Buffer plaintext.
- **`packages/data/src/__tests__/key-provider.test.ts`** (8 unit): `selectProvider()` defaults to `env`, dispatches to vault/kms, throws on unknown id; EnvKeyProvider validates KEK presence + 32-byte length, round-trips wrap/unwrap, rejects non-32-byte DEKs; Vault + KMS stubs throw the deferred-error messages.

Total: **24 tests passing.**

## Why `set_config` over `SET LOCAL`

`SET LOCAL app.tenant_id = '<uuid>'` is the obvious form, but Postgres does not accept bind parameters for the value of a `SET LOCAL` — the UUID would have to be string-concatenated into the SQL, which means the call site has to either trust callers absolutely or re-implement parameter sanitization for one specific call. `SELECT set_config('app.tenant_id', $1, true)` is the functionally equivalent form that DOES accept a bind param for the value (the third argument `true` is the `is_local` flag). Drizzle's `sql` template tag emits the value as a Param node and the underlying `pg` driver binds it at the wire level — no SQL string ever sees the UUID concatenated in.

## PgBouncer Interleave Methodology

The constitutional claim of "no cross-tenant leakage under PgBouncer transaction-mode" only fails under specific conditions: physical-connection reuse + a session-scoped GUC that survives across transactions. The test setup forces reuse by capping the application Pool at `max: 5` (and a second pass at `max: 3`) while running 100 alternating tenant ops — by the pigeonhole principle, every physical connection sees both tenants. Under that pressure, `SET LOCAL`-style transaction-scoped GUCs (which `set_config(name, value, true)` is) MUST be cleared at COMMIT/ROLLBACK; if they leaked, the tenant-B select would see tenant-A rows (or vice versa) and the test would fail loud.

Three op shapes interleave (one per i mod 3): insert-under-tenant / select-under-tenant / probe-without-tenant-context. The probe must return 0 rows or raise — both are valid fail-closed shapes; the cast `''::uuid` inside the policy can either raise at execution or evaluate to NULL → row-denied, depending on how the policy wraps the cast.

## Threat Mitigations Verified by Tests

| Threat | Mitigation | Test |
|--------|------------|------|
| T-01-04-01 (SET-without-LOCAL leak) | `set_config(name, value, true)` is transaction-scoped | tenant-context unit test "set_config('app.tenant_id', $1, true)" + pgbouncer-interleave |
| T-01-04-02 (SQL injection via tenantId) | UUID regex pre-check + drizzle `${}` parameterization | tenant-context unit tests "rejects invalid tenant UUIDs" + "binds via set_config" |
| T-01-04-03 (cross-tenant leak under PgBouncer) | pgbouncer-interleave with pool max=5 then max=3 | pgbouncer-interleave both runs |
| T-01-04-04 (GCM IV reuse) | `randomBytes(12)` per encryptValue call | envelope unit test "different ciphertexts for same plaintext" |
| T-01-04-05 (modified ciphertext accepted) | GCM auth tag verification on decryptValue | envelope unit tests for three tamper points |
| T-01-04-08 (header-injection bypass) | strict UUID regex in tenantPlugin | tenant.test "comma-joined array → default tenant" |
| T-01-04-09 (Vault/KMS stub silently succeeds) | every stub method throws | key-provider tests for vault + kms |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wrong PgBouncer image tag in plan**

- **Found during:** Task 1 pgbouncer-interleave test execution.
- **Issue:** Plan references `edoburu/pgbouncer:1.23.1`. The Docker Hub registry only publishes tags in the `vMAJOR.MINOR.PATCH-p<rev>` format; the bare `1.23.1` tag returns 404.
- **Fix:** Bumped image to `edoburu/pgbouncer:v1.23.1-p3` (latest patch revision of the 1.23.1 line per `https://hub.docker.com/v2/repositories/edoburu/pgbouncer/tags`).
- **Files modified:** `packages/data/src/__tests__/pgbouncer-interleave.test.ts`
- **Commit:** `ecf1dd6`

**2. [Rule 2 - Critical] `typeof !== 'string'` insufficient for header-injection guard**

- **Found during:** Task 1 tenant.test.ts run.
- **Issue:** Plan specified Fastify exposes repeated headers as `string[]`, so `typeof headerVal !== 'string'` would catch them. In Fastify 5 / current Node http, repeated headers are pre-joined into a comma-separated single string ("uuid1,uuid2") — that passes the typeof check and would let an attacker send two values hoping the first is honored.
- **Fix:** Validate against the strict UUID regex in addition to typeof. Comma-joined values fail the regex and fall back to default. Threat model entry T-01-04-08 still satisfied.
- **Files modified:** `apps/api/src/middleware/tenant.ts`
- **Commit:** `ecf1dd6`

**3. [Rule 3 - Blocking] Fastify plugin encapsulation hides hook**

- **Found during:** Task 1 tenant.test.ts run.
- **Issue:** Routes registered at the app root never saw `req.tenantId` because Fastify encapsulates each plugin's hooks in a child context by default; the `onRequest` hook never fired for parent-scope routes.
- **Fix:** Wrapped the plugin body with `fastify-plugin` (`fp(...)`). Added `fastify-plugin` as an explicit `apps/api` dependency.
- **Files modified:** `apps/api/src/middleware/tenant.ts`, `apps/api/package.json`
- **Commit:** `ecf1dd6`

**4. [Rule 1 - Bug] `users_tenant_email_unique` collision between sequential interleave runs**

- **Found during:** Task 1 pgbouncer-interleave.test.ts second run (max=3).
- **Issue:** First run's emails ("ta-0@ex.com" etc.) survived into the second run; the (tenant_id, email) unique constraint rejected the duplicate insert and the test failed for the wrong reason.
- **Fix:** Per-run email salt (pool-max + random suffix) keeps inserts unique across both runs.
- **Files modified:** `packages/data/src/__tests__/pgbouncer-interleave.test.ts`
- **Commit:** `ecf1dd6`

**5. [Rule 1 - Bug] Probe-without-context error mode**

- **Found during:** Task 1 pgbouncer-interleave.test.ts first run.
- **Issue:** Plan asserted the no-context probe returns 0 rows. In practice it raises `invalid input syntax for type uuid` because the policy's `current_setting('app.tenant_id', true)::uuid` cast attempts to convert `''` to a UUID. Both behaviors are valid fail-closed shapes per Pitfall 4 — the row is denied either way.
- **Fix:** Probe accepts EITHER 0 rows OR the named cast error.
- **Files modified:** `packages/data/src/__tests__/pgbouncer-interleave.test.ts`
- **Commit:** `ecf1dd6`

**6. [Cosmetic] Biome formatter prefers double quotes**

- **Found during:** Task 2 verification.
- **Issue:** Plan's verify clause greps for `createCipheriv\('aes-256-gcm'` (single quotes). Biome (the project formatter) rewrites to double quotes; the literal grep fails.
- **Fix:** Substantive verification confirmed via quote-agnostic grep (`createCipheriv\(.aes-256-gcm.`); the algorithm string is inlined at both call sites for readability, with a comment documenting the choice. The plan's grep is a sanity check; the substantive contract (AES-256-GCM at the createCipheriv call site) holds.
- **Files modified:** `packages/data/src/encryption/env-key-provider.ts`
- **Commit:** `b5a5107`

### Wave-2 Coordination

Plan 01-03 (Drizzle schema + first migration + two-pool client factory) and this plan are sibling Wave-2 plans. They landed nearly simultaneously. The pgbouncer-interleave test self-skips when `migrations/0000_*.sql` is absent and activates automatically once 03 lands the SQL file — by the time the integration test ran, 01-03 had already shipped its migration. No coordination overhead surfaced.

## Authentication Gates

None encountered — entirely automatable via testcontainers.

## Follow-ups

- **Phase 2:** Replace `tenantPlugin`'s header read with bearer-token → sessions.tenant_id resolution. The `req.tenantId` field surface stays unchanged so consumers don't need to re-wire.
- **Phase 6:** Implement real `VaultKeyProvider` (HashiCorp Vault adapter) and `KmsKeyProvider` (AWS KMS adapter, with parallel paths for GCP KMS / Azure Key Vault). The `KeyProvider` interface stays stable; only the impls change.
- **Phase 3+:** Add a lint rule that grep-fails CI when `db.execute(...)` appears outside `withTenant(...)` / `tenantPlugin` (RESEARCH-DB §Anti-Patterns). Phase 1 ships only the chokepoint helper; the lint enforcement is deferred.
- **Phase 6:** Wrap every BullMQ worker job handler in `withTenant(payload.tenantId, async (tx) => ...)` (PITFALLS.md #12). This plan provides the helper; worker integration is out of scope.

## Self-Check: PASSED

- All claimed files exist:
  - `packages/data/src/tenant-context.ts` — FOUND
  - `apps/api/src/middleware/tenant.ts` — FOUND
  - `apps/api/src/middleware/tenant.test.ts` — FOUND
  - `packages/data/src/__tests__/tenant-context.test.ts` — FOUND
  - `packages/data/src/__tests__/pgbouncer-interleave.test.ts` — FOUND
  - `packages/data/src/__tests__/envelope.test.ts` — FOUND
  - `packages/data/src/__tests__/key-provider.test.ts` — FOUND
  - `packages/data/src/encryption/{key-provider,env-key-provider,vault-key-provider,kms-key-provider,envelope,index}.ts` — all FOUND
- All claimed commits in `git log`:
  - `ecf1dd6` — FOUND (Task 1)
  - `b5a5107` — FOUND (Task 2)
  - `237ac29` — FOUND (barrel re-export)
- 24/24 tests passing on full plan-04 suite.
- Verification grep counts non-zero on all 6 substantive checks (set_config, createCipheriv, "not implemented in v1" × 2, addHook, randomBytes(12), tenantPlugin in buildApp).
