---
phase: 12
plan: 05a
subsystem: ui-spec-conformance
tags: [phase-12, conformance, vitest, rtl, jsx-oracle, uiconf-04, uiconf-06]
requires:
  - .planning/phases/07-frontend-ui-spec/design/screens-user.jsx
  - .planning/phases/07-frontend-ui-spec/design/screens-admin.jsx
  - .planning/phases/07-frontend-ui-spec/design/ui.jsx
  - apps/web/src/components/screens/auth/SignInForm.tsx
  - apps/web/src/components/screens/auth/SignUpForm.tsx
  - apps/web/src/components/screens/auth/OidcButtons.tsx
  - apps/web/src/components/screens/auth/VerifyEmailClient.tsx
  - apps/web/src/components/screens/auth/SetupForm.tsx
  - apps/web/src/components/screens/AdminIndex.tsx
provides:
  - apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts
  - apps/web/src/components/__tests__/conformance/SignInForm.test.tsx
  - apps/web/src/components/__tests__/conformance/SignUpForm.test.tsx
  - apps/web/src/components/__tests__/conformance/OidcButtons.test.tsx
  - apps/web/src/components/__tests__/conformance/VerifyEmailClient.test.tsx
  - apps/web/src/components/__tests__/conformance/setup.test.tsx
  - apps/web/src/components/__tests__/conformance/admin-index.test.tsx
affects: []
tech-stack:
  added: []
  patterns:
    - "Hand-curated JSX-oracle inventory fixture (single module, per-screen constants, source-citation comments) consumed by per-screen conformance tests."
    - "Conformance test header comment pattern: SPDX line + Phase/Plan line + explicit `screens-{user,admin}.jsx:LINE` or `ui.jsx:LINE` citations."
key-files:
  created:
    - apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts
    - apps/web/src/components/__tests__/conformance/SignInForm.test.tsx
    - apps/web/src/components/__tests__/conformance/SignUpForm.test.tsx
    - apps/web/src/components/__tests__/conformance/OidcButtons.test.tsx
    - apps/web/src/components/__tests__/conformance/VerifyEmailClient.test.tsx
    - apps/web/src/components/__tests__/conformance/setup.test.tsx
    - apps/web/src/components/__tests__/conformance/admin-index.test.tsx
  modified: []
decisions:
  - "UICONF-04 conformance tests assert SEMANTIC DOM equivalence (heading text, role, aria-label, data-slot, link href, button name, alert count) — NOT pixel/style equivalence. Variant kind=ghost vs Button variant=outline is a non-semantic styling deviation."
  - "Each conformance test mounts the production React component inside an I18nProvider seeded with i18n keys that resolve to the JSX-oracle's literal English strings (or the live `end-user.json` resource bundle for /setup and /admin-index where production copy was localized away from the oracle's wording). Drift between oracle text and production i18n value is captured as a single string per token in the inventory fixture."
  - "The oracle-vs-production string drift between auth screens is intentional and documented per-screen: `signInInventory.headingOracle` (\"Sign in\") vs `.headingProduction` (\"Sign in to OpenWhispr\") — these are distinct CONTRACT axes, both preserved in the fixture."
metrics:
  duration: "~6m"
  completed: 2026-05-14
---

# Phase 12 Plan 12-05a: UICONF-04 JSX-Oracle Conformance Suite Summary

## One-liner

Six conformance test files + one hand-curated JSX-oracle inventory fixture that bind every Phase-12 auth screen and the new /admin index page to canonical `screens-{user,admin}.jsx` artboards via Vitest + RTL semantic assertions; 28 tests green, UICONF-06 single-banner hardening and 3-axis PII gate live as defense-in-depth over Plan 12-04.

## What shipped

### Inventory fixture (Task 1 — commit 0d0d38e)

`apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts` — 212 lines, 30 source-citation comments, 6 exported per-screen constant blocks:

| Constant | Oracle source | Tokens captured |
|---|---|---|
| `signInInventory` | `screens-user.jsx:7-94` | heading (oracle + production), lede, 3 OIDC labels, or-separator, email/password/remember labels, forgot link, submit, footer link |
| `signUpInventory` | `screens-user.jsx:97-183` | heading (oracle + production), lede, name/email/password labels, submit, footer link, UICONF-06 duplicate-error tokens (title/body), generic-error tokens |
| `oidcInventory` | `screens-user.jsx:15-25` | 3 providers (id + name + label), empty array, single-provider array |
| `verifyEmailInventory` | `screens-user.jsx:186-260` | 3 shipped variants (loading/success/error) with title+body+CTA, plus the oracle-only "pending" variant retained for future traceability |
| `setupInventory` | `ui.jsx:229-316 + 326-336 + 338-352` | 3 section anchors, stepper data-slot, 5 form labels, heading, deviation note (no /setup oracle) |
| `adminConfigInventory` | `screens-admin.jsx:445-628` | page-head heading, lede, readonly alert (title + role), 2 cards (oracle + production titles + endpoint labels), 3 PII-gate patterns |

### Auth-screen conformance tests (Task 2 — commit 99bb496)

| File | Oracle line range | Tests | Key assertions |
|---|---|---|---|
| `SignInForm.test.tsx` | screens-user.jsx:7-94 | 6 | heading, Email/Password labelled inputs, 3 OIDC buttons (async findByRole), submit button, sign-up link (`href=/sign-up`), forgot-password copy |
| `SignUpForm.test.tsx` | screens-user.jsx:97-183 | 4 | 3 labelled inputs, submit copy, sign-in link (`href=/sign-in`), **UICONF-06**: `getAllByRole('alert').toHaveLength(1)` + `alert-title.textContent !== alert-description.textContent` on `USER_ALREADY_EXISTS` branch, equality to `signUpInventory.duplicate.{title,body}.text` |
| `OidcButtons.test.tsx` | screens-user.jsx:15-25 | 3 | 0-providers (button count = 0), 1-provider (exactly 1 + 2 negative), 3-providers (count = 3 + named-check loop including generic `oidc → sso` label slot) |
| `VerifyEmailClient.test.tsx` | screens-user.jsx:186-260 | 4 | loading variant (pinned via never-resolving promise), success variant + `/sign-in` CTA, error variant + `/sign-up` CTA (token undefined branch), error-result branch |

### /setup + /admin index conformance tests (Task 3 — commit 84a746f)

| File | Oracle line range | Tests | Key assertions |
|---|---|---|---|
| `setup.test.tsx` | ui.jsx:229-316, 326-336, 338-352 (no /setup oracle — explicit deviation note in header) | 5 | section anchors (`identity`, `workspace`, `review`), Stepper primitive (`[data-slot="stepper"]`), 5 Field labels (Name/Email/Password/Workspace/Timezone), submit copy, wizard heading |
| `admin-index.test.tsx` | screens-admin.jsx:445-628 | 6 | `<h1>Configuration</h1>`, lede match, exactly one `role='status'` + zero `role='alert'`, ≥ 2 `[data-slot="card"]`, **3-axis PII gate**: no email pattern, no IPv4 pattern, no `audit` substring (case-insensitive) |

## UICONF-06 hardening idiom (exact code)

```ts
await waitFor(() => {
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});
const alert = screen.getByRole("alert");
const titleEl = alert.querySelector('[data-slot="alert-title"]');
const bodyEl = alert.querySelector('[data-slot="alert-description"]');
const titleText = titleEl?.textContent ?? "";
const bodyText = bodyEl?.textContent ?? "";
expect(titleText.length).toBeGreaterThan(0);
expect(bodyText.length).toBeGreaterThan(0);
expect(titleText).not.toBe(bodyText);
// And the strings come from the JSX-oracle-derived inventory tokens.
expect(titleText).toBe(signUpInventory.duplicate.title.text);
expect(bodyText).toBe(signUpInventory.duplicate.body.text);
```

## PII gate idioms + observed match counts

`adminConfigInventory.piiPatterns`:

```ts
email: /[\w.+-]+@[\w-]+\.[\w.-]+/
ipv4: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
auditSubstring: "audit"  // case-insensitive
```

Observed against `container.innerHTML` from `<AdminIndex />` on a deterministic resource bundle:

| Pattern | Match count |
|---|---|
| email | 0 |
| ipv4 | 0 |
| `audit` (case-insensitive) | 0 |

All three PII-gate assertions pass without an `.only` filter or environment skip.

## Test outcomes

```
$ cd apps/web && pnpm vitest run src/components/__tests__/conformance/
 Test Files  6 passed (6)
      Tests  28 passed (28)
```

Per-file breakdown: 6 (SignIn) + 4 (SignUp) + 3 (Oidc) + 4 (Verify) + 5 (Setup) + 6 (AdminIndex) = 28 tests.

## Deviations from Plan

### Documented design deviations (oracle-level, surfaced in fixture comments)

These are NOT auto-fix deviations — they were already known and explicitly carried forward from RESEARCH §16 / D-20. The conformance suite acknowledges them in inventory comments and test headers without rewriting assertions to silently hide them.

1. **[Oracle vs production string drift — auth headings/ledes]**
   - Found: while transcribing inventory (Task 1).
   - Oracle: `screens-user.jsx:12` `<h2>Sign in</h2>`; `screens-user.jsx:13` lede `"Welcome back to your OpenWhispr Server."`.
   - Production: `t("end-user.signin.title.heading.text")` → `"Sign in to OpenWhispr"`; lede → `"Use your email or your organization SSO."`.
   - Resolution: both strings captured in `signInInventory` (`headingOracle`/`headingProduction`, `ledeOracle`/`ledeProduction`). Test asserts the production value (the actual shipped surface). Same pattern for `signUpInventory`.
   - Why this is acceptable: the oracle is a design-language template, not a copy oracle; the wording difference is intentional copy refinement made during Plan 07 / Plan 12-04.

2. **[VerifyEmailClient — 3 shipped variants vs 4 oracle variants]**
   - Found: while inventorying `screens-user.jsx:186-260`.
   - Oracle: 4 variants — `pending` / `verifying` / `success` / `error` (lines 215-218).
   - Production: 3 variants — `loading` / `success` / `error` (collapses oracle's `pending` + `verifying` into a single `loading`).
   - Reason: the RSC route validates `?token=` before mounting the client; there is no user-initiated pending branch where the user clicks "Open mail app".
   - Resolution: conformance test asserts the 3 shipped variants; `verifyEmailInventory.oraclePendingVariant` retains the unshipped 4th for any future plan that adds a standalone "check your inbox" screen. Inline header note documents this.

3. **[OIDC button styling — `kind=\"ghost\"` vs `variant=\"outline\"`]**
   - Found: while inventorying `screens-user.jsx:22`.
   - Oracle: third (generic SSO) button uses `kind=\"ghost\"`.
   - Production: `OidcButtons` renders all three buttons with `variant=\"outline\"`.
   - Resolution: conformance test asserts ONLY on role/name/count, not on CSS variant. This is a non-semantic styling deviation captured in `oidcInventory` and the test header. Closing this would require a follow-up plan that differentiates the variants in production.

4. **[No /setup JSX oracle]**
   - Found: while attempting to locate a `ScreenSetup` artboard in `screens-user.jsx`.
   - Oracle: none exists. The Phase-07 screens-user.jsx + ui.jsx pair never produced a dedicated /setup template.
   - Resolution: `setup.test.tsx` header carries an explicit `DOCUMENTED DESIGN DEVIATION` line plus the substring `no /setup JSX oracle` for grep-based plan-check enforcement. The test asserts conformance against the COMPOSED primitives (`AuthShell` + `Btn` + `Field`) and the ADMIN-02 wizard structural invariants (3 anchor sections, Stepper, 5 labels).

5. **[/admin index omits the oracle's third "Effective env" card]**
   - Found: while inventorying `screens-admin.jsx:584-624`.
   - Oracle: third card renders 6 env var values (some redacted).
   - Production: AdminIndex renders ONLY the first 2 cards (endpoint labels, no values).
   - Reason: rendering any env values widens the trust boundary for an end-user-visible /admin landing; actual values are reachable via the sidebar → Config route which already exists.
   - Resolution: `adminConfigInventory.cards` captures only the 2 shipped cards; the test asserts `>= 2 cards`, never `== 3`. The PII gate enforces "no leaked values" structurally.

### Auto-fixed Issues

None — the plan executed exactly as written. No Rule 1/2/3 auto-fix triggered.

### Linter auto-formatting

Biome's `lint/style/useTemplate` fired on 3 occurrences of `"prefix " + variable` string concatenation in the test resource bundles (a fixable rule). Auto-fixed in-place during pre-commit; no test behavior change. Documented because the lint hook visibly rewrote 3 files between Write and commit.

### Commit-subject case fix

`commitlint` rejected the Task-2 commit subject as start-cased (`SignInForm + SignUpForm + ...`). Re-issued with lowercased subject `add auth-screen conformance suite (4 files, 17 tests)`. Same content, same files staged — no functional change.

## Authentication gates

None — this plan is test-only and exercises no auth flows beyond mocked `authClient.{signIn,signUp,verifyEmail,sendVerificationEmail,signIn.social}`.

## Known Stubs

None. All conformance assertions exercise the just-shipped Plan 12-03 / Plan 12-04 implementations (SetupForm, SignInForm, SignUpForm, OidcButtons, VerifyEmailClient, AdminIndex). No placeholder values, no empty-data flows that would mask UI gaps.

## TDD Gate Compliance

This plan ships test files only. Each of the three task commits is a `test(...)` commit — by construction this is a RED-only landing for plans whose product IS the test suite. The implementation files those tests exercise were shipped GREEN in Plans 12-03 / 12-04. No `feat(...)` follow-up commit is needed for this plan.

## Self-Check

- [x] `__fixtures__/jsx-inventory.ts` — FOUND
- [x] `SignInForm.test.tsx` — FOUND
- [x] `SignUpForm.test.tsx` — FOUND
- [x] `OidcButtons.test.tsx` — FOUND
- [x] `VerifyEmailClient.test.tsx` — FOUND
- [x] `setup.test.tsx` — FOUND
- [x] `admin-index.test.tsx` — FOUND
- [x] Commit 0d0d38e — FOUND in `git log --all`
- [x] Commit 99bb496 — FOUND in `git log --all`
- [x] Commit 84a746f — FOUND in `git log --all`
- [x] `pnpm vitest run src/components/__tests__/conformance/` — 6 files, 28 tests, all green

## Self-Check: PASSED
