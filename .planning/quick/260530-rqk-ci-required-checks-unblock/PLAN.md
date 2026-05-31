---
quick_id: 260530-rqk
slug: ci-required-checks-unblock
date: 2026-05-30
status: in_progress
---

# Quick Task: unblock the structurally-broken required/blocking CI checks

## Goal

A PR touching only docs/tests goes **fully green** without an owner admin-merge.
Today `mutation-quick`, `coverage-floor`, `contract-test`, `load-smoke`,
`pr-checklist`, `trivy-fs` (and the e2e/playwright cluster) fail on EVERY PR for
CI-invocation or runner-resource reasons unrelated to PR content — forcing the
owner to admin-merge (#44, #46, #47). Fix the invocation bugs; honestly scope
the env-impossible gates with documented justification. **Never** bypass a gate
or weaken a real security/coverage/mutation invariant.

## Root causes (all read from CI logs with own eyes, run 26687976229 / PR #47)

| Check | Root cause | Class |
|---|---|---|
| `mutation-quick` | `stryker run --incremental --since origin/<base>` → `error: unknown option '--since'` (Stryker has no `--since`) | CI-invocation bug |
| `coverage-floor` | `pnpm test --coverage` where `test`=`vitest run --coverage` → `vitest run --coverage --coverage` → CAC `Expected a single value for option "--coverage"` | CI-invocation bug |
| `pr-checklist` | `require-checklist-action` `skipComments:false` counts bot comment-checkboxes (CodeRabbit/Copilot "Create stacked PR") as incomplete | action-config bug |
| `trivy-fs` | CRITICAL/HIGH dep CVE = known Dependabot #33 transitive `tmp` path-traversal (dev-only, zero prod) | scoped-ignore |
| `load-smoke` | preflight `Docker MemTotal 15.61 GiB < 24 GiB floor` on hosted runner; a ≤2-min mock smoke does not need plateau RAM | env-scope |
| `contract-test`, `e2e-hermetic`, `e2e-phase6-quick`, `embedded-smoke`, `playwright` | `docker compose ... up -d --wait` boot/health failures on hosted runner | env/health — INVESTIGATE, do not blind-fix |

## Approach (smallest honest fix per defect)

### Task 1 — mutation-quick `--since` (ci.yml:190)
Stryker's incremental mode already scopes via `--incremental` + cached
`reports/stryker-incremental.json`; `--since` is not a Stryker flag. Drop the
`--since origin/...` arg → `pnpm test:mutation:incremental`. The base-ref diff
scoping that `--since` *intended* is not supported by Stryker CLI; incremental
caching is the supported mechanism. (If true diff-scoping is wanted later, that
is a separate Stryker `--mutate` glob computation — out of scope here.)

### Task 2 — coverage-floor duplicate `--coverage` (ci.yml:781)
`pnpm test --coverage` → drop the extra flag → `pnpm test` (script already
carries `--coverage`). Leaves the coverage-summary.json + floor lint intact.

### Task 3 — pr-checklist comment false-positive (ci.yml:197)
Set `skipComments: true` so only the PR-body checklist is evaluated, not
bot-injected comment checkboxes. The PR-body checklist requirement stays.

### Task 4 — trivy-fs scoped ignore (.trivyignore, new)
Add `.trivyignore` listing the exact CVE/GHSA for the #33 transitive `tmp`
path-traversal with a justification comment + expiry note. Wire trivy-action
`trivyignores:` (or rely on default `.trivyignore` discovery). Verify the file
masks ONLY that advisory (no blanket severity downgrade) — a new unrelated
CRITICAL must still fail the gate. Add a regression test asserting `.trivyignore`
contains the CVE id and is non-empty / well-formed.

### Task 5 — load-smoke RAM floor env-override (preflight.sh:34)
Make `REQUIRED_RAM_BYTES` honor an env override
`PREFLIGHT_MIN_RAM_GIB` (default stays 24). The CI `load-smoke` job (mock
profile, ≤2 min, ≤5 VU) sets `PREFLIGHT_MIN_RAM_GIB=12` — a mock smoke is not a
1000-VU plateau, so the 24 GiB plateau floor is the wrong gate for it. Real
`make load-test PROFILE=...` keeps 24 GiB. Extend `preflight.test.sh` with a
case proving the override lowers the floor AND that the default is still 24.

### Task 6 — contract-test / e2e / embedded-smoke / playwright boot failures
INVESTIGATE first (read the captured compose logs artifacts). Likely a
health-wait timeout under hosted-runner memory pressure. Candidate fixes:
raise `--wait-timeout`, reduce the profile's resident set for CI, or split the
heavy compose boot. **Do not** weaken the assertions. If the true fix needs a
bigger runner or is non-trivial, log it as a deferred sub-item and surface to
Nick rather than guessing — these are REQUIRED gates and must stay meaningful.

## Surface
- `.github/workflows/ci.yml` (Tasks 1, 2, 3, 5-CI-env)
- `.trivyignore` (Task 4, new) + a tools/*.test.ts regression
- `tools/load-test/scripts/preflight.sh` + `preflight.test.sh` (Task 5)
- contract-test/e2e job blocks in ci.yml (Task 6, after investigation)

## Verification
- actionlint clean on ci.yml.
- `bash tools/load-test/scripts/preflight.test.sh` green (override + default).
- trivyignore regression test green.
- `pnpm test:all` GREEN (pre-push evidence gate) — never --no-verify.
- The real proof is a follow-up PR (or this one) going green on all required
  checks WITHOUT admin override. Surface any check that still cannot pass.
