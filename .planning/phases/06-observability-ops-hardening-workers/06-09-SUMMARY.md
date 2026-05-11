---
phase: 06-observability-ops-hardening-workers
plan: 09
subsystem: anti-abuse-rate-limit-+-tenant-context-static-lint
tags: [scale-04, scale-03, rate-limit, fastify, valkey, audit-log, ts-ast, ci-gate, d-rl1, d-rl2, d-rl3, d-w4]
dependency_graph:
  requires:
    - .planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md (D-RL1..3, D-W4)
    - .planning/phases/06-observability-ops-hardening-workers/06-RESEARCH.md §4
    - .planning/phases/02-auth-wire-api-skeleton-conformance-harness/02-CONTEXT.md (verification-status carve-out)
    - apps/api/src/plugins/rate-limit.ts (Phase 2 baseline)
    - apps/api/src/lib/audit.ts (Plan 06-05 recordAudit)
    - apps/worker/src/lib/with-tenant-context.ts (Plan 06-07)
    - apps/worker/src/lib/with-system-context.ts (Plan 06-07)
    - tools/lint-rls.ts (TS-AST pattern reference)
  provides:
    - apps/api/src/config/rate-limits.ts — D-RL2 per-route rpm matrix, 13 entries, env-overridable
    - apps/api/src/plugins/rate-limit.ts — layered IP+user tiers, X-RateLimit-* headers, 429 audit emission hook
    - tools/lint-tenant-context.ts — TS-AST D-W4 layer 1 static gate
    - pnpm lint:tenant-context script + GHA job + lefthook hook + branch-protection entry
  affects:
    - apps/api/src/index.ts — wires onRateLimitExceeded → recordAudit when opts.db present
    - .env.example — 27 new RATE_LIMIT_* env vars
    - .github/workflows/ci.yml — lint-tenant-context required job
    - scripts/branch-protection.json — lint-tenant-context required check
    - lefthook.yml — pre-commit hook on apps/worker/src/jobs/*.ts
tech_stack:
  added:
    - "@fastify/rate-limit hook:'preHandler' override — runs after dualAuthHook (onRequest) so user-tier keyGenerator sees req.user.id"
    - "Dedicated IP-tier preHandler hook with ioredis INCR+PEXPIRE counter (or in-process Map fallback)"
    - "TypeScript Compiler API (`typescript` devDep, no ts-morph) — AST walk over apps/worker/src/jobs/**/*.ts looking for withTenantContext/withSystemContext CallExpression"
  patterns:
    - "Layered rate-limit: separate IP-tier (onRequest, before route match) + user-tier (preHandler, after auth) — fires 429 when EITHER tier exhausted (D-RL1)"
    - "Per-route rpm matrix in code (apps/api/src/config/rate-limits.ts) + env overrides — Phase 8 k6 tuning is a config change, not a code change (D-RL2)"
    - "Best-effort audit emission via injected onRateLimitExceeded callback — pre-auth abuse with no tenant ctx logs warn + drops (D-RL3)"
    - "Subprocess + direct-API hybrid test pattern — execFileSync proves exit-code wiring, runMain()/runLint()/scanFile() exports prove the lint logic with v8 coverage"
key_files:
  created:
    - apps/api/src/config/rate-limits.ts
    - tools/lint-tenant-context.ts
    - .planning/phases/06-observability-ops-hardening-workers/06-09-SUMMARY.md
  modified:
    - apps/api/src/plugins/rate-limit.ts (Phase 6 extensions on Phase 2 baseline)
    - apps/api/src/plugins/rate-limit.test.ts (Wave 0 stub → 31 GREEN tests)
    - apps/api/src/index.ts (onRateLimitExceeded wired)
    - tools/lint-tenant-context.test.ts (Wave 0 stub → 20 GREEN tests)
    - package.json (lint:tenant-context script)
    - .github/workflows/ci.yml (lint-tenant-context job)
    - scripts/branch-protection.json (lint-tenant-context required check)
    - lefthook.yml (pre-commit hook)
    - .env.example (28 RATE_LIMIT_* env vars)
decisions:
  - "GritQL vs TS-AST: TS-AST chosen. RESEARCH §4 rated GritQL MEDIUM-confidence; the TypeScript Compiler API is already a project devDep, mirrors tools/lint-rls.ts, and handles every TS dialect uniformly. Time-boxed spike NOT performed; TS-AST works on the first try."
  - "Plugin registration: @fastify/rate-limit registered ONCE (not twice as the plan suggested) — the plugin's `hook: 'preHandler'` option moves its evaluation phase AFTER dualAuthHook's onRequest, which is what the spec actually needs. The 'IP-tier' is implemented as a separate onRequest hook with its own ioredis counter rather than a second plugin registration (fastify-plugin's idempotency prevents double-registration anyway)."
  - "User-tier keyGenerator reads `req.user.id ?? req.ip` (not `req.session.userId` as the plan spec text used) — the actual project shape stamps `req.user` via dualAuthHook (apps/api/src/middleware/dual-auth.ts) and never populated `req.session`. The auto-degrade-to-IP semantic is identical."
  - "Audit emission wired via injectable `onRateLimitExceeded` callback in plugin options, NOT inside the plugin itself — recordAudit needs a DB tx + tenant context that only buildApp owns, and the callback signature keeps the plugin pure for unit tests."
  - "Subprocess vs direct-API tests both retained for lint-tenant-context — the execFileSync suite proves exit-code shape (CI surface contract), the in-process suite drives v8 coverage of the lint module body."
  - "Coverage measurement note: `tools/**` is excluded from the constitutional coverage gate per vitest.config.ts (mirrors lint-rls.ts pattern). Local verification with an override config shows tools/lint-tenant-context.ts at 96/95/100/95.83."
metrics:
  duration_minutes: 35
  completed: 2026-05-11
  tasks: 2
  files_created: 3
  files_modified: 9
---

# Phase 6 Plan 06-09: Anti-abuse rate-limit + tenant-context static lint Summary

## Overview

Two-surface delivery that closes SCALE-04's rate-limit half and lights up D-W4 layer 1 of the 3-layer worker-tenant-context defense.

**One-liner:** Layered IP + user `@fastify/rate-limit` (Valkey-backed, X-RateLimit-* headers, 429 audit emission) plus TypeScript Compiler API CI gate enforcing `withTenantContext`/`withSystemContext` wrapping on every `apps/worker/src/jobs/**/*.ts` file.

## What landed

### Task 1 — Layered rate-limit + per-route matrix + 429 audit emission

`apps/api/src/config/rate-limits.ts` exports the locked D-RL2 matrix verbatim:

| Route group | rpmUser | rpmIp | Keying | env override prefix |
|---|---|---|---|---|
| probes (livez/readyz/startupz/health) | — | — | skip | — |
| auth signin/signup/forgot | n/a | 10 | ip-only | `RATE_LIMIT_AUTH_*_IP` |
| verification-status (polling carve-out) | n/a | 30 | composite-ip-email | `RATE_LIMIT_VERIFICATION_STATUS` |
| lightweight reads | 120 | 600 | user-and-ip | `RATE_LIMIT_LIGHTWEIGHT_*` |
| transcribe | 20 | 60 | user-and-ip | `RATE_LIMIT_TRANSCRIBE_*` |
| reason | 30 | 90 | user-and-ip | `RATE_LIMIT_REASON_*` |
| agent/stream | 10 | 30 | user-and-ip | `RATE_LIMIT_AGENT_STREAM_*` |
| agent/web-search | 30 | 90 | user-and-ip | `RATE_LIMIT_WEB_SEARCH_*` |
| crud write | 60 | 300 | user-and-ip | `RATE_LIMIT_CRUD_WRITE_*` |
| crud read | 120 | 600 | user-and-ip | `RATE_LIMIT_CRUD_READ_*` |
| crud batch | 20 | 60 | user-and-ip | `RATE_LIMIT_CRUD_BATCH_*` |
| keys/create | 5 | 20 | user-and-ip | `RATE_LIMIT_KEYS_CREATE_*` |
| keys/list+revoke | 30 | 90 | user-and-ip | `RATE_LIMIT_KEYS_OTHER_*` |
| admin/* | 60 | 300 | user-and-ip | `RATE_LIMIT_ADMIN_*` |
| **GLOBAL_IP_CEILING** | n/a | **600/min/IP** | every non-skip route | `RATE_LIMIT_GLOBAL_IP_CEILING` |

`apps/api/src/plugins/rate-limit.ts` is extended over the Phase 2 baseline (which itself is preserved byte-for-byte — every existing `rate-limit-*.test.ts` regression suite still passes):

- New `onRequest` hook fires the IP-tier ceiling FIRST against a dedicated counter (ioredis INCR+PEXPIRE on Valkey, or in-process Map when VALKEY_URL is unset).
- The Phase 2 `@fastify/rate-limit` registration gets `hook: 'preHandler'` + `keyGenerator: req => 'user:' + (req.user?.id ?? req.ip)` + `addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true, 'retry-after': true }`.
- 429 envelope is byte-for-byte preserved: `{error: "Too many requests"}`, single key — Phase 2 contract suite + CONTRACT-01 unchanged.
- New `onRateLimitExceeded?: (req, rule, route) => void | Promise<void>` plugin option. `buildApp` wires it (when `opts.db` is present) to open a short transaction and call `recordAudit('security.rate_limit_exceeded', {rule, route})` (D-A6 #17). Pre-auth abuse with no tenant context is logged warn + dropped — never crashes the response path.

### Task 2 — tools/lint-tenant-context.ts (D-W4 layer 1) + CI integration

`tools/lint-tenant-context.ts` uses the TypeScript Compiler API to walk every `apps/worker/src/jobs/**/*.ts` file (excluding `*.test.ts` and `*.d.ts`) and search for at least one `CallExpression` whose callee identifier is `withTenantContext` or `withSystemContext`. Failure exits 1 with file:line + reason on stderr. Layout drift (no files found) exits 2.

Wired through:
- `pnpm lint:tenant-context` script in root `package.json`.
- `.github/workflows/ci.yml` — new required `lint-tenant-context` job with hardened runner and SHA-pinned actions.
- `scripts/branch-protection.json` — `lint-tenant-context` added to required_status_checks.
- `lefthook.yml` — pre-commit hook on `apps/worker/src/jobs/*.ts` glob (~1s scan against 8 job files).

Combined with Plan 06-07's runtime pg-pool guard (layer 2) and RLS property test (layer 3), the 3-layer D-W4 tenant-context defense is complete.

## GritQL vs TS-AST decision

06-RESEARCH.md §4 rated GritQL `MEDIUM-confidence`. We did NOT run the 30-min spike — the TypeScript Compiler API is already a project devDep, is the exact pattern that powers `tools/lint-rls.ts`, and works on the first try across every BullMQ handler shape in the repo (`new Worker(QUEUE_NAME, withTenantContext(...))`, `const handler = withSystemContext(...)`, `export function createWorker(deps) { ... withTenantContext ... }`). The check is "wrapper identifier appears somewhere in the module body" — TS-AST's `ts.forEachChild` recursive visit nails this in 25 lines. Revisit GritQL only if the lint scope expands to subtle pattern-based rules (e.g. "every `Worker` constructor's 2nd arg must be a CallExpression"), which we don't need today.

## Tests

### Rate-limit (apps/api)

`apps/api/src/plugins/rate-limit.test.ts` — Wave 0 stub flipped GREEN. 31 tests across:
- D-RL1 layered keying (4 tests): IP-tier ceiling, user-tier per-route, auto-degrade-to-IP unauth, EITHER counter exhaustion.
- D-RL2 matrix (14 tests): every row of the matrix asserts both `rateLimits[key]` values + functional (where applicable, e.g. verification-status carve-out preservation, probes 100/100 success).
- D-RL3 response shape (6 tests): envelope unchanged, X-RateLimit-{Limit,Remaining,Reset}, Retry-After, audit emission with rule='user' + route.
- IP-tier audit emission (1 test): rule='ip' fires when ceiling trips.
- IP-tier injected redis-like store (2 tests): redisIpStore.incr + skipOnError-parity degradation.
- getRouteName fallback (1 test): unmatched URL path.
- audit emission failure path (1 test): onRateLimitExceeded throwing does not crash 429 response.
- Env override (2 tests): RATE_LIMIT_* env vars and empty-string parity with defaults.
- Helper (4 tests): routeRateLimitConfig() per-keying-mode return shape.

Phase 2 regression (`rate-limit-check-user`, `rate-limit-verification-status`, `rate-limit-health-exempt`, `rate-limit-valkey-construction`) — 6 + 4 tests — all preserved GREEN.

### Lint (tools)

`tools/lint-tenant-context.test.ts` — Wave 0 stub flipped GREEN. 20 tests:
- 7 subprocess tests via execFileSync (exit codes 0/1/2 + stderr shape contracts).
- 13 direct-API tests covering runLint, scanFile, runMain (clean/failure/drift/internal-error branches), resolveRoot (env-vs-cwd precedence), mainEntry (delegation).

## Coverage

| File | Lines | Branches | Functions | Statements |
|---|---|---|---|---|
| apps/api/src/plugins/rate-limit.ts | 100% (55/55) | 100% (30/30) | 100% (11/11) | 100% (56/56) |
| apps/api/src/config/rate-limits.ts | 100% (11/11) | 100% (8/8) | 100% (2/2) | 100% (12/12) |
| tools/lint-tenant-context.ts (override config) | 95.83% (46/48) | 95% (19/20) | 100% (9/9) | 96% (48/50) |

Note: `tools/**` is excluded from the constitutional coverage gate per `vitest.config.ts` (same posture as `lint-rls.ts` / `lint-tdd.ts`). Local verification with an override config confirms the lint module exceeds 95% on every axis — uncovered lines are the script auto-run sentinel (process.argv[1] comparison) which only fires when invoked as the executable.

## Atomic commits

- `0b0d83a feat(06-09): layered rate limit + per-route matrix + 429 audit emission`
- `30c91db feat(06-09): tenant-context static lint (D-W4 layer 1) + CI integration`
- (final docs commit will follow this SUMMARY write)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — bug] User-tier keyGenerator hook order**
- **Found during:** Task 1
- **Issue:** The plan's `<action>` text said `req.session?.userId ?? req.ip`. The codebase actually stamps `req.user` via `dualAuthHook` (Phase 2, `apps/api/src/middleware/dual-auth.ts`), never `req.session`. Additionally, dualAuthHook is `onRequest` and registered AFTER `rateLimitPlugin`, so without intervention the user-tier keyGenerator would always see `req.user === undefined` and degrade to IP — defeating the layered design.
- **Fix:** Pass `hook: 'preHandler'` to `@fastify/rate-limit` v10 so it evaluates AFTER `dualAuthHook`'s `onRequest`. KeyGenerator reads `req.user?.id ?? req.ip` (matching the actual codebase shape, not the spec text).
- **Files modified:** apps/api/src/plugins/rate-limit.ts
- **Commit:** 0b0d83a

**2. [Rule 4 → Rule 1] @fastify/rate-limit double-registration**
- **Found during:** Task 1
- **Issue:** The plan said "register @fastify/rate-limit TWICE". `fastify-plugin` is idempotent and the second registration is a no-op; the runtime semantics required (independent IP-tier counter + user-tier counter) cannot be achieved by registering the same plugin twice.
- **Fix:** Plan's intent (two independent counters) is preserved via single plugin registration for user-tier + a separate `onRequest` hook using ioredis directly for the IP-tier. Both share the same Valkey instance (single ioredis client). Documented in plugin header comment.
- **Files modified:** apps/api/src/plugins/rate-limit.ts
- **Commit:** 0b0d83a

**3. [Rule 2 — auto-add missing critical functionality] tools/lint-rls.ts NOT modified**
- **Plan mentions** "tools/lint-rls.ts — companion lint that scans queries for raw SQL strings that touch tenant tables without going through the canonical RLS-aware helpers". The plan text says "extend as the plan defines; if scope unclear, follow `tools/lint-rls.test.ts` expectations".
- **Outcome:** `tools/lint-rls.ts` already exists from Phase 1 / Plan 05, scans live Postgres via DATABASE_URL, and Phase 6 Plan 06-02 already extended it for pg_partman child handling (the only Phase 6 extension `tools/lint-rls.test.ts` declares — five PHASE_6_NOT_YET stubs added by Wave 0 Plan 06-01, all already flipped GREEN by Plan 06-02 which authored migration 0009_audit_log_partman.sql + extended the AUDIT_LOG_CHILD_REGEX in lint-rls.ts).
- **Verification:** `pnpm lint:rls` (with a migrated Postgres) passes; the five Phase 6 RED stubs in `tools/lint-rls.test.ts` are GREEN as of commit `cf4cb2c` (Plan 06-02). Plan 06-09 inherits this state — no further extension is needed.

### Auth gates

None — both tasks completed without auth interaction (no upstream API calls; everything stays in-repo).

## Self-Check: PASSED

- `apps/api/src/config/rate-limits.ts` → FOUND ✓
- `apps/api/src/plugins/rate-limit.ts` → FOUND ✓
- `apps/api/src/plugins/rate-limit.test.ts` → FOUND (31 tests GREEN) ✓
- `apps/api/src/index.ts` → FOUND (onRateLimitExceeded wired) ✓
- `.env.example` → FOUND (27 RATE_LIMIT_* lines) ✓
- `tools/lint-tenant-context.ts` → FOUND (exits 0 against current repo) ✓
- `tools/lint-tenant-context.test.ts` → FOUND (20 tests GREEN) ✓
- `package.json` → FOUND (`"lint:tenant-context"` script) ✓
- `.github/workflows/ci.yml` → FOUND (`lint-tenant-context` job) ✓
- `scripts/branch-protection.json` → FOUND (`lint-tenant-context` in required checks) ✓
- `lefthook.yml` → FOUND (pre-commit `tenant-context` glob) ✓
- Commit `0b0d83a` → FOUND ✓
- Commit `30c91db` → FOUND ✓
