---
quick_id: 260530-rqk
slug: ci-required-checks-unblock
date: 2026-05-30
status: complete
---

# Summary: unblock the structurally-broken required CI gates

Nick chose **"Fix the broken CI gates first"** (over admin-merging #17-B) so
PR #47 — and all future PRs — can go green without an owner admin override.
Today multiple required/blocking checks fail on EVERY PR for CI-invocation or
runner-resource reasons (verified identical-red on PR #44/#46/#47, #46 = main).

## Fixed (5 gates, deterministic, TDD where logic changed)

| Gate | Root cause (read from CI logs) | Fix |
|---|---|---|
| `mutation-quick` | `stryker run --incremental --since origin/<base>` → `unknown option '--since'` | drop `--since`; incremental scoping is `--incremental` + cached `stryker-incremental.json` |
| `coverage-floor` | `pnpm test --coverage` where `test`=`vitest run --coverage` → `vitest run --coverage --coverage` → CAC error | call `pnpm test` (single flag) |
| `pr-checklist` | `require-checklist-action` scanned bot comment-checkboxes (CodeRabbit/Copilot) → always incomplete | `skipComments: true` (PR-body checklist still required) |
| `trivy-fs` | CRITICAL/HIGH dep CVE = Dependabot #33 transitive `tmp` path-traversal (dev-only, zero prod) | scoped `.trivyignore` (`CVE-2026-44705` / `GHSA-ph9p-34f9-6g65`) + `trivyignores:` wired; `tools/lint-trivyignore.{ts,test.ts}` enforces specific-ID-only, justified, no-severity-class |
| `load-smoke` | preflight `MemTotal 15.61 GiB < 24 GiB floor` on ~16 GiB hosted runner | preflight RAM floor env-overridable (`PREFLIGHT_MIN_RAM_GIB`, default 24); CI mock smoke sets 12; real `make load-test` keeps 24 |

TDD: `preflight.test.sh` T9 (override lowers floor) + T10 (default 24 GiB
intact) — RED→GREEN verified. `lint-trivyignore.test.ts` 12 cases (severity/
wildcard/bare-ID/malformed-exp rejected; live `.trivyignore` valid + contains
the #33 IDs). No gate bypassed; no real security/coverage/mutation invariant
weakened. Commit `ac5c1a61`.

## Two REAL bugs the CLI fixes unmasked — both fixed (Nick: "fix both до упора")

Fixing the `mutation-quick` `--since` typo and adding the contract-test
diagnostic made Stryker + the migrate boot actually run, exposing two genuine
pre-existing bugs underneath. Both diagnosed from own-eyes evidence and fixed
properly (not blind-patched).

### Bug B — `migrate` exits 1 / OSS `docker compose up` broken (commit 94f93ee3)
The captured contract-test logs showed:
`migrate-1 | refusing to start: PGBOUNCER_ADMIN_PASSWORD is unset or matches deny-list`.
The migrate boot gate (`check-default-secrets.ts`) requires all 10
`COMPOSE_REQUIRED_KEYS` (pgbouncer/minio/grafana/traefik all carry
`profiles: [default]`), but `.env.slim.example` seeded only 6 — PGBOUNCER +
TRAEFIK commented out, MINIO + GRAFANA absent. bootstrap only generates ACTIVE
placeholders, so 4 never materialized → migrate refused. This broke CI AND every
fresh OSS `git clone && docker compose up`. Fix: seed all 4 missing secrets;
regression guard `tools/lint-env-required-secrets.{ts,test.ts}` cross-checks
`.env.slim.example` against `COMPOSE_REQUIRED_KEYS` so they can't drift again.

### Bug A — mutation-quick never green / Stryker dry-run aborts (commit 839d3d6b)
With `--since` gone, Stryker ran and its initial dry-run failed: ~13 tests
`readFileSync` a MUTATED `src/**` file and `toMatch`/`toContain` its text;
Stryker instruments those files (`through.on("close",…)` →
`through.on(stryMutAct_…("168") ? "" : …)`), so the literal tokens vanish and
the tests fail → Stryker aborts before any mutant. These are source-structure
(lint-class) assertions, meaningless under mutation. Fix (Nick decision): list
them in `stryker.config.json` `ignorePatterns` (+ `.claude` worktree noise) so
they're removed from the Stryker sandbox ONLY (still run + gate under
`pnpm test`). Verified end-to-end: `stryker run --mutate .../index.ts` →
"Initial test run succeeded. Ran 64 tests" → "mutation score 70.33 ≥ break 50".
Regression guard `tools/lint-stryker-source-assertion-excludes.test.ts`.

The contract-test job also gained a non-invasive diagnostic (MASTER_KEK
placeholder guard + `docker compose logs migrate` on failure) for future boot
issues. Analysis: `.planning/debug/contract-test-migrate-exit1-2026-05-30.md`.

## Verification
- Both CLI bugs reproduced locally (RED) then confirmed resolved.
- `bash tools/load-test/scripts/preflight.test.sh` → all pass.
- `lint-trivyignore` 12/12; `lint-env-required-secrets` 6/6;
  `lint-stryker-source-assertion-excludes` 5/5; boot-refusal + check-default-
  secrets 42/42.
- Stryker dry-run verified GREEN end-to-end (mutation score 70.33 ≥ 50).
- actionlint: my edits add zero new findings (3 pre-existing on main untouched).
- `pnpm test:all` GREEN for the pre-push evidence gate. Never --no-verify.
- Real proof = PR #48 going green on ALL the previously-red gates without admin
  override (CI run pending after this push).
- Real proof = PR #48 going green on the 5 fixed gates without admin override;
  `contract-test` may still be red pending the migrate diagnosis (surfaced).

## 2026-05-31 follow-up — mutation-quick root cause + contract-test ingress fix

Two more commits, both pushed/committed AFTER the first CI run revealed the
real (non-typo) issues:

1. **mutation-quick 68min → 25s (`a1b36807`, PUSHED, GREEN on CI).** Root cause
   was NOT a typo: `stryker run --incremental` mutated all 4 packages' src/ on a
   cold incremental cache (cache key = hash of pnpm-lock/vitest/stryker config,
   which my edits invalidated), i.e. a FULL run with no job timeout. Fix:
   `tools/stryker-diff-scope.ts` (+13 TDD unit tests) diffs the merge base and
   mutates ONLY the PR's changed *.ts (empty for docs/CI-only PRs → 0 mutants →
   seconds). + `timeout-minutes: 20` backstop. CI confirmed: mutation-quick PASS
   25s (own eyes, PR #48).

2. **coverage-floor (`0cf91116`, PUSHED, GREEN 25s) + contract-test
   (`c654ca57`, COMMITTED, NOT yet pushed).** coverage-floor now consumes the
   `test` job's coverage artifact instead of re-running the suite. contract-test
   root cause (read from CI job log, own eyes): after the storage-overlay fix
   cleared the BYOK guard, the api hit the NEXT pre-existing barrier —
   `FATAL ingress-boot: NODE_ENV=production requires an HTTPS origin` — because
   the job booted WITHOUT the ingress overlay the contract-test profile is
   authored for. Fix (NOT a guard weakening — the guard is intentional): layer
   `compose/docker-compose.ingress.yml` + pin https://api.localhost origins +
   cert path, and run the canonical in-network `seed` + `contract-test-runner`
   containers (matching `make contract-test`) instead of host-side pnpm.

## BLOCKED (handoff state, 2026-05-31 ~02:1x local)
- `c654ca57` (contract-test fix) is COMMITTED locally but NOT pushed: the
  SHA-strict pre-push test-evidence gate needs `c654ca57`-stamped fragments from
  a full `pnpm test:all`, but the LOCAL Docker Desktop VM is wedged — `docker
  run` hangs indefinitely even on cached images, surviving a full app
  quit+kill-9+relaunch. `test:all` stalls on the docker-booting projects
  (tests-self-tests/tests-integration). Safe non-destructive recovery exhausted;
  a destructive VM data-reset was NOT done (machine owner asleep, unauthorized).
- `--no-verify` is constitutionally banned; gaming the gate with empty backfill
  fragments (#65 gap) was deliberately NOT done.
- RESUME when Docker is healthy (`docker run --rm alpine:3 echo ok` returns):
  `pnpm test:all` (keep .env present) → verify 23 `c654ca57*` fragments
  passed/exit 0 → `git push --force-with-lease` (NEVER --no-verify) → watch
  contract-test go green on PR #48 → all 21 runnable required green
  (verify-images is path-filtered, non-applicable) → owner admin-merge #48 →
  ping peer gr0flvsr (k8s) to deploy.
- CURRENT PR #48 (a1b36807) required state: 20/21 GREEN; only contract-test red
  (the thing c654ca57 fixes).
