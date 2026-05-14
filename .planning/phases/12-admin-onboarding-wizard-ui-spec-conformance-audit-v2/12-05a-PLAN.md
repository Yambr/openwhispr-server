---
phase: 12
plan: 05a
type: tdd
wave: 3
depends_on: [12-03, 12-04]
autonomous: true
requirements: [UICONF-04, UICONF-06]
files_modified:
  - apps/web/src/components/__tests__/conformance/SignInForm.test.tsx
  - apps/web/src/components/__tests__/conformance/SignUpForm.test.tsx
  - apps/web/src/components/__tests__/conformance/OidcButtons.test.tsx
  - apps/web/src/components/__tests__/conformance/VerifyEmailClient.test.tsx
  - apps/web/src/components/__tests__/conformance/setup.test.tsx
  - apps/web/src/components/__tests__/conformance/admin-index.test.tsx
  - apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts
tags: [phase-12, conformance, vitest, rtl, jsx-oracle, uiconf-04, uiconf-06]
must_haves:
  truths:
    - "Six conformance test files exist under `apps/web/src/components/__tests__/conformance/`, each running under Vitest + @testing-library/react."
    - "Each conformance test file's header comment cites the JSX oracle source by file:line range (e.g., `screens-user.jsx:7-94 + ui.jsx:229-316`)."
    - "Inventory tables (heading text, lede text, field labels, button text, alert presence, role/aria-label attributes, landmark counts) are hand-curated from the 6 JSX oracle files (`screens-user.jsx`, `screens-admin.jsx`, `ui.jsx`) NOT from `design-canvas.jsx` (RESEARCH P6 — both overcorrections avoided)."
    - "`SignInForm` conformance test cites `screens-user.jsx:7-94` and asserts: heading text, lede, 3 OIDC buttons (when 3 providers configured), or-separator, Email + Password fields, Remember checkbox, Forgot link, Submit button, footer."
    - "`SignUpForm` conformance test cites `screens-user.jsx:97-183` AND includes the UICONF-06 hardening: `expect(getAllByRole('alert')).toHaveLength(1)` + title.text ≠ body.text on duplicate-email error."
    - "`OidcButtons` conformance test cites `screens-user.jsx:15-25` and runs three scenarios: 0 providers → 0 buttons; 1 provider → 1 button; 3 providers → 3 buttons with `ghost` variant only on the generic OIDC."
    - "`VerifyEmailClient` conformance test cites `screens-user.jsx:186-260` covering the 4 variants (pending / verifying / success / error)."
    - "`setup.test.tsx` cites `ui.jsx:229-316` (AuthShell) + `ui.jsx:326-336` (Btn) + `ui.jsx:338-352` (Field); header comment documents the no-/setup-JSX-oracle deviation explicitly (RESEARCH §16)."
    - "`admin-index.test.tsx` cites `screens-admin.jsx:445-628` (ScreenConfig) and asserts Shell + Sidebar kind='admin' + page-head 'Configuration' lede + ONE read-only alert + 2-col card grid; ZERO email/IP/audit patterns in the rendered DOM (defense-in-depth on Plan 12-04 Task 5)."
    - "Coverage on diff ≥ 90/90/90/90 (these are tests; their coverage hit lands on the production files they exercise — already covered by Plans 12-03 / 12-04. This plan's gate is that the test suite is green AND every conformance file has a JSX:LINE citation in its SPDX header)."
  artifacts:
    - path: apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts
      provides: "Hand-curated inventory constants derived from screens-{user,admin}.jsx + ui.jsx — exported per-screen for the 6 conformance tests to import"
    - path: apps/web/src/components/__tests__/conformance/SignInForm.test.tsx
      provides: "Conformance assertions vs screens-user.jsx:7-94 + ui.jsx:229-316"
    - path: apps/web/src/components/__tests__/conformance/SignUpForm.test.tsx
      provides: "Conformance + UICONF-06 single-banner + title≠body hardening vs screens-user.jsx:97-183"
    - path: apps/web/src/components/__tests__/conformance/OidcButtons.test.tsx
      provides: "0/1/N provider rendering vs screens-user.jsx:15-25"
    - path: apps/web/src/components/__tests__/conformance/VerifyEmailClient.test.tsx
      provides: "4-variant conformance vs screens-user.jsx:186-260"
    - path: apps/web/src/components/__tests__/conformance/setup.test.tsx
      provides: "Wizard composition conformance vs ui.jsx primitives with no-oracle deviation note"
    - path: apps/web/src/components/__tests__/conformance/admin-index.test.tsx
      provides: "/admin index conformance vs screens-admin.jsx:445-628 + PII gate"
  key_links:
    - from: "apps/web/src/components/__tests__/conformance/*.test.tsx"
      to: ".planning/phases/07-frontend-ui-spec/design/{screens-user,screens-admin,ui}.jsx"
      via: "header comment citing file:line ranges"
      pattern: "screens-(user|admin)\\.jsx:[0-9]+(-[0-9]+)?|ui\\.jsx:[0-9]+(-[0-9]+)?"
threat_model:
  trust_boundaries:
    - "Test suite -> production auth screens + admin index page"
  threats:
    - id: T-12.05a-01
      stride: T
      component: "Conformance drift between JSX oracle and shipped UI"
      disposition: mitigate
      mitigation: "Each test file's header cites file:line; assertions read inventory from the __fixtures__ module; future JSX edits to oracle require fixture updates (PR review catches drift)"
    - id: T-12.05a-02
      stride: T
      component: "UICONF-06 regression silently re-introduced"
      disposition: mitigate
      mitigation: "SignUpForm conformance test in this plan explicitly re-asserts `getAllByRole('alert').toHaveLength(1)` + title≠body (defense-in-depth over Plan 12-04 Task 3)"
---

<objective>
Ship the Vitest+RTL structural conformance suite that asserts every auth screen and the new /admin index page semantically matches the JSX oracle files. Six dedicated test files under `apps/web/src/components/__tests__/conformance/`, each with a header citation chain pointing to `screens-{user,admin}.jsx:LINE` (NOT `design-canvas.jsx` — RESEARCH P6).

Purpose: UICONF-04 (semantic DOM conformance against the canonical JSX oracle, NOT pixel-diff) + UICONF-06 hardening (defense-in-depth single-banner + title-vs-body distinction).

Output: 6 conformance test files + 1 shared inventory fixture module — single atomic commit; any drift surfaced during authoring is fixed in this same commit (per the plan-split note in RESEARCH §14).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-CONTEXT.md
@.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-RESEARCH.md
@.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-PATTERNS.md
@.planning/phases/07-frontend-ui-spec/design/screens-user.jsx
@.planning/phases/07-frontend-ui-spec/design/screens-admin.jsx
@.planning/phases/07-frontend-ui-spec/design/ui.jsx
@apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx

<interfaces>
JSX oracle line ranges (canonical citations — RESEARCH §16):
- ScreenSignIn:           screens-user.jsx:7-94    (oracle for SignInForm conformance)
- ScreenSignUp:           screens-user.jsx:97-183  (oracle for SignUpForm conformance)
- OIDC buttons inventory: screens-user.jsx:15-25   (3 providers + ghost variant on generic OIDC)
- VerifyEmail variants:   screens-user.jsx:186-260 (4 variants: pending/verifying/success/error)
- AuthShell primitive:    ui.jsx:229-316           (composes /setup since no /setup JSX oracle exists)
- Btn primitive:          ui.jsx:326-336
- Field primitive:        ui.jsx:338-352
- ScreenConfig (admin):   screens-admin.jsx:445-628 (oracle for /admin index)

Required SPDX + citation block (every conformance test file):
```
// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-05a — UICONF-04 conformance inventory derived from
//   .planning/phases/07-frontend-ui-spec/design/<file>:<line-range> (<oracle name>)
// Inventory: see 12-RESEARCH.md §16 table and __fixtures__/jsx-inventory.ts.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Hand-curate inventory fixture from JSX oracles</name>
  <files>apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts</files>
  <read_first>
    - .planning/phases/07-frontend-ui-spec/design/screens-user.jsx (lines 7-94 ScreenSignIn, 97-183 ScreenSignUp, 15-25 OIDC inventory, 186-260 VerifyEmail variants)
    - .planning/phases/07-frontend-ui-spec/design/screens-admin.jsx (lines 445-628 ScreenConfig)
    - .planning/phases/07-frontend-ui-spec/design/ui.jsx (lines 229-316 AuthShell, 326-336 Btn, 338-352 Field)
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-RESEARCH.md §16 (full inventory tables)
  </read_first>
  <behavior>
    - Module exports per-screen inventory constants:
      - `signInInventory`: heading text token, lede token, 3 OIDC button labels, or-separator text, Email label, Password label, Remember label, Forgot link text, Submit label, footer link text
      - `signUpInventory`: similar; plus the UICONF-06 error-key tokens (`duplicate.title.text`, `duplicate.body.text`, etc.)
      - `oidcInventory`: provider list [{id:'google',name:'Google'}, {id:'github',name:'GitHub'}, {id:'oidc',name:'SSO',variant:'ghost'}]
      - `verifyEmailInventory`: 4 variants array
      - `setupInventory`: section anchors `['identity','workspace','review']` + AuthShell composition note
      - `adminConfigInventory`: page-head text, lede, alert text, 2 card titles
    - Each constant block has a `// from <file>:<line-range>` source comment immediately above it.
  </behavior>
  <action>Read the cited line ranges from the JSX oracle files. Manually transcribe role/label/text values into TypeScript constants. Do NOT AST-walk `design-canvas.jsx` (RESEARCH P6 overcorrection 1). Do NOT skip reading the JSX oracles (RESEARCH P6 overcorrection 2 — the Phase 07.1 mistake).</action>
  <verify>
    <automated>test -f apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts && cd apps/web && pnpm -s typecheck && grep -c "from .*\\.jsx:[0-9]" apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts | awk '$1>=6{exit 0} {exit 1}'</automated>
  </verify>
  <acceptance_criteria>
    - File exists, typechecks.
    - At least 6 source-citation comments of form `from <file>.jsx:<line>` (one per oracle artboard).
    - Exports the 6 named inventory constants.
  </acceptance_criteria>
  <done>Inventory fixture committed; conformance tests can import deterministic expectations.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 2: SignInForm + SignUpForm + OidcButtons + VerifyEmailClient conformance tests (RED + GREEN)</name>
  <files>apps/web/src/components/__tests__/conformance/SignInForm.test.tsx, apps/web/src/components/__tests__/conformance/SignUpForm.test.tsx, apps/web/src/components/__tests__/conformance/OidcButtons.test.tsx, apps/web/src/components/__tests__/conformance/VerifyEmailClient.test.tsx</files>
  <read_first>
    - apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx (template: mocks, I18nProvider, resources, Wrap)
    - apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx (UICONF-06 starting point)
    - apps/web/src/components/screens/auth/__tests__/VerifyEmailClient.test.tsx (variant-rendering harness)
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-PATTERNS.md §"conformance/{SignInForm,SignUpForm,OidcButtons,VerifyEmailClient}.test.tsx"
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-RESEARCH.md §12 (conformance suite layout)
  </read_first>
  <behavior>
    - Each file follows the SHARED scaffold (PATTERNS.md "Vitest+RTL conformance test scaffold"): vi.mock next/navigation + next/link + @/lib/auth-client; resources literal; Wrap I18nProvider.
    - Each file's SPDX + phase header MUST include the JSX-oracle citation line for that screen.
    - SignInForm test imports `signInInventory` and asserts:
      - One `role='heading' level=1` (or whatever the oracle uses) with the heading text token
      - Lede paragraph present
      - Mock fetch returning 3 providers -> 3 OIDC buttons render
      - Or-separator present
      - Email + Password fields with correct labels
      - Remember checkbox + Forgot link + Submit button + footer link
    - SignUpForm test imports `signUpInventory` and asserts (in addition to layout):
      - **UICONF-06 single-banner gate** (PATTERNS.md verbatim block): `expect(getAllByRole('alert')).toHaveLength(1)` + title.textContent !== body.textContent on duplicate-email error path
    - OidcButtons test imports `oidcInventory`:
      - 0 providers -> 0 buttons (component returns null)
      - 1 provider -> 1 button
      - 3 providers -> 3 buttons, generic OIDC has `data-variant="ghost"` (or whatever the vendored `Button` uses)
    - VerifyEmailClient test imports `verifyEmailInventory` and renders each of the 4 variants, asserting variant-specific copy/state.
  </behavior>
  <action>Write all four files in parallel. Reuse the existing mocks pattern. Fetch is mocked via `global.fetch = vi.fn().mockResolvedValue({ json: ... })` to drive deterministic provider lists per scenario.</action>
  <verify>
    <automated>cd apps/web && pnpm vitest run src/components/__tests__/conformance/SignInForm.test.tsx src/components/__tests__/conformance/SignUpForm.test.tsx src/components/__tests__/conformance/OidcButtons.test.tsx src/components/__tests__/conformance/VerifyEmailClient.test.tsx</automated>
  </verify>
  <acceptance_criteria>
    - All 4 test files green.
    - Each file's header has the regex match for `screens-user\.jsx:[0-9]+`.
    - SignUpForm conformance test contains the literal substring `toHaveLength(1)` AND a title.textContent vs body.textContent inequality assertion.
    - OidcButtons conformance test has 3 distinct scenarios (0/1/3 providers).
  </acceptance_criteria>
  <done>4 of 6 conformance test files green; auth-screen UICONF-04 coverage live.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 3: setup wizard + admin index conformance tests (RED+GREEN, with no-oracle deviation note + PII gate)</name>
  <files>apps/web/src/components/__tests__/conformance/setup.test.tsx, apps/web/src/components/__tests__/conformance/admin-index.test.tsx</files>
  <read_first>
    - apps/web/src/components/screens/auth/SetupForm.tsx (Plan 12-03 output)
    - apps/web/src/components/screens/AdminIndex.tsx (Plan 12-04 output)
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-PATTERNS.md §"conformance/setup.test.tsx" + §"admin-index.test.tsx"
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-RESEARCH.md §16 (no /setup JSX oracle — deviation rationale)
    - .planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-RESEARCH.md §15(h) (admin PII gate)
  </read_first>
  <behavior>
    - `setup.test.tsx`:
      - Header comment MUST contain the literal phrase `no /setup JSX oracle` (or `documented design deviation`) AND citations to `ui.jsx:229-316`, `ui.jsx:326-336`, `ui.jsx:338-352`.
      - Asserts: 3 section anchors with ids `identity`, `workspace`, `review` exist; stepper element present (`querySelector('[data-slot="stepper"]')` or similar — verify with Plan 12-03's vendored Stepper); Submit button exists; AuthShell-style brand region renders (look for the data-slot ui.jsx exposes).
    - `admin-index.test.tsx`:
      - Header cites `screens-admin.jsx:445-628`.
      - Asserts: Sidebar with `data-kind="admin"` (or equivalent — match Plan 12-04 AdminIndex output); ONE alert with `role='status'`; ≥ 2 cards (`[data-slot="card"]`); 2-column grid class on the container.
      - **PII gate (defense-in-depth over Plan 12-04 Task 5):**
        - `expect(container.innerHTML).not.toMatch(/@\\w+\\.\\w+/)` (no email-like)
        - `expect(container.innerHTML).not.toMatch(/\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b/)` (no IPv4)
        - `expect(container.innerHTML.toLowerCase()).not.toContain('audit')` (no audit references)
  </behavior>
  <action>Mirror the test scaffold from Task 2. setup.test.tsx tests the rendered SetupForm output; admin-index.test.tsx renders AdminIndex. Both add the inventory citations as comments. PII gate uses three explicit assertions.</action>
  <verify>
    <automated>cd apps/web && pnpm vitest run src/components/__tests__/conformance/setup.test.tsx src/components/__tests__/conformance/admin-index.test.tsx</automated>
  </verify>
  <acceptance_criteria>
    - Both test files green.
    - setup.test.tsx header grep `no /setup JSX oracle\\|documented design deviation` ≥ 1.
    - admin-index.test.tsx contains all three PII-gate assertions (grep `not.toMatch.*@\\|not.toMatch.*\\\\b\\\\d\\|not.toContain.*audit`).
    - All 6 conformance test files run green together: `cd apps/web && pnpm vitest run src/components/__tests__/conformance/` exit 0.
  </acceptance_criteria>
  <done>All 6 conformance test files committed and green; UICONF-04 ↔ JSX-oracle binding live.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test suite -> production screens | Acts as regression net against JSX-oracle drift |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-12.05a-01 | T (Tampering) | Drift between JSX oracle and production | mitigate | Header citations + fixture module concentrate inventory in one place; future drift breaks tests |
| T-12.05a-02 | T (Tampering) | UICONF-06 silent regression | mitigate | Single-banner + title≠body re-asserted in this plan (defense-in-depth) |
| T-12.05a-03 | I (Info) | Admin index PII leak via future widening | mitigate | PII gate (3 regex assertions) (defense-in-depth over Plan 12-04 Task 5) |
</threat_model>

<verification>
- Single atomic commit `test(12-05a): UICONF-04 Vitest+RTL conformance suite (6 files) with JSX-oracle citations`.
- `cd apps/web && pnpm vitest run src/components/__tests__/conformance/` green.
- All 6 files have header citations to specific JSX file:line ranges.
- Inventory fixture has 6 source-citation comments.
</verification>

<success_criteria>
- 6 conformance test files green.
- UICONF-06 hardening present (defense-in-depth).
- PII gate present on /admin (defense-in-depth).
- JSX:LINE citations exist on every file's header.
</success_criteria>

<output>
After completion, create `.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-05a-SUMMARY.md` capturing:
- Final inventory constant list with source-cite line ranges.
- The exact assertion idioms used for UICONF-06 single-banner + title≠body.
- The PII gate regex patterns + their match counts (must be 0).
- Any drift discovered during authoring + how it was fixed in this commit.
</output>
