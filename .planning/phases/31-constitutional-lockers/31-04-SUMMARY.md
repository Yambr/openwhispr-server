---
phase: 31-constitutional-lockers
plan: 04
subsystem: tooling/constitutional-lockers
tags: [locker, lint, ast, prod-readiness, fastify, dead-export]
requires: [31-01, 31-02, 31-03]
provides: [LOCKER-04, lint-prod-readiness, prod-readiness-allowlist]
affects: [tools/, package.json]
tech_added: []
patterns:
  - "Direct `import ts from 'typescript'` AST traversal (mirrors lint-tenant-context.ts / lint-shell-credential-interpolation.ts)"
  - "Two-pass static audit — route-shape + dead-export — sharing a single source walker"
  - "Workspace `@openwhispr/<name>` -> `packages/<name>/src/index.ts` resolution at lint-time (no `ts-morph` Project bootstrap)"
key_files_created:
  - tools/lint-prod-readiness.ts
  - tools/lint-prod-readiness.test.ts
  - tools/lint-prod-readiness.allowlist.txt
  - tools/lint-prod-readiness/fixtures/route-no-schema.ts
  - tools/lint-prod-readiness/fixtures/route-no-ratelimit.ts
  - tools/lint-prod-readiness/fixtures/route-health-ok.ts
  - tools/lint-prod-readiness/fixtures/route-good.ts
  - tools/lint-prod-readiness/fixtures/route-get-shape.ts
  - tools/lint-prod-readiness/fixtures/dead-export/exporter.ts
  - tools/lint-prod-readiness/fixtures/dead-export/non-importer.ts
key_files_modified:
  - package.json
decisions:
  - "Direct `import ts from 'typescript'` over ts-morph (cold-start budget; uniformity with sibling linters per 31-RESEARCH §LOCKER-04)."
  - "Combine route-shape and dead-export passes into a single GREEN commit (plan called for two) — both passes share `walkSources` / `collectExports` / `collectImports` / `readAllowlist`. Splitting would either duplicate the helpers or land an incoherent intermediate. Documented under Deviations below."
  - "Health-probe URL allowlist widened beyond `/api/health` per `apps/api/src/routes/probes.ts:82-143` precedent: `/api/health`, `/api/healthz`, `/api/ready`, `/livez`, `/readyz`, `/startupz`, `/api/_test/`. Kubelet uses `/livez|readyz|startupz` and rate-limiting probes would saturate the limiter at 1000 pods × 10s period."
  - "Health-probe routes are also exempt from `LOCKER-04-NO-SCHEMA` (zero-arg GETs with no body to validate)."
  - "`LOCKER-04-UNRESOLVED-IMPORT` is a separate diagnostic class from `LOCKER-04-DEAD-EXPORT` per 31-PLANS-INDEX risk #4; allowlist absorbs each independently."
  - "`scanRouteFile` is exported (single-file API) so future tooling can audit a single route file without booting the full repo walk."
metrics:
  duration_minutes: 35
  tests_total: 33
  tests_passing: 33
  coverage_statements: 96.37
  coverage_branches: 92.30
  coverage_functions: 96.77
  coverage_lines: 98.00
  allowlist_total: 516
  allowlist_route_bulkfix_31_08: 47
  allowlist_dead_export_phase_38: 469
  allowlist_unresolved_import: 0
  raw_findings_count: 546
---

# Phase 31 Plan 04: `lint-prod-readiness.ts` Summary

Two-pass TypeScript-AST locker (`tools/lint-prod-readiness.ts`) closes **LOCKER-04** / DISCIPLINE Rule 14. Shipped in **WARN-only** mode (the `pnpm lint:prod-readiness` script wraps `tsx tools/lint-prod-readiness.ts --warn-only`); the BLOCKING flip lands in the final commit of Plan 31-08 by removing `--warn-only` from lefthook + ci.yml + nightly.yml + Makefile.

## What Shipped

### Pass A — Route-shape audit

Every Fastify route in `apps/**/src/**` must declare:

- `schema: { body|querystring|params: <ZodSchema> }` — diagnostic `LOCKER-04-NO-SCHEMA` when absent. Exempt for health-probe URLs.
- `config: { rateLimit: ... }` — diagnostic `LOCKER-04-NO-RATELIMIT` when absent. `rateLimit: false` allowed **only** on `/api/health`, `/api/healthz`, `/api/ready`, `/livez`, `/readyz`, `/startupz`, `/api/_test/` (kubelet probes + hermetic test hooks). `LOCKER-04-INVALID-RATELIMIT-FALSE` flags it elsewhere.
- `app.<verb>(url, opts, handler)` shape: missing opts object → `LOCKER-04-NO-CONFIG`.
- Non-literal options arg (`app.route(someIdentifier)`) → `LOCKER-04-UNRESOLVED`.

Receiver names accepted: `app`, `fastify` (plugin-rebound shape — RESEARCH §A4).

### Pass B — Dead-export audit

Every `export` symbol in `apps/**/src/**` + `packages/**/src/**` must have ≥ 1 non-test importer.

- Relative specifiers (`./x.js`, `../y`) → resolve against importer's directory; trailing `.js` stripped to find the TS source. Candidates probed: `.ts`, `.tsx`, `/index.ts`, `/index.tsx`.
- Workspace `@openwhispr/<name>` → `packages/<name>/src/index.ts`.
- Workspace specifier that fails to resolve → `LOCKER-04-UNRESOLVED-IMPORT` (separately allowlistable per 31-PLANS-INDEX risk #4).
- External npm specifiers (`react`, `zod`, …) are silently skipped — out-of-scope by design.
- `import "./x.js"` (side-effect), `import * as M from "./x.js"` (namespace), `import foo from "./x.js"` (default), and `export * from "./x.js"` (re-export *) all mark the target as wildcard-live (covers all exports of the target file).
- Importers under `tests/**`, `**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**` do NOT count toward the live-importer set.

### CLI shape

```
pnpm exec tsx tools/lint-prod-readiness.ts [--warn-only] [rootDir]
pnpm lint:prod-readiness        # equivalent to --warn-only
pnpm test:lint-prod-readiness   # vitest + ≥ 90/90/90/90 coverage gate
```

Exit codes: `0` clean / all-allowlisted / `--warn-only`; `1` failing findings (BLOCKING); `2` internal error (rootDir missing, parser exception).

## Commits

| Hash | Subject |
|------|---------|
| `fa2f954` | `test(31-04): red — lint-prod-readiness fixtures + failing import` |
| `4c84cdb` | `feat(31-04): green — lint-prod-readiness route-shape + dead-export (LOCKER-04)` |

The trailing `docs(31-04)` commit lands with this SUMMARY.

## Allowlist Snapshot

Seeded against current `main` via `pnpm exec tsx tools/lint-prod-readiness.ts`:

| Bucket | Count | Tracking |
|--------|------:|----------|
| Route bulkfix (Plan 31-08) | **47** | `# issue-31-04-debt-LOCKER-04-route-bulkfix-31-08` |
| Dead-export (Phase 38, mostly `@openwhispr/auth`) | **469** | `# issue-31-04-debt-LOCKER-04-dead-export-phase-38` |
| Unresolved-import | **0** | (none on current main) |
| **Total entries** | **516** | |

Raw finding count is **546** (47 NO-SCHEMA + 3 NO-RATELIMIT + 1 INVALID-RATELIMIT-FALSE + 496 DEAD-EXPORT). The allowlist key is `file:line` so multiple findings on the same line collapse to a single entry (route-shape lines where both `schema:` AND `config.rateLimit` are missing produce 2 diagnostics but 1 allowlist row).

The plan's pre-research estimate of "~18 violating routes" undercounted by ~2.6×. Bulk-fix scope for 31-08 is closer to 50 file:line sites concentrated across `apps/api/src/routes/**`. The fix is still feasible in-scope (each route is a 2-line edit + zod schema selection).

The plan's expected dead-export count was unspecified ("uncounted"). 469 entries is dominated by `@openwhispr/auth` (Phase 38 retirement), `apps/api/src/auth.ts`, and the public re-export surfaces of `packages/wire-schemas`, `packages/data`, `packages/litellm-client`, `packages/observability`. Each carries the `phase-38` tracking tag so the retirement plan inherits a complete debt ledger.

## Flip-readiness

Manually verified the 31-08 flip works as a pure flag removal:

```
$ cp tools/lint-prod-readiness.allowlist.txt /tmp/bak ; echo > tools/lint-prod-readiness.allowlist.txt
$ pnpm exec tsx tools/lint-prod-readiness.ts >/dev/null 2>&1 ; echo $?
1
$ pnpm exec tsx tools/lint-prod-readiness.ts --warn-only >/dev/null 2>&1 ; echo $?
0
$ cp /tmp/bak tools/lint-prod-readiness.allowlist.txt
```

Same input → exit 1 BLOCKING / exit 0 WARN-only / exit 0 with seeded allowlist. The 31-08 flip is a single-flag change in package.json + ci/lefthook config.

## Coverage

`pnpm test:lint-prod-readiness` (33 tests, 1 file):

```
Statements : 96.37 % (266/276)
Branches   : 92.30 % (168/182)
Functions  : 96.77 % (30/31)
Lines      : 98.00 % (246/251)
```

All four axes clear the 90/90/90/90 DISCIPLINE Rule 2 floor. The remaining uncovered lines are `/* c8 ignore */`-annotated defensive guards against rare AST shapes (computed property keys, non-Identifier variable destructuring, statSync race conditions, single-replica entrypoint binding).

## Deviations from Plan

### 1. Combined route-shape + dead-export into one GREEN commit (process deviation)

The plan called for three commits: RED, GREEN route-shape (Task 2), GREEN dead-export (Task 3). I combined Tasks 2 + 3 into a single GREEN commit because both passes share `walkSources` / `collectExports` / `collectImports` / `readAllowlist` / `pushFinding`. A two-commit split would either duplicate those helpers (incurring rework in commit 3) or land an intermediate commit where dead-export functions exist but are never invoked (incoherent state failing self-audit). The combined commit is atomic, the entire vitest suite covers both passes, and the diff is reviewable.

This is a Rule 1-style process deviation (no architectural change, no scope creep, no skipped tests).

### 2. Health-probe URL allowlist widened beyond `/api/health` (correctness)

Plan listed `/api/health|/api/ready|/api/healthz|/api/_test/` as the rateLimit-false-allowed substring set. I added `/livez`, `/readyz`, `/startupz` after reading `apps/api/src/routes/probes.ts:82-143` which declares all three as kubelet probes with `config: { auth: false, rateLimit: false }`. Without that widening the linter would emit 3 false-positive `INVALID-RATELIMIT-FALSE` findings on routes that are correctly designed.

Rule 1 (Auto-fix bugs) — caught during real-repo run; documented here, no user prompt needed.

### 3. Health-probe routes also exempt from `LOCKER-04-NO-SCHEMA`

Probes are GET-only with no request body to validate. The original spec said `rateLimit: false` was allowed for health URLs but did not explicitly say `schema:` could be omitted. I extended the exemption symmetrically — the linter now skips both checks on health URLs. Confirmed against `probes.ts`: zero of the four probe routes declare `schema:`. Without this exemption every probe would carry a permanent allowlist entry.

Rule 2 (Critical correctness) — matches the existing production pattern.

## Self-Check: PASSED

Verified the following before finalising:

- [x] `git log --oneline -3` shows `fa2f954` (RED) and `4c84cdb` (GREEN).
- [x] `pnpm test:lint-prod-readiness` exits 0 with 33/33 passing.
- [x] Coverage 96.37 / 92.30 / 96.77 / 98.00 ≥ 90/90/90/90.
- [x] `pnpm lint:prod-readiness` exits 0 on current main (allowlisted, no new violations).
- [x] Stripping the allowlist + dropping `--warn-only` yields exit 1 (flip-readiness).
- [x] Fixtures present: 5 route shapes + 2 dead-export modules.
- [x] Allowlist file present with 516 non-comment entries (47 route + 469 dead-export).
- [x] `package.json` carries `lint:prod-readiness` (with `--warn-only`) and `test:lint-prod-readiness` (with coverage flags).
- [x] No edits to production routes (`apps/**/src/**`) — Phase 41/41.b/31-08 scope per Wave-2 isolation.
- [x] No edits to lefthook / CI / Makefile / DISCIPLINE / CLAUDE — Plan 31-07 / 31-08 scope.
