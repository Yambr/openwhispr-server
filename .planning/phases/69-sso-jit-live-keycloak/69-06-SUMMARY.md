---
phase: 69-sso-jit-live-keycloak
plan: 06
subsystem: sso-jit-live-keycloak-e2e
tags: [sso, oidc, keycloak, jit, e2e, fixture, halt-env-blocked]
requires:
  - 69-01 (oidc-jit-config + resolveJitDecision + validateJitBoot)
  - 69-02 (audit enum 18->21 + sso.jit.* payloads + migration 0032)
  - 69-03 (auth.ts mapProfileToUser + 4 databaseHooks + tenantId additionalField)
  - 69-04 (desktop mint-bearer JIT seam)
  - 69-05 (realm-openwhispr-test.json + seed script + keycloak.yml + 1.5 split)
provides:
  - compose/test/keycloak-api-env.yml (@sso-only api<->Keycloak fixture overlay, D-69-4 Option A)
  - compose/test/keycloak-traefik-dynamic.yml (keycloak.localhost Traefik route)
  - real tests/e2e-cjm/steps/sso.steps.ts (7 @cjm-sso scenarios)
  - tests/e2e-cjm/steps/__tests__/sso.steps.test.ts (sibling unit coverage)
  - sso-step-drift.test.ts flipped to real-step mode
affects:
  - Makefile (e2e-cjm @sso branch layers keycloak-api-env.yml)
  - compose/test/keycloak.yml (network external-decl fix)
  - tests/e2e-cjm/features/sso/keycloak-oidc.feature (un-redded + 1.6 re-scope + 1.2/1.5a reconcile)
  - compose/test/keycloak-realms/realm-openwhispr-test.json (provider-id "oidc" redirect URIs + dave/bob users)
tech-stack:
  added: []
  patterns:
    - "@sso-only compose overlay (fixture pattern, not prod-default change) — mirrors docker-compose.yml:330 fixture-idp"
    - "Keycloak via Traefik at keycloak.localhost (split-horizon fix: same issuer origin for host browser + in-network api discovery)"
    - "desktop bearer-mint path as the e2e driver (also satisfies Req-7 deep-link)"
    - "Admin-REST user mutation between two logins to drive role-downgrade (1.3) + tenant-mismatch (1.5a) against a single shared live realm"
    - "JIT audit assertion via api structured-log grep (no audit-read route = no new prod code per D-69-4 / hard-rule-1)"
key-files:
  created:
    - compose/test/keycloak-api-env.yml
    - compose/test/keycloak-traefik-dynamic.yml
    - tests/e2e-cjm/steps/__tests__/sso.steps.test.ts
  modified:
    - tests/e2e-cjm/steps/sso.steps.ts
    - tests/e2e-cjm/features/sso/keycloak-oidc.feature
    - tests/self-tests/sso-step-drift.test.ts
    - compose/test/keycloak.yml
    - compose/test/keycloak-realms/realm-openwhispr-test.json
    - Makefile
decisions:
  - "D-69-4 Option A: api<->Keycloak wiring is a TEST FIXTURE overlay (@sso-only), prod compose defaults untouched"
  - "D-69-4 Option C2: 1.6 re-scoped to malformed-JSON boot loud-fail (exit 78 + FATAL oidc-jit-boot), NOT unreachable-realm"
  - "tenant claim = email_domain mode; acme.example -> DEFAULT_TENANT_ID (users table fails open, rule 16)"
  - "1.5a mode-6 driven by Admin-REST email-domain change (acme.example -> globex.example mapped to a different tenant id)"
metrics:
  duration: ~70m
  completed: 2026-05-29
status: HALTED (environment-blocked at the live e2e run; all code/wiring complete + committed)
---

# Phase 69 Plan 06: Live-Keycloak SSO JIT e2e Summary

**One-liner:** Real `sso.steps.ts` (7 `@cjm-sso` scenarios) + sibling unit tests + the `@sso`-only api↔Keycloak fixture overlay are complete, committed, and lint/unit/drift-GREEN — but the live `make e2e-cjm SCENARIO="@sso"` run is **HALTED on a genuine environment block**: `quay.io/keycloak/keycloak:26.0` cannot be pulled (all external registry + network egress times out in this sandbox), so the live Keycloak container never starts.

## What shipped (code + wiring — all committed)

### Task 0 — api↔Keycloak fixture wiring (D-69-4 Option A) — commit `c994a496`
- **`compose/test/keycloak-api-env.yml`**: `@sso`-only overlay setting the api+worker OIDC triple (`OIDC_ISSUER_URL=https://keycloak.localhost/realms/acme`, client `openwhispr-backend` / secret) + the 7 JIT env vars (`email_domain` tenant claim, mapping `acme.example→DEFAULT_TENANT_ID` + `globex.example→11111111-…`, `groups` group claim, role map `openwhispr-engineering→member`/`openwhispr-admin→admin`, priority, default `member`, revocation `downgrade_to_default`). Mirrors the `docker-compose.yml:330` fixture-idp precedent — **test fixture, not a prod default change**.
- **Split-horizon fix:** Keycloak is routed through the SAME Traefik instance at `https://keycloak.localhost` (covered by the `*.localhost` wildcard cert). Traefik gets a `keycloak.localhost` network alias so the api's in-network OIDC discovery fetch AND the host browser hit the same issuer origin (the classic Keycloak issuer/discovery mismatch is eliminated). `compose/test/keycloak-traefik-dynamic.yml` adds the file-provider route; `KC_HOSTNAME=https://keycloak.localhost` + `KC_PROXY_HEADERS=xforwarded`.
- **Realm**: client redirect URIs fixed to the provider-id `oidc` callbacks (`oauth2/callback/oidc`, `desktop-callback/oidc` — the genericOAuth + desktop routes actually used); added seeded users `dave` (admin group, for 1.3) + `bob` (for 1.4).
- **Makefile** `@sso` branch layers `-f compose/test/keycloak-api-env.yml`; prod compose defaults untouched.

### Task 1 — real `sso.steps.ts` + sibling unit tests — commit `71259734`
- All stubs replaced with live-Keycloak undici implementations for the 7 scenarios:
  - **1.1** alice JIT create → `get-session` role=member, tenant=DEFAULT (the mapped "acme"), + `sso.jit.user.created` structured-log assertion + Req-7 deep-link (`openwhispr-app://?bearer_token=…`).
  - **1.2** alice second login → returning session resolves tenant=acme/role=member.
  - **1.3** dave first login=admin → Admin-REST removes the admin group → second login downgrades to member (`sso.jit.role.updated`).
  - **1.4** bob → email-domain tenant derivation.
  - **1.5a** carol provisioned under acme → Admin-REST rewrites her email domain to `globex.example` (mapped to a different tenant id) → second login hits mode-6 → **403 `forbidden_tenant_mismatch`**.
  - **1.5b** cross-tenant 404 `not_found` clone against the fail-closed `transcribe` table (`users` fails open — D-69-3 / RESEARCH fact 3).
  - **1.6** malformed `OIDC_TENANT_MAPPING` JSON via `bootStack({expectExit:78})` → asserts exit 78 **and** `FATAL oidc-jit-boot` in stderr (D-69-4 C2 re-scope; pure boot-config test, no Keycloak).
- Drive strategy: the **desktop bearer-mint path** (also covers Req-7); outcome read via `get-session`; audit event asserted via api structured logs (no audit-read route = no new prod code, D-69-4 / hard-rule-1).
- **`__tests__/sso.steps.test.ts`**: 11 sibling unit tests, HTTP boundary mocked (mandatory per cjm-steps-need-unit-tests).
- Feature un-redded (`@expected-red`/`@after-*` removed); `sso-step-drift.test.ts` flipped to real-step mode (placeholder-only guard dropped; strict 100% feature↔binding equivalence — 24/24 steps match).

### Blocking-fix — `keycloak.yml` network — commit `8a4078fe`
- 69-05's `keycloak.yml` declared `openwhispr_internal` as `external: true`, which merged over the base's project-scoped network and made the `@sso` stack boot require a non-existent bare `openwhispr_internal` network. Removed the external decl so keycloak joins the same project network as the api. **Verified via `docker compose … config`** (network no longer external; Traefik `keycloak.localhost` alias merges cleanly with the existing api/auth aliases).

## Verification (deterministic parts — GREEN)
- `pnpm vitest run tests/self-tests/sso-step-drift.test.ts tests/e2e-cjm/steps/__tests__/sso.steps.test.ts` → **14 passed**.
- `pnpm lint:lockers` → clean (only pre-existing allowlisted WARNs).
- `pnpm tsx tools/lint-steps-have-unit-tests.ts` → passed (sso.steps covered).
- `pnpm tsx tools/lint-cjm-doc.ts --features … --check-expected-red` → passed; `grep -c @expected-red feature` = 0.
- `biome check` on all 3 authored files → clean.
- Pre-commit hooks (gitleaks, biome, english, steps-have-unit-tests, gherkin-tags, playwright-config) + commitlint → all GREEN on every commit.
- `docker compose … config` for the full `@sso` file set → valid (network + Traefik alias merge correct).

## HALT — environment block at the live e2e run

`E2E_CJM=1 SCENARIO="@sso" make e2e-cjm` reached the compose `up --build` for the `@sso` stack and failed pulling the Keycloak image. Exact compose log (`/tmp/sso-e2e.log:36-40`):

```
 keycloak Pulling
 keycloak Error
Error response from daemon: Head "https://quay.io/v2/keycloak/keycloak/manifests/26.0": Get "https://quay.io/v2/auth?scope=repository%3Akeycloak%2Fkeycloak%3Apull&service=quay.io": net/http: TLS handshake timeout
e2e-cjm-dump-logs: wrote compose-logs/ (18 files)
Warning: No resource found to remove for project "e2e-cjm".
make: *** [e2e-cjm] Error 18
```

Diagnosis (this is a host-network egress block, NOT a code/wiring defect, and NOT fixable within this plan's scope):

```
curl -m20 https://quay.io/v2/               -> (28) Connection timed out after 20011 ms (HTTP 000)
curl -m20 https://registry-1.docker.io/v2/  -> (28) Connection timed out after 20001 ms (HTTP 000)
curl -m15 https://github.com                -> (28) Connection timed out
docker pull quay.io/keycloak/keycloak:26.0  -> TLS handshake timeout (retried; persistent)
docker images | grep keycloak               -> (none cached)
```
The block persists even with the Bash sandbox explicitly disabled, so it is the host/network environment, not the tool sandbox. No `keycloak:26.0` image is cached locally, so the container cannot start and the 7 live scenarios cannot run.

The teardown trap correctly restored the pre-existing `openwhispr` project (all 14 containers `Up (healthy)` again) and removed the `e2e-cjm` project — no orphaned state, no damage to the concurrent worktree stack.

### To finish (single command, once network egress is available)
```
E2E_CJM=1 SCENARIO="@sso" make e2e-cjm
```
Expected: 7/7 `@cjm-sso` GREEN against the live Keycloak 26 container. If anything is red on that run, check `docker compose -p e2e-cjm logs keycloak` / `logs api` first (per CLAUDE memory). The `@cjm-sso-1.6` boot scenario does NOT need Keycloak (pure `bootStack` config test) and would already pass in isolation, but the Makefile runs the whole `@sso` tag set together.

## Deviations from Plan

### Feature-text reconciliation to the merged production behavior (truthfulness, hard-rule-1)
The locked 69-05 feature text for 1.2 / 1.4 / 1.5a / 1.6 described mechanisms that do not match the merged code:
1. **1.6 [D-69-4 C2 — approved]:** re-scoped from "unreachable realm → boot exit + `sso.jit.rejected`" (a mechanism that does not exist — lazy genericOAuth discovery boots clean) to the real merged loud-fail: malformed `OIDC_TENANT_MAPPING` JSON → `validateJitBoot()` exit 78 + `FATAL oidc-jit-boot`.
2. **1.2 [Rule 1 — bug in feature]:** the old text asserted `sso.jit.role.updated` on a pure name re-sync, but `update.after` emits that audit ONLY on a role change (`oidc-jit-hooks.ts:253-259`). Reworded to assert the returning session resolves the same tenant/role (the truthful re-sync observable).
3. **1.5a [Rule 1 — unrealizable trigger]:** the old text used a named "globex" tenant claim, but the realm/fixture uses `email_domain` mode. Reworded to the real mode-6 trigger driven by an Admin-REST email-domain change between two logins (resolved tenant ≠ persisted tenant → `forbidden_tenant_mismatch`). Added `globex.example` to the tenant mapping for this.
4. **1.4:** added seeded user `bob@acme.example` (the realm had no `bob`); no feature-text change needed beyond the existing email-domain steps.

These edits are within the D-69-3 precedent ("edit the locked feature text") and keep every assertion HONEST against real merged behavior. The drift sentinel was updated in the SAME change.

### keycloak.yml network external-decl removal (Rule 3 — blocking)
Removing the `external: true` network decl was required for the `@sso` stack to boot at all; it is a defect in 69-05's overlay surfaced only by actually enabling the `@sso` run. Documented inline + commit `8a4078fe`.

## Architectural note for the verifier (single-shared-realm constraint)
Mode-6 (1.5a) and the role-downgrade (1.3) are NOT drivable by a single static realm login because (a) the `users` table fails OPEN to the default tenant (rule 16), and (b) two Keycloak stacks cannot co-exist (fixed host ports 8089/9000). The honest solution adopted is **Admin-REST mutation of the seeded user between two logins on the one shared live realm** (remove admin group for 1.3; rewrite email domain for 1.5a) — real IdP state changes, no faked claims, no weakened assertions. This is the only conflict-free way to exercise the returning-user transitions end-to-end.

## Self-Check: PASSED
- FOUND: compose/test/keycloak-api-env.yml, compose/test/keycloak-traefik-dynamic.yml, tests/e2e-cjm/steps/sso.steps.ts, tests/e2e-cjm/steps/__tests__/sso.steps.test.ts
- FOUND commits: c994a496, 71259734, 8a4078fe
- `@expected-red` in feature = 0; drift+unit tests = 14 passed; lockers clean.
- The ONLY incomplete acceptance item is the live 7/7 run, blocked solely by the image-pull/network environment (documented above with exact logs).
