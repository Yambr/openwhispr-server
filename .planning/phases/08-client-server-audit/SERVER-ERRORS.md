# Server-Side Errors Ledger

**Append-only.** Production-side errors / constraints surfaced by test-debt phases but NOT fixed in those phases per CLAUDE.md Conventions Hard Rule #1 ("NEVER edit production server code to make tests pass"). Future targeted production-fix phase reads this file + user-approved scope.

Each entry: surfacing phase + file:line + production code symptom + test infra workaround + suggested production fix.

---

## Entry 1 — Migration SQL hardcodes "public" schema in FK refs (Phase 18.1.2-03)

**Surfacing phase:** Phase 18.1.2 / Plan 03 (test isolation HALT W-2).

**File:** `packages/data/migrations/0000_*.sql` (and likely 0001..0017 FK refs).

**Production symptom:** FK constraints use explicit `REFERENCES "public"."tenants"`, `REFERENCES "public"."users"`, etc. Test infrastructure cannot relocate FK-pointed tables to a per-test schema via `search_path` because the explicit `"public".` prefix bypasses `search_path` resolution.

**Test workaround (Phase 18.1.2-03 Option A):** All integration tests share `public` schema; per-file logical isolation via `TRUNCATE` in `beforeEach` + unique user emails. Drizzle `_meta.__drizzle_migrations` detects already-applied migrations → 2nd file's `migrate()` is no-op.

**Suggested production fix (deferred to future phase):** Make migrations schema-aware:
- Option (i): Strip `"public".` prefixes from all FK refs in migrations 0000..0017. Re-stamp `_journal.json` hashes. Confirm RLS context still works.
- Option (ii): Add `SCHEMA` env knob (e.g., `OPENWHISPR_DB_SCHEMA` defaulting to `public`) that migrations honor via parameterized SQL. More invasive but multi-tenant-friendly.

**Owner:** unassigned. Lives in deferred-items.md §W-2-bis + here.

## Status: CLOSED-WITH-PARTIAL-DEBT 2026-05-15 (Phase 19)

**Closing commit:** `d45291d` (fix(19-03-01): strip "public." FK prefixes — SR-19.1 Option a)

Option (a) executed: 8 FK prefix sites stripped from 0000_initial.sql + 0014_audit_log_partition[.down].sql. 3 partman registry literals exempt (NOT FK refs). W-2 atomic-revert of `tests/support/shared-pg.ts` NOT executed because the file was BORN at commit `15c24c9` with the shared-public + TRUNCATE pattern — no prior per-file state exists to revert to. Mild D-20 violation acknowledged; full per-file `search_path` test isolation design deferred to **SR-19.1b (Entry 6 below)**.

---

## Entry 2 — Pre-existing Fastify decorator types missing (Phase 18.1.2-03 IDE diagnostic)

**Surfacing phase:** Phase 18.1.2 / Plan 03 (IDE diagnostic on `apps/api/tests/unit/routes/__tests__/streaming-usage.integration.test.ts:98-99`).

**File:** `apps/api/src/types/fastify.d.ts` (likely missing) OR `apps/api/src/plugins/auth.ts` decorator declaration.

**Production symptom:** `req.user` and `req.tenant` are runtime-set by auth+tenant decorators but NOT declared via `declare module 'fastify' { interface FastifyRequest { user: ...; tenant: ...; } }`. TypeScript flags every test that touches `req.user` as `Property 'user' does not exist on type 'FastifyRequest'`. Tests run fine at runtime (decorators present); only typecheck is red.

**Test workaround (none required — vitest transpiles past TS errors):** None. But `pnpm typecheck` is silently red across many files for this reason.

**Suggested production fix (deferred):** Add `apps/api/src/types/fastify.d.ts` with `declare module 'fastify' { interface FastifyRequest { user?: ...; tenant?: ...; } }`. Use existing types from auth plugin + tenant decorator. ~30 LOC. Zero runtime impact.

**Owner:** unassigned. Related to Phase 14-04 typecheck-deferral §14-04 (deferred-items.md).

## Status: CLOSED 2026-05-15 (Phase 19)

**Closing commit:** `626fa30` (feat(19-01-02): green — add apps/api/src/types/fastify.d.ts module augmentation — SR-19.2)

Fastify module augmentation landed: `req.user` + `req.tenant` declared. Phase 14-04 typecheck deferral CLOSED downstream.

---

## Entry 3 — Migration 0014 requires pg_partman extension (Phase 18.1.2-03 retry #3)

**Surfacing phase:** Phase 18.1.2 / Plan 03 retry #3 (HALT before shared-pg image fix).

**File:** `packages/data/migrations/0014_audit_log_partition.sql`.

**Production symptom:** Migration requires `pg_partman` extension to be installed in the target Postgres instance. Production custom image `openwhispr/postgres:17.5-pgpartman` ships pg_partman pre-installed; standard `postgres:17-alpine` does not.

**Test workaround (Phase 18.1.2-03 retry #4):** `apps/api/tests/support/shared-pg.ts` updated to use `openwhispr/postgres:17.5-pgpartman` + `provisionPgPartman()` helper invoked after `bootstrapSharedRoles()`. Test infra mirrors production image choice.

**Suggested production fix (no action needed — this is canonical):** Migration 0014 correctly assumes the custom Postgres image. Document in `docs/operations.md` "Local development test prerequisites": `make build-pg-partman` (if present) OR `docker pull openwhispr/postgres:17.5-pgpartman` is required for running integration tests locally.

## Status: CLOSED 2026-05-15 (Phase 19)

**Closing commit:** `38584a9` (docs(19-01-04): pg_partman prerequisite recipe — SR-19.5, D-15)

Canonical documentation landed; image choice is correct as-is.

---

## Entry 4 — BYOK guard calls `process.exit(1)` on missing envs (Phase 18.1.2-04)

**Surfacing phase:** Phase 18.1.2 / Plan 04 (Bucket B closure, D-07 + Δ-3).

**File:** `packages/byok-guard/src/index.ts:242`.

**Production symptom:** `assertBYOKConfig()` calls `process.exit(1)` directly when an overlay's BYOK env contract is unsatisfied. Vitest traps this as "process.exit unexpectedly called with 1" — every test file that imports `apps/api/src/index.ts` (which calls `assertBYOKConfig()` at module-top, line 56) goes RED if the test env lacks BYOK envs. Plan 04's CONTEXT D-07 originally proposed refactoring the guard to `throw new BYOKGuardError(record.message)` with caller-side try/catch+log+exit at both `apps/api/src/index.ts:54-56` and `apps/worker/src/index.ts:7-9` (mirroring PATTERNS surface 5). That refactor is production code per CLAUDE.md hard rule §Conventions #1 and was rejected from this test-debt phase.

**Test workaround (Phase 18.1.2-04-01):** `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts` now mocks `@openwhispr/byok-guard` to a no-op (`assertBYOKConfig: () => undefined`). Also fixed stale relative mock paths after the Phase 15-02 `migrate-tests` codemod moved the file 2 directories deeper — `../auth.js` → `../../../src/auth.js`, etc., for all 14 source-relative `vi.mock` calls. byok-guard's own unit suite already spies `process.exit` per-test (see `packages/byok-guard/tests/unit/__tests__/byok-guard.test.ts:79`) so no fix needed there. Δ-3 closed: 2 entrypoint-db-shape failures GREEN.

**Suggested production fix (deferred to future production-side phase):** Refactor per original D-07 + PATTERNS surface 5: export `class BYOKGuardError extends Error` from `@openwhispr/byok-guard`, replace `process.exit(1)` at line 242 with `throw new BYOKGuardError(record.message)`, wrap callers in `try { assertBYOKConfig(); } catch (err) { logger.fatal({ err }, "..."); process.exit(1); }` at both api + worker entrypoints. Library throws, entrypoint catches+logs+exits (proper separation of concerns; user-memory `feedback_no_workarounds_enterprise.md`).

**Owner:** unassigned. Future production-fix phase reads this entry.

## Status: CLOSED 2026-05-15 (Phase 19)

**Closing commit:** `1488057` (feat(19-02-02): green — BYOK throw not exit; api+worker catch — SR-19.3)

BYOKGuardError class + throw/catch pattern landed at api + worker entrypoints; 18.1.2-04-01 test workaround reverted.

---

## Entry 5 — otel-bootstrap onSignal not exported; SIGTERM emit trapped by vitest worker handler (Phase 18.1.2-04)

**Surfacing phase:** Phase 18.1.2 / Plan 04 (Bucket B closure, D-09).

**File:** `apps/api/src/otel-bootstrap.ts:144`.

**Production symptom:** `const onSignal = (): void => { void shutdownSdk(); }` is a module-local symbol (not exported). The line-coverage test at `apps/api/tests/unit/otel-bootstrap.test.ts:124-131` exercises onSignal by `process.emit("SIGTERM" as never)` — but vitest's worker process registers its OWN `SIGTERM` handler at worker boot that calls `process.exit(143)` BEFORE `onSignal` (registered via `process.once`) gets to invoke `shutdownSdk()`. Result: `Error: process.exit unexpectedly called with "143"`. CONTEXT D-09 + RESEARCH §5 confirm onSignal has zero captured closure deps → safe to add `export` keyword. That single-character edit is production code per CLAUDE.md hard rule §Conventions #1 and was rejected from this test-debt phase.

**Test workaround (Phase 18.1.2-04-03):** `apps/api/tests/unit/otel-bootstrap.test.ts:124-131` rewritten to spy `process.exit` (mockImplementation `() => undefined as never`) BEFORE emitting SIGTERM. The competing vitest worker SIGTERM handler still fires + still calls `process.exit(143)`, but the spy swallows the exit so the test does not crash. Assertion validates non-throw + records the captured exit code is `143` (vitest worker handler) — which proves onSignal ran without throwing. Trade-off: this test no longer asserts `shutdownSdk` was called (cannot — vitest worker's SIGTERM beats onSignal's `process.once` registration). It only asserts onSignal does not throw. Coverage on lines 144-148 preserved.

**Suggested production fix (deferred):** Add `export` keyword at line 144: `export const onSignal = ...`. Two-character edit. Refactor test to import + invoke directly (`mod.onSignal()`) + spy `shutdownSdk` to assert behavior. Closes both coverage AND behavior assertion.

**Owner:** unassigned.

## Status: CLOSED 2026-05-15 (Phase 19)

**Closing commit:** `e9f20a3` (fix(19-01-03): green — export onSignal + revert 18.1.2-04-03 — SR-19.4)

`onSignal` exported; test refactored to invoke directly + spy `shutdownSdk`; coverage + behavior assertion both restored.

---

## Entry 6 — Per-file `search_path` test-isolation infrastructure design required (Phase 19-03)

**Surfacing phase:** Phase 19 / Plan 03 (advisor HALT resolution for SR-19.1 Option (a) execution).

**File:** `apps/api/tests/support/shared-pg.ts` (born at commit `15c24c9` with shared-public pattern).

**Production symptom:** Integration tests share the `public` schema via `shared-pg.ts` shared-public + `TRUNCATE` pattern (Phase 18.1.2-03 Option A). Cross-test leakage is currently bounded by per-`beforeEach` `TRUNCATE` + unique user emails, but isolation is NOT strict — concurrent test files theoretically race on the same `public` schema rows. 25/25 integration tests + 479/479 route tests stay GREEN at present, so the bound holds today.

**Test workaround (already in place — Phase 18.1.2-03 Option A):** shared-public + per-test `TRUNCATE` + unique emails. Phase 19-03 confirmed GREEN. No additional workaround required.

**Suggested production fix (deferred — design required):** Build per-file `acquireSchema(testId)` API that:
- Allocates a per-test-file schema name like `_test_<testId>` and sets `search_path` to it.
- Routes Drizzle's `migrationsSchema` to `_meta_test_<testId>` so each schema has its own `__drizzle_migrations` ledger.
- Provides a partman-aware helper that re-registers `audit_log` under the per-test schema (or re-routes partman calls).
- Tears down the schema in `afterAll` for hygiene.

Estimated scope: ~4-6h. Touches ~17 integration test files + `shared-pg.ts` + a new partman test helper.

**Owner:** unassigned. Defer to v3 or a dedicated test-infra-hardening phase. The Phase 19-03 FK strip (commit `d45291d`) is forward-compatible — once this isolation infra lands, no further migration edits will be needed.

---

## Append-protocol

Future entries follow same shape: surfacing phase + file:line + production symptom + test workaround + suggested fix + owner.

Entries here are **NOT** production code edits. They are observations + advisory fix proposals. Do not pre-emptively act on entries without explicit user-scope phase.
