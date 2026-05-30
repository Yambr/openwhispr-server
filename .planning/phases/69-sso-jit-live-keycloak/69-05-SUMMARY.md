<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
---
phase: 69-sso-jit-live-keycloak
plan: 05
subsystem: sso-live-keycloak-fixtures
tags: [keycloak, oidc, jit, e2e-cjm, realm-fixture, locker-06]
requires:
  - "compose/test/keycloak.yml (Phase 18 Keycloak 26 fixture stub, --profile sso)"
  - "Makefile e2e-cjm target (Phase 13/22 hermetic compose harness)"
provides:
  - "compose/test/keycloak-realms/realm-openwhispr-test.json (realm acme + openwhispr-backend client + userinfo group mapper)"
  - "scripts/seed-keycloak-realm.sh (Admin-REST realm import, LOCKER-06 safe, idempotent)"
  - "make e2e-cjm @sso wiring (keycloak.yml + readiness poll + seed step)"
  - "@cjm-sso-1.5a / @cjm-sso-1.5b split feature scenarios"
  - "7 OIDC JIT env vars documented in .env.slim.example"
affects:
  - "Plan 69-06 (e2e step impl runs against this fixture + wiring)"
  - "Plan 69-04 (desktop JIT path consumes groups-in-userinfo from this realm)"
tech-stack:
  added: []
  patterns:
    - "Admin-REST realm import (keeps mounted import dir empty — realm-path separation)"
    - "bash-3.2 disciplined CLI script (set -uo pipefail, command -v guards, input-safety regex)"
    - "boundary-mocked unit test for a shell script (in-process http.Server stands in for Keycloak Admin API)"
key-files:
  created:
    - compose/test/keycloak-realms/realm-openwhispr-test.json
    - scripts/seed-keycloak-realm.sh
    - scripts/__tests__/seed-keycloak-realm.test.ts
  modified:
    - Makefile
    - .env.slim.example
    - tests/e2e-cjm/features/sso/keycloak-oidc.feature
    - tests/e2e-cjm/features/rls-cross-tenant.feature
    - docs/customer-journeys.md
    - vitest.config.ts
decisions:
  - "D-69-3 honoured: @cjm-sso-1.5 split into 1.5a (sign-in 403 forbidden_tenant_mismatch) + 1.5b (read 404 not_found)"
  - "Carried open question A1/Q3 resolved at realm authoring: group-membership protocol mapper targets id_token AND userinfo AND access_token"
  - "Keycloak readiness poll implemented as inline curl loop in the Makefile (not a new TS module) to avoid an undertested boundary file"
metrics:
  duration: ~25m
  completed: 2026-05-29
  commits: 2
  files_changed: 9
---

# Phase 69 Plan 05: Live-Keycloak Fixtures + e2e Wiring Summary

Authored the live-Keycloak test fixtures with the load-bearing realm-path separation: the realm JSON lives in a SEPARATE dir and is imported at runtime via the Keycloak Admin REST API, so the bind-mounted import dir stays empty and `@cjm-sso-1.6`'s loud-fail-on-empty observation stays honest. Wired the Keycloak fixture into `make e2e-cjm` only for `@sso` runs, and split `@cjm-sso-1.5` into the two truthful scenarios D-69-3 mandates.

## What shipped

### Task 1 — realm fixture + Admin-REST seed + unit test (commit `6dd5a864`)
- **`compose/test/keycloak-realms/realm-openwhispr-test.json`** — realm `acme`, confidential client `openwhispr-backend` (e2e redirect URIs for the api callback + desktop callback), a `groups` client scope with a Group-Membership protocol mapper configured to emit the `groups` claim in **id_token, userinfo, and access_token** (A1 / Open-Q3 — the desktop bearer-mint path reads groups from userinfo). Seeded users `alice@acme.example` (engineering+everyone groups → tenant acme / role member) and `carol@acme.example` (the returning-user fixture for the 1.5a changed-tenant-claim path).
- **`scripts/seed-keycloak-realm.sh`** — bash-3.2 (`set -uo pipefail`), `command -v curl/jq` guards (exit 127), input-safety regex on `KC_URL` (exit 3 on shell-meta). Acquires an admin token from `/realms/master/protocol/openid-connect/token` (client_id=admin-cli, grant_type=password), then POSTs the realm to `/admin/realms` with a Bearer header. Idempotent: 201 OR 409 (realm exists) = success. **LOCKER-06 safe** — admin creds cross into `curl` ONLY via `--data-urlencode` fields sourced from env, never interpolated into a shell command string; the realm body is `--data-binary @file`.
- **`scripts/__tests__/seed-keycloak-realm.test.ts`** — RED-first unit test (per `feedback_cjm_steps_need_unit_tests`). Stands up an in-process `http.Server` that plays the Keycloak Admin surface and points the script at it via `KC_URL`. Asserts: (1) token acquired + used as Bearer on the import POST; (2) realm body reaches `/admin/realms` intact; (3) 409 is idempotent success; (4) the admin password never leaks to stdout/stderr; (5) a shell-meta `KC_URL` is refused before any network call. The script is spawned via argv-array `spawn("bash", [SCRIPT], { shell: false })` with secrets in `env` (LOCKER-06 in the test too).
- **`vitest.config.ts`** — added a `scripts` project entry so `scripts/__tests__/*.test.ts` is discovered (see Deviations).

### Task 2 — Makefile wiring + feature split + env docs (commit `c1079f91`)
- **`Makefile` e2e-cjm** — when `SCENARIO` matches `*sso*`, the compose stack adds `-f compose/test/keycloak.yml --profile sso`, then polls Keycloak `/health/ready` (inline curl loop, 60×2s) and runs `scripts/seed-keycloak-realm.sh` BEFORE `bddgen`/`playwright`. The default (non-SSO) run is byte-for-byte unchanged — `KC_COMPOSE`/`KC_PROFILE` collapse to empty — so Keycloak is NOT booted for the base suite and `@cjm-sso-1.6` still sees an empty import dir. `e2e-cjm-teardown`'s `--remove-orphans` cleans the keycloak container.
- **`keycloak-oidc.feature`** — `@cjm-sso-1.5` replaced by `@cjm-sso-1.5a` (returning user, changed tenant claim → `403 forbidden_tenant_mismatch` + `sso.jit.rejected` audit) and `@cjm-sso-1.5b` (cross-tenant read in a fail-closed table → `404 not_found`, no existence leak). 7 scenarios total; all `@sso` scenarios keep `@expected-red @after-phase-19 @after-keycloak-up` (Plan 06 removes them).
- **`.env.slim.example`** — appended the 7 OIDC JIT env vars (commented, SPEC defaults documented).
- **`docs/customer-journeys.md` + `rls-cross-tenant.feature`** — updated the stale `@cjm-sso-1.5` references to the 1.5a/1.5b split (keeps the CJM doc cross-ref truthful; `lint-cjm-doc` green).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a `scripts` vitest project entry**
- **Found during:** Task 1
- **Issue:** `scripts/` was not matched by any vitest `projects[]` entry (only excluded from the coverage include glob). The acceptance command `pnpm test seed-keycloak-realm` would never discover `scripts/__tests__/seed-keycloak-realm.test.ts`.
- **Fix:** Added a `{ name: "scripts", root: p("scripts"), include: ["__tests__/*.test.ts"] }` project entry, mirroring the existing `tools` entry. `scripts/**` stays out of the coverage include glob (bash is not TS source).
- **Files modified:** `vitest.config.ts`
- **Commit:** `6dd5a864`

**2. [Rule 2 - Correctness of operator-facing artifact] Updated stale CJM-doc + companion-feature references**
- **Found during:** Task 2
- **Issue:** Splitting `@cjm-sso-1.5` left `docs/customer-journeys.md` §1.5 and the `rls-cross-tenant.feature` header comment naming a scenario tag that no longer exists.
- **Fix:** Rewrote the doc §1.5 into §1.5a + §1.5b and repointed the companion-feature comment to `@cjm-sso-1.5b`. `lint-cjm-doc --check-expected-red` stays green (34 anchors).
- **Files modified:** `docs/customer-journeys.md`, `tests/e2e-cjm/features/rls-cross-tenant.feature`
- **Commit:** `c1079f91`

### Design choices (within plan latitude)

- **Keycloak readiness poll** implemented as an inline `curl` loop against `/health/ready` in the Makefile, rather than a new `wait-for-keycloak.ts` module. The existing `wait-for-readiness.ts` polls for the api's `{ status: "ok", migrations_completed: true }` shape — wrong for Keycloak's `{ "status": "UP" }`. A new TS module would need its own coverage/unit test for an undertested network boundary; the bash poll is the simpler, fully-self-contained choice that keeps the seed from racing the container.
- **Seed script requires `jq`** (guarded `command -v jq`, exit 127). `jq` is available on dev + CI per 69-RESEARCH's Environment Availability table; this avoids fragile grep/sed JSON parsing of the token response.

## Threat Flags

None. The realm fixture's client secret + user passwords are test-only literals inside `compose/test/` (LOCKER-03 allowlisted; gitleaks pre-commit/pre-push hooks ran and passed). The seed script introduces no new credential-interpolation surface (LOCKER-06 clean). No new network endpoint, auth path, or schema change beyond what the plan's `<threat_model>` (T-69-14/15/16) already covers.

## Verification (all green, verified live)

- `pnpm exec vitest run --project scripts seed-keycloak-realm` → 4/4 pass
- `bash -n scripts/seed-keycloak-realm.sh` → syntactically valid
- `compose/test/keycloak-realms/realm-openwhispr-test.json` exists; `ls -A compose/test/keycloak/` → only `.gitkeep` (mounted dir still empty)
- `grep -c "userinfo.token.claim" …realm-openwhispr-test.json` → 1 (groups mapper targets userinfo, A1)
- `grep "admin/realms" scripts/seed-keycloak-realm.sh` → matches (Admin REST import)
- `pnpm exec tsx tools/lint-shell-credential-interpolation.ts` → rc=0 (LOCKER-06 clean; no new violation)
- `pnpm lint:lockers` → rc=0
- `pnpm tsx tools/lint-cjm-doc.ts --features tests/e2e-cjm/features --check-expected-red` → rc=0
- `grep -cE "cjm-sso-1.5a|cjm-sso-1.5b" …keycloak-oidc.feature` → 2 (scenario split; tokens appear only on scenario tags)
- `grep -c "keycloak.yml" Makefile` → 3 (wired into the @sso branch + teardown context)
- `grep -c "OIDC_TENANT_CLAIM" .env.slim.example` → 3
- `pnpm exec vitest run --project tests-integration env-slim-example` → 10/10 pass
- `pnpm lint:english` → pass (1457 files)

## Self-Check: PASSED

- Created files verified on disk: realm JSON, seed script, seed unit test, SUMMARY.
- Commits verified on HEAD: `6dd5a864` (Task 1), `c1079f91` (Task 2).
