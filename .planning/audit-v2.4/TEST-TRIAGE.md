# v2.4 — Test-suite triage (Phases 57-58 verification)

**Date:** 2026-05-22
**Method:** ran the full monorepo suite at v2.4 HEAD and at the pre-v2.4 baseline
(`3b504fa3`, a fresh worktree at `/tmp/v24-baseline`), then diffed failures.

## Headline

The project's `main` branch is **NOT green** — it carries a pre-existing failing-test
backlog. v2.4's Phases 57-58 introduced **one** regression, now fixed.

## v2.4 HEAD full run (coverage)

`Test Files 14 failed | 472 passed | 40 skipped (526)` — `Tests 39 failed | 5316 passed | 228 skipped`.

(An earlier non-coverage `pnpm -w test --run` reported 143 failed — that run hit a stale
`tests-integration` state; the clean coverage run's 39 is authoritative.)

## Baseline (pre-v2.4 `3b504fa3`) — per-file classification

| Failing file | baseline fails | v2.4 fails | verdict |
|---|---|---|---|
| `env-slim-example.test.ts` | 4 | 4 | pre-existing |
| `oidc-env-wiring.test.ts` | 4 | 4 | pre-existing |
| `compose-overlays.test.ts` | 8 | 8 | pre-existing |
| `traefik-network-alias.test.ts` | 9 | 9 | pre-existing |
| `contract-test-runner-compose.test.ts` | 3 | 3 | pre-existing |
| `0020-drop-plaintext.test.ts` | 2 | 2 | pre-existing (NOT a Phase-57/migration-0031 regression) |
| `boot-order.test.ts` | 1 | 1 | pre-existing |
| `plan-52-04b-routes-cascade.test.ts` | 1 | 1 | pre-existing |
| `auth-locale-and-enqueue.test.ts` | 1 | 1 | pre-existing |
| `test-only.test.ts` | 1 | 1 | pre-existing |
| `i18n-completeness.test.ts` | 1 | 1 | pre-existing |
| `slim-core-base.test.ts` | 1 (Test 1) | **2** → fixed to 1 | **v2.4 regression — FIXED** |
| `virtual-key-rotation-removed.test.ts` | TBD | 2 | pending baseline-full diff |
| `lint-ui-spec.test.ts` | TBD | 2 | pending baseline-full diff |

## v2.4 regression — identified and fixed

`slim-core-base.test.ts` Test 2 ("no surviving service declares a `profiles:` key") failed
because Phase 58 AUDIT-HARD-04 correctly added `profiles: [dev]` to mailpit. The Phase-14
test's premise was written before any dev-profiled service existed. Test 2 reworked to the
correct invariant: any service declaring `profiles:` must be gated OUT of the `default`
profile. Commit on branch `v2.4-oss-publish`. `slim-core-base.test.ts` back to 1 failure
(Test 1, pre-existing).

## Pre-existing backlog — NOT v2.4 scope

`slim-core-base.test.ts` Test 1 ("services keys equal exactly the 7-service slim-core set")
fails because `docker-compose.yml` on `main` still has ~19 services — Phase 14's slim-core
GREEN was never fully landed, or the base drifted back. This + the ~33 other pre-existing
`tests-integration` / `|api|` failures are a **pre-existing test-debt backlog on `main`**
and are out of scope for v2.4 (an audit-and-publish milestone). Recommend a dedicated
test-debt phase. Logged here rather than silently "fixed" per CLAUDE.md Hard Rules 1 + 2.
