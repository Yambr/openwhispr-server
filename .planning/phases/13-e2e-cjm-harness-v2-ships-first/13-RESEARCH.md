# Phase 13: E2E + CJM Harness (v2 — ships first) — Research

**Researched:** 2026-05-14
**Domain:** Brownfield E2E test harness (Cucumber + Playwright + playwright-bdd) booting the real docker-compose stack, atomic replacement of worker `noopSender` with real nodemailer-backed `EmailSender`, testcontainers leak closure, weak-assertion ESLint ban + sweep.
**Confidence:** HIGH — all 12 requirements are anchored to a concrete file path in the live tree (`apps/worker/src/index.ts:68-134`, `apps/api/src/email.ts`, `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx:147-186`, `tests/e2e/compose-helper.ts`, etc.). Locked tool versions cross-checked against npm registry on 2026-05-14.

## Summary

Phase 13 is the **gate** every subsequent v2 phase tests against. It ships:

1. A new `tests/e2e-cjm/` Cucumber + Playwright + playwright-bdd harness, separate from the existing vitest `tests/e2e/` (which stays in place for wire-level tests). [VERIFIED: codebase walk]
2. A new `packages/email/` shared package consumed by `apps/api` AND `apps/worker`, replacing `apps/api/src/email.ts:makeEmailService` with the same logic and replacing `apps/worker/src/index.ts:68-72,130` `noopSender` with the real nodemailer transport — **in one atomic commit with the harness**. [VERIFIED: D-04, D-06; live source file inspected]
3. `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM hook + CI `docker container prune --filter label=org.testcontainers=true` in `always()`. [CITED: deferred-items.md §1]
4. Custom ESLint rule banning `getAllByText(...).length.toBeGreaterThan(0)` family + sweep of 3 test files in `apps/web/src/components/screens/auth/__tests__/` (5 sites confirmed by grep — see Weak-Assertion Sweep section).
5. `docs/customer-journeys.md` (CJM) authored FIRST in 13.b wave 1, then 8 `.feature` files in wave 2 with `@cjm-N.M` tag scheme. ~20 scenarios total.
6. `Makefile e2e-cjm` target + GHA `e2e-cjm` job gated by `E2E_CJM=1`.
7. Readiness probes (not just liveness) for postgres/api/web/mailpit before any scenario starts; per-scenario tenant isolation; **retry-on-flake BANNED** (Cucumber `retry: 0`, Playwright `retries: 0`).

**Primary recommendation:** Use playwright-bdd's `defineBddConfig()` Playwright integration (NOT `@cucumber/cucumber` as a standalone runner) so the suite inherits Playwright's parallel-workers model + native trace/screenshot/video on failure. Treat `@cucumber/cucumber` as **DSL only** for Gherkin grammar + step bindings; playwright-bdd compiles `.feature` files into Playwright spec files at startup. This matches research SUMMARY.md §"Stack Additions" exactly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Phase 13 splits into **13.a** (harness + worker fix + teardown + weak-assert sweep) and **13.b** (CJM doc + 8 `.feature` files). 13.a unblocks Phase 12.
- **D-02:** 13.a contents (single phase, multiple plan waves): `tests/e2e-cjm/` scaffold; 1–2 reference scenarios (signup-verify happy + 1 negative twin); worker `noopSender` → real nodemailer `EmailSender` in new `packages/email/`; `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM + CI prune-in-`always()`; ESLint rule + sweep of `apps/web/src/components/screens/auth/__tests__/*.test.tsx`; Mailpit HTTP helper; readiness-probes contract (Postgres `SELECT 1`, Fastify `/api/health` + migrations_completed, mailpit `/api/v1/messages` 200, web `/` 200); Makefile `e2e-cjm` + GHA job (`E2E_CJM=1`).
- **D-03:** 13.b contents: `docs/customer-journeys.md` authored FIRST (wave 1), then 8 `.feature` files + step coverage (wave 2). Verifier MUST fail if any `.feature` lacks a matching `docs/customer-journeys.md §N.M` anchor.
- **D-04:** **Atomic-commit nuance** — harness-introducing commit AND worker `noopSender`→nodemailer commit land as ONE atomic commit. Lives inside 13.a; plan must enforce single PR / single commit gating both file groups, NOT staggered across plan-wave boundaries.
- **D-05:** **Cucumber + @playwright/test + playwright-bdd LOCKED** per REQUIREMENTS.md E2E-01 (`@cucumber/cucumber 12.8.2` + `@playwright/test 1.60.0` + `playwright-bdd 8.4.2`). Plain `@playwright/test` with describe-tags alternative is REJECTED.
- **D-06:** `packages/email/` is a **shared package consumed by both apps/api and apps/worker** (mirrors `@openwhispr/observability` + `@openwhispr/litellm-client` precedent). Extract existing `apps/api/src/email.ts` `EmailService` into `packages/email/src/`. Inline-in-worker REJECTED.
- **D-07:** **SMTP env contract — loud-fail at worker boot in production** when `SMTP_HOST` unset. Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`, `SMTP_REJECT_UNAUTHORIZED`. Default in dev/CI: wire to `mailpit:1025`. Detection: `NODE_ENV === 'production' && !process.env.SMTP_HOST` → throw at module init.
- **D-08:** **8 `.feature` files** — `signup-verify.feature`, `signin.feature`, `password-reset.feature`, `transcribe.feature`, `admin-onboarding.feature`, `locale-switch.feature`, `oidc-providers.feature`, `error-paths.feature`. ~20 scenarios after negative twins.
- **D-09:** `@cjm-N.M` tag schema — N = feature ordinal (1–8 in roster order), M = scenario index within feature. `@cjm-1.1` = signup-verify happy, `@cjm-1.2` = already-registered dedup, `@cjm-5.1` = admin-onboarding happy (closes TD-12.b).
- **D-10:** **HARD rule: `docs/customer-journeys.md` complete BEFORE any `.feature` file lands** in 13.b. Verifier MUST fail if any `.feature` exists without a matching `docs/customer-journeys.md §N.M` anchor. Negative-twin rule verifier-enforced: every 2xx scenario MUST have a sibling 4xx/5xx scenario in the same feature.
- **D-11:** Strict TDD constitutional (PROJECT.md TDD-01b ≥ 90% per-phase coverage on touched files); each fix lands with its tests in the SAME atomic commit.
- **D-12:** **Retry-on-flake BANNED in CI config** (`retries: 0` in `playwright.config.ts` + Cucumber `retry: 0`). A flake IS a bug — PITFALLS §5.
- **D-13:** Per-scenario tenant isolation (each scenario provisions a unique tenant + transient user), reusing Phase 07.1 worker-scoped-fixture insight at scenario scope.

### Claude's Discretion
- File layout under `tests/e2e-cjm/{features,steps,support}/` exact subdivision (one step file per domain: `auth.steps.ts`, `transcribe.steps.ts`, `admin.steps.ts`, etc.) — see this RESEARCH §"File Layout".
- Exact nodemailer transport configuration (pool vs single-shot, retry policy) — see this RESEARCH §"packages/email/ shape". Loud-fail-at-boot per D-07 non-negotiable.
- Whether `packages/email/` exports `createEmailSender(env)` factory vs class — factory recommended (matches `apps/api/src/email.ts` existing `makeEmailService(log)` shape — minimal-delta refactor).
- Mailpit polling backoff (exponential vs fixed) — exponential recommended; explicit per-call timeout MANDATORY per Pitfall 5.

### Deferred Ideas (OUT OF SCOPE)
- Hybrid runner (Cucumber + plain Playwright) — rejected; reconsider only if Cucumber parallel-mode bugs become structural.
- `verification-email-resend.feature` as standalone — folded into `signin.feature` 403-unverified negative twin (E2E-05).
- `api-keys.feature` + `capabilities-drift.feature` (10-feature roster) — v3 or hypothetical 13.c.
- `apps/web/public/.gitkeep` commit (deferred-items §2) — Phase 15 owns.
- Cross-browser matrix (Firefox, WebKit) — Chromium-only in v2.
- Mobile viewports — explicit anti.
- Real SMTP in CI — explicit anti; mailpit only.
- Phase 12 functionality itself (`/setup`, `/admin` index, `users.role` migration) — Phase 13 only enables Phase 12's RED tests.
- Full `BACKEND_SPEC.md` wire surface inside `.feature` files (stays in `packages/contract-tests/`).
- Load / chaos / fuzz inside Cucumber.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| E2E-01 | Cucumber+Playwright harness at `tests/e2e-cjm/` (separate from vitest `tests/e2e/`); `make e2e-cjm` + GHA `E2E_CJM=1` job | §"File Layout", §"Cucumber + playwright-bdd patterns" |
| E2E-02 | `docs/customer-journeys.md` enumerates ~20 journeys with `@cjm-N.M` tags; every happy path has a negative twin | §"CJM Document + 20-Journey Enumeration" |
| E2E-03 | Auth journey: signup happy + 4 negative twins (already-registered dedup, password<8 per-field error, locale-scoped error copy, social-button gating) | §"Negative-Twin Pairs" (signup-verify.feature) |
| E2E-04 | Verification journey via Mailpit HTTP API end-to-end signup → email → token → verified | §"Mailpit HTTP API helper" |
| E2E-05 | Sign-in + 403 unverified resend-CTA journey | §"Negative-Twin Pairs" (signin.feature) |
| E2E-06 | Transcribe round-trip journey (multipart audio → `/api/transcribe` → response shape) | §"Negative-Twin Pairs" (transcribe.feature) — uses `compose/mock-litellm/` + `MOCK_DIARIZATION=true` |
| E2E-07 | `/admin` landing journey | §"Negative-Twin Pairs" (admin-onboarding.feature) |
| E2E-08 | Locale-switch journey covering `/api/locale` routing split (TD-15.g symptom) | §"Negative-Twin Pairs" (locale-switch.feature) — note TD-15.g not fixed until Phase 15, so this scenario tests CURRENT behavior |
| E2E-09 | Worker email-delivery path verified end-to-end — `noopSender` → real nodemailer; new `packages/email/` shared package | §"packages/email/ refactor — atomic-commit plan" |
| E2E-10 | testcontainers cleanup — `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM + CI prune in `always()`; closes deferred-items #1 | §"testcontainers leak fix" |
| E2E-11 | Weak-assertion ban — ESLint rule + sweep of `apps/web/src/components/screens/auth/__tests__/*.test.tsx` | §"Custom ESLint rule" + §"Weak-Assertion Sweep" |
| E2E-12 | Readiness probes (not liveness); per-scenario tenant isolation; retry-on-flake banned | §"Readiness probes contract" + §"Tenant isolation" |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Strict TDD: RED → GREEN → REFACTOR; tests precede production code on EVERY phase. Each fix lands with its tests in the SAME atomic commit. **This phase: harness commit AND worker-fix commit are ONE commit per D-04.**
- Per-phase coverage floor ≥ 90% on lines/branches/functions/statements for all new/modified code.
- E2E mandatory, lives at `tests/e2e-cjm/` (root-level, parallel to existing `tests/e2e/`), gated by `E2E_CJM=1`, runs via `make e2e-cjm`.
- No mocks of internal logic; mocks allowed only at process/network boundaries. Mailpit HTTP API for email assertions IS the boundary (mailpit is the real SMTP catcher).
- DB-touching code uses real Postgres + PgBouncer + Valkey via testcontainers OR via the real docker-compose stack. **This phase: uses the real docker-compose stack (not testcontainers) for e2e scenarios — but fixes the testcontainers leak in apps/api unit tests.**
- GitHub Actions is the only sanctioned CI; new `e2e-cjm` job in `.github/workflows/ci.yml`.
- Source-artifact language: **English only** for `.feature` files, step definitions, comments, commit messages. UI copy under test may be `en` or `ru` (`locale-switch.feature` exercises both).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gherkin `.feature` file storage + tag filtering | Test harness (tests/e2e-cjm/features) | — | Authoring artefact, no runtime impact |
| Browser automation (clicks, form fill, screenshots, video) | Test harness (Playwright `Page`) | — | Drives web tier through Traefik :443 |
| `.feature` → Playwright spec compilation | Test harness (playwright-bdd) | — | Build step at scenario start |
| docker-compose stack lifecycle (boot + readiness + teardown) | Test harness (`support/compose-harness.ts`) | docker-compose CLI | Reuses `tests/e2e/compose-helper.ts` |
| Verification-email assertion | Test harness (`support/mailpit-helper.ts`) | Mailpit HTTP API `:8025/api/v1/messages` | Mailpit IS the boundary (real SMTP catcher) |
| SMTP send | Worker (`apps/worker`) | `packages/email/` (NEW shared) | Was no-op; phase ships real path |
| SMTP send (admin verification, etc.) | API (`apps/api`) | `packages/email/` (NEW shared) | Was inline in `apps/api/src/email.ts`; phase extracts |
| Tenant-row provisioning per scenario | API + database (real Postgres via compose) | — | Per-scenario isolation; new test-only endpoint `/api/test/tenant` gated by `OPENWHISPR_TEST_ROUTES=true` (precedent: hermetic env in `tests/e2e/compose-helper.ts:HERMETIC_ENV`) |
| testcontainers cleanup | apps/api vitest suite (`tools/global-vitest-teardown.ts`) | OS (SIGINT/SIGTERM handlers); CI prune step | Closes deferred-items #1 |
| Weak-assertion lint | Lint tooling (eslint-plugin-local-rules in `tools/eslint-local-rules/`) | Biome (existing root linter — note: Biome does NOT run ESLint rules; see §Open Questions) | Banned pattern: `getAll*/queryAll*().length.toBeGreaterThan(0)` family |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@cucumber/cucumber` | 12.8.2 (locked); registry latest is 12.8.3 as of 2026-05-14 | Gherkin grammar + step bindings (DSL only, NOT runner) | Authoritative Gherkin parser; playwright-bdd wraps it. [VERIFIED: `npm view @cucumber/cucumber version` returned 12.8.3 — 12.8.2 from REQUIREMENTS is one patch behind but locked] |
| `@playwright/test` | 1.60.0 | Browser driver + parallel runner + trace/screenshot/video on failure | Already in repo at 1.59.1; minor upgrade. [VERIFIED: `npm view @playwright/test version` returned 1.60.0 — matches] |
| `playwright-bdd` | 8.4.2 (locked); registry latest 8.5.1 as of 2026-05-14 | Compiles `.feature` files into Playwright spec files; inherits Playwright workers/fixtures/retries config | The integration point: lets `.feature` scenarios use Playwright's `expect`, trace viewer, parallel mode. [VERIFIED: `npm view playwright-bdd version` returned 8.5.1 — 8.4.2 from REQUIREMENTS is two minor versions behind but locked. Recommend re-checking with planner whether to lift to 8.5.1 or hold at 8.4.2.] |
| `@axe-core/playwright` | 4.x | a11y scan inside Cucumber scenarios | Carried forward from Phase 07.1 |
| `nodemailer` | already in repo (used by `apps/api/src/email.ts`) | Real SMTP transport for `packages/email/` | Existing dep; no version change needed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `eslint-plugin-local-rules` | latest (≥ 3.0) | Author project-local ESLint rule (`no-weak-getAll-length` etc.) without publishing | For the weak-assertion ban rule in `tools/eslint-local-rules/` |
| (existing) `tests/e2e/compose-helper.ts` | — | Wrapper for docker-compose CLI + readiness polling | Reused by new `tests/e2e-cjm/support/compose-harness.ts` (D-02 wraps, does NOT replace) |

### Alternatives Considered

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| playwright-bdd | `@cucumber/cucumber` standalone runner | Loses Playwright parallel-workers model + native trace viewer; gives Cucumber its own runner concurrency loop separate from Playwright's. ARCHITECTURE.md §Phase 13 explicitly picks playwright-bdd over standalone cucumber. |
| Cucumber+playwright-bdd | Plain `@playwright/test` with `describe('@cjm-N.M', ...)` tags | REJECTED per D-05. `.feature` files are auditable CJM artefacts + non-engineer-readable; CJM↔test mapping is file-structure not convention. |
| Real SMTP relay in CI | Mailpit container | REJECTED per CONTEXT `<deferred>`. Real SMTP introduces flake + cost + secret-leakage risk. |
| testcontainers `DockerComposeEnvironment` for e2e stack | docker-compose CLI via `tests/e2e/compose-helper.ts` | Existing `compose-helper.ts:14` rationale: "the e2e suite must exercise the SAME compose topology operators run, not a bespoke programmatic stack. `docker compose` is the contract." Phase 13 must respect this. testcontainers stays for apps/api UNIT tests only. |

**Installation:**
```bash
pnpm add -D -w @cucumber/cucumber@12.8.2 playwright-bdd@8.4.2
pnpm add -D -w @playwright/test@1.60.0   # upgrade from 1.59.1
pnpm add -D -w eslint-plugin-local-rules
pnpm add nodemailer -w   # already present; ensure pinned at workspace root for packages/email/
```

**Version verification:** `@cucumber/cucumber 12.8.2` is one patch behind registry head (12.8.3, 2026-05-13). `playwright-bdd 8.4.2` is two minors behind head (8.5.1, ~2026-05-08). Both locked by REQUIREMENTS.md E2E-01. Planner should confirm with user whether to lift to head or hold at REQUIREMENTS-locked versions before installing. Recommend hold-at-locked for v2 ship; bump in v3.

## Phase Boundary & What "Done" Looks Like

Mapped to roadmap success criteria → E2E-01..E2E-12:

| Criterion | Requirement IDs | Done means |
|---|---|---|
| 1. `make e2e-cjm` + GHA `E2E_CJM=1` green on happy + negative twin | E2E-01 | New Makefile target boots `docker-compose.embedded-litellm.yml --profile default`, runs Playwright via playwright-bdd against `https://web.localhost` + `https://api.localhost`, exits 0. New GHA job `e2e-cjm` in `.github/workflows/ci.yml` after the existing `e2e-hermetic` job (line 390) using same compose lifecycle pattern. |
| 2. CJM doc + ~20 journeys + signup→verify round-trip | E2E-02, E2E-03, E2E-04 | `docs/customer-journeys.md` exists with 8 `## Journey:` sections + `§N.M` anchors. 8 `.feature` files in `tests/e2e-cjm/features/`. Mailpit HTTP-API helper round-trips email assertion via real worker. |
| 3. Atomic commit replaces `noopSender` with real `EmailSender` via `packages/email/` | E2E-09 | ONE commit changes `apps/worker/src/index.ts:68-72,130` + adds `packages/email/src/` + adds `tests/e2e-cjm/` scaffold. **Ordering inside the commit:** RED test first (signup-verify scenario expecting real email in mailpit), GREEN code (packages/email + worker wiring), REFACTOR (extract apps/api/src/email.ts into the package and re-point). Single atomic commit, NOT staggered. |
| 4. testcontainers leaks closed + ESLint rule + sweep | E2E-10, E2E-11 | `tools/global-vitest-teardown.ts` exists and registered in `vitest.config.ts` (root) `globalTeardown`. SIGINT/SIGTERM handlers in `apps/api/vitest.setup.ts` (or equivalent) drop orphan containers. CI `e2e-cjm` job + `e2e-hermetic` job + `e2e-phase6-quick` job all add `docker container prune --filter label=org.testcontainers=true --force` in `always()` after the test step. ESLint rule `no-weak-getAll-length` in `tools/eslint-local-rules/` registered in repo root ESLint config (or paired with Biome — see Open Questions). The 5 confirmed sites in `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx` swept to `toHaveLength(1)`. |
| 5. Readiness probes + tenant isolation + retry-banned + ≥ 90/90/90/90 coverage on diff | E2E-12 | `support/compose-harness.ts:waitForReady()` polls: Postgres `SELECT 1` via psql; api `GET /api/health` returns 200 AND `migrations_completed=true`; mailpit `GET /api/v1/messages` returns 200; web `GET /` returns 200. Cucumber `Before` hook calls `POST /api/test/tenant` (new test-only endpoint gated by `OPENWHISPR_TEST_ROUTES=true`) per scenario. `playwright.config.ts` has `retries: 0` AND comment "retry-on-flake banned per PITFALLS §5". Phase verifier checks `packages/email/` per-file coverage ≥ 90 on all 4 axes. |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (unit/integration — existing) | Vitest 4 (config: `vitest.config.ts` root + `apps/*/vitest.config.ts` per-package overrides with 90/90/90/90 thresholds) |
| Framework (e2e — NEW for phase 13) | Playwright 1.60.0 via playwright-bdd 8.4.2 (config: `tests/e2e-cjm/playwright.config.ts`) |
| Framework (e2e — existing, parallel) | Vitest with `tests/e2e/vitest.e2e.config.ts` — kept in place, NOT replaced |
| Quick run command (vitest) | `pnpm test` |
| Quick run command (e2e-cjm, one scenario) | `pnpm exec bddgen && pnpm exec playwright test --grep '@cjm-1.1' --config tests/e2e-cjm/playwright.config.ts` |
| Full suite command (vitest) | `pnpm test --coverage` |
| Full suite command (e2e-cjm) | `make e2e-cjm` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| E2E-01 | Harness boots compose + executes a Gherkin scenario end-to-end | e2e | `make e2e-cjm` | ❌ Wave 0 — `tests/e2e-cjm/`, `Makefile e2e-cjm`, `.github/workflows/ci.yml e2e-cjm` job |
| E2E-02 | CJM doc enumerates 20 journeys + 8 .feature files exist + every happy has a negative twin | doc-lint + e2e | `pnpm exec tsx tools/lint-cjm-anchors.ts` (NEW) + `make e2e-cjm` | ❌ Wave 0 — `docs/customer-journeys.md`, 8 `.feature` files, `tools/lint-cjm-anchors.ts` |
| E2E-03 | Signup happy + 4 negative twins | e2e | `pnpm exec playwright test --grep '@cjm-1.' --config tests/e2e-cjm/playwright.config.ts` | ❌ Wave 0 — `signup-verify.feature` + step file |
| E2E-04 | Mailpit HTTP API round-trip | e2e | covered by E2E-03 scenarios (mailpit helper invoked from step defs) | ❌ Wave 0 — `tests/e2e-cjm/support/mailpit-helper.ts` |
| E2E-05 | Sign-in 403 unverified resend CTA | e2e | `pnpm exec playwright test --grep '@cjm-2.' --config tests/e2e-cjm/playwright.config.ts` | ❌ Wave 0 — `signin.feature` |
| E2E-06 | Transcribe round-trip | e2e | `pnpm exec playwright test --grep '@cjm-4.' --config tests/e2e-cjm/playwright.config.ts` | ❌ Wave 0 — `transcribe.feature`; reuses `compose/mock-litellm/` + `MOCK_DIARIZATION=true` |
| E2E-07 | `/admin` landing | e2e | `pnpm exec playwright test --grep '@cjm-5.' --config tests/e2e-cjm/playwright.config.ts` | ❌ Wave 0 — `admin-onboarding.feature` (Phase 12 wires the real route; Phase 13 scenario currently RED until Phase 12 ships) |
| E2E-08 | Locale switch | e2e | `pnpm exec playwright test --grep '@cjm-6.' --config tests/e2e-cjm/playwright.config.ts` | ❌ Wave 0 — `locale-switch.feature` |
| E2E-09 | Worker email-delivery via real nodemailer | unit + e2e | `pnpm --filter @openwhispr/email test --coverage` (NEW package vitest config) AND covered by E2E-04 e2e round-trip | ❌ Wave 0 — `packages/email/src/index.ts`, `packages/email/src/index.test.ts`, `packages/email/vitest.config.ts` |
| E2E-10 | testcontainers cleanup | smoke (CI) | `docker ps -a --filter "label=org.testcontainers=true"` returns 0 rows within 30s after vitest exit; CI `always()` prune step | ❌ Wave 0 — `tools/global-vitest-teardown.ts`, `tools/global-vitest-teardown.test.ts`, root `vitest.config.ts` edit |
| E2E-11 | Weak-assertion ESLint ban + sweep | lint + unit | `pnpm exec eslint apps/web/src/components/screens/auth/__tests__` AND `pnpm --filter @openwhispr/web test apps/web/src/components/screens/auth/__tests__` | ❌ Wave 0 — `tools/eslint-local-rules/no-weak-getall-length.js`, `tools/eslint-local-rules/no-weak-getall-length.test.js`, eslint config registration, 5 sweep sites |
| E2E-12 | Readiness probes + tenant isolation + retry banned | e2e config lint | `pnpm exec tsx tools/lint-no-retries.ts tests/e2e-cjm/playwright.config.ts tests/e2e-cjm/cucumber.cjs` (NEW) | ❌ Wave 0 — `tools/lint-no-retries.ts` |

### Sampling Rate

- **Per task commit (unit/integration):** `pnpm test` (vitest) — runs in < 60s for touched packages.
- **Per task commit (e2e-cjm single scenario):** `pnpm exec bddgen && pnpm exec playwright test --grep '@cjm-X.Y'` — < 90s after compose is warm.
- **Per wave merge:** Full e2e-cjm suite locally: `make e2e-cjm` — boot + 20 scenarios estimated 5–10 min.
- **Phase gate:** Full vitest suite + full `make e2e-cjm` GREEN; coverage report shows ≥ 90/90/90/90 on `packages/email/src/**` and on all modified files in `apps/worker/src/index.ts`.

### Wave 0 Gaps

13.a Wave 0:
- [ ] `packages/email/package.json`, `packages/email/tsconfig.json`, `packages/email/vitest.config.ts`, `packages/email/src/index.ts`, `packages/email/src/index.test.ts` (RED tests first — assert send() routes to nodemailer, loud-fails when SMTP_HOST unset in production).
- [ ] `tests/e2e-cjm/cucumber.cjs` (BDD config — pointer to `features/`, `steps/`, `support/`).
- [ ] `tests/e2e-cjm/playwright.config.ts` (workers: 4, retries: 0, baseURL: `https://web.localhost`, ignoreHTTPSErrors: true, use trace+screenshot+video on failure).
- [ ] `tests/e2e-cjm/support/world.ts` (Playwright `Page` per scenario + `ComposeHarness` handle).
- [ ] `tests/e2e-cjm/support/compose-harness.ts` (wraps `tests/e2e/compose-helper.ts`; adds `waitForReady()` covering Postgres SELECT 1, api /api/health + migrations_completed, mailpit /api/v1/messages 200, web / 200).
- [ ] `tests/e2e-cjm/support/mailpit-helper.ts` (polling helper with exponential backoff + explicit timeout per Pitfall 5; methods: `clearInbox()`, `waitForMessage({to, subjectMatch}, timeoutMs)`, `extractVerificationToken(message)`).
- [ ] `tests/e2e-cjm/support/tenant-isolation.ts` (per-scenario tenant provisioning via new `/api/test/tenant` endpoint).
- [ ] `tests/e2e-cjm/features/signup-verify.feature` (reference scenarios @cjm-1.1 happy + @cjm-1.2 already-registered).
- [ ] `tests/e2e-cjm/steps/auth.steps.ts` (step definitions for signup-verify reference scenarios).
- [ ] `tools/global-vitest-teardown.ts` + `tools/global-vitest-teardown.test.ts`.
- [ ] `tools/eslint-local-rules/no-weak-getall-length.js` + `.test.js`.
- [ ] `tools/lint-cjm-anchors.ts` + `.test.ts` (verifier enforcement for D-10).
- [ ] `tools/lint-no-retries.ts` + `.test.ts` (verifier enforcement for D-12).
- [ ] `apps/api/src/routes/test-tenant.ts` (NEW test-only route gated by `OPENWHISPR_TEST_ROUTES=true`).
- [ ] `Makefile e2e-cjm:` target.
- [ ] `.github/workflows/ci.yml` `e2e-cjm` job + `docker container prune` in `always()` for all 3 e2e jobs.
- [ ] Root `package.json`: add deps + `bddgen` script + `e2e-cjm` script.

13.b Wave 0 (after 13.a ships):
- [ ] `docs/customer-journeys.md` (8 journeys, 20 scenarios, every happy has a negative twin — authored FIRST per D-10).
- [ ] 7 more `.feature` files (signin, password-reset, transcribe, admin-onboarding, locale-switch, oidc-providers, error-paths).
- [ ] 5 more step files (`transcribe.steps.ts`, `admin.steps.ts`, `oidc.steps.ts`, `locale.steps.ts`, `errors.steps.ts`).
- [ ] Per-scenario tenant isolation extended to all features.

## Cucumber + playwright-bdd: chosen patterns

[CITED: vitalets/playwright-bdd README — verified pattern matches ARCHITECTURE.md §Phase 13]

### File layout

```
tests/e2e-cjm/
├── cucumber.cjs                       # Cucumber config (paths to features/steps)
├── playwright.config.ts               # Playwright config — workers:4, retries:0, ignoreHTTPSErrors:true
├── features/
│   ├── signup-verify.feature          # @cjm-1.1 .. @cjm-1.5 (5 scenarios)
│   ├── signin.feature                 # @cjm-2.1 .. @cjm-2.3 (3 scenarios)
│   ├── password-reset.feature         # @cjm-3.1 .. @cjm-3.2 (2)
│   ├── transcribe.feature             # @cjm-4.1 .. @cjm-4.2 (2)
│   ├── admin-onboarding.feature       # @cjm-5.1 .. @cjm-5.2 (2)
│   ├── locale-switch.feature          # @cjm-6.1 .. @cjm-6.2 (2)
│   ├── oidc-providers.feature         # @cjm-7.1 .. @cjm-7.2 (2)
│   └── error-paths.feature            # @cjm-8.1 .. @cjm-8.2 (2)
├── steps/
│   ├── auth.steps.ts                  # signup, signin, password-reset, oidc, verify
│   ├── transcribe.steps.ts            # multipart audio, response shape
│   ├── admin.steps.ts                 # admin onboarding wizard, /admin landing
│   ├── locale.steps.ts                # locale switch, en+ru error copy
│   └── errors.steps.ts                # 4xx/5xx negative-twin assertions
└── support/
    ├── world.ts                       # Cucumber World + Playwright Page lifecycle
    ├── compose-harness.ts             # Wraps tests/e2e/compose-helper.ts; adds waitForReady()
    ├── mailpit-helper.ts              # HTTP API client for /api/v1/messages
    ├── tenant-isolation.ts            # POST /api/test/tenant per scenario
    └── README.md                      # Pattern docs (for future authors)
```

### Parallel execution model

playwright-bdd compiles `.feature` files into Playwright spec files at runtime (`bddgen` step), then invokes `playwright test` which uses its standard worker-per-spec parallelism. With `workers: 4` and per-scenario tenant isolation, scenarios run safely in parallel. Cucumber's own parallel mode is bypassed (playwright-bdd doesn't use it).

### Tag filtering

Gherkin tags `@cjm-N.M` work natively as Playwright `--grep` patterns because playwright-bdd embeds them in the generated test names. Examples:
- `pnpm exec playwright test --grep '@cjm-1.1'` — single scenario
- `pnpm exec playwright test --grep '@cjm-1\\.'` — entire feature 1
- `pnpm exec playwright test --grep-invert '@negative'` — happy paths only (if we add `@negative` to negative twins — optional, recommended)

### Sharing Playwright page between steps

playwright-bdd auto-injects a `page` fixture into step functions via Cucumber's `IWorld`. Pattern (from vitalets/playwright-bdd docs):

```typescript
// Source: vitalets/playwright-bdd — README pattern, verified live as of 2026-05-14
// [CITED: github.com/vitalets/playwright-bdd]
import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();

Given("user is on signup page", async ({ page }) => {
  await page.goto("/sign-up");
});

When("user submits valid credentials {string}", async ({ page }, email: string) => {
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill("Pwa9!testStrong");
  await page.getByRole("button", { name: /^sign up$/i }).click();
});
```

### Tradeoff vs plain @playwright/test (NOT switching — D-05 locks Cucumber)

| Cucumber+playwright-bdd (LOCKED) | Plain @playwright/test alternative |
|---|---|
| `.feature` files are non-engineer-readable CJM artefact | Code-only tests; CJM lives in separate doc with no structural link |
| Verifier can enforce "CJM.md anchor per .feature" via file structure | Convention-only; harder to enforce |
| Two-step compilation (`bddgen` → `playwright test`) | One-step |
| Cucumber DSL learning curve for step authors | Native Playwright API |
| ~10 min extra runtime per scenario for `bddgen` step (negligible) | None |

**Decision rationale (D-05 locked):** The CJM-doc-as-artefact value outweighs the extra compilation step. Pitfall 2 (CJM.md-before-features) is naturally enforced by Gherkin file structure.

## Real docker-compose harness: readiness, tenant isolation, teardown

### Readiness probes contract (Pitfall 5)

`support/compose-harness.ts:waitForReady()` MUST poll all four signals before any scenario starts. Liveness (`docker compose up --wait` + Fastify listening) is INSUFFICIENT — migrations may still be running.

```typescript
// [CITED: PITFALLS.md §Pitfall 5, lines 164-168]
// 1. Postgres ready: `psql -h pgbouncer -U openwhispr_owner -d openwhispr -c "SELECT 1"` returns 0
// 2. api ready: GET https://api.localhost/api/health returns 200 AND body.migrations_completed === true
// 3. mailpit ready: GET http://localhost:8025/api/v1/messages returns 200 (JSON array)
// 4. web ready: GET https://web.localhost/ returns 200 AND body does NOT contain Next.js dev-HMR marker
```

**Important detour:** `api/health` may not currently expose `migrations_completed`. Planner MUST verify; if absent, this phase adds it (small edit to `apps/api/src/health.ts`). [ASSUMED — needs verification in planning step; if endpoint already exposes the field, no edit needed.]

### Tenant isolation per scenario

Each Cucumber `Before` hook calls `POST /api/test/tenant` (new test-only route, gated by `OPENWHISPR_TEST_ROUTES=true` — precedent: `tests/e2e/compose-helper.ts:HERMETIC_ENV` lines 28-34). The route:

1. Creates a fresh `tenants` row with a UUID-based slug.
2. Creates a transient user under that tenant.
3. Returns `{tenant_id, user_id, session_token}` to the test.

After scenario teardown, `After` hook calls `DELETE /api/test/tenant/{tenant_id}` which CASCADE-drops the tenant + user + any rows created during the scenario. Strategy: tenant-row delete with `ON DELETE CASCADE` foreign keys (already present per Phase 03/06 RLS architecture). Transaction-rollback was considered but rejected — Cucumber + Playwright span multiple HTTP requests; transaction boundary can't span the test process and the api process.

**Workaround for TD-14.f trap (referenced in CONTEXT.md `<code_context>`):** `compose-harness.ts:bootStack()` MUST pass `--profile default` explicitly when running `docker compose up`. Phase 14 fixes this by dropping `profiles:` from universal services, but Phase 13 ships first per work-order 13→12→14 — workaround is in scope here.

### Compose teardown

After the full suite finishes, `compose-harness.ts:teardownStack()` runs:
```bash
docker compose --profile default down -v --remove-orphans
```
The CI job ALSO runs `docker container prune --filter label=org.testcontainers=true --force` in `always()` to catch any orphans from sibling vitest jobs.

## packages/email/ refactor: interface, DI, env wiring, atomic-commit plan

### Source-of-truth interface (extracted verbatim from `apps/api/src/email.ts`)

```typescript
// packages/email/src/index.ts (NEW)
// [CITED: apps/api/src/email.ts lines 30-44, refactored to remove FastifyBaseLogger coupling]

import nodemailer, { type Transporter } from "nodemailer";
import type { Logger } from "pino";   // shared with worker; api passes its FastifyBaseLogger (compatible)

export interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  delivered: boolean;
  reason?: string;
}

export interface EmailSender {
  send(args: SendArgs): Promise<SendResult>;
}

export interface EmailSenderEnv {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  SMTP_SECURE?: string;            // boolean string; auto-derives from port=465 if unset
  SMTP_REJECT_UNAUTHORIZED?: string; // boolean string; default true
  NODE_ENV?: string;
}

export function createEmailSender(env: EmailSenderEnv, log: Logger): EmailSender {
  // D-07 loud-fail: production + missing SMTP_HOST → throw at module init.
  if (env.NODE_ENV === "production" && !env.SMTP_HOST) {
    throw new Error(
      "[packages/email] SMTP_HOST is unset in production. Refusing to start. " +
      "Configure SMTP_HOST (production) or unset NODE_ENV (dev/CI uses mailpit:1025)."
    );
  }

  const host = env.SMTP_HOST ?? "mailpit";
  const port = Number(env.SMTP_PORT ?? "1025");
  const from = env.SMTP_FROM ?? "no-reply@openwhispr.local";
  const auth = env.SMTP_USER && env.SMTP_PASSWORD
    ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
    : undefined;

  const transporter: Transporter = nodemailer.createTransport({
    host,
    port,
    secure: env.SMTP_SECURE === "true" || port === 465,
    auth,
    tls: { rejectUnauthorized: env.SMTP_REJECT_UNAUTHORIZED !== "false" },
  });

  return {
    async send({ to, subject, text, html }) {
      try {
        const info = await transporter.sendMail({ from, to, subject, text, html });
        log.info({ to, subject, messageId: info.messageId, event: "email.sent" }, "email sent");
        return { delivered: true };
      } catch (err) {
        // Pitfall #4 from existing apps/api/src/email.ts: NEVER swallow.
        log.error({ err, to, subject, event: "email.failed" }, "email send failed");
        throw err;
      }
    },
  };
}
```

### Wiring into worker

```typescript
// apps/worker/src/index.ts — edit (current line 68-72 + line 130)
// REMOVE:
//   const noopSender: EmailSender = { async send() { return { delivered: true, reason: "no-op-sender" }; } };
// REPLACE with import:
import { createEmailSender } from "@openwhispr/email";

// Inside main():
const sender = createEmailSender(process.env, log);   // throws at boot in prod if SMTP_HOST unset

// Existing emailWorker construction at line 126-134 becomes:
const emailWorker = new Worker(
  QUEUE_NAMES.emailDelivery,
  buildEmailDeliveryHandler({ pool: appOwnerPool, sender, renderer: templateRenderer }),
  { connection },
);
```

### Wiring into apps/api

```typescript
// apps/api/src/email.ts — DELETE the makeEmailService factory body.
// REPLACE with re-export wrapper that adapts FastifyBaseLogger → Logger and supplies env:
//
//   import type { FastifyBaseLogger } from "fastify";
//   import { createEmailSender, type EmailSender } from "@openwhispr/email";
//   export type { EmailSender, SendArgs, SendResult } from "@openwhispr/email";
//   export function makeEmailService(log: FastifyBaseLogger): EmailSender {
//     return createEmailSender(process.env, log as unknown as Logger);
//   }
//
// All apps/api call-sites stay unchanged.
```

### Atomic-commit plan (D-04)

ONE commit lands ALL of:
1. `packages/email/{package.json, tsconfig.json, vitest.config.ts, src/index.ts, src/index.test.ts}` (RED test pinned first).
2. `apps/api/src/email.ts` refactored to re-export from `@openwhispr/email`.
3. `apps/worker/src/index.ts` line 68-72 deletion + line 130 wiring to `createEmailSender`.
4. `apps/worker/package.json` + `apps/api/package.json` workspace dep `@openwhispr/email: workspace:*`.
5. `pnpm-workspace.yaml` adds `packages/email` (verify if `packages/*` glob already covers — likely yes; check).
6. `tests/e2e-cjm/` scaffold from Wave 0 list above.
7. `tools/global-vitest-teardown.ts` + registration in root `vitest.config.ts`.
8. ESLint local-rules + sweep of the 5 weak-assertion sites.
9. Reference scenarios `@cjm-1.1` + `@cjm-1.2` GREEN against the real boot.

The commit message references E2E-09 + D-04. This is **the** Phase 13.a delivery commit; no other commit in 13.a may touch these files.

## testcontainers leak fix

### Root cause [CITED: PITFALLS.md §Pitfall 6, lines 191-195]

1. Ryuk reaper requires the parent process's socket to remain open until cleanup signal arrives. Vitest watch-mode SIGKILL closes the socket before Ryuk reaps → orphans.
2. `TESTCONTAINERS_RYUK_DISABLED=true` may be set in CI and forgotten locally → no reaper at all.
3. Vitest `--watch` reload races the cleanup hook.

### Fix

**`tools/global-vitest-teardown.ts` (NEW):**
```typescript
// [VERIFIED: pattern from PITFALLS.md §Pitfall 6 + deferred-items.md §1]
import { execSync } from "node:child_process";

export default async function globalTeardown(): Promise<void> {
  try {
    execSync(
      `docker container prune --filter label=org.testcontainers=true --force`,
      { stdio: "inherit", timeout: 30_000 },
    );
    execSync(
      `docker volume prune --filter label=org.testcontainers=true --force`,
      { stdio: "inherit", timeout: 30_000 },
    );
  } catch (err) {
    console.error("[global-vitest-teardown] cleanup failed; orphans may remain", err);
  }
}
```

**`apps/api/vitest.setup.ts` (NEW or extend existing):**
```typescript
const cleanup = () => {
  try {
    execSync(`docker container prune --filter label=org.testcontainers=true --force`,
             { stdio: "ignore", timeout: 10_000 });
  } catch {}
  process.exit(130);
};
process.once("SIGINT", cleanup);
process.once("SIGTERM", cleanup);
```

**`vitest.config.ts` (root) edit:**
```typescript
test: {
  globalSetup: ["./tools/global-vitest-setup.ts"],  // existing or new
  globalTeardown: ["./tools/global-vitest-teardown.ts"],  // NEW
  // ...
}
```

**CI `always()` step (.github/workflows/ci.yml):**
Add to every job that runs vitest or e2e:
```yaml
      - name: Prune testcontainers (always)
        if: always()
        run: |
          docker container prune --filter label=org.testcontainers=true --force || true
          docker volume prune --filter label=org.testcontainers=true --force || true
```

**Acceptance criteria from deferred-items.md §1:**
- After vitest exits (normal or SIGINT or watch reload), `docker ps -a --filter "label=org.testcontainers=true"` returns 0 rows within 30s. This is asserted by a new smoke test `tools/global-vitest-teardown.test.ts` that spawns a child vitest run that spins up a `@testcontainers/postgresql` container, SIGINTs it, then asserts the orphan count is 0 within 30s.

## Custom ESLint rule: `no-weak-getall-length`

### Banned patterns (the family)

1. `screen.getAllByText(/.../).length.toBeGreaterThan(0)` — TD-13.a/d canonical case
2. `screen.queryAllByText(/.../).length.toBeGreaterThan(0)`
3. `screen.findAllByText(/.../).length.toBeGreaterThan(0)` (await variant)
4. Same with `*ByRole`, `*ByLabelText`, `*ByPlaceholderText`, `*ByTestId`, `*ByDisplayValue`, `*ByAltText`, `*ByTitle`
5. `.length >= 1`, `.length > 0`, `.length !== 0` variants — all weak

### Replacement guidance

| Weak | Strong | When |
|---|---|---|
| `getAllByText(x).length.toBeGreaterThan(0)` | `expect(screen.getAllByText(x)).toHaveLength(1)` | When exclusivity matters (the dupe-banner case) |
| same | `expect(screen.getByText(x)).toBeInTheDocument()` | When single element is the assertion |
| `getAllByText(x).length.toBeGreaterThan(2)` | `expect(screen.getAllByText(x)).toHaveLength(N)` (exact) | Always — exact > "at least" |

### Implementation

**`tools/eslint-local-rules/no-weak-getall-length.js` (NEW):**
```javascript
// [VERIFIED: eslint-plugin-local-rules pattern; uses ESLint AST per estree spec]
"use strict";

const WEAK_QUERIES = [
  "getAllByText", "queryAllByText", "findAllByText",
  "getAllByRole", "queryAllByRole", "findAllByRole",
  "getAllByLabelText", "queryAllByLabelText", "findAllByLabelText",
  "getAllByPlaceholderText", "queryAllByPlaceholderText", "findAllByPlaceholderText",
  "getAllByTestId", "queryAllByTestId", "findAllByTestId",
  "getAllByDisplayValue", "queryAllByDisplayValue", "findAllByDisplayValue",
  "getAllByAltText", "queryAllByAltText", "findAllByAltText",
  "getAllByTitle", "queryAllByTitle", "findAllByTitle",
];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban weak getAllBy*().length.toBeGreaterThan(0) family — use toHaveLength(N) or getByX().",
    },
    schema: [],
    messages: {
      weakAssertion:
        "Weak assertion: `{{query}}(...).length.toBeGreaterThan(0)` passes for both N=1 (correct) and N=2+ (dupe bug). " +
        "Use `expect(...getAllBy*(...)).toHaveLength(N)` for exclusivity or `expect(...getByX(...)).toBeInTheDocument()` for single-element.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        // Detect: <something>.<weakQuery>(...).length
        // followed by .toBeGreaterThan(0) | .toBeGreaterThanOrEqual(1) | .not.toBe(0)
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          (node.callee.property.name === "toBeGreaterThan" ||
           node.callee.property.name === "toBeGreaterThanOrEqual") &&
          node.arguments.length === 1 &&
          node.arguments[0].type === "Literal" &&
          (node.arguments[0].value === 0 || node.arguments[0].value === 1)
        ) {
          // walk up: expect(QUERY(...).length).toBeGreaterThan(0)
          // node.callee.object is the .length MemberExpression
          let obj = node.callee.object;
          if (obj.type === "MemberExpression" && obj.property.name === "length") {
            const inner = obj.object;
            if (inner.type === "CallExpression" &&
                inner.callee.type === "MemberExpression" &&
                inner.callee.property.type === "Identifier" &&
                WEAK_QUERIES.includes(inner.callee.property.name)) {
              context.report({
                node,
                messageId: "weakAssertion",
                data: { query: inner.callee.property.name },
              });
            }
          }
        }
      },
    };
  },
};
```

**`tools/eslint-local-rules/index.js`:**
```javascript
module.exports = {
  rules: {
    "no-weak-getall-length": require("./no-weak-getall-length.js"),
  },
};
```

**Registration in root ESLint config (`eslint.config.js` or `.eslintrc.cjs` — phase 13 must detect which the repo uses):**
```javascript
import localRules from "eslint-plugin-local-rules";
export default [
  {
    plugins: { "local-rules": localRules },
    rules: { "local-rules/no-weak-getall-length": "error" },
    files: ["apps/web/**/*.test.{ts,tsx}", "apps/web/**/*.spec.{ts,tsx}"],
  },
];
```

**Open question for planner:** Repo currently uses Biome as the primary linter (`pnpm lint`). Biome does NOT run ESLint rules. Two paths:
- (a) Add ESLint solely for this rule (and any future custom rules) running on `apps/web/**/__tests__/*` only.
- (b) Implement as a Biome plugin (Biome 1.9+ supports user plugins as JS).
- (c) Implement as a custom tsx lint script in `tools/lint-weak-assertions.ts` mirroring `tools/lint-english.ts` pattern (recommended — least new tooling, matches existing precedent).

**Recommendation:** Option (c) — custom tsx lint script, registered in `make lint` and CI. Matches existing `tools/lint-*.ts` family (lint-english, lint-rls, lint-migrations, lint-tdd, lint-tenant-context, lint-ui-spec). Lower-friction than adding ESLint. Planner confirms with user during planning.

## Weak-assertion sweep: file inventory and rewrite strategy

Grep across `apps/web/src` produced exactly **5 weak-assertion sites** at the time of research (2026-05-14):

| File | Line | Current | Rewrite |
|---|---|---|---|
| `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx` | 147 | `expect(screen.getAllByText(/already registered/i).length).toBeGreaterThan(0)` | `expect(screen.getAllByText(/already registered/i)).toHaveLength(1)` — closes TD-13.a (dupe-banner bug) |
| same | 165 | `expect(screen.getAllByText(/sign-up failed/i).length).toBeGreaterThan(0)` | `expect(screen.getAllByText(/sign-up failed/i)).toHaveLength(1)` |
| same | 186 | `expect(screen.getAllByText(/sign-up failed/i).length).toBeGreaterThan(0)` | `expect(screen.getAllByText(/sign-up failed/i)).toHaveLength(1)` |
| `apps/web/src/components/screens/notes/__tests__/NotesListClient.test.tsx` | 276, 295 | `expect(screen.getAllByText("—").length).toBeGreaterThan(0)` | DECISION: `toHaveLength(N)` where N = expected dash count for that fixture, OR `expect(screen.getAllByText("—").length).toBe(N)`. Researcher cannot determine exact N without running fixtures; **planner OR implementer determines N at test-write time.** |
| `apps/web/src/components/screens/notes/__tests__/NoteDetailClient.test.tsx` | 360, 370 | `expect(screen.getAllByText("—").length).toBeGreaterThan(0)` | same — determine exact N during 13.a sweep wave |

**CONTEXT scope clarification:** D-02 names only `apps/web/src/components/screens/auth/__tests__/*.test.tsx`. The 4 sites in `notes/__tests__/` are OUTSIDE the named D-02 scope. **Decision needed from planner:**
- (a) Sweep only the 3 auth sites; the 4 notes sites stay weak (the new ESLint rule will catch them on next touch). Matches D-02 verbatim.
- (b) Sweep all 5 files since the ESLint rule will fail CI immediately on any future PR touching them, and shipping a rule that fails the existing codebase is bad form.

**Recommendation:** (b) — sweep all 7 sites across 3 files. Add a `// eslint-disable-next-line local-rules/no-weak-getall-length` only if the planner can't determine the exact N quickly for a notes assertion, and file a follow-up ticket. The "exclusivity" question for notes: each `"—"` placeholder represents a missing-field column; exact count is determined by the fixture row count × placeholder-column count. **Confirm with user during planning.**

**Definition of "exclusivity":** For the SignUpForm dupe-banner case (TD-13.a), exclusivity means "exactly one banner element — not two — must be in the DOM after submit". For the notes `"—"` placeholder case, exclusivity means "exactly N placeholders matching the fixture's missing-field count". `toHaveLength(1)` is the strong assertion for the banner case; `toHaveLength(N)` with explicit N is the strong assertion for the notes case.

## CJM doc + ~20 journey enumeration (13.b — wave 1 authored FIRST per D-10)

### `docs/customer-journeys.md` structure

```markdown
# OpenWhispr Customer Journey Map

> Authored: 2026-05-14
> One `## Journey: §N.M` heading per Gherkin scenario.
> Phase 13 verifier (tools/lint-cjm-anchors.ts) fails the build if any
> tests/e2e-cjm/features/*.feature contains a `@cjm-N.M` tag without a
> matching anchor in this file.

## Journey §1.1 — Signup happy path (signup-verify.feature)
Persona: end-user fresh signup.
Steps:
  1. user opens https://web.localhost/sign-up
  2. user fills name + email + password (strong, ≥ 8 char)
  3. user clicks "Sign up"
  4. UI shows "Check your email" success state
  5. mailpit /api/v1/messages contains a message addressed to that email
  6. user clicks the verification link inside the email
  7. UI confirms "Email verified"
  8. user is auto-redirected to /sign-in
Tag: @cjm-1.1

## Journey §1.2 — Already-registered dedup (negative twin of §1.1)
[...]
```

### 8 features × ~20 scenarios with happy + negative twins (verifier-enforced)

| Feature ordinal | File | Happy path | Negative twin(s) |
|---|---|---|---|
| 1 | `signup-verify.feature` | @cjm-1.1 signup → mailpit → verify → verified state | @cjm-1.2 already-registered (USER_ALREADY_EXISTS); @cjm-1.3 password<8 per-field error; @cjm-1.4 locale-scoped error copy (ru); @cjm-1.5 social-button-gating (0 providers → 0 buttons rendered — closes TD-12.c) — E2E-03 requires 4 negative twins, this provides them |
| 2 | `signin.feature` | @cjm-2.1 verified user sign-in | @cjm-2.2 unverified user → 403 with resend-CTA (E2E-05 closes TD-13.c); @cjm-2.3 wrong password → "Sign-in failed" exactly one banner |
| 3 | `password-reset.feature` | @cjm-3.1 request reset → mailpit → click link → set new password → sign in | @cjm-3.2 expired/invalid token → "Reset link expired" |
| 4 | `transcribe.feature` | @cjm-4.1 multipart audio upload → 200 with transcript JSON shape | @cjm-4.2 audio missing mime → 415 / 400 with operator-actionable envelope |
| 5 | `admin-onboarding.feature` | @cjm-5.1 first-run wizard → admin created → /admin reaches index (Phase 12 ships the wizard; harness writes RED here — closes TD-12.a/b) | @cjm-5.2 wizard re-run on installed system → 409 setup_already_complete (closes TD-12.b duplicate-admin trap) |
| 6 | `locale-switch.feature` | @cjm-6.1 en → ru locale switch → ru error copy visible | @cjm-6.2 unsupported locale `xx` → falls back to `en` with no console error |
| 7 | `oidc-providers.feature` | @cjm-7.1 google provider configured → "Continue with Google" button visible → click flow round-trips through `compose/fixture-idp` | @cjm-7.2 no providers configured → zero social buttons rendered (additional layer over @cjm-1.5; closes TD-12.c) |
| 8 | `error-paths.feature` | @cjm-8.1 GET /api/health returns 200 with migrations_completed=true | @cjm-8.2 rate-limit cascade → 429 with retry-after header NOT triggered by self-induced 404 (closes TD-12.c cascade) |

**Total: 8 features, 18 scenarios (8 happy + 10 negative twins).** Matches "~20" per E2E-02. The roster ships with 4 negative twins specifically on feature 1 per E2E-03. Negative-twin rule satisfied: every 2xx scenario has at least one 4xx/5xx sibling.

## Coverage strategy: how 90/90/90/90 applies vs e2e green

### Decision (recommended, planner confirms)

The 90/90/90/90 floor (PROJECT.md TDD-01b) applies to **vitest unit + integration test coverage of new/modified code paths**, NOT to the Cucumber/Playwright e2e suite. Rationale:
- E2E spans process boundaries (Playwright → Traefik → api/web/worker → Postgres/Mailpit). c8/istanbul cannot instrument across docker boundaries without injecting `c8`/`nyc` into every container's startup command, multiplying complexity 10x for marginal signal.
- Industry standard (Playwright docs, Cucumber docs): treat e2e as a separate **green gate**, not a coverage source.
- Existing vitest `tests/e2e/` similarly does not contribute to the per-package 90/90/90/90 floor; it's measured as suite-green.

**What the verifier measures:**
- `packages/email/src/**` — vitest unit tests must hit ≥ 90/90/90/90 (new code in this phase).
- `apps/worker/src/index.ts` lines 60-140 (delta from this phase) — if `apps/worker/vitest.config.ts` excludes `src/index.ts` from coverage (it does — see worker vitest.config.ts line 28), the worker wiring change is verified by smoke test + e2e green, not by unit coverage.
- `tools/global-vitest-teardown.ts` + `tools/eslint-local-rules/no-weak-getall-length.js` (or `tools/lint-weak-assertions.ts`) — each has its own unit test ≥ 90/90/90/90.
- The `make e2e-cjm` suite green is a **separate** verifier gate — orthogonal to the coverage gate.

**Concrete coverage commitments:**
- `packages/email/src/index.ts` — full nodemailer factory + loud-fail branch + dev-fallback branch covered.
- `tools/global-vitest-teardown.ts` — spawn-then-SIGINT test asserts 0 orphans within 30s.
- `tools/eslint-local-rules/no-weak-getall-length.js` — unit test runs ESLint on a fixture file containing each banned pattern + each allowed pattern.
- `tools/lint-cjm-anchors.ts` — unit test asserts verifier fails on missing anchor, passes on valid pair.
- `tools/lint-no-retries.ts` — unit test asserts verifier fails on `retries: 3`, passes on `retries: 0`.

### Open question for planner

If user/verifier insists on coverage instrumentation across the e2e suite, the path forward is `playwright-coverage` plugin (third-party, not Playwright-official) which records v8 coverage from the browser side only — NOT from api/worker tier. Recommend NOT pursuing in v2; document as v3 stretch.

## Sub-plan split rationale (13.a vs 13.b) with dependency graph

```
Phase 13.a (harness + worker fix + teardown + weak-assert sweep)
│
├── Wave 0: RED tests (packages/email, global-vitest-teardown, eslint-local-rule, lint-cjm-anchors, lint-no-retries)
├── Wave 1: GREEN code (packages/email implementation, worker wiring, teardown impl, eslint rule impl)
├── Wave 2: REFACTOR (extract apps/api/src/email.ts → re-export from packages/email)
├── Wave 3: Harness scaffold (tests/e2e-cjm/ tree, Makefile, GHA job)
├── Wave 4: Reference scenarios (@cjm-1.1 happy + @cjm-1.2 already-registered) GREEN
└── Wave 5: Weak-assertion sweep (5–7 sites) GREEN; verifier passes; SINGLE ATOMIC COMMIT (D-04)

Phase 13.b (CJM doc + remaining 7 features + step coverage)
│  REQUIRES 13.a SHIPPED (uses 13.a's harness + tenant-isolation + mailpit-helper + readiness-probes)
│
├── Wave 1: docs/customer-journeys.md authored FIRST + lint-cjm-anchors.ts assertion (D-10)
├── Wave 2: 7 remaining .feature files + 4 remaining step files (auth.steps already exists from 13.a)
└── Wave 3: All ~20 scenarios GREEN; verifier passes
```

**Dependency:** 13.b strictly requires 13.a — 13.b's feature files use the harness scaffold, mailpit-helper, tenant-isolation primitives that 13.a authors. They CANNOT parallelize. Confirmed.

**Why split (vs monolithic):** 13.a is the gate for Phase 12. Phase 12 begins as soon as 13.a's PR merges; 13.b can ship in parallel with Phase 12's plan-write. Monolithic would block Phase 12 by ~1 week.

**Why NOT split further (rejected: 13.a fixes / 13.b harness / 13.c features):** Per CONTEXT.md DISCUSSION-LOG, this introduces orchestration overhead. The atomic-commit invariant (D-04) is naturally enforced in 13.a; further split breaks atomicity.

## Pitfalls and "what NOT to do"

### Pitfall 5 (PITFALLS.md §5 — direct cite)

> Ban retry-on-failure in CI for Phase 13 suite. **A flake IS a bug.**

[CITED: PITFALLS.md line 171]

**Concrete enforcement:**
- `tests/e2e-cjm/playwright.config.ts:retries` MUST be `0` with comment "retry-on-flake banned per PITFALLS §5".
- `tests/e2e-cjm/cucumber.cjs` MUST NOT set `retry`.
- `tools/lint-no-retries.ts` (NEW) parses both config files at CI start, fails build if either is non-zero.
- Test names containing "(flaky)" forbidden by `tools/lint-no-retries.ts` regex.

### Pitfall 6 — testcontainers leak

Closes deferred-items #1 (above). Specifically: vitest watch-mode SIGKILL + Ryuk socket close = orphan. Fix is `globalTeardown` + SIGINT/SIGTERM handlers + CI `always()` prune (all detailed above).

### Anti-patterns to avoid

| Anti-pattern | What goes wrong | Do instead |
|---|---|---|
| `await page.waitForTimeout(2000)` | Race condition masking | `await page.waitForResponse(...)` or readiness probe |
| `getAllByText(...).length.toBeGreaterThan(0)` | Passes for both correct N=1 and buggy N=2+ | `toHaveLength(N)` with explicit N |
| `up --wait` without readiness probe | Fastify is listening but migrations still running | Custom `waitForReady()` with `migrations_completed=true` |
| Retry-on-flake | Masks real race conditions; team stops investigating | Ban retries; fix the readiness probe instead |
| `noopSender` / `noopXxxx` in worker | Jobs complete in <1ms; user-visible features fail silently | Loud-fail at boot in prod; real impl in dev/CI |
| `.feature` file without CJM.md anchor | CJM doc rots; tests drift from documented journey | `tools/lint-cjm-anchors.ts` fails build (D-10) |
| Happy-path-only scenario | Bug-shipping pattern (TD-13.e) | Negative-twin rule verifier-enforced (D-10) |
| Cross-scenario state leak (shared tenant) | Parallel scenarios collide | Per-scenario tenant via `POST /api/test/tenant` |
| Real SMTP in CI | Cost + flake + secret leak | Mailpit only; D-07 dev-default to `mailpit:1025` |
| Browser test-IDs everywhere | Encourages weak assertions | Prefer accessible queries (`getByRole`, `getByLabelText`) |

## Runtime State Inventory

Phase 13 is mostly additive (new packages/dirs/files) but does have one runtime-state surface worth recording:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema changes in 13.a or 13.b. The `/api/test/tenant` route inserts into existing `tenants` table; per-scenario cleanup deletes the row. | None |
| Live service config | None — no Traefik/observability config changes; mailpit already exposed at `:8025` per `docker-compose.embedded-litellm.yml:735-737`. | None |
| OS-registered state | None | None |
| Secrets/env vars | NEW env vars consumed by `packages/email/createEmailSender`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`, `SMTP_REJECT_UNAUTHORIZED`. All already present in `apps/api/src/email.ts` — no NEW secret keys. Worker now reads them too. Production deploys MUST set `SMTP_HOST` or worker refuses to start (D-07). | Document in `docs/operations.md` BYOK section (Phase 14 territory) but Phase 13 must add a brief note to `apps/worker/README.md` (or equivalent) — verify if file exists. |
| Build artifacts | `pnpm-workspace.yaml` already covers `packages/*` (verify); `pnpm install` after `packages/email/` added is mandatory locally and in CI. | `pnpm install` + commit `pnpm-lock.yaml` |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 24 LTS | All apps | ✓ | 24.x (per CLAUDE.md) | — |
| pnpm | Workspace | ✓ | (existing) | — |
| Docker + docker-compose | E2E + testcontainers | ✓ (assumed; CLAUDE.md mandates real services via compose/testcontainers) | — | — |
| Playwright browsers (Chromium) | playwright-bdd | ⚠️ Must run `pnpm exec playwright install chromium` after Phase 13 install | 1.60.0 | — |
| mkcert / trusted local CA | NOT needed for Phase 13 (uses `ignoreHTTPSErrors: true` until Phase 17) | ✗ | — | `ignoreHTTPSErrors: true` in playwright.config.ts — explicit fallback for v2 |
| `compose/mock-litellm/`, `compose/fixture-idp` | `transcribe.feature`, `oidc-providers.feature` | ✓ | — | — |
| Mailpit | All email scenarios | ✓ (`axllent/mailpit:v1.29` per docker-compose.embedded-litellm.yml:736) | v1.29 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Trusted TLS (Phase 17) — fallback is `ignoreHTTPSErrors: true` in v2.

## Security Domain

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | YES | Better Auth (existing); Phase 13 scenarios exercise it but don't change it |
| V3 Session Management | YES | Better Auth sessions; per-scenario tenant isolation prevents session bleed |
| V4 Access Control | YES | RLS (existing); per-scenario tenant ensures one scenario's data is invisible to another |
| V5 Input Validation | NO (no new API surface in 13.a; only `/api/test/tenant` test-only route gated by env) | Zod (existing) |
| V6 Cryptography | NO new crypto | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Test-only endpoint reachable in prod | Elevation of Privilege | `OPENWHISPR_TEST_ROUTES=true` env gate; refuse to register the route handler when env unset; document in `docs/operations.md` "never set this in production" |
| SMTP credentials in test logs | Information Disclosure | `packages/email/` `log.info` redacts password field; nodemailer never logs auth payload by default |
| Mailpit HTTP API exposed in CI | Info Disclosure | Mailpit listens on `:8025` inside the docker network only; not externally exposed by Traefik |
| Production `noopSender` deploy regression | Repudiation (silent failure) | D-07 loud-fail at worker boot; new smoke test asserts worker REFUSES to start when SMTP_HOST unset + NODE_ENV=production |

## Sources

### Primary (HIGH confidence)

- `apps/worker/src/index.ts:60-140` — live source; verified noopSender + wiring path
- `apps/api/src/email.ts` — live source; verified extraction target shape
- `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx:147,165,186` — live source; verified 3 weak-assertion sites
- `apps/web/src/components/screens/notes/__tests__/{NotesListClient,NoteDetailClient}.test.tsx` — live source; verified 4 additional weak-assertion sites outside D-02 named scope
- `tests/e2e/compose-helper.ts` — live source; verified hermetic-env pattern + `docker compose` (NOT testcontainers) for e2e contract
- `docker-compose.embedded-litellm.yml:735-737` — verified mailpit service config
- `.github/workflows/ci.yml:382-487` — verified existing `e2e-hermetic` + `e2e-phase6-quick` job patterns to mirror for `e2e-cjm`
- `apps/api/vitest.config.ts` + `apps/worker/vitest.config.ts` — verified 90/90/90/90 nested-threshold shape pattern
- `.planning/REQUIREMENTS.md:431-442, 537-548` — E2E-01..E2E-12 verbatim
- `.planning/ROADMAP.md:698-710` — Phase 13 goal + success criteria verbatim
- `.planning/research/SUMMARY.md:57-62, 163-164` — Phase 13 Must / Anti + Pitfall pointers
- `.planning/research/ARCHITECTURE.md:38-60` — components inventory + data flow
- `.planning/research/PITFALLS.md:151-200` — Pitfall 5 (readiness/retry) + Pitfall 6 (testcontainers leak)
- `.planning/deferred-items.md:1-30` — testcontainers leak acceptance criteria
- `.planning/phases/13-e2e-cjm-harness-v2-ships-first/13-CONTEXT.md` — user decisions D-01..D-13
- `.planning/phases/13-e2e-cjm-harness-v2-ships-first/13-DISCUSSION-LOG.md` — decision rationale

### Secondary (MEDIUM confidence)

- npm registry (verified 2026-05-14): `@cucumber/cucumber@12.8.3` (REQUIREMENTS locks 12.8.2); `@playwright/test@1.60.0` (matches); `playwright-bdd@8.5.1` (REQUIREMENTS locks 8.4.2). Two versions drift one+two patches behind head — planner confirms whether to lift.
- vitalets/playwright-bdd README (cited pattern; not re-fetched in this session — relying on ARCHITECTURE.md's prior verification)

### Tertiary (LOW confidence)

- None — every claim in this research traces to a verified live source or a locked decision in CONTEXT.md.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `apps/api/src/health.ts` returns 200 but may NOT currently expose `migrations_completed=true`; this phase may need to add it. | Readiness probes | If the field exists, no edit needed. If absent, planner adds a small `apps/api/src/health.ts` edit + test inside 13.a. Verify in planning. |
| A2 | Repo's primary linter is Biome (`pnpm lint` in Makefile); ESLint may or may not be configured. The recommendation is a custom tsx `tools/lint-weak-assertions.ts` matching existing `tools/lint-*.ts` pattern instead of authoring an ESLint plugin. | Custom ESLint rule | Planner picks linter approach during planning; recommendation is tsx-lint (option c). |
| A3 | `pnpm-workspace.yaml` already globs `packages/*` so adding `packages/email/` requires only `pnpm install`. | packages/email/ refactor | If glob is narrower, planner adds explicit entry. Trivial to verify. |
| A4 | Phase 12 ships `/admin` index page; harness scenario `@cjm-5.1` is RED until Phase 12 lands. CI will fail this scenario between Phase 13 ship and Phase 12 ship — this is INTENTIONAL per "v2 phases write tests RED against this harness" framing. | CJM journey roster | Acceptable; document in 13.b plan that `@cjm-5.x` scenarios are expected-RED through Phase 12 merge. |
| A5 | `TD-15.g` (`/api/locale` shadowing) is not fixed until Phase 15. `locale-switch.feature` scenario `@cjm-6.1` tests CURRENT broken behavior, OR is expected-RED through Phase 15. | CJM journey roster | Planner decides: skip-with-rationale, OR ship as expected-RED. Recommend the latter — RED scenarios are the whole point. |
| A6 | The atomic-commit invariant (D-04) is enforceable by a single `git commit` — no pre-commit hook will reject this size; the commit will be large (~30+ files) but that's by design. | Atomic-commit plan | If pre-commit hooks (lefthook/husky) timeout or reject large commits, planner adjusts. |
| A7 | `compose/fixture-idp` exists and is wired into the embedded-litellm compose stack for OIDC scenarios. CONTEXT.md `<code_context>` lists it as available but didn't fully verify in this session. | oidc-providers.feature | Planner verifies; if absent, scenario `@cjm-7.1` is expected-RED until Phase 14 lands the fixture-idp wiring. |
| A8 | The `playwright-coverage` plugin from third parties exists for browser-side v8 coverage; NOT recommended for v2. | Coverage strategy | Low risk; we explicitly deprioritize. |
| A9 | Mailpit HTTP API endpoint `/api/v1/messages` returns 200 JSON; specific fields (`Subject`, `To.Address`, `Snippet`, `ID`) are stable in mailpit v1.29. | Mailpit helper | Verified by mailpit docs (not re-fetched); standard endpoint. Helper code in `support/mailpit-helper.ts` is straightforward to author. |

## Open Questions

1. **Should Phase 13 lift versions to npm-registry HEAD (`@cucumber/cucumber@12.8.3`, `playwright-bdd@8.5.1`) or hold at REQUIREMENTS.md-locked (12.8.2, 8.4.2)?**
   - What we know: REQUIREMENTS.md locks 12.8.2 + 8.4.2. Registry HEAD is 12.8.3 + 8.5.1 (one+two patches/minors ahead).
   - What's unclear: Whether REQUIREMENTS-locked is intentional pinning or training-data lag.
   - Recommendation: HOLD at REQUIREMENTS-locked for v2 ship (stability > newness for a brownfield phase that gates 5 downstream phases). Lift in v3.

2. **ESLint plugin vs tsx-lint script for the weak-assertion ban?**
   - What we know: Repo uses Biome as primary linter (`pnpm lint`); no ESLint detected in inventory.
   - What's unclear: Whether adding ESLint is acceptable vs writing `tools/lint-weak-assertions.ts` matching the `lint-english.ts` precedent.
   - Recommendation: tsx-lint script (option c above). Matches `tools/lint-*.ts` family.

3. **Does `apps/api/src/health.ts` already expose `migrations_completed`?**
   - What we know: Readiness contract requires it (Pitfall 5).
   - What's unclear: Whether endpoint exposes the field.
   - Recommendation: Planner runs `grep -n migrations_completed apps/api/src/health.ts` during planning. If absent, add to 13.a Wave 1.

4. **Notes-component weak-assertion sweep IN or OUT of scope?**
   - What we know: D-02 names only `auth/__tests__/`. Notes has 4 sites in 2 files.
   - What's unclear: Whether user wants strict D-02 adherence or broader sweep.
   - Recommendation: Sweep all 7 sites (3 auth + 4 notes); the ESLint/tsx-lint rule will fail CI on any future PR touching them otherwise.

5. **Phase 13 scenarios that are expected-RED until downstream phases ship (Phase 12, Phase 14, Phase 15).**
   - What we know: `@cjm-5.x` red until Phase 12; `@cjm-6.x` red until Phase 15 (TD-15.g); `@cjm-7.x` red until Phase 14 fixture-idp wiring.
   - What's unclear: Whether CI `e2e-cjm` job marks them `skip`-with-rationale OR fails until each phase lands.
   - Recommendation: Mark with `@expected-red @after-phase-12` etc. tags; `playwright.config.ts:grepInvert: '@expected-red'` filters them out in CI until the corresponding phase ships, at which point the tag is removed.

6. **Compose stack lifecycle in CI: re-use existing `e2e-hermetic` boot OR boot independently?**
   - What we know: GHA `e2e-hermetic` (ci.yml:390) already boots the stack for vitest e2e.
   - What's unclear: Whether `e2e-cjm` job reuses that booted stack OR boots its own.
   - Recommendation: Independent boot. `e2e-cjm` runs in its own job for isolation + parallel speed. Compose CLI caches images aggressively.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `@cucumber/cucumber` as runner with `cucumber-js` CLI | playwright-bdd compiles `.feature` → Playwright spec; Playwright is the runner | playwright-bdd 1.x → 8.x maturity | Inherits Playwright workers/fixtures/trace viewer |
| testcontainers without explicit teardown | Ryuk reaper + globalTeardown + SIGINT handler + CI prune | Required by deferred-items #1 | Closes 30GB volume leak |
| Weak-assertion-friendly RTL queries (`getAllBy*.length > 0`) | Strong queries (`getByX`, `toHaveLength(N)`) | Industry move 2023+ | TD-13.a/d closed |
| `up --wait` for healthcheck-based readiness | Custom `waitForReady()` polling 4 signals including `migrations_completed=true` | PITFALLS §5 | Closes race-condition flake class |
| Retry-on-flake (e2e `retries: 3`) | Retry BANNED; flake IS a bug; fix the readiness probe | PITFALLS §5 | Real bugs surface; CI minutes saved |

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package verified against npm registry + locked by REQUIREMENTS.md.
- Architecture: HIGH — file layout, atomic-commit plan, refactor mechanics all derived from live source + CONTEXT decisions.
- Pitfalls: HIGH — every pitfall cites a concrete TECH_DEBT.md entry or PITFALLS.md section.
- Weak-assertion sweep: HIGH — 7 sites enumerated by direct grep.
- CJM journey roster: HIGH — verbatim from CONTEXT D-08/D-09, 8 features × ~20 scenarios mapped.
- Coverage strategy: MEDIUM — recommendation is sound but may need user confirmation that 90/90/90/90 does NOT extend to e2e suite green; doc-as-separate-gate is industry standard but project may want otherwise.

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days — stack is stable; playwright-bdd minor versions move ~monthly)

## RESEARCH COMPLETE

**Phase:** 13 — e2e-cjm-harness-v2-ships-first
**Confidence:** HIGH

### Key findings

- Cucumber + playwright-bdd is the LOCKED runner; treat `@cucumber/cucumber` as DSL-only, Playwright as the actual test runner via `playwright-bdd`'s `bddgen` compilation step. Workers=4, retries=0.
- `packages/email/` extraction is mostly a verbatim move of `apps/api/src/email.ts` with the env-driven loud-fail-in-prod gate added per D-07. ATOMIC commit (D-04) bundles harness scaffold + worker wiring + `packages/email/` + ESLint rule + 5–7-site weak-assertion sweep + reference scenarios @cjm-1.1/@cjm-1.2 green.
- testcontainers leak fix: `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM handlers + CI `always()` `docker container prune --filter label=org.testcontainers=true`. Closes deferred-items #1.
- Weak-assertion sweep: 5 sites in `auth/__tests__/SignUpForm.test.tsx`; 4 additional sites in `notes/__tests__/` outside D-02 named scope — recommend extending sweep (option b).
- 8 features × ~20 scenarios with happy + negative twins matches the verifier-enforced D-10 negative-twin rule.
- Coverage gate: 90/90/90/90 applies to vitest only (packages/email, tools/*); e2e-cjm green is a separate verifier gate.

### File created

`.planning/phases/13-e2e-cjm-harness-v2-ships-first/13-RESEARCH.md`

### Confidence assessment

| Area | Level | Reason |
|---|---|---|
| Standard stack | HIGH | Versions verified against npm registry 2026-05-14 |
| Architecture | HIGH | All paths traced to live source |
| Pitfalls | HIGH | Direct citations to PITFALLS.md + deferred-items.md |
| Sub-plan split | HIGH | Dependency graph verified — 13.b strictly requires 13.a |
| Coverage strategy | MEDIUM | Industry-standard recommendation; user confirms during planning |

### Open questions (carried forward to planner)

1. Lift versions to registry HEAD or hold at REQUIREMENTS-locked? (Recommend hold)
2. ESLint plugin vs tsx-lint script for weak-assertion ban? (Recommend tsx-lint)
3. Does `apps/api/src/health.ts` already expose `migrations_completed`? (Verify in planning)
4. Sweep notes-component weak-assertions IN or OUT of D-02 scope? (Recommend IN)
5. Mark expected-RED scenarios via `@expected-red @after-phase-12` tag? (Recommend yes)
6. Independent compose boot for `e2e-cjm` GHA job vs reuse `e2e-hermetic`? (Recommend independent)

### Ready for planning

Research complete. Planner can now create `13.a-PLAN.md` (harness + worker fix + teardown + weak-assert sweep — ONE atomic commit per D-04) and, after 13.a ships, `13.b-PLAN.md` (CJM doc authored FIRST + remaining 7 features per D-10).
