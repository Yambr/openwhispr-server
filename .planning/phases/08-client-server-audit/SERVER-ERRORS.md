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

---

## Entry 2 — Pre-existing Fastify decorator types missing (Phase 18.1.2-03 IDE diagnostic)

**Surfacing phase:** Phase 18.1.2 / Plan 03 (IDE diagnostic on `apps/api/tests/unit/routes/__tests__/streaming-usage.integration.test.ts:98-99`).

**File:** `apps/api/src/types/fastify.d.ts` (likely missing) OR `apps/api/src/plugins/auth.ts` decorator declaration.

**Production symptom:** `req.user` and `req.tenant` are runtime-set by auth+tenant decorators but NOT declared via `declare module 'fastify' { interface FastifyRequest { user: ...; tenant: ...; } }`. TypeScript flags every test that touches `req.user` as `Property 'user' does not exist on type 'FastifyRequest'`. Tests run fine at runtime (decorators present); only typecheck is red.

**Test workaround (none required — vitest transpiles past TS errors):** None. But `pnpm typecheck` is silently red across many files for this reason.

**Suggested production fix (deferred):** Add `apps/api/src/types/fastify.d.ts` with `declare module 'fastify' { interface FastifyRequest { user?: ...; tenant?: ...; } }`. Use existing types from auth plugin + tenant decorator. ~30 LOC. Zero runtime impact.

**Owner:** unassigned. Related to Phase 14-04 typecheck-deferral §14-04 (deferred-items.md).

---

## Entry 3 — Migration 0014 requires pg_partman extension (Phase 18.1.2-03 retry #3)

**Surfacing phase:** Phase 18.1.2 / Plan 03 retry #3 (HALT before shared-pg image fix).

**File:** `packages/data/migrations/0014_audit_log_partition.sql`.

**Production symptom:** Migration requires `pg_partman` extension to be installed in the target Postgres instance. Production custom image `openwhispr/postgres:17.5-pgpartman` ships pg_partman pre-installed; standard `postgres:17-alpine` does not.

**Test workaround (Phase 18.1.2-03 retry #4):** `apps/api/tests/support/shared-pg.ts` updated to use `openwhispr/postgres:17.5-pgpartman` + `provisionPgPartman()` helper invoked after `bootstrapSharedRoles()`. Test infra mirrors production image choice.

**Suggested production fix (no action needed — this is canonical):** Migration 0014 correctly assumes the custom Postgres image. Document in `docs/operations.md` "Local development test prerequisites": `make build-pg-partman` (if present) OR `docker pull openwhispr/postgres:17.5-pgpartman` is required for running integration tests locally.

---

## Append-protocol

Future entries follow same shape: surfacing phase + file:line + production symptom + test workaround + suggested fix + owner.

Entries here are **NOT** production code edits. They are observations + advisory fix proposals. Do not pre-emptively act on entries without explicit user-scope phase.
