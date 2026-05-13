# Phase 13: E2E + CJM Harness (v2 — ships first) - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the Cucumber+Playwright E2E + CJM harness that every subsequent v2 phase (12, 14, 15, 16, 17) writes tests RED against, atomically replacing the worker `noopSender` with a real nodemailer-backed `EmailSender` and closing the testcontainers-leak + weak-assertion footguns that let TD-13.a/c/d/e ship green in v1.

**In scope:**
- New `tests/e2e-cjm/` Cucumber+Playwright+playwright-bdd harness (separate from existing vitest `tests/e2e/`).
- Replacement of `apps/worker/src/index.ts:68-134` `noopSender` with a real nodemailer-backed `EmailSender` extracted to NEW `packages/email/` (shared by api + worker).
- `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM hook + CI `docker container prune --filter label=org.testcontainers=true` in `always()`.
- ESLint rule banning the `getAllByText(...).length.toBeGreaterThan(0)` weak-assertion family, plus a sweep of `apps/web/src/components/screens/auth/__tests__/*.test.tsx`.
- Mailpit HTTP-API verification helper for the signup→verification-email→verified journey.
- Per-scenario tenant isolation; readiness-probe gating (not just `--wait` liveness); retry-on-flake BANNED in CI.
- `docs/customer-journeys.md` (CJM) and ~20 named journeys with `@cjm-N.M` tags, happy + negative twins.
- `make e2e-cjm` Makefile target + GHA `E2E_CJM=1` job.

**Out of scope (explicit deferrals):**
- Real SMTP in CI (mailpit only).
- Cross-browser matrix (Chromium-only in v2).
- Full `BACKEND_SPEC.md` wire surface inside `.feature` files (contract tests stay in `packages/contract-tests/`).
- Mobile viewports.
- Load/chaos/fuzz inside Cucumber.
- Phase 12 functionality itself (`/setup`, `/admin` index, `users.role` migration) — Phase 13 only enables Phase 12's RED tests; the wizard ships in Phase 12.

</domain>

<decisions>
## Implementation Decisions

### Sub-plan split (research-recommended)
- **D-01:** Phase 13 splits into **13.a** (harness + worker fix + teardown + weak-assert sweep) and **13.b** (CJM doc + 8 `.feature` files). 13.a unblocks Phase 12.
- **D-02:** 13.a contents (single phase, multiple plan waves):
  - tests/e2e-cjm/ scaffold (cucumber.cjs, playwright.config.ts, support/world.ts, support/compose-harness.ts).
  - 1–2 reference scenarios (signup-verify happy + 1 negative twin) to prove the harness works end-to-end.
  - Worker `noopSender` → real nodemailer-backed `EmailSender` in new `packages/email/`.
  - `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM + CI prune-in-always.
  - ESLint rule for weak-assertion family + sweep of `apps/web/src/components/screens/auth/__tests__/*.test.tsx`.
  - Mailpit HTTP helper.
  - Readiness-probes contract (Postgres `SELECT 1`, Fastify `/api/health` + migrations_completed, mailpit `/api/v1/messages` 200, web `/` 200).
  - Makefile `e2e-cjm` target + GHA `e2e-cjm` job (`E2E_CJM=1`).
- **D-03:** 13.b contents: `docs/customer-journeys.md` authored FIRST (wave 1), then 8 `.feature` files + step coverage (wave 2). Verifier MUST fail if any `.feature` lacks a matching `docs/customer-journeys.md §N.M` anchor.
- **D-04:** **Atomic-commit nuance:** Roadmap success criterion #3 requires the harness-introducing commit AND the worker `noopSender`→nodemailer commit to land as ONE atomic commit. With the 13.a/13.b split, this atomic requirement lives inside 13.a — the plan must enforce it (single PR, single commit gating both file groups, NOT staggered across plan-wave boundaries).

### BDD runner pick
- **D-05:** **Cucumber + @playwright/test + playwright-bdd LOCKED** per REQUIREMENTS.md E2E-01 (`@cucumber/cucumber 12.8.2` + `@playwright/test 1.60.0` + `playwright-bdd 8.4.2`). Roadmap's deferred open question is resolved here. Rationale: `.feature` files are the auditable CJM artefact + non-engineer-readable + Gherkin file structure naturally enforces "CJM.md before features" (Pitfall 2). The "plain @playwright/test with @cjm tags" alternative from ARCHITECTURE.md §Open-Q is REJECTED.

### packages/email/ shape + SMTP env contract
- **D-06:** `packages/email/` is a **shared package consumed by both apps/api and apps/worker** (matches `@openwhispr/observability` + `@openwhispr/litellm-client` precedent). Extract existing `apps/api/src/email.ts` `EmailService` into `packages/email/src/`. Both api and worker import `EmailSender` + `templateRenderer`. Inline-in-worker alternative is REJECTED — loses reusability and the package-boundary discipline already established.
- **D-07:** **SMTP env contract — loud-fail at worker boot in production** when `SMTP_HOST` is unset. Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` (boolean), `SMTP_REJECT_UNAUTHORIZED`. Default in dev/CI: wire to `mailpit:1025`. Detection: `NODE_ENV === 'production'` && `!process.env.SMTP_HOST` → throw at module init (matches Phase 14 BYOK loud-fail pattern; same posture as bootstrap.sh refuse-to-start gate). Lazy-on-first-send and Mailpit-default-in-prod alternatives REJECTED — both reproduce the brownfield trap that gave us TD-mailpit.

### CJM journey roster + ordering rule
- **D-08:** **8 `.feature` files (research roster confirmed)**: `signup-verify.feature`, `signin.feature`, `password-reset.feature`, `transcribe.feature`, `admin-onboarding.feature`, `locale-switch.feature`, `oidc-providers.feature`, `error-paths.feature`. ~20 scenarios total after negative twins. Each feature 2–3 scenarios (happy + 1–2 negative twins).
- **D-09:** **`@cjm-N.M` tag schema** — N = feature ordinal (1–8 in roster order), M = scenario index within feature. Examples: `@cjm-1.1` = signup-verify happy path, `@cjm-1.2` = signup-verify already-registered dedup, `@cjm-5.1` = admin-onboarding happy path (the journey that closes TD-12.b).
- **D-10:** **HARD rule: `docs/customer-journeys.md` complete BEFORE any `.feature` file lands** in 13.b. Phase 13 verifier MUST fail if any `.feature` exists without a matching `docs/customer-journeys.md §N.M` anchor. CJM.md table enumerates per journey: happy path + each error branch (every non-2xx the backend emits on this path) + each silent-failure mode (worker noop, no email, no observability). Negative-twin rule: every `Scenario:` with a 2xx outcome MUST have a sibling `Scenario:` in the same feature file asserting a 4xx/5xx outcome the UI handles correctly. Verifier enforces this.

### Cross-cutting locks (carried forward from prior phases & PROJECT.md)
- **D-11:** Strict TDD constitutional (PROJECT.md TDD-01b ≥ 90% per-phase coverage on touched files); each fix lands with its tests in the SAME atomic commit.
- **D-12:** **Retry-on-flake BANNED in CI config** (`retries: 0` in `playwright.config.ts` + Cucumber `retry: 0`). A flake IS a bug — PITFALLS §5.
- **D-13:** Per-scenario tenant isolation (each scenario provisions a unique tenant + transient user), reusing the Phase 07.1 worker-scoped-fixture insight at scenario scope.

### Claude's Discretion
- File layout under `tests/e2e-cjm/{features,steps,support}/` exact subdivision (one step file per domain: `auth.steps.ts`, `transcribe.steps.ts`, `admin.steps.ts`, etc.) — researcher/planner choose.
- Exact nodemailer transport configuration (pool vs single-shot, retry policy) — researcher chooses, but MUST loud-fail at boot per D-07.
- Whether the new `packages/email/` exports `createEmailSender(env)` factory vs class — researcher chooses.
- Mailpit polling backoff (exponential vs fixed) inside the helper — researcher chooses; MUST have an explicit timeout per Pitfall 5.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 13 requirements & roadmap
- `.planning/REQUIREMENTS.md` §E2E-01..E2E-12 — 12 locked requirements for Phase 13 wire shape.
- `.planning/ROADMAP.md` §"Phase 13: E2E + CJM Harness (v2 — ships first)" — goal + 5 success criteria.
- `.planning/PROJECT.md` — TDD-01b coverage rule; English-only; en+ru i18n; constitutional disciplines.

### v2 research (authoritative for this phase)
- `.planning/research/SUMMARY.md` §"Phase 13 — E2E + CJM harness" + §"Stack Additions (v2 only)" — dep versions locked (`@cucumber/cucumber 12.8.2`, `@playwright/test 1.60.0`, `playwright-bdd 8.4.2`, `@axe-core/playwright 4.x`).
- `.planning/research/ARCHITECTURE.md` §"Phase 13 — Cucumber+Playwright E2E + CJM" — new components inventory + data flow + Phase scope.
- `.planning/research/PITFALLS.md` Pitfalls 1, 2, 3, 4, 5 — weak-assertions, happy-path-only, capability drift, brownfield wizard timing, readiness-probe races. **All five are Phase 13 cross-cutting.**
- `.planning/research/FEATURES.md` §"Phase 13 — E2E + CJM harness" — Must / Anti delineation.
- `.planning/research/STACK.md` — dependency-version rationale.

### Code call-sites that change
- `apps/worker/src/index.ts:68-134` — `noopSender` declaration + `sender: noopSender` wiring; both replaced atomically with real nodemailer-backed `EmailSender` from new `packages/email/`.
- `apps/api/src/email.ts` — current `EmailService` source; extracted into `packages/email/src/`.
- `apps/web/src/components/screens/auth/__tests__/*.test.tsx` — weak-assertion sweep target (TD-13.a/d).
- `tests/e2e/compose-helper.ts` — to be wrapped by new `tests/e2e-cjm/support/compose-harness.ts`.
- `.github/workflows/ci.yml` — new `e2e-cjm` job after the existing `e2e` job; gated on `E2E_CJM=1`.
- `package.json` (root) — `@playwright/test` upgrade 1.59.1 → 1.60.0; add `@cucumber/cucumber 12.8.2` + `playwright-bdd 8.4.2`.

### Deferred-items closure
- `.planning/deferred-items.md` §1 (testcontainers cleanup) — closed by Phase 13's `tools/global-vitest-teardown.ts` + CI prune.
- `.planning/deferred-items.md` §2 (`apps/web/public/.gitkeep` missing) — NOT owned by Phase 13; documented here so planner does not pick it up (Phase 15 owns).

### Upstream wire spec (only for transcribe & auth scenarios)
- `/Users/nick/openwhispr/docs/BACKEND_SPEC.md` — relevant for `transcribe.feature` round-trip assertions; do NOT duplicate spec invariants inside `.feature` files (contract-tests remain authoritative).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/email.ts` — existing `EmailService` with nodemailer + i18n template integration (Phase 06-08 + Phase 10-01b). Extract verbatim into `packages/email/src/` as the new shared package.
- `packages/observability/` + `packages/litellm-client/` — precedent for shared packages consumed by both api + worker. `packages/email/` mirrors this pattern (D-06).
- `tests/e2e/compose-helper.ts` — existing vitest-based dockerized stack harness. New `tests/e2e-cjm/support/compose-harness.ts` wraps it (does NOT replace it — separate runners).
- `@playwright/test 1.59.1` already in repo-root `package.json:45` — minor upgrade to 1.60.0.
- `compose/mock-litellm/`, `tests/e2e/mock-realtime/`, `compose/fixture-idp` — hermetic fixtures the Cucumber suite can reuse for non-paid scenarios.
- Phase 07.1 worker-scoped Playwright fixture pattern — reused at scenario scope per D-13.

### Established Patterns
- Co-located `*.test.ts` next to `*.ts` everywhere — Phase 15 reorganizes this, but Phase 13 lives at `tests/e2e-cjm/` (already root-level), so unaffected.
- BullMQ Worker-per-queue at `apps/worker/src/index.ts` — the new `EmailSender` slots in at the existing `emailWorker` construction (line 130 `sender: noopSender` → `sender: createEmailSender(env)`).
- Env-switch escape-hatch pattern (Phase 07.1 D-01) — `OPENWHISPR_DISABLE_RATE_LIMIT`, `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION` etc. Same posture for any new Phase 13 test-mode flags (default OFF in prod).

### Integration Points
- Compose stack boot: Cucumber `support/compose-harness.ts` boots `docker-compose.embedded-litellm.yml`. **Note:** this file currently has TD-14.f (`profiles: [default]` selecting zero services). Phase 13 must work around this — pass `--profile default` explicitly in `bootStack()` OR use the in-flight Phase 14 fix if it lands first. Per the work-order (13 → 12 → 14), Phase 13 ships first, so it MUST handle the TD-14.f trap inline.
- Mailpit `:8025/api/v1/messages` HTTP API — already exposed by mailpit service in compose. Helper polls this endpoint.
- Traefik `:443 websecure` HTTPS entrypoint — Cucumber `baseURL: https://app.localhost`. Until Phase 17 lands trusted certs, Playwright config sets `ignoreHTTPSErrors: true`.

</code_context>

<specifics>
## Specific Ideas

- Roster of 8 features and their `@cjm-N.M` numbering (D-08, D-09) is exact — researcher should not propose alternate scope unless a journey demonstrably duplicates another.
- `@cjm-1.1` (signup-verify happy) and `@cjm-1.2` (already-registered dedup) are the **reference scenarios shipped in 13.a** to prove the harness end-to-end before 13.b expands coverage.
- The verification-email round-trip via Mailpit HTTP API (E2E-04) is the **single most important integration test** in 13.a — it exercises every layer (web → api → BullMQ → worker → packages/email/ → nodemailer → mailpit SMTP → mailpit HTTP API readback → Playwright clicks verification link → asserts verified state). If this works, the harness works.
- The atomic-commit guarantee (D-04) is non-negotiable — researcher/planner must NOT propose breaking it across plan waves.

</specifics>

<deferred>
## Deferred Ideas

- **Hybrid runner (Cucumber for some features, plain Playwright for others)** — explicitly rejected in favor of Cucumber-everywhere. Re-evaluate only if Cucumber+playwright-bdd parallel-mode bugs become structural pain.
- **password-reset.feature replacement with verification-email-resend.feature** — kept research roster instead; resend-CTA assertion lives inside `signin.feature` 403-unverified negative twin (per E2E-05).
- **api-keys.feature + capabilities-drift.feature** (10-feature expansion) — deferred to v3 or a Phase 13.c if a third sub-plan ever materializes. Capability-drift is partially covered inside Phase 12's UI conformance scope.
- **`apps/web/public/.gitkeep` commit** (`.planning/deferred-items.md` §2) — Phase 15 owns per existing assignment; Phase 13 does NOT pick it up even though the harness will surface the issue if Phase 11 hasn't already.
- **Cross-browser matrix (Firefox, WebKit)** — Chromium-only in v2; expand if user-base evidence demands it.
- **Mobile viewports** — explicit anti per FEATURES.md.
- **Real SMTP in CI** — explicit anti; mailpit only.

</deferred>

---

*Phase: 13-e2e-cjm-harness-v2-ships-first*
*Context gathered: 2026-05-14*
