---
phase: 2
slug: auth-wire-api-skeleton-conformance-harness
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-09
last_updated: 2026-05-09
---

# Phase 2 — Validation Strategy

> Per-task validation contract for execution feedback sampling.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit/integration) + Vitest 4 (contract-tests workspace; HTTP fetch against deployed backend) + testcontainers 10.x |
| **Config files** | `vitest.config.ts` (root) + `packages/contract-tests/vitest.config.ts` (Plan 06) |
| **Quick run command** | `pnpm vitest run --bail 1 --reporter=dot` |
| **Full suite command** | `pnpm test` (alias: lint + lint:english + lint:rls + typecheck + vitest run --coverage) |
| **Phase gate command** | `pnpm test && docker compose --profile default --profile contract-test up -d --wait && pnpm -F @openwhispr/data run seed:conformance && make contract-test && docker compose down -v` |
| **Estimated runtime** | Quick: ~10s. Full (with testcontainers + compose-up + contract-tests): ~10–15 min |

---

## Sampling Rate

- After every task commit: `pnpm vitest run --changed`
- After every wave merge: `pnpm test` + `pnpm vitest run packages/contract-tests/` (if backend running)
- Before `/gsd-verify-work`: full GHA contract-test job green on a real PR
- Max feedback latency: 30s for unit, 10–15min for full PR-time CI

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement(s) | Test Type | Automated Command | Status |
|---------|------|------|----------------|-----------|-------------------|--------|
| 2-01-1 | 01 | 1 | AUTH-02 (foundation) | unit | `pnpm -F @openwhispr/api test --run src/lib/scheme-allowlist.test.ts src/lib/cookie-domain.test.ts src/lib/token-rotation.test.ts` | pending |
| 2-01-2 | 01 | 1 | AUTH-04, AUTH-07 | integration (testcontainers) | `pnpm -F @openwhispr/data test --run src/__tests__/0001_better_auth.test.ts src/__tests__/0002_oauth_state.test.ts && pnpm tsx tools/lint-rls.ts` | pending |
| 2-01-3 | 01 | 1 | AUTH-04, AUTH-05 | unit (smoke) | `pnpm -F @openwhispr/api test --run src/auth.test.ts && pnpm -F @openwhispr/api typecheck` | pending |
| 2-02-1 | 02 | 1 | PROVIDER-04 (foundation) | build | `pnpm -F @openwhispr/api build && pnpm -F @openwhispr/data build && pnpm -F @openwhispr/data test --run src/__tests__/migrate.test.ts` | pending |
| 2-02-2 | 02 | 1 | PROVIDER-04 | compose validation | `docker compose config --quiet && docker compose --profile dev config --quiet` | pending |
| 2-02-3 | 02 | 1 | (closes Phase 1 D-08) | self-test (docker) | `pnpm vitest run tests/self-tests/api-entrypoint-default-secrets.test.ts tests/self-tests/api-container-healthy.test.ts tests/self-tests/migrate-gates-api.test.ts` | pending |
| 2-03-1 | 03 | 2 | WIRE-17 (envelope) | unit | `pnpm -F @openwhispr/api test --run src/error-handler.test.ts && pnpm -F @openwhispr/api typecheck && pnpm -F @openwhispr/contract-tests typecheck` | pending |
| 2-03-2 | 03 | 2 | WIRE-18, WIRE-19, AUTH-03 | integration (testcontainers) | `pnpm -F @openwhispr/api test --run src/middleware/dual-auth.test.ts src/middleware/require-cookie-only.test.ts` | pending |
| 2-03-3 | 03 | 2 | WIRE-01, WIRE-02, WIRE-03, WIRE-04 | integration (in-process inject) | `pnpm -F @openwhispr/api test --run src/routes/check-user.test.ts src/routes/verification-status.test.ts src/routes/delete-account.test.ts src/routes/health.test.ts && pnpm -F @openwhispr/api typecheck` | pending |
| 2-04-1 | 04 | 2 | PROVIDER-04 | unit + integration | `pnpm -F @openwhispr/api test --run src/email.test.ts src/__tests__/email-mailpit.test.ts` | pending |
| 2-04-2 | 04 | 2 | (D-28 rate limits) | integration | `pnpm -F @openwhispr/api test --run src/__tests__/rate-limit-check-user.test.ts src/__tests__/rate-limit-verification-status.test.ts src/__tests__/rate-limit-health-exempt.test.ts` | pending |
| 2-04-3 | 04 | 2 | WIRE-20, AUTH-06 | self-test + unit | `pnpm -F @openwhispr/api test --run src/__tests__/openwhispr-source-log.test.ts && pnpm vitest run tests/self-tests/traefik-https-only.test.ts` | pending |
| 2-05-1 | 05 | 3 | AUTH-01, AUTH-02 | unit + integration | `pnpm -F @openwhispr/api test --run src/lib/pkce.test.ts src/routes/desktop-signin.test.ts src/__tests__/oauth-state-persist.test.ts` | pending |
| 2-05-2 | 05 | 3 | AUTH-02 | integration (testcontainers) | `pnpm -F @openwhispr/api test --run src/routes/auth-callback.test.ts` | pending |
| 2-05-3 | 05 | 3 | AUTH-04 | integration (100 concurrent) | `pnpm -F @openwhispr/api test --run src/lib/token-rotation.test.ts src/__tests__/token-rotation-overlap.test.ts` | pending |
| 2-06-1 | 06 | 3 | CONTRACT-01 (5 endpoint files) | contract (real deploy) | `bash -c 'docker compose --profile default up -d --wait && pnpm -F @openwhispr/data run seed:conformance && BACKEND_URL=http://api.localhost AUTH_URL=http://auth.localhost pnpm -F @openwhispr/contract-tests test --run src/conventions.test.ts src/check-user.test.ts src/verification-status.test.ts src/delete-account.test.ts src/health.test.ts; rc=$?; docker compose down -v; exit $rc'` | pending |
| 2-06-2 | 06 | 3 | CONTRACT-01 (oauth/rotation/cookie-host) | contract (real deploy) | `bash -c 'docker compose --profile default --profile contract-test up -d --wait && pnpm -F @openwhispr/data run seed:conformance && NODE_ENV=test BACKEND_URL=http://api.localhost AUTH_URL=http://auth.localhost OIDC_ISSUER_URL=http://fixture-idp:9000 OPENWHISPR_PROTOCOL=mycorp-whispr pnpm -F @openwhispr/contract-tests test --run src/oauth-redirect.test.ts src/token-rotation.test.ts src/cookie-host.test.ts; rc=$?; docker compose down -v; exit $rc'` | pending |
| 2-06-3 | 06 | 3 | CONTRACT-01 (CI wiring) | grep / yaml | `grep -q "contract-test" .github/workflows/ci.yml && grep -q "contract-test" scripts/branch-protection.json && grep -q "^contract-test:" Makefile` | pending |
| 2-07-1 | 07 | 4 | PROVIDER-03 (docs) | lint | `pnpm tsx tools/lint-english.ts docs/auth.md docs/oidc-operator-config.md docs/channel-scheme-override.md docs/operations.md && test -s docs/auth.md && grep -q "## Auth" docs/operations.md` | pending |
| 2-07-2 | 07 | 4 | (planning state) | grep | `grep -q "AUTH-01.*Phase 2.*Complete" .planning/REQUIREMENTS.md && grep -q "02-07-PLAN.md" .planning/ROADMAP.md && grep -q "completed_phases: 3" .planning/STATE.md && ! grep -q "SC#1 partial" .planning/phases/01-core-infra-multi-tenant-data/deferred-items.md` | pending |
| 2-07-3 | 07 | 4 | CONTRACT-01 (final smoke) | end-to-end | full quality-gate command from § Test Infrastructure | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

Phase 2 substrate that must exist before later tasks can run — all are landed by Plans 01+02 in Wave 1:

- [x] Better Auth installed + configured + 0001_better_auth.sql migration runs (Plan 01 / Wave 1)
- [x] `apps/api/src/auth.ts` with Better Auth instance + Drizzle adapter (Plan 01 / Wave 1)
- [x] `apps/api/Dockerfile` + `entrypoint.sh` (Plan 02 / Wave 1)
- [x] `compose/api` service block in `docker-compose.yml` (Plan 02 / Wave 1)
- [x] `packages/contract-tests/src/schemas.ts` zod source of truth (Plan 03 / Wave 2)
- [x] `apps/api/src/error-handler.ts` + custom error classes (Plan 03 / Wave 2)
- [x] All 4 route handlers exist before contract tests for them run (Plan 03 / Wave 2)
- [x] OAuth shim + callback + scheme validator (Plan 05 / Wave 3)
- [x] Token rotation overlap machinery (Plan 05 / Wave 3)
- [x] Conformance fixture seeder (Plan 06 / Wave 3)
- [x] fixture-idp service for multi-channel matrix (Plan 06 / Wave 3)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator runs `bash bootstrap.sh && make up` and lands on healthy stack including new `api` service | success criterion #1 | Real Docker daemon required | `docker compose ps` shows api `(healthy)` within 60s; covered by Plan 02 self-test in CI |
| GitHub branch protection actually applied to main | CI-03 (cross-phase) | Maintainer-only GitHub-side state | `gh api repos/{owner}/{repo}/branches/main/protection -X PUT --input scripts/branch-protection.json`; documented in 02-06-SUMMARY |
| OAuth full round-trip with real Google/Okta IdP | AUTH-05 partial | Requires real IdP client credentials | Configure OIDC_*, run sign-in from desktop, confirm bearer token received; covered automatically by fixture-idp in CI |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies declared
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s quick / < 15min full
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** PLANNED (planner-signoff 2026-05-09; executor populates Status column at exec time)
