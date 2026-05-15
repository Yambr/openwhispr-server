# Phase 19: Server-error closure - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Production-fix phase consuming `.planning/phases/08-client-server-audit/SERVER-ERRORS.md` Entries 1-5 (surfaced by Phases 18.1.1 + 18.1.2 under CLAUDE.md Conventions Hard Rule #1 "never edit prod from test-debt phases"). Each entry has user-approved scope here.

**In scope (5 SRs):**
- SR-19.1 Migration SQL schema-aware refactor (Entry 1) — Option (i) strip `"public".` prefixes
- SR-19.2 Fastify `FastifyRequest` types declare module (Entry 2)
- SR-19.3 BYOK guard refactor `process.exit(1)` → `throw BYOKGuardError` (Entry 4)
- SR-19.4 otel-bootstrap `export` keyword on `onSignal` (Entry 5)
- SR-19.5 docs/operations.md pg_partman prerequisite (Entry 3 follow-up)

**Out of scope (deferred):**
- Option (ii) `OPENWHISPR_DB_SCHEMA` env knob — defer to v3 multi-tenant-by-schema topology
- Phase 19.1-19.4 downstream code for `@cjm` tags (separate phases)
- FSL history scrub, GHA e2e-cjm first run, axe/visual baseline bakes (operator)

</domain>

<decisions>
## Implementation Decisions

### SR-19.1 Migration strategy (advisor)

- **D-01:** Use **Option (i) strip `"public".` prefixes**. Reject Option (ii) env-knob.
- **D-02:** **Real scope much smaller than Entry 1 estimate**: advisor verified via grep = **11 hits across only 3 files**:
  - `packages/data/migrations/0000_initial.sql:67,71,75,79,83,87` (6 FK refs)
  - `packages/data/migrations/0014_audit_log_partition.sql:77,100,115` (3 hits)
  - `packages/data/migrations/0014_audit_log_partition.down.sql:27,46` (2 hits)
- **D-03:** Migrations 0001-0013, 0015-0017 ALREADY use unqualified refs (match RLS policy + GRANT convention at `0000:125-139,148-153`). Drizzle schema defs are plain `pgTable("tenants", …)` at `packages/data/src/schema/tenants.ts:7` — no `pgSchema('public')` wrapper. Codebase already philosophically schema-agnostic.
- **D-04:** `0014:100` pg_partman `parent_table='public.audit_log'` literal is partman METADATA (not FK) — LEAVE AS IS. Partition mgmt isn't exercised by test isolation; partman config row stays `public.audit_log`.
- **D-05:** `0000:148` `GRANT USAGE ON SCHEMA public` stays — `_app` role already has it; test schemas don't need this grant.
- **D-06:** Re-run `pnpm drizzle-kit generate` after edits to recompute journal hashes. Drizzle ≥ 0.20 stamps hashes from file content automatically. Production DBs already have migrations applied — `migrate()` reads `_meta.__drizzle_migrations` and skips by hash+idx; only fresh bootstraps run new SQL.

### SR-19.2 Fastify types (no advisor needed)

- **D-07:** Author NEW `apps/api/src/types/fastify.d.ts` with `declare module 'fastify' { interface FastifyRequest { user?: ...; tenant?: ...; } }`. Use existing types from auth plugin + tenant decorator. ~30 LOC. Zero runtime impact.
- **D-08:** Closes Phase 14-04 typecheck-deferral root cause. Update `.planning/deferred-items.md §14-04` to CLOSED.

### SR-19.3 BYOK guard (no advisor needed)

- **D-09:** Refactor `packages/byok-guard/src/index.ts:242`: replace `process.exit(1)` with `throw new BYOKGuardError(record.message)`. Export `class BYOKGuardError extends Error` from package.
- **D-10:** Update callers at `apps/api/src/index.ts:54-56` + `apps/worker/src/index.ts:7-9` to catch:
  ```ts
  try { assertBYOKConfig(); }
  catch (err) {
    if (err instanceof BYOKGuardError) { logger.fatal({ err }, "..."); process.exit(1); }
    throw err;
  }
  ```
- **D-11:** Update byok-guard unit suite — assertions now test for thrown `BYOKGuardError` instead of `process.exit` spy.
- **D-12:** Revert Phase 18.1.2-04 test workaround at `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts` (mocked `@openwhispr/byok-guard` to no-op) — production refactor supersedes; restore real assertion semantics.

### SR-19.4 otel-bootstrap export (no advisor needed)

- **D-13:** Add `export` keyword to `apps/api/src/otel-bootstrap.ts:144` (`onSignal` → `export const onSignal`). Single-character production change.
- **D-14:** Update `apps/api/tests/unit/otel-bootstrap.test.ts:124-131` — replace SIGTERM `process.emit` + `process.exit` spy with direct `onSignal()` invocation. Assert no-throw + spy `shutdownSdk`. Reverts Phase 18.1.2-04 workaround.

### SR-19.5 ops docs (no advisor needed)

- **D-15:** Append `docs/operations.md` "Local development test prerequisites" section (already initialized in Phase 18.1.2-05-05) with explicit pg_partman image recipe: `docker pull openwhispr/postgres:17.5-pgpartman` or `make build-pg-partman` if Makefile target. Reference SERVER-ERRORS Entry 3.

### Plan split & sequencing (advisor)

- **D-16:** **3 plans, sequential per Phase 18.1.1+18.1.2 race lesson:**
  - **19-01** SR-19.2 + SR-19.4 + SR-19.5 (low-risk localized fixes; 3-4 commits)
  - **19-02** SR-19.3 BYOK refactor (byok-guard package + 2 entrypoint callers + suite update + Phase 18.1.2-04 revert; 2-3 commits)
  - **19-03** SR-19.1 + W-2 revert + close (migrations + journal + Phase 18.1.2-03 test-infra revert + SERVER-ERRORS Entries 1-5 transitions + ROADMAP/STATE close; 2-3 commits)
- **D-17:** **Wave graph strictly sequential:** `19-01 → 19-02 → 19-03`. No parallel. 18.1.1 race-condition lesson carries.
- **D-18:** Total atomic commit estimate: **~8-10**.
- **D-19:** SR-19.1 LAST because (a) it touches drizzle bookkeeping ledger, (b) it can cascade to test-infra retesting (Phase 18.1.2-03 W-2 revert), (c) reserves CI-green progress from prior plans as safety net.
- **D-20:** **Atomic revert pattern:** Phase 18.1.2-03 test-infra workaround flips back to per-file `search_path` schemas in SAME commit as migration edits. If `search_path` strategy doesn't unblock W-2 in practice, revert whole commit cleanly — no 2-phase dance.

### Constitutional / Process

- **D-21:** ZERO `--no-verify`.
- **D-22:** TDD D-39 doctrine: 2-commit RED+GREEN pair for new code (D-07, D-13); single-GREEN for pre-existing RED tests transitions.
- **D-23:** Coverage 90/90/90/90 on changed prod files (fastify.d.ts is types-only, no coverage); byok-guard ≥ 90; otel-bootstrap ≥ 90.
- **D-24:** End-of-phase aggregate `pnpm test` exits 0 + `pnpm typecheck` exits 0.
- **D-25:** SERVER-ERRORS.md Entries 1-5 transition `Owner: unassigned` → `Owner: Phase 19 (commit <SHA>)` with linked atomic commits. Add `## Status: CLOSED 2026-05-15` block per entry.
- **D-26:** v2.1 milestone declaration: CLOSED-WITH-PRE-EXISTING-DEBT → CLOSED (assuming D-24 satisfied).

### Claude's Discretion

- 1 advisor only (SR-19.1 strategy); other 4 SRs have explicit user-approved fixes in SERVER-ERRORS.md.
- HALT recipes: if SR-19.1 migration journal re-hash creates production-DB conflict during local boot, HALT + 3-branch user choice (a/regenerate b/manual hash patch c/defer SR-19.1 to v3).
- Per-plan SUMMARY ≤ 80 LOC each (smaller than 18.1.x because scope is bounded).
- Total Phase 19 runtime estimate: ~2-3h (smaller than 18.1.x).

</decisions>

<canonical_refs>
## Canonical References

### SERVER-ERRORS source ledger
- `.planning/phases/08-client-server-audit/SERVER-ERRORS.md` Entries 1-5 (input contract)

### SR-19.1 sites (per advisor verification)
- `packages/data/migrations/0000_initial.sql:67,71,75,79,83,87` (6 FK refs to strip)
- `packages/data/migrations/0014_audit_log_partition.sql:77,100,115`
- `packages/data/migrations/0014_audit_log_partition.down.sql:27,46`
- `packages/data/drizzle.config.ts:17-23` (journal/_meta config)
- `packages/data/src/schema/tenants.ts:7`, `users.ts:15` (already plain pgTable — no edit needed)

### SR-19.2 sites
- `apps/api/src/types/fastify.d.ts` (NEW file)
- `apps/api/src/plugins/auth.ts` (decorator types reference)
- `apps/api/src/plugins/tenant-context.ts` (tenant decorator types)

### SR-19.3 sites
- `packages/byok-guard/src/index.ts:242` (refactor target)
- `apps/api/src/index.ts:54-56` (caller)
- `apps/worker/src/index.ts:7-9` (caller)
- `packages/byok-guard/tests/unit/__tests__/byok-guard.test.ts` (assertion update)
- `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts` (Phase 18.1.2-04-01 revert)

### SR-19.4 sites
- `apps/api/src/otel-bootstrap.ts:144` (export keyword)
- `apps/api/tests/unit/otel-bootstrap.test.ts:124-131` (Phase 18.1.2-04-03 revert)

### SR-19.5 sites
- `docs/operations.md` (Phase 18.1.2-05-05 section extend)

### Phase 18.1.2 W-2 revert site
- `apps/api/tests/support/shared-pg.ts` (canonical pattern returns to per-file `search_path` schemas)
- `apps/api/tests/unit/routes/__tests__/usage.integration.test.ts` (TRUNCATE→search_path)
- `apps/api/tests/unit/routes/__tests__/streaming-usage.integration.test.ts`
- 15 cluster #2 files in `apps/api/tests/unit/routes/{conversations,notes,folders,transcriptions,v1}/__tests__/`

### Constitutional / Process
- `.planning/PROJECT.md` §Engineering Discipline rules 1-10
- CLAUDE.md root §Conventions Hard Rules #1 (now THIS phase has explicit user scope to edit prod)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Drizzle 0.31.x auto-stamps `_journal.json` hashes on `pnpm drizzle-kit generate` (advisor verified)
- RLS policy convention at `0000_initial.sql:125-139` uses unqualified table names — Option (i) edits match
- `pgTable("tenants", …)` Drizzle schema convention already schema-agnostic
- pg_partman `parent_table='public.audit_log'` is METADATA literal, NOT FK — leave untouched

### Established Patterns
- Phase 18.1.2 sequential execute (no parallel) — race-condition lesson
- TDD D-39 doctrine — 2-commit pair for new code
- HALT-and-escalate recipes — 3-branch user choice on novel constraint
- SERVER-ERRORS.md ledger model — Owner transitions on production-fix commit

### Integration Points
- Phase 18.1.2-04 test workarounds → revert to real assertions when production fix lands (atomic)
- Phase 18.1.2-03 test-infra (shared `public` + TRUNCATE) → revert to per-file `search_path` schemas in same commit as migration edits
- Phase 14-04 typecheck deferred-items entry → CLOSED via SR-19.2 + SR-19.3
- `.planning/STATE.md` milestone status `closed-with-followup` → `closed` via D-26

</code_context>

<specifics>
## Specific Ideas

- 11 grep hits across 3 migration files — much smaller scope than initial Entry 1 estimate (18 files / 50-100 LoC)
- Journal re-hash is informational on existing prod DBs (already applied; skipped by hash+idx in `_meta.__drizzle_migrations`)
- Phase 19 = `git revert` opportunity for some Phase 18.1.2 workarounds (BYOK mock, otel `process.exit` spy)
- pg_partman literal `'public.audit_log'` is documentation-worthy (Entry 3 followup section in operations.md)

</specifics>

<deferred>
## Deferred Ideas

- **Option (ii) `OPENWHISPR_DB_SCHEMA` env knob** — v3 multi-tenant-by-schema topology trigger
- **Phase 19.1-19.4 downstream code** for repointed `@cjm` tags — separate phases (unchanged)
- **Operator-side**: FSL scrub, GHA e2e-cjm first run, axe baseline live bake, Playwright visual GREEN bake, UICONF-05 baseline
- **Per-tenant schema topology** (multi-tenant by schema rather than RLS) — v3+

### Reviewed Todos (not folded)
- None.

</deferred>

---

*Phase: 19-server-error-closure*
*Context gathered: 2026-05-15*
