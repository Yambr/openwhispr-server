---
phase: 2
slug: auth-wire-api-skeleton-conformance-harness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-09
---

# Phase 2 — Validation Strategy

> Per-task validation contract for execution feedback sampling.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit/integration) + Vitest 4 (contract-tests workspace; HTTP fetch against deployed backend) + testcontainers 10.x + Playwright 1.x (deferred to later if needed for OAuth-redirect E2E with real browser) |
| **Config files** | `vitest.config.ts` (root) + `packages/contract-tests/vitest.config.ts` |
| **Quick run command** | `pnpm vitest run --bail 1 --reporter=dot` |
| **Full suite command** | `pnpm test` (alias: lint + lint:english + lint:rls + typecheck + vitest run --coverage) |
| **Phase gate command** | `pnpm test && make up && pnpm wait-healthy && make contract-test BACKEND_URL=http://api.localhost AUTH_URL=http://auth.localhost && make down` |
| **Estimated runtime** | Quick: ~10s. Full (with testcontainers + compose-up + contract-tests): ~10-15 min |

---

## Sampling Rate

- After every task commit: `pnpm vitest run --changed`
- After every wave merge: `pnpm test` + `pnpm vitest run packages/contract-tests/` (if backend running)
- Before `/gsd-verify-work`: full GHA contract-test job green on a real PR
- Max feedback latency: 30s for unit, 10-15min for full PR-time CI

---

## Per-Task Verification Map

The planner will populate this table fully. Skeleton:

| Task ID | Plan | Wave | Requirement(s) | Test Type | Automated Command | Status |
|---------|------|------|----------------|-----------|-------------------|--------|
| 2-XX-XX | XX | N | WIRE-/AUTH-/CONTRACT- | unit/integration/contract | (planner fills) | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

Phase 2 substrate that must exist before later tasks can run:

- [ ] Better Auth installed + configured + 0001_better_auth.sql migration runs (Wave 1)
- [ ] `apps/api/src/auth.ts` with Better Auth instance + Drizzle adapter (Wave 1)
- [ ] `apps/api/Dockerfile` + `entrypoint.sh` exists before `api-entrypoint-default-secrets.test.ts` runs (Wave 1)
- [ ] `compose/api` service block in `docker-compose.yml` (Wave 1)
- [ ] `packages/contract-tests/src/schemas.ts` zod source of truth (Wave 2)
- [ ] `apps/api/src/error-handler.ts` + custom error classes (Wave 2)
- [ ] All 4 route handlers exist before contract tests for them run (Wave 2)
- [ ] OAuth shim + callback + scheme validator exist before multi-channel matrix test (Wave 3)
- [ ] Token rotation overlap machinery exists before token-rotation contract test (Wave 3)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator runs `bash bootstrap.sh && make up` and lands on healthy stack including new `api` service | success criterion #1 | Real Docker daemon required | `docker compose ps` shows api `(healthy)` within 60s |
| GitHub Security Advisories link works on the live repo | (no explicit REQ) | GitHub-side state | Visit /security/advisories on the published repo |
| OAuth full round-trip with real Google/Okta IdP | AUTH-05 partial | Requires real IdP client credentials | Configure OIDC_* env, run sign-in from desktop, confirm bearer token received |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / < 15min full
- [ ] `nyquist_compliant: true` set in frontmatter once planner populates the per-task map

**Approval:** pending
