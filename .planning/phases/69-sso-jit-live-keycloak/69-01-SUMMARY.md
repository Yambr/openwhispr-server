<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
---
phase: 69-sso-jit-live-keycloak
plan: 01
subsystem: auth
tags: [sso, jit, oidc, keycloak, pure-resolver, boot-validator]
requires:
  - "lib/oidc-providers.ts present()/env-defaulted reader pattern"
  - "config/litellm.ts validateLitellmBoot exit-78 posture"
provides:
  - "readJitConfig(env): JitConfig | null — 7-var loader, JIT-disable gate"
  - "JitConfig type (tenantClaim, tenantMapping?, groupClaim, roleMapping?, rolePriority, defaultRole, revocationMode)"
  - "validateJitBoot(env, onFail): single JSON.parse + zod site for OIDC_TENANT_MAPPING/OIDC_ROLE_MAPPING, exit 78"
  - "resolveJitDecision(claims, cfg, existing?): JitDecision — pure shared decision tree (D-69-1)"
  - "JitDecision + RejectionCode + ExistingIdentity types"
affects:
  - "Wave 2: web genericOAuth mapProfileToUser + desktop mint-bearer both call resolveJitDecision"
tech-stack:
  added: []
  patterns:
    - "env-defaulted reader (env = DEFAULT_ENV) + present() guard, mirrors oidc-providers.ts"
    - "boot loud-fail co-location (exit 78 / EX_CONFIG) alongside validateLitellmBoot/validateEncryptionBoot"
    - "discriminated-union return (never throw on bad claims), mirrors oidc-providers returning values"
    - "defensive claim coercion (asRecord/asStringArray), mirrors settings-resolver.ts"
key-files:
  created:
    - apps/api/src/lib/oidc-jit-config.ts
    - apps/api/src/config/oidc-jit-boot.ts
    - apps/api/src/lib/oidc-jit-resolver.ts
    - apps/api/tests/unit/lib/__tests__/oidc-jit-config.test.ts
    - apps/api/tests/unit/config/oidc-jit-boot.test.ts
    - apps/api/tests/unit/lib/__tests__/oidc-jit-resolver.test.ts
  modified: []
decisions:
  - "Test files placed per existing repo convention (config tests in tests/unit/config/, lib tests in tests/unit/lib/__tests__/) rather than the plan's tests/unit/__tests__/ suggestion, so vitest discovers them alongside their siblings."
  - "validateJitBoot is the SINGLE JSON.parse site; readJitConfig delegates to it (loud-fail co-location, not a LOCKER-01 mandate — LOCKER-01 only restricts NODE_ENV branching)."
  - "OIDC_DEFAULT_ROLE outside admin|member|viewer is treated as forbidden_no_role_mapping (operator config error) rather than minting a bogus role — avoids an `as JitRole` suppression and closes the branch defensively."
metrics:
  duration: ~25m
  completed: 2026-05-29
  tasks: 2
  files: 6
---

# Phase 69 Plan 01: SSO JIT Pure Foundations Summary

One-liner: Two pure, no-I/O JIT-SSO foundations — a 7-var env loader (`readJitConfig`) with a co-located JSON.parse boot validator (`validateJitBoot`, exit 78), and the shared claim→{tenantId,role} decision tree (`resolveJitDecision`) at 100% branch — both consumed verbatim by Wave 2's web + desktop seams per D-69-1.

## What Was Built

### Task 1 — config loader + boot validator (TDD)
- **`apps/api/src/lib/oidc-jit-config.ts`** — `readJitConfig(env = process.env): JitConfig | null`. Mirrors `oidc-providers.ts` (`present()` guard, env-defaulted arg). Returns `null` when `OIDC_TENANT_CLAIM` is unset (JIT silently disabled). Reads the 7 vars with documented defaults (`groupClaim="groups"`, `rolePriority=["admin","member","viewer"]`, `defaultRole=null`, `revocationMode="downgrade_to_default"`). Parses `OIDC_ROLE_PRIORITY` by splitting on `/\s*>\s*/`; the literal string `"null"` maps `defaultRole` to `null`. The two mapping vars arrive ALREADY-PARSED (delegated to `validateJitBoot`).
- **`apps/api/src/config/oidc-jit-boot.ts`** — `validateJitBoot(env, onFail = defaultFail): { tenantMapping?, roleMapping? }`. Single JSON.parse site for `OIDC_TENANT_MAPPING` (zod `record(string, string)`) and `OIDC_ROLE_MAPPING` (zod `record(string, enum(admin|member|viewer))`). Malformed JSON or invalid shape → `onFail` naming the var; default `onFail` writes `FATAL` to stderr + `process.exit(78)` (`EX_CONFIG`), verbatim posture from `config/litellm.ts`. Absent vars → `undefined` (optional, no throw). Lives in `config/` for loud-fail co-location with the other boot validators — architectural, not a locker mandate.

### Task 2 — pure resolver (TDD, 100% branch)
- **`apps/api/src/lib/oidc-jit-resolver.ts`** — `resolveJitDecision(claims, cfg, existing?): JitDecision`. PURE: no env read, no DB, no Better Auth, no `fetch`. Discriminated-union return (`{ok:true; tenantId; role; downgraded?}` | `{ok:false; code:RejectionCode}`), never throws on bad claims. Decision tree:
  1. Resolve tenant key — `email_domain` mode (split email on `@`) or named-claim mode; missing → `forbidden_missing_tenant_claim`, malformed → `invalid_oidc_profile`.
  2. Map through `tenantMapping`; not found → `forbidden_unknown_tenant`.
  3. Returning user with changed tenant → `forbidden_tenant_mismatch` (mode 6, D-69-3).
  4. Collect groups (defensive `asStringArray`); map via `roleMapping`; tie-break by `rolePriority` index (mode 4).
  5. No match: `defaultRole===null` → `forbidden_no_role_mapping`; else assign default role.
  6. Returning admin downgraded by revocation → `downgraded:true` (mode 5).

## Verification

- `pnpm exec vitest run --project=api oidc-jit` → **3 files / 47 tests passed**.
- Resolver coverage (computed from `coverage-final.json`): **branches 100% (64/64), statements 100%, functions 100%** — meets the Req-2 100%-branch acceptance.
- Config + boot coverage (2-file include `total`): **lines 100%, branches 93.18%, functions 100%** — all axes ≥ 90 floor. The uncovered branches are the `= process.env` / `= defaultFail` default-parameter arms (tests pass explicit args) — the established sibling-boot-validator pattern; the `process.exit(78)` sink carries a `/* v8 ignore */` (never executed in unit tests, would kill the runner).
- `pnpm --filter @openwhispr/api typecheck` → clean.
- `pnpm lint:lockers` → exit 0. No new BLOCKING findings. LOCKER-02: zero suppressions in the 3 production files (verified by grep). Resolver purity grep returns zero real I/O lines (only a JSDoc mention of `process.env`).
- Adjacent regression slice (`oidc-providers`, `auth-schema-mapping`, `auth-role-input-false`) → 21 tests passed.

## Deviations from Plan

**1. [Test-path convention] Test files placed per existing repo layout, not the plan's literal paths**
- **Found during:** Task 1 setup.
- **Issue:** The plan's `files_modified` lists `apps/api/tests/unit/__tests__/oidc-jit-config.test.ts` etc., but the repo convention is config tests in `tests/unit/config/` and lib tests in `tests/unit/lib/__tests__/` (where `oidc-providers.test.ts` and `litellm.test.ts` already live). Vitest discovery and the coverage `include` are calibrated to those dirs.
- **Fix:** Placed `oidc-jit-boot.test.ts` in `tests/unit/config/`, `oidc-jit-config.test.ts` + `oidc-jit-resolver.test.ts` in `tests/unit/lib/__tests__/`. Pure-location change; no behavior impact.

**2. [Rule 2 — correctness] OIDC_DEFAULT_ROLE outside the role enum is rejected, not coerced**
- **Found during:** Task 2 GREEN.
- **Issue:** `cfg.defaultRole` is typed `string | null`; an operator could set `OIDC_DEFAULT_ROLE=banana`. A bare `as JitRole` would mask that and mint an invalid role.
- **Fix:** Added `asJitRole()` validating against `["admin","member","viewer"]`; an out-of-enum default → `forbidden_no_role_mapping` (operator config error). Avoids a type assertion (LOCKER-02 hygiene) and added a dedicated test for the new branch.

## TDD Gate Compliance

RED → GREEN gates verified in git log for both tasks:
- `074428d2 test(69-01): add failing tests for ... config loader + boot validator` → `b9ad5e24 feat(69-01): oidc-jit config loader + JSON.parse boot validator`
- `8cab1691 test(69-01): add failing tests for ... pure resolver` → `676384b8 feat(69-01): pure oidc-jit decision-tree resolver (100% branch)`

RED runs confirmed `Cannot find module` (modules absent) before GREEN. No unexpected-pass at RED.

## Known WARNs (expected, non-blocking)

LOCKER-04 (dead-export, WARN-only; BLOCKING flip deferred to Phase 41 per CLAUDE.md ledger) flags `RejectionCode`, `JitDecision`, `ExistingIdentity`, `resolveJitDecision` (and would flag `readJitConfig`/`JitConfig`) as having no non-test importer YET. This is by design: D-69-1 specifies these exports are consumed by Wave 2 (web `mapProfileToUser` + desktop `mint-bearer`). The WARN resolves when Wave 2 wires the two call-sites. No allowlist annotation added — the importers land within the same phase.

## Self-Check: PASSED

- Files exist: all 6 created files FOUND (verified via filesystem check).
- Commits exist on HEAD: `676384b8`, `8cab1691`, `b9ad5e24`, `074428d2` confirmed in `git log`.
- No deletions: `git diff --diff-filter=D HEAD~4 HEAD` empty.
- STATE.md / ROADMAP.md: NOT modified by this agent (orchestrator owns those writes).
