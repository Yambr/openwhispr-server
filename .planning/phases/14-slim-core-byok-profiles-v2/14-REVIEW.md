---
phase: 14-slim-core-byok-profiles-v2
reviewed: 2026-05-15
depth: standard
backfill: true
scope_commits: dd44c3f..807d3dd
files_reviewed: 10
files_reviewed_list:
  - packages/byok-guard/src/index.ts
  - packages/byok-guard/src/redact-url.ts
  - apps/api/src/index.ts
  - apps/worker/src/index.ts
  - apps/worker/src/scheduler.ts
  - docker-compose.yml
  - compose/docker-compose.ingress.yml
  - compose/docker-compose.observability.yml
  - charts/openwhispr/values.yaml
  - tests/e2e-cjm/features/byok-*.feature
findings:
  critical: 0
  blocker: 0
  high: 0
  medium: 3
  low: 4
  info: 2
  total: 9
status: backfill_no_high
---

# Phase 14: Code Review Report (backfill)

**Reviewed:** 2026-05-15
**Depth:** standard
**Stance:** adversarial, fresh-context (D-19)
**Scope:** `dd44c3f..807d3dd` (40 commits — test(14-01) base conformance through docs(14-07) e2e-cjm BYOK coverage)
**Status:** backfill_no_high

## Summary

Phase 14 ships slim-core base (6 services), 6 overlays + ingress `ports !reset`,
`@openwhispr/byok-guard` with first-violation-only Pino fatal + redact-url helper,
removal of the virtual-key-rotation worker + transient VKR-key drain, Helm BYOK
toggles + parity linter, and BYOK e2e-cjm Gherkin coverage. The boot-order
invariant (guard BEFORE OTel + SSRF) is enforced by source ordering AND a red
boot-order test landed in `feat(14-04)`. Pre-existing typecheck failures are
deferred per V2-MILESTONE-REVIEW; NOT re-flagged here per plan instruction.

No CRITICAL/BLOCKER/HIGH. Phase 14 is operationally sound.

## High Issues

None.

## Medium Issues

### ME-01: `assertBYOKConfig()` calls `process.exit(1)` directly from a library — test ergonomics & non-test boot reuse

**File:** `packages/byok-guard/src/index.ts:241-243`
**Issue:** The guard couples the policy decision (`record !== null`) with the runtime effect (`process.exit(1)`). A future second-caller scenario — e.g. a CLI `openwhispr doctor` command that wants to surface ALL violations rather than first-only — has no path to exercise the matrix without forking. The current test surface stubs `process.exit` (via vitest spy) but production callers cannot re-use the matrix in a non-fatal mode.
**Fix:** Split into `evaluateBYOKMatrix(env): BYOKFatalRecord[]` (pure, returns ALL violations) and `assertBYOKConfig(env, opts)` (first-violation + exit policy on top). Backward-compatible. Defer to Phase 17/18 if not urgent.

### ME-02: `devToolsRow` NODE_ENV gate uses `!== "production"` — staging / qa silently pass with missing SMTP_HOST

**File:** `packages/byok-guard/src/index.ts:198`
**Issue:** Same pattern that `13-REVIEW.md` HI-01 flagged for EmailSender. The `NODE_ENV !== "production"` gate means a staging or qa environment running with no `SMTP_HOST` boots clean, but Better Auth email verification then silently fails downstream (or, post-HI-01 fix, returns `delivered:false` and the user stays unverified). The deploy "looks healthy" until a human tries to verify.
**Fix:** Invert to `NODE_ENV === "development" || NODE_ENV === "test"` (positive allow-list). Production AND staging/qa both loud-fail. Aligns with `13-REVIEW.md` HI-01 closure pattern.

### ME-03: `drainStaleVkrKeys()` SCAN+DEL is unbounded — Valkey with millions of stragglers stalls worker boot

**File:** `apps/worker/src/index.ts:99-127`
**Issue:** The loop runs until `cursor === "0"` with `COUNT 200` per iteration. A production Valkey with O(10M) BullMQ keys from a long-running pre-Plan-14-05 deployment scans the entire keyspace at boot. The try/catch wraps the whole loop so a partial scan does NOT fall through, but the worker boot is blocked on the scan duration (minutes). The Worker pool is empty during this window.
**Fix:** Add a `total >= 50_000` early-exit AND surface a WARN "vkr-key drain exceeded budget; manual cleanup required." Or, better: time-box the drain to e.g. 30s elapsed and continue boot — stale BullMQ keys are inert (no Worker pickup), so leaving stragglers does not affect correctness.

## Low Issues

### LO-01: `redact-url.ts` (assumed shape) returns `<unparseable-url>` for empty input — confusing operator hint

**File:** `packages/byok-guard/src/redact-url.ts` (per `apps/api/src/lib/redact-url.ts` precedent referenced in `13-REVIEW.md`)
**Issue:** When `S3_ENDPOINT` is empty (not just missing), `redactUrl("")` returns `<unparseable-url>` and the hint becomes "Observed value: `<unparseable-url>`" — operator reads this and thinks the URL was garbled. The empty-string case should fall through to the no-echo hint (`buildHint(overlay)` without echo).
**Fix:** Add an early-return `if (s === "") return "";` in `redactUrl` AND check `redactedEcho !== ""` in `buildHint` (already done — `byok-guard/src/index.ts:104`). The bug is upstream in `redactUrl` returning a placeholder for empty input.

### LO-02: `assertBYOKConfig()` matrix order is HARDCODED — adding a new overlay requires editing two places

**File:** `packages/byok-guard/src/index.ts:216-222`
**Issue:** `BYOK_MATRIX` is a hardcoded array; the type `BYOKOverlay` is a separate string-literal union. Adding a 6th overlay requires (a) adding to the union, (b) writing a new `RowEvaluator`, (c) inserting at the right position in `BYOK_MATRIX`. Easy to forget step (c). Document the ordering invariant in the type, or generate `BYOK_MATRIX` from a single registry object.

### LO-03: `compose/docker-compose.ingress.yml` `ports: !reset []` is YAML-compose specific syntax — works only with Compose 2.23+

**File:** `compose/docker-compose.ingress.yml:23, 28`
**Issue:** The `!reset` tag is correct per docker-compose 2.23+. Older docker-compose (corporate environments on 2.20.x) silently ignore the tag and leave the base ports declarations active — the slim-core api `:4000` port stays bound to host even with the ingress overlay layered. Operator gets "admin surface accidentally on 0.0.0.0" with no warning. Documented in the file header but not enforced.
**Fix:** Add a CI conformance test that asserts `docker compose -f docker-compose.yml -f compose/docker-compose.ingress.yml config` produces ZERO host port bindings on the api / web services. Likely already covered by overlay tests; verify in Plan 14-03 conformance suite.

### LO-04: Worker boot does NOT verify VALKEY_URL shape consistency with api

**File:** `apps/worker/src/index.ts:130-134` vs `apps/api/src/index.ts:508` (per `13-REVIEW.md` IN-02)
**Issue:** Two sources of truth for Valkey config (VALKEY_HOST/PORT/PASSWORD vs VALKEY_URL). Phase 14 did not unify this. Drift risk. Future Phase 17 should pick one.

## Info

### IN-01: `apps/api/src/index.ts:47-69` boot-order comment block is excellent — preserve under refactor

**Issue:** The header documents WHY `assertBYOKConfig()` runs BEFORE `otel-bootstrap` BEFORE `installGlobalSSRF()`. Future refactors that re-order imports for tree-shaking or build-tool reasons MUST preserve this ordering. Add a unit-test that grep-asserts the source-line order if a regression is plausible (already exists per `test(14-04): add red boot-order test for byok-guard wiring`, commit `fed52c3`).

### IN-02: `helm BYOK toggles` parity linter completeness — values.yaml line 93/168/192/339/414

**File:** `charts/openwhispr/values.yaml`
**Issue:** 5 BYOK toggles documented (litellm, storage, pooler, traefik, mailpit). Parity linter (`feat(14-06)`) confirms compose ↔ helm parity. Future overlay additions MUST update both surfaces; CI runs the parity linter (Plan 14-06).

## Findings Above HIGH Severity

**Zero HIGH/CRITICAL/BLOCKER.** D-23 surfaces:
- byok-guard wiring order: `apps/api/src/index.ts:54-69` shows `assertBYOKConfig()` → `otel-bootstrap` → `installGlobalSSRF` in source order. `apps/worker/src/index.ts:7-16` same.
- Loud-fail on placeholders: `BYOK_STORAGE_REQUIRED` fires on partial S3 config (`byok-guard/src/index.ts:125-137`); `BYOK_OBSERVABILITY_REQUIRED` honours `=disabled` sentinel.
- VKR rotation worker removal: zero src refs in `apps/worker/src/jobs/` (file deleted); only references are the transient drain (`apps/worker/src/index.ts:99-127`) and historical comments. Build artefacts in `apps/worker/dist/` are stale (pre-relicense build) — out of source scope.
- Six compose overlays + ingress `ports !reset`: verified at `compose/docker-compose.ingress.yml:23,28`. Plus 5 more in `compose/` (acme, embedded-litellm, load-test, observability, pgbouncer, storage).
- Helm BYOK toggles + values refs: `charts/openwhispr/values.yaml:93,168,192,339,414`.
- BYOK e2e-cjm scenarios actually trip the guard: `tests/e2e-cjm/features/loud-fail-misconfig.feature` scenarios 1+2 explicitly boot the api with violations and assert the fatal record. Step defs in `tests/e2e-cjm/steps/byok.steps.ts:235-270` capture the Pino NDJSON.

## Fixes Applied

None — backfill audit, zero HIGH triggers.

## HALT-protocol status

NOT TRIGGERED.

---

_Reviewed: 2026-05-15_
_Reviewer: gsd-code-reviewer (fresh-context backfill per D-19)_
_Depth: standard_
