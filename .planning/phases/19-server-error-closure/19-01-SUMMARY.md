---
phase: 19-server-error-closure
plan: 01
subsystem: api-types + observability + ops-docs
tags: [SR-19.2, SR-19.4, SR-19.5, server-errors-closure, types, otel, docs]
requires: [Phase 18.1.2-04-03, Phase 18.1.2-05-05, Phase 14-04 deferral]
provides:
  - canonical apps/api/src/types/fastify.d.ts
  - exported apps/api/src/otel-bootstrap.ts::onSignal
  - docs/operations.md SR-19.5 pg_partman recipe + SERVER-ERRORS Entry 3 cross-link
affects: [apps/api typecheck graph, apps/api otel unit suite, contributor onboarding docs]
key-files:
  created:
    - apps/api/src/types/fastify.d.ts
    - apps/api/tests/unit/__tests__/fastify-request-types.test.ts
  modified:
    - apps/api/src/otel-bootstrap.ts (export keyword + comment block)
    - apps/api/tests/unit/otel-bootstrap.test.ts (workaround revert)
    - docs/operations.md (pg_partman recipe + SR-19.5 cross-link)
    - .planning/deferred-items.md (§14-04 root-cause-class closure block)
decisions: [D-07, D-08, D-13, D-14, D-15, D-22, D-23]
metrics:
  duration: ~25 min
  completed: 2026-05-15
  commits: 4
---

# Phase 19 Plan 01: SR-19.2 + SR-19.4 + SR-19.5 Summary

One-liner: Centralized `FastifyRequest` decorator types in a dedicated `.d.ts`, exported `otel-bootstrap.ts::onSignal` to retire the 18.1.2-04-03 `process.exit` spy workaround, and documented the `pg_partman` image prerequisite — three localized fixes consuming SERVER-ERRORS.md Entries 2, 3, 5 with zero cross-subsystem impact.

## Commits

| # | SHA | Type | Subject |
|---|-----|------|---------|
| 1 | `f8e6d51` | test | red — FastifyRequest user/tenant typecheck contract |
| 2 | `626fa30` | feat | green — add apps/api/src/types/fastify.d.ts module augmentation (SR-19.2, D-07) |
| 3 | `e9f20a3` | fix  | green — export onSignal + revert 18.1.2-04-03 (SR-19.4) |
| 4 | `38584a9` | docs | pg_partman prerequisite recipe (SR-19.5, D-15) |

Start of plan: `866c514`. 4 commits, well under D-18 ≤ 7 budget.

## Per-SR Verification

### SR-19.2 (D-07, D-08) — Fastify types canonical .d.ts

- New file `apps/api/src/types/fastify.d.ts` exists with `declare module "fastify" { interface FastifyRequest { user?: ...; tenant?: ...; } }`.
- 4-test contract suite at `apps/api/tests/unit/__tests__/fastify-request-types.test.ts` RED → GREEN (2 failed | 2 passed → 4 passed).
- `pnpm --filter @openwhispr/api typecheck`: 19 errors at HEAD~3 → 19 errors at HEAD (delta = 0). All 19 are the pre-existing §14-04 catalog (BullMQ, RequestInit, CloudRow generics, litellm-client `ResponseData<unknown>`) — unrelated to req.user/req.tenant. `grep -E "Property 'user'|Property 'tenant'"` against typecheck log: 0 hits before and after.
- `.planning/deferred-items.md §14-04` transitioned with milestone-honest caveat: SR-19.2 closes the root-cause *class* (decorator type invisibility) per D-08 framing; the symptom catalog entries belong to separate subsystems and remain deferred.

### SR-19.4 (D-13, D-14) — otel-bootstrap export

- `apps/api/src/otel-bootstrap.ts:144`: `const onSignal` → `export const onSignal` (single keyword). `process.once("SIGTERM"|"SIGINT", onSignal)` registrations preserved intact (production side-effect carries).
- `apps/api/tests/unit/otel-bootstrap.test.ts`: 18.1.2-04-03 `process.exit` spy + `process.emit("SIGTERM")` workaround REPLACED with direct `mod.onSignal()` invocation + `sdk.shutdown` spy (closure-binding-aware spy target; documented in test body + commit body).
- `pnpm --filter @openwhispr/api test otel-bootstrap`: Test Files 2 passed (2) | Tests 18 passed (18). The new SR-19.4 assertion `shutdownSpy.toHaveBeenCalled()` is GREEN.

### SR-19.5 (D-15) — ops docs

- `docs/operations.md` "Local development test prerequisites" item #3 extended: explicit `docker pull openwhispr/postgres:17.5-pgpartman` canonical recipe added next to existing `make build-pg-partman` and mirrored-registry forms; migration `0014_audit_log_partition.sql` named by canonical path; upstream `postgres:17-alpine`-does-NOT-ship-pg_partman pitfall called out; SERVER-ERRORS.md Entry 3 cross-link added with Phase 18.1.2-05-05 (surfacing) + Phase 19 / SR-19.5 (closing) attribution.
- `grep -c "openwhispr/postgres:17.5-pgpartman" docs/operations.md` 2 → 3.
- Makefile note: `build-pg-partman` target referenced in docs but absent from Makefile (pre-existing drift; out of scope, noted in commit body).

## Coverage (D-23)

- `apps/api/src/types/fastify.d.ts` — types-only, D-23 carve-out (no Vitest instrumentation applies).
- `apps/api/src/otel-bootstrap.ts` — `onSignal` arrow covered by the new direct invocation; `process.once` registrations covered by module-load side-effect in 6 other tests. No `c8 ignore` pragma needed.
- No coverage delta on any other file (test additions only).

## Deviations from Plan

### Auto-fixed (Rule 1/2)

**1. [Rule 1 — Spy target] `vi.spyOn(mod, "shutdownSdk")` initially failed because `onSignal` closes over the module-scope binding, not the namespace property.**
- Found during: Task 19-01-03 GREEN verification (`expected to have been called at least once`).
- Fix: switched the spy target to `mod.sdk.shutdown` per plan rollback §2 fallback ("if spy on dynamic import surface fails → use vi.mock OR alternative spy target"). Spying on the SDK's underlying `shutdown` method observes the real call chain (`onSignal → shutdownSdk → sdk.shutdown`) without `vi.mock` namespace gymnastics. Documented in the test body comment block + commit `e9f20a3` body.

### Deferred-items §14-04 honesty correction (milestone-honest deviation)

The plan's must_haves truth #2 said the §14-04 entry should transition to `CLOSED — Phase 19-01-02 (commit <SHA>)`. The §14-04 catalog symptoms (BullMQ typings, RequestInit body, CloudRow generics, litellm-client `ResponseData<unknown>`) are NOT caused by missing decorator types — they are unrelated subsystem failures. Per `feedback_no_workarounds_enterprise.md` (milestone honesty), the entry was extended with an explicit "SR-19.2 root-cause-class closure" sub-section that closes the *root-cause class* (decorator type invisibility) per D-08's framing while keeping the symptom-level entries deferred to their owning future phases. This is more honest than a flat "CLOSED" stamp.

## SERVER-ERRORS.md Ledger Transition (queued for Plan 03 / D-25)

| Entry | SR | Closing commit (Phase 19-01) | Status when Plan 03 lands |
|-------|------|------|-------|
| 2 | SR-19.2 | `626fa30` (feat 19-01-02) | fix landed in Phase 19-01, awaiting `## Status: CLOSED 2026-05-15` block + Owner transition in Plan 03 ledger close |
| 3 | SR-19.5 | `38584a9` (docs 19-01-04) | fix landed in Phase 19-01, awaiting `## Status: CLOSED 2026-05-15` block in Plan 03 |
| 5 | SR-19.4 | `e9f20a3` (fix 19-01-03)  | fix landed in Phase 19-01, awaiting `## Status: CLOSED 2026-05-15` block in Plan 03 |

Entries 1 (migrations) + 4 (BYOK guard) remain owned by Plans 19-02 + 19-03 respectively.

## Lefthook + Process

- 4/4 commits passed lefthook (biome write, english, phase-tag-comments, commitlint).
- ZERO `--no-verify` (D-21).
- 1 commitlint warning on commit 4 (footer leading blank) — non-blocking.

## Self-Check: PASSED

- `git log --oneline -4` → `f8e6d51 / 626fa30 / e9f20a3 / 38584a9` confirmed.
- `apps/api/src/types/fastify.d.ts` exists.
- `apps/api/src/otel-bootstrap.ts` contains `export const onSignal` (1 hit).
- `apps/api/tests/unit/otel-bootstrap.test.ts` contains `mod.onSignal` (1 hit).
- `docs/operations.md` contains `openwhispr/postgres:17.5-pgpartman` (3 hits, ≥ 1).
- `pnpm --filter @openwhispr/api test otel-bootstrap` exits 0 (18/18 passed).
- `pnpm --filter @openwhispr/api test fastify-request-types` exits 0 (4/4 passed).
