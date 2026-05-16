# QA Audit — Test Layering & Pyramid Health (2026-05-16)

**Audit type:** Read-only structural review.
**Scope:** How tests are organized (unit → integration → contract → smoke → e2e → load → mutation → security), what CI runs and in what order, BYOK matrix coverage, and stage layering smells.
**Companion document:** [2026-05-16-cjm-coverage.md](./2026-05-16-cjm-coverage.md) (journey-level gaps).

---

## TL;DR

**The pyramid is solid where it exists, but two HIGH-priority layers are missing:**

1. **L1 — No smoke-test layer between `docker compose up --wait` and full e2e.** Memory `feedback_smoke_before_full_e2e` already records this, but there is no `make smoke` target, no `tests/smoke/` directory, no synthetic transaction probe. After `up --wait`, the only signal of API functional readiness is the full `make e2e-cjm` run (~60 s). A broken route handler today is discovered through a Playwright trace, not a 2-second smoke probe.
2. **L2 — BYOK provider-matrix integration test is absent.** `byok-guard` covers missing-key shape and URL redaction, but no test asserts that each of `[OpenAI, OpenRouter, Groq, Bedrock] × [BYOK on/off]` = 8 permutations loads the right env vars and routes to the right provider path inside LiteLLM.

Six more lower-priority gaps follow (L3…L8). Each has a concrete proposed fix the next agent can pick up.

---

## 1. Current pyramid (as it is today)

```
                  ┌────────────────────────────────────┐
        Security  │ gitleaks, trivy, codeql, license   │  parallel, PR-required
                  ├────────────────────────────────────┤
        Mutation  │ stryker --since (PR)               │  PR-incremental
                  │ stryker (nightly)                  │  nightly
                  ├────────────────────────────────────┤
            Load  │ k6 (PROFILE=mock | realistic)      │  nightly ONLY  ◀── L3 gap
                  ├────────────────────────────────────┤
             E2E  │ e2e-cjm (playwright-bdd, 26 GREEN) │  PR gated
                  │ e2e-hermetic (vitest)              │  PR gated
                  │ e2e-test-phase6 (testcontainers)   │  PR gated
                  ├────────────────────────────────────┤
           Smoke  │ ───── ABSENT ─────                 │  ◀── L1 gap (HIGH)
                  ├────────────────────────────────────┤
        Contract  │ packages/contract-tests (36 tests) │  PR gated, post-compose
                  ├────────────────────────────────────┤
     Integration  │ testcontainers (Postgres, Redis)   │  inside `pnpm test`
                  ├────────────────────────────────────┤
            Unit  │ vitest, ~250+ files                │  inside `pnpm test`
                  ├────────────────────────────────────┤
       Typecheck  │ tsc --noEmit (all workspaces)      │  PR required
                  ├────────────────────────────────────┤
            Lint  │ biome + 9 custom linters           │  PR required, parallel
                  └────────────────────────────────────┘
```

Coverage thresholds (from root `vitest.config.ts` + per-package overrides):
- **Global:** lines 85 / branches 80 / functions 80 / statements 85.
- **Strict (90/90/90/90):** `apps/api`, `apps/web`, `apps/worker`, `packages/data`, `packages/byok-guard`, `packages/email`, `packages/litellm-client`.

CI gating (from `.github/workflows/ci.yml`):
- Lint + typecheck run in parallel.
- `pnpm test` (unit + integration) gates on lint + typecheck.
- Contract + e2e gate on `pnpm test` passing.
- 15 required status checks total.

---

## 2. Layering gaps (severity-ordered)

### L1 — HIGH — No smoke-test layer between `docker compose up --wait` and full e2e

**Evidence:**
- `Makefile:43-44` — `up: docker compose up -d --wait`. The `--wait` flag only checks container healthchecks (docker-level), not application functional readiness.
- No `make smoke` target in the Makefile (`grep -E '^smoke' Makefile` returns nothing).
- No `tests/smoke/` directory.
- Memory `feedback_smoke_before_full_e2e` records the user's expectation: "lint → build → per-service-up → stack → playwright, in that order, with logs check at each layer."
- Memory `feedback_check_loki_after_tests` records the symptom: "after ANY e2e/compose run, FIRST check container logs + traefik routing — don't stare at playwright trace.zip guessing." A smoke layer would convert that 30+ s feedback loop into ~2 s.

**Root cause:** the layer was never added; the team relied on healthchecks + full e2e.

**Proposed fix:**

Add a `make smoke` target running a tiny vitest suite that does NOTHING but synthetic transactions:

```
tests/smoke/
   health.smoke.test.ts          — GET https://api.localhost/api/health → 200 + migrations_completed=true
   transcribe-415.smoke.test.ts  — POST /api/transcribe text/plain → 415 + typed envelope
   realtime-handshake.smoke.test.ts — WSS /v1/realtime without bearer → close 4401
   web-root.smoke.test.ts        — GET https://web.localhost/ → 200 + has <html>
   traefik-host-split.smoke.test.ts — GET /api/health on web.localhost → 404 (host-split correct)
```

```makefile
smoke:
	pnpm exec vitest run --config vitest.smoke.config.ts
```

Wire it into the developer loop and CI:
```makefile
e2e-cjm: smoke
	E2E_CJM=1 SCENARIO=$${SCENARIO:-} \
	$(PNPM) exec playwright test --config tests/e2e-cjm/playwright.config.ts \
	--grep-invert '@expected-red' $(SCENARIO)
```

**Acceptance criteria for the next agent:**
1. Create `tests/smoke/` with the 5 probes above; each MUST complete in <500 ms.
2. Add `make smoke` target; make `make e2e-cjm` depend on it.
3. Add a GHA job step `make smoke` between the `up --wait` and `make e2e-cjm` calls.
4. Memory note: respect `feedback_check_loki_after_tests` — if smoke fails, dump `docker compose logs --tail=200` to the GHA log before exiting.

---

### L2 — HIGH — BYOK provider-matrix integration test absent

**Evidence:**
- `packages/byok-guard/src/index.ts` validates boot-time env presence only; it does not test per-provider routing.
- No file matching `byok-provider-matrix`, `provider-routing`, `provider-matrix` exists under `tests/integration/` or `packages/*/test/`.
- Memory `project_phase5_websearch` plus the BYOK CJM family in `tests/e2e-cjm/features/byok-*.feature` only assert boot-time behavior, not which env var routes to which LiteLLM provider config.
- Stack constraint (`CLAUDE.md` §Constraints): bundled LiteLLM ships bare — the operator wires keys via env. A regression in the env→provider mapping is currently invisible.

**Root cause:** Phase 14 closed boot-time coverage, deferred runtime matrix.

**Proposed fix:**

Create `tests/integration/byok-provider-matrix.test.ts` (vitest, real-LiteLLM-container via testcontainers):

```typescript
// 8 permutations: [OpenAI, OpenRouter, Groq, Bedrock] × [BYOK overlay on/off]
describe.each([
  { provider: "openai",     envKey: "OPENAI_API_KEY",     model: "whisper-1" },
  { provider: "openrouter", envKey: "OPENROUTER_API_KEY", model: "openai/whisper-1" },
  { provider: "groq",       envKey: "GROQ_API_KEY",       model: "whisper-large-v3" },
  { provider: "bedrock",    envKey: "AWS_ACCESS_KEY_ID",  model: "amazon.transcribe" },
])("BYOK provider $provider", ({ provider, envKey, model }) => {
  it.each([
    { overlay: "on"  },
    { overlay: "off" },
  ])("with BYOK overlay $overlay routes /v1/audio/transcriptions to the right provider", async ({ overlay }) => {
    // boot a LiteLLM container with ONLY this provider's env var set
    // POST /v1/audio/transcriptions with model=<model>
    // assert the LiteLLM master-key log shows the right upstream provider was invoked
  });
});
```

Per memory `feedback_loadtest_cost_discipline`, the test MUST use a mock upstream (e.g. `mock-litellm` or `wiremock`) — never a paid provider — and gate any live-provider variant behind `OPENWHISPR_LOADTEST_ALLOW_PAID`.

**Acceptance criteria for the next agent:**
1. Create the test above; 8 cases × 2 = 16 assertions minimum.
2. Use testcontainers to boot the LiteLLM image; do NOT touch the dev compose stack.
3. Assert the upstream provider observed equals the expected one; assert no other provider received traffic.
4. Add to `pnpm test` (not e2e) — this is integration, not e2e.
5. Coverage of `packages/litellm-client/` MUST remain at 90/90/90/90.

---

### L3 — MEDIUM — Load tests are nightly-only; no PR-time perf signal

**Evidence:**
- `Makefile` defines `load-test PROFILE=[mock|realistic]` but it is referenced only from `.github/workflows/nightly.yml`, not `ci.yml`.
- Memory `feedback_realistic_profile_smoke_and_baseline` requires "smoke + short baseline locally to publish working config + Mac numbers" — implies a short (≤ 60 s) load smoke is expected.
- A perf regression introduced in a PR is invisible until the next nightly.

**Proposed fix:**

Add a PR-time load smoke (≤ 2 min) that runs `PROFILE=mock` only, with strict cost discipline:

```makefile
load-smoke:
	PROFILE=mock DURATION=60s VUS=5 $(MAKE) load-test
```

```yaml
# in ci.yml
load-smoke:
  needs: [test]
  runs-on: ubuntu-latest
  steps:
    - run: make up --wait
    - run: make load-smoke
```

**Acceptance criteria:**
1. ≤ 2 min wall-clock, ≤ 5 VU × ≤ 60 s (per `feedback_loadtest_cost_discipline`).
2. Mock provider only; assert no paid-provider env var is read.
3. Fail the job if p95 latency for `/api/health` exceeds a baseline (committed in `tests/load/baselines/`).

---

### L4 — LOW — Two vitest configs cause E2E discovery confusion

**Evidence:**
- Root has both `vitest.config.ts` and `vitest.e2e.config.ts`.
- Developer needs to know which config corresponds to which `make` target.
- Memory `feedback_testcontainers_cleanup_audit` ("apps/api vitest leaks postgres testcontainers + volumes (Ryuk not firing)") suggests the test-runner surface area is already a debugging hotspot.

**Proposed fix:** Consolidate into a single config with a conditional `E2E` env gate. The `make e2e-hermetic` target sets `E2E=1`; the config switches its `include` glob accordingly.

**Acceptance criteria:**
1. One vitest config file.
2. `pnpm test` runs unit + integration; `E2E=1 pnpm test` runs e2e-hermetic.
3. Per-package configs that override (apps/api, etc.) MUST keep their strict 90/90/90/90 thresholds.

---

### L5 — LOW — Testcontainers cleanup has no validation test

**Evidence:**
- `tests/global-vitest-teardown.ts` exists (cleanup hook).
- Memory `feedback_testcontainers_cleanup_audit` records the symptom: "apps/api vitest leaks postgres testcontainers + volumes (Ryuk not firing); audit before any compose smoke and after my own api test runs."
- No meta-test validates "after `pnpm test` exits, no `testcontainers-*` containers remain."

**Proposed fix:** A meta self-test in `tests/self-tests/` that runs a tiny vitest suite in a subprocess, then asserts `docker ps -a --filter label=org.testcontainers --format '{{.ID}}'` is empty.

**Acceptance criteria:**
1. Self-test fails CI if Ryuk leaves orphan containers.
2. Add a logged warning to the audit document if Ryuk is disabled via `TESTCONTAINERS_RYUK_DISABLED=true` (currently set in ci.yml — that's a different concern: cleanup falls to `always()` GHA steps).

---

### L6 — MEDIUM — SSO step stubs can silently rot

**Evidence:**
- `tests/e2e-cjm/steps/sso.steps.ts` (~171 lines) — every step body is `throw new Error("keycloak SSO ships in Phase 19")`.
- Playwright-bdd strict-mode requires every Gherkin step to have a binding; the throw satisfies the binding but produces a misleading "all 6 SSO scenarios fail with the same message" signal regardless of underlying realm/wiring state.
- If Phase 19 slips by 6+ months, the step file's signature can drift away from the Gherkin steps and no one notices because the throw masks all failure modes.

**Proposed fix:** Add a mid-Phase-19 audit checklist as a `.planning/qa-audit/sso-stub-watchdog.md` (calendar reminder). Optionally: add a single self-test asserting that `sso.steps.ts` step text strings exactly match the `Given/When/Then` strings in `tests/e2e-cjm/features/sso/keycloak-oidc.feature` — catches drift before Phase 19 lands.

**Acceptance criteria:**
1. Self-test that diffs step strings between `sso.steps.ts` and `keycloak-oidc.feature`.
2. Fails CI if a step text drifts.

---

### L7 — LOW — Worker S3 override is non-normative; documented as SR-19a.4

**Evidence:**
- `tests/e2e-cjm/compose-overrides.yml` injects `S3_ENDPOINT` + credentials on the worker service.
- `compose/docker-compose.storage.yml` only injects on `api`, not `worker`.
- Commit `1832f28` references SR-19a.4 in `.planning/SERVER-ERRORS.md` (worker storage fix).

**Proposed fix:** Promote SR-19a.4 to a small phase that fixes `compose/docker-compose.storage.yml` upstream, then delete the override block. The override should not be load-bearing in CJM tests indefinitely.

**Acceptance criteria:**
1. After upstream fix, removing the override block from `compose-overrides.yml` MUST not break any `@cjm-byok-storage.*` scenario.

---

### L8 — MEDIUM — `@expected-red` scenarios have no staleness alert

**Evidence:**
- 14 of 44 CJM scenarios carry `@expected-red` (~32%).
- No mechanism (GHA workflow / cron / lint rule) alerts if a scenario stays RED beyond its committed phase.
- `feedback_no_workarounds_enterprise` mandates against accumulating debt; `@expected-red` is debt with a label.

**Proposed fix:** Add a weekly GHA workflow that:
1. Parses every `@expected-red @after-phase-X` tag.
2. Cross-references `ROADMAP.md` for the phase's planned completion date.
3. Opens (or updates) a GitHub issue listing any scenario whose phase has slipped past its planned date.

**Acceptance criteria:**
1. Workflow file `.github/workflows/expected-red-staleness.yml`.
2. Schedule: weekly (e.g. Monday 09:00 UTC).
3. Idempotent: re-runs update the same issue rather than spawning duplicates.

---

## 3. Aggregate acceptance criteria for the follow-up agent

When implementing the fixes above, the agent MUST:

1. Honor the **TDD + RED → GREEN → REFACTOR** rule from `CLAUDE.md`: every new layer (smoke, BYOK matrix, load-smoke) lands with a RED test first.
2. Honor coverage floors: any new code added to `packages/byok-guard/`, `packages/litellm-client/`, etc. keeps 90/90/90/90.
3. Honor `feedback_loadtest_cost_discipline`: no paid-provider calls in PR-time tests.
4. Honor `feedback_cjm_steps_need_unit_tests`: any new step bindings under `tests/e2e-cjm/steps/` ship with a vitest unit test in `steps/__tests__/`.
5. Honor `feedback_tdd_and_ci`: GitHub Actions is the only sanctioned CI; gate every new layer there.

---

## 4. Out of scope

- Refactoring existing tests for style.
- Changing the global 85/80/80/85 coverage thresholds.
- Adjusting `tools/lint-cjm-doc.ts` rules.
- Adding new providers beyond the [OpenAI, OpenRouter, Groq, Bedrock] set already in scope for v2.1.
