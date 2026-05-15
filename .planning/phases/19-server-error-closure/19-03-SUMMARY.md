---
phase: 19
plan: 03
subsystem: server-error-closure
tags: [migrations, server-errors, ledger-close, v2.1, partial-debt]
status: closed-with-partial-debt
completed: 2026-05-15
commits:
  - d45291d  # SR-19.1 Option a — strip 8 FK prefixes
  - 3619dd9  # SERVER-ERRORS Entries 1-5 ledger close + Entry 6 (SR-19.1b)
  - <this commit>  # ROADMAP + STATE + deferred-items sync
---

# Phase 19 Plan 03: FINAL — SR-19.1 FK strip + SERVER-ERRORS ledger close + v2.1 milestone CLOSED-WITH-PARTIAL-DEBT

## Objective

Execute advisor-locked **Option (a)** for SR-19.1: strip 8 hardcoded `"public".` FK
prefixes from production migration SQL. Append closure blocks to SERVER-ERRORS.md
Entries 1-5, introduce Entry 6 (SR-19.1b) for the deferred per-file `search_path`
test-isolation design, sync ROADMAP+STATE, and declare the v2.1 milestone
CLOSED-WITH-PARTIAL-DEBT.

## Commits

| SHA       | Message                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `cbe0082` | Phase 19 baseline (Plan 02 summary)                                                    |
| `d45291d` | fix(19-03-01): green — strip "public." FK prefixes from migrations (SR-19.1, Option a) |
| `3619dd9` | docs(19-03-02): close SERVER-ERRORS entries 1-5 + add SR-19.1b debt entry              |
| (this)    | docs(19-03-03): sync ROADMAP+STATE — v2.1 milestone CLOSED-WITH-PARTIAL-DEBT           |

## Option (a) Decision Rationale (advisor verdict — LOCKED)

- D-20 atomic-revert mandate authored on **false premise**: `git log --follow apps/api/tests/support/shared-pg.ts` shows the file was BORN at commit `15c24c9` with the shared-public + TRUNCATE pattern. No prior per-file state exists for atomic revert.
- Honoring an impossible mandate = workaround per `feedback_no_workarounds_enterprise.md`.
- Advisor verdict: execute Option (a) (strip 8 FK prefixes), defer test-infra revert to SR-19.1b.
- Mild D-20 violation is **self-aware + documented** (Entry 6 + this SUMMARY).

## FK Strip — 8 sites landed; 3 partman literals exempt

**Stripped (8 FK references):**

- `packages/data/migrations/0000_initial.sql` lines 67/71/75/79/83/87 — 6 sites
- `packages/data/migrations/0014_audit_log_partition.sql` line 77 — 1 site
- `packages/data/migrations/0014_audit_log_partition.down.sql` line 46 — 1 site

**Exempt (3 partman registry literals — NOT FK refs):**

- `0014.sql:100` `p_parent_table => 'public.audit_log'` (partman.create_parent API)
- `0014.sql:115` `WHERE parent_table = 'public.audit_log'` (partman.part_config)
- `0014.down.sql:27` `DELETE FROM partman.part_config WHERE parent_table = 'public.audit_log'`

Stripping these would break partman registration and the partition rollback path.

## Drizzle migration-hash impact + mitigation

`_meta.__drizzle_migrations.hash` rows for tags `'0000_initial'` and `'0014_audit_log_partition'` will mismatch on any prod DB that already applied the pre-strip migrations. Per advisor finding: **ZERO deployed prod tenants currently** — theoretical risk only. Mitigation for future operator upgrades: one-shot `UPDATE _meta.__drizzle_migrations SET hash = <new> WHERE tag IN (...)` OR a rehash migration. Documented in Entry 1 closure block + commit body.

## SERVER-ERRORS.md ledger state (post Phase 19)

| Entry | Status                      | Closing commit | Notes                                         |
| ----- | --------------------------- | -------------- | --------------------------------------------- |
| 1     | CLOSED-WITH-PARTIAL-DEBT    | `d45291d`      | SR-19.1 Option a; W-2 revert deferred to 19.1b |
| 2     | CLOSED                      | `626fa30`      | SR-19.2 fastify.d.ts module augmentation       |
| 3     | CLOSED                      | `38584a9`      | SR-19.5 pg_partman recipe                      |
| 4     | CLOSED                      | `1488057`      | SR-19.3 BYOKGuardError throw/catch             |
| 5     | CLOSED                      | `e9f20a3`      | SR-19.4 export onSignal                        |
| 6     | OPEN (new — SR-19.1b)       | —              | Per-file search_path test-isolation design     |

## New Entry 6 (SR-19.1b)

- **Owner:** unassigned. Defer to v3 or dedicated test-infra-hardening phase.
- **Scope:** `acquireSchema(testId)` API + per-schema `migrationsSchema=_meta_test_<id>` + partman-aware helper. Est. ~4-6h, touches ~17 integration tests + `shared-pg.ts` + new partman helper.
- **Current state (GREEN):** shared-public + `TRUNCATE` in `beforeEach` + unique user emails. 25/25 integration + 479/479 route tests stay GREEN post-SR-19.1 strip.

## Verification (final aggregate)

- `pnpm --filter @openwhispr/data exec vitest run migrations/__tests__/0014-audit-log-partition.test.ts` → **6/6 GREEN**
- `pnpm --filter @openwhispr/api exec vitest run tests/unit/routes` → **479/479 GREEN** (encompasses the 25 cluster #1 + cluster #2 integration tests cited in the plan)
- 4 pre-existing failures in `scripts/check-default-secrets.test.ts` confirmed unchanged via `git stash` probe (out of scope per executor SCOPE BOUNDARY)
- Phase 14-04 typecheck deferral CLOSED downstream by SR-19.2 + SR-19.3

## v2.1 milestone status

**CLOSED-WITH-PARTIAL-DEBT** — SR-19.1b carry only. 10 phases under v2.1 (12, 13, 14, 15, 16, 17, 18, 18.1, 18.1.1, 18.1.2, 19) all shipped.

## Phase 19 totals

- **3 plans** (19-01, 19-02, 19-03)
- **~10 atomic commits** (Plan 01: 5; Plan 02: 3; Plan 03: 3)
- **ZERO `--no-verify`** across all commits
- Hard-rule INVERSION honored: every production edit traces to a SERVER-ERRORS.md entry with user-approved scope
- D-15 NO-parallel-ops respected throughout

## Self-Check

- [x] All commits exist in git log
- [x] SERVER-ERRORS.md Entries 1-5 have Status: CLOSED/CLOSED-WITH-PARTIAL-DEBT blocks
- [x] SERVER-ERRORS.md Entry 6 (SR-19.1b) appended
- [x] 8 FK strips landed in 3 migration files; 3 partman literals exempt
- [x] STATE.md + ROADMAP.md + deferred-items.md synced
- [x] 25 integration tests preserved GREEN (verified via 479/479 route tests)

## Self-Check: PASSED
