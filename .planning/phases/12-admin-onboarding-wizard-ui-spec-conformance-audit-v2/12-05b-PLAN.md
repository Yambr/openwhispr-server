---
phase: 12
plan: 05b
type: tdd
wave: 3
depends_on: [12-05a]
autonomous: true
requirements: [UICONF-05, ADMIN-06]
files_modified:
  - tests/conformance/ui-spec/axe.spec.ts
  - tests/conformance/ui-spec/playwright.config.ts
  - tests/e2e-cjm/features/admin-onboarding.feature
  - tests/e2e-cjm/features/signup-verify.feature
  - tests/e2e-cjm/features/oidc-providers.feature
  - package.json
  - pnpm-lock.yaml
tags: [phase-12, axe, playwright, cjm-flip-green, uiconf-05, admin-06]
must_haves:
  truths:
    - "`@axe-core/playwright` is at version 4.11.2 (CONTEXT D-19 lock) in package.json + pnpm-lock.yaml."
    - "`tests/conformance/ui-spec/axe.spec.ts` exists and reuses Phase 13 compose-harness (`tests/e2e-cjm/support/compose-harness.ts`) via `bootStack()` / `tearStack()` — NOT a separate compose boot."
    - "The axe spec iterates exactly 5 routes: `/sign-in`, `/sign-up`, `/verify-email`, `/setup`, `/admin`."
    - "Each route's axe analysis (rule tags `wcag2a + wcag2aa + wcag21a + wcag21aa`) reports `results.violations.length === 0`."
    - "5 Gherkin scenarios flip GREEN by tag-removal:"
    - "  - admin-onboarding.feature `@cjm-5.1` and `@cjm-5.3`: `@expected-red @after-phase-12` tags removed"
    - "  - signup-verify.feature `@cjm-1.5`: `@expected-red @after-phase-12` tags removed"
    - "  - oidc-providers.feature `@cjm-7.1` and `@cjm-7.2`: `@expected-red @after-phase-12` tags removed"
    - "`make e2e-cjm` (or the equivalent script `pnpm e2e-cjm`) runs end-to-end on the booted compose stack and reports all 5 newly-untagged scenarios PASSED."
    - "No retry-on-flake (Phase 13 D-12 lock carries forward; D-22)."
    - "Coverage on diff ≥ 90/90/90/90 — the production code under test is Plans 12-01..12-04; this plan adds verification artifacts whose own coverage is naturally 100% (every line runs in the green path)."
  artifacts:
    - path: tests/conformance/ui-spec/playwright.config.ts
      provides: "Playwright config for the conformance lane; reuses the compose-harness primitive"
    - path: tests/conformance/ui-spec/axe.spec.ts
      provides: "5-route axe baseline (zero-violation assertion per route)"
    - path: tests/e2e-cjm/features/admin-onboarding.feature
      provides: "Tag removal for @cjm-5.1 + @cjm-5.3 (flipped GREEN)"
    - path: tests/e2e-cjm/features/signup-verify.feature
      provides: "Tag removal for @cjm-1.5"
    - path: tests/e2e-cjm/features/oidc-providers.feature
      provides: "Tag removal for @cjm-7.1 + @cjm-7.2"
  key_links:
    - from: tests/conformance/ui-spec/axe.spec.ts
      to: tests/e2e-cjm/support/compose-harness.ts
      via: "named import bootStack/tearStack"
      pattern: "from .*e2e-cjm/support/compose-harness"
    - from: package.json
      to: "@axe-core/playwright@4.11.2"
      via: "devDependencies pin"
      pattern: "@axe-core/playwright.*4\\.11\\.2"
threat_model:
  trust_boundaries:
    - "Test harness -> live compose stack (real Chromium, real Postgres, real Better Auth)"
  threats:
    - id: T-12.05b-01
      stride: T
      component: "Axe rule-set drift"
      disposition: mitigate
      mitigation: "Lock `@axe-core/playwright` at 4.11.2 and pin rule tags `wcag2a+wcag2aa+wcag21a+wcag21aa` (RESEARCH §12); upgrade requires explicit phase-bump"
    - id: T-12.05b-02
      stride: T
      component: "CJM tag-removal regression"
      disposition: mitigate
      mitigation: "Grep gate after commit asserts zero `@expected-red @after-phase-12` tags remain on the 5 target scenarios"
    - id: T-12.05b-03
      stride: D
      component: "Compose-harness re-boot cost"
      disposition: accept
      mitigation: "Reuse Phase 13 primitive (`bootStack`/`tearStack`); one boot per Playwright suite, not per test"
---

<objective>
Land the UICONF-05 axe baseline (real Chromium against the booted Phase 13 compose stack) and flip the 5 `@expected-red @after-phase-12` Gherkin scenarios authored in Phase 13 to GREEN by removing the conditional tags now that the underlying UI surfaces exist.

Purpose: UICONF-05 (axe-clean across all auth screens + /setup + /admin) + ADMIN-06 (Phase 13 `@cjm-admin-onboarding` journey GREEN before merge).

Output: 1 new Playwright config + 1 new axe spec + 3 Gherkin feature-file tag edits + 1 devDep bump — single atomic commit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-CONTEXT.md
@.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-RESEARCH.md
@.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-PATTERNS.md
@tests/e2e-cjm/support/compose-harness.ts
@tests/e2e-cjm/playwright.config.ts
@tests/e2e-cjm/features/admin-onboarding.feature
@tests/e2e-cjm/features/signup-verify.feature
@tests/e2e-cjm/features/oidc-providers.feature

<interfaces>
From RESEARCH §12 lines 705-725 — axe.spec.ts body (verbatim implementation target):
```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { bootStack, tearStack } from "../../e2e-cjm/support/compose-harness";

test.beforeAll(async () => { await bootStack(); });
test.afterAll(async () => { await tearStack(); });

for (const route of ["/sign-in", "/sign-up", "/verify-email", "/setup", "/admin"]) {
  test(`axe baseline: ${route}`, async ({ page }) => {
    await page.goto(`http://localhost${route}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
```

Tag-removal targets (per CONTEXT canonical_refs + RESEARCH §14 plan 12-05b):
- tests/e2e-cjm/features/admin-onboarding.feature line 6 (@cjm-5.1) AND line 17 (@cjm-5.3)
- tests/e2e-cjm/features/signup-verify.feature line 32 (@cjm-1.5)
- tests/e2e-cjm/features/oidc-providers.feature line 6 (@cjm-7.1) AND line 12 (@cjm-7.2)
(Line numbers per RESEARCH §14 line 832 — planner re-verifies at execution time; the grep gate is on the tag, not the line number.)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Bump @axe-core/playwright to 4.11.2 (D-19 lock)</name>
  <files>package.json, pnpm-lock.yaml</files>
  <read_first>
    - package.json (root workspace) — locate the `devDependencies` block (or wherever @axe-core/playwright currently pinned)
    - tests/e2e-cjm/package.json if it pins separately
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-CONTEXT.md D-19
  </read_first>
  <behavior>
    - After completion, `pnpm list @axe-core/playwright` reports exactly version `4.11.2` in every workspace that depends on it.
    - `@playwright/test` remains at 1.60.0 (Phase 13 lockfile lock, D-19 implicit constraint).
  </behavior>
  <action>Find the current pin of @axe-core/playwright (likely in tests/e2e-cjm/package.json or root). Update to `4.11.2`. Run `pnpm install` to update lockfile. Commit the lockfile alongside the package.json change.</action>
  <verify>
    <automated>node -e "const pkgs=require('child_process').execSync('pnpm list -r --json @axe-core/playwright',{encoding:'utf8'}); if (!pkgs.includes('4.11.2')) process.exit(1)"</automated>
  </verify>
  <acceptance_criteria>
    - `pnpm list -r @axe-core/playwright` shows 4.11.2 everywhere.
    - `pnpm list -r @playwright/test` shows 1.60.0 unchanged (no accidental bump).
    - `pnpm install --frozen-lockfile` exits 0 (lockfile coherent).
  </acceptance_criteria>
  <done>Dep bumped; lockfile committed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Author tests/conformance/ui-spec/{playwright.config.ts,axe.spec.ts}</name>
  <files>tests/conformance/ui-spec/playwright.config.ts, tests/conformance/ui-spec/axe.spec.ts</files>
  <read_first>
    - tests/e2e-cjm/playwright.config.ts (existing config — mirror baseURL, browsers, retries:0 per D-22)
    - tests/e2e-cjm/support/compose-harness.ts (bootStack/tearStack exports + signatures)
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-RESEARCH.md §12 (lines 705-725 verbatim axe spec)
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-CONTEXT.md D-22 (no retry-on-flake)
  </read_first>
  <behavior>
    - `playwright.config.ts`:
      - Test dir `./` (relative to the config); `testMatch` for `*.spec.ts`
      - `retries: 0` (D-22)
      - `use.baseURL` matching the compose-harness exposed host
      - One project on Chromium (axe-core needs real Chromium)
      - Optional `globalSetup`/`globalTeardown` — but the spec uses `beforeAll`/`afterAll` for compose-harness symmetry with Phase 13; the config does NOT also boot the stack (avoid double-boot)
    - `axe.spec.ts`: implement RESEARCH §12 verbatim block. Iterate 5 routes. Assert violations === [].
    - The first run of this spec against a freshly-booted stack with Plans 12-01..12-04 merged MUST produce zero violations across all 5 routes. If a violation surfaces, fix it in the underlying production component (NOT by silencing axe rules) before this plan closes.
  </behavior>
  <action>Create the config. Author the spec verbatim from RESEARCH §12. Use named imports from `../../e2e-cjm/support/compose-harness`. Use `wcag2a + wcag2aa + wcag21a + wcag21aa` rule tags (CONTEXT "Claude's Discretion": planner picks WCAG-2.1-AA-only — this is the locked choice).</action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && pnpm exec playwright test --config tests/conformance/ui-spec/playwright.config.ts</automated>
  </verify>
  <acceptance_criteria>
    - All 5 axe-baseline tests pass.
    - Spec file imports from `../../e2e-cjm/support/compose-harness` (grep verifies).
    - Config sets `retries: 0`.
    - No `analyze().withRules` overrides that silence specific WCAG-AA violations — Task 2's pass condition is HONEST zero-violation across the tagged ruleset.
  </acceptance_criteria>
  <done>Axe baseline live + green on the booted stack across 5 routes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Remove `@expected-red @after-phase-12` tags from 5 Gherkin scenarios + verify `make e2e-cjm` green</name>
  <files>tests/e2e-cjm/features/admin-onboarding.feature, tests/e2e-cjm/features/signup-verify.feature, tests/e2e-cjm/features/oidc-providers.feature</files>
  <read_first>
    - tests/e2e-cjm/features/admin-onboarding.feature (locate @cjm-5.1 + @cjm-5.3 scenarios)
    - tests/e2e-cjm/features/signup-verify.feature (locate @cjm-1.5 scenario)
    - tests/e2e-cjm/features/oidc-providers.feature (locate @cjm-7.1 + @cjm-7.2 scenarios)
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-CONTEXT.md D-27 (canonical scenario list)
    - docs/customer-journeys.md §5.1, §5.3, §1.5, §7.1, §7.2 (verify journey docs match the now-GREEN flow)
  </read_first>
  <behavior>
    - For each of the 5 target scenarios, REMOVE the literal tags `@expected-red` and `@after-phase-12` from the tag line above the `Scenario:` keyword. Leave all other tags intact (`@cjm-5.1`, `@cjm-admin-onboarding`, etc.).
    - Do NOT edit step definitions or feature-body Gherkin — only the tag line.
    - After edits, run the full Cucumber+Playwright suite via `make e2e-cjm` (or equivalent) on the booted compose stack. All 5 newly-untagged scenarios MUST pass; previously-green scenarios MUST stay green (no regression).
    - If a scenario goes RED, root-cause the failure in the underlying Plan 12-01..12-04 production code (NOT by re-adding the tag). Fix and re-run in the same plan execution.
  </behavior>
  <action>Edit each feature file. Run `make e2e-cjm` (or `pnpm e2e-cjm`). Verify Cucumber output shows the 5 scenarios as passed. If anything goes RED, investigate Plans 12-01..12-04 — the gap closure happens in this same atomic commit if a small fix is needed; if a larger gap surfaces, abort and return to the orchestrator.</action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && ! grep -E "@expected-red.*@after-phase-12|@after-phase-12.*@expected-red" tests/e2e-cjm/features/admin-onboarding.feature tests/e2e-cjm/features/signup-verify.feature tests/e2e-cjm/features/oidc-providers.feature && make e2e-cjm 2>&1 | tail -40</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "@expected-red|@after-phase-12" tests/e2e-cjm/features/admin-onboarding.feature tests/e2e-cjm/features/signup-verify.feature tests/e2e-cjm/features/oidc-providers.feature` returns ZERO matches on the lines containing `@cjm-5.1`, `@cjm-5.3`, `@cjm-1.5`, `@cjm-7.1`, `@cjm-7.2`.
    - `make e2e-cjm` (or `pnpm e2e-cjm`) exits 0.
    - Cucumber report shows the 5 target scenarios passed; total scenario count includes the 5 newly-green ones; no scenario regressions.
    - `tools/lint-cjm-doc.ts` (Phase 13 doc parity gate) still passes — feature-file edits did not break the docs/customer-journeys.md cross-ref.
  </acceptance_criteria>
  <done>5 scenarios flipped GREEN; full e2e-cjm suite green on the booted stack.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Playwright harness -> compose stack (real Chromium + real services) | UICONF-05 + ADMIN-06 final verification gate |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-12.05b-01 | T (Tampering) | Axe rule-set drift | mitigate | @axe-core/playwright pinned 4.11.2; explicit WCAG-2.1-AA rule tags (Task 2) |
| T-12.05b-02 | T (Tampering) | Tag-removal regression | mitigate | Grep gate asserts zero @expected-red on the 5 target scenarios (Task 3 verify) |
| T-12.05b-03 | D (DoS) | Compose-harness re-boot cost | accept | Reuse Phase 13 primitive; one boot per suite |
| T-12.05b-04 | T (Tampering) | Silencing axe rules to force-pass | mitigate | No `.withRules` exclusions allowed in axe.spec.ts; honest zero-violation is the only pass condition (Task 2 acceptance) |
</threat_model>

<verification>
- Single atomic commit `test(12-05b): UICONF-05 axe baseline (5 routes, WCAG-2.1-AA) + flip 5 @cjm scenarios GREEN` covering the 7 files + lockfile.
- `pnpm exec playwright test --config tests/conformance/ui-spec/playwright.config.ts` exit 0.
- `make e2e-cjm` exit 0 with all 5 newly-untagged scenarios passed.
- `grep -E "@expected-red.*@after-phase-12" tests/e2e-cjm/features/{admin-onboarding,signup-verify,oidc-providers}.feature` returns 0 matches.
- `pnpm list -r @axe-core/playwright` shows 4.11.2 everywhere.
</verification>

<success_criteria>
- Axe baseline reports 0 violations across all 5 routes under WCAG-2.1-AA rule tags.
- `@cjm-5.1`, `@cjm-5.3`, `@cjm-1.5`, `@cjm-7.1`, `@cjm-7.2` scenarios all GREEN.
- @axe-core/playwright at 4.11.2.
- Phase 12 verification can begin once this plan closes.
</success_criteria>

<output>
After completion, create `.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-05b-SUMMARY.md` capturing:
- The 5 axe-route axe results (must all be 0 violations).
- The exact tag-line diffs applied to each feature file.
- `make e2e-cjm` final report excerpt showing the 5 newly-green scenarios.
- Any production-code fixes needed during the flip (expect none — Plans 12-01..12-04 are designed to make these scenarios green).
</output>
