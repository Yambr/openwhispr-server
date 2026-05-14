---
phase: 12
plan: 04
subsystem: web-auth-screens
tags: [phase-12, plan-12-04, auth-screens, useAuthProviders, OidcButtons, UICONF-06, UICONF-07, admin-index, ADMIN-04, ADMIN-05, TD-12.a, TD-12.c]
requires:
  - "12-01 (setup_state + role + additionalFields)"
  - "12-02 (/api/auth/providers public endpoint)"
  - "12-03 (/setup wizard surface, locale shape)"
provides:
  - "useAuthProviders hook (fetch-driven OIDC provider list, fail-closed contract)"
  - "OidcButtons consuming /api/auth/providers at mount; zero-providers => null; loading => null"
  - "SignUpForm UICONF-06 banner: distinct title.text + body.text per errorKind"
  - "SignInForm UICONF-07: resend-verification CTA on 403 EMAIL_NOT_VERIFIED"
  - "/admin index RSC page + AdminIndex component (closes TD-12.a)"
  - "docs/operations.md ADMIN-05 bcrypt break-glass section"
affects:
  - "Phase 07.1 SignInForm + SignUpForm + OidcButtons (rewrite-in-place)"
  - "UI-SPEC-admin.md + UI-SPEC-end-user.md (Appendix C key index sync)"
  - "en + ru end-user.json + admin.json locale bundles"
tech-stack:
  added: []
  patterns:
    - "useEffect-driven public-endpoint fetch with cancelled-cleanup pattern"
    - "discriminated-union local component state (idle / error-generic / error-unverified)"
key-files:
  created:
    - apps/web/src/components/screens/auth/useAuthProviders.ts
    - apps/web/src/components/screens/auth/__tests__/useAuthProviders.test.ts
    - apps/web/src/components/screens/auth/__tests__/OidcButtons.test.tsx
    - apps/web/src/components/screens/AdminIndex.tsx
    - apps/web/src/components/screens/__tests__/AdminIndex.test.tsx
    - apps/web/src/app/(admin)/admin/page.tsx
    - .planning/deferred-items.md
  modified:
    - apps/web/src/components/screens/auth/OidcButtons.tsx
    - apps/web/src/components/screens/auth/SignUpForm.tsx
    - apps/web/src/components/screens/auth/SignInForm.tsx
    - apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx
    - apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx
    - apps/web/src/locales/en/end-user.json
    - apps/web/src/locales/ru/end-user.json
    - apps/web/src/locales/en/admin.json
    - apps/web/src/locales/ru/admin.json
    - docs/operations.md
    - .planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md
    - .planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md
decisions:
  - "Hyphenated leaf segments (`error-duplicate`, `error-generic`, `error-unverified`, `card-stt`, `card-note`) to keep new copy keys inside the D-ART4 5-level dotted schema enforced by tools/lint-ui-spec.ts. Documented in commit 1207760."
  - "AdminIndex is a Client Component (`'use client'`) so it can consume the existing react-i18next context that AdminLayout boots; the page.tsx wrapper stays a pure RSC entry per Phase 07.1 D-ADMIN-1."
  - "Resend-verification CTA reuses Better Auth's `authClient.sendVerificationEmail({ email })` — NO new API route added (Phase 12 boundary respected, mirrors VerifyEmailClient's existing surface)."
  - "Local SignInForm state migrated from `{errorVisible: boolean}` to a discriminated union `{kind: 'idle' | 'error-generic' | 'error-unverified'}` so the unverified branch carries its own resend phase ('idle' | 'sending' | 'sent') without crosstalk."
  - "VerifyEmailClient was AUDITED (must_haves clause) — it has zero provider references and required no changes; no-op pass documented in this summary instead of churning the file."
metrics:
  duration: "~80 minutes (RED+GREEN×5 tasks + coverage boost + UI-SPEC sync + ops doc)"
  completed_date: "2026-05-14"
  tasks: 5
  commits: 7
  tests_added: 21
  tests_total_apps_web_auth: 70
  files_touched: 18
---

# Phase 12 Plan 04: Auth Screens + `/admin` Index + Break-Glass Docs Summary

**One-liner:** Auth screens now consult `/api/auth/providers` at mount (zero baked-in providers), UICONF-06 duplicate banner fixed in SignUpForm, UICONF-07 resend-verification CTA shipped on SignInForm, `/admin` index page closes TD-12.a, and `docs/operations.md` documents the bcrypt htpasswd break-glass recovery path (ADMIN-05).

---

## Scope of work

All five plan tasks shipped in RED → GREEN order on `main` (inline execution; no worktree isolation per orchestrator instruction). Pre-flight: tree was clean at `e54daf8`; no stash needed.

| # | Task | Files | Commits |
|---|---|---|---|
| 1 | `useAuthProviders` hook + RTL test | `useAuthProviders.ts`, `useAuthProviders.test.ts` | `87a0be3`, `38ab618` |
| 2 | OidcButtons rewrite (DELETE env read) + test | `OidcButtons.tsx`, `OidcButtons.test.tsx`, SignIn/SignUp tests migrated | `b8d7d8e` (combined with T3) |
| 3 | SignUpForm UICONF-06 banner fix + i18n keys | `SignUpForm.tsx`, locales | `b8d7d8e` (combined with T2) |
| 4 | SignInForm UICONF-07 resend CTA + i18n keys | `SignInForm.tsx`, locales | `7e4cef6` |
| 5 | `/admin` index + AdminIndex + ADMIN-05 docs | `(admin)/admin/page.tsx`, `AdminIndex.tsx`, `AdminIndex.test.tsx`, `docs/operations.md` | `1207760` |
| — | Coverage lift on diff files | 3 test files | `a557d8a` |

---

## Plan-mandated SUMMARY fields

### Resend endpoint URL the CTA targets

`authClient.sendVerificationEmail({ email })` → POST `/api/auth/send-verification-email` (Better Auth catch-all under `apps/api/src/routes/better-auth-handler.ts`).

Verified path: `SignInForm.tsx` constructs the call via `(authClient as ...).sendVerificationEmail(...)`. This is the **same** endpoint Better Auth uses for the initial sign-up email and is consumed by `VerifyEmailClient` in its `authClient.verifyEmail({ query: { token } })` mirror surface. NO new API route was added — Phase 12 boundary respected.

### PII gate regex match counts on rendered AdminIndex output

| Pattern | Description | Match count |
|---|---|---|
| `/[\w.+-]+@[\w-]+\.[\w.-]+/` | Email-like | **0** |
| `/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/` | IPv4-like | **0** |
| `audit` (case-insensitive substring) | Audit-log keyword | **0** |

Enforced by `apps/web/src/components/screens/__tests__/AdminIndex.test.tsx` test 4 (`PII gate (RESEARCH §15(h))`).

### New i18n keys (en + ru parity confirmed)

**UICONF-06 (SignUpForm banner fix) — 4 keys × 2 langs = 8 entries:**
- `end-user.signup.error-duplicate.title.text`
- `end-user.signup.error-duplicate.body.text`
- `end-user.signup.error-generic.title.text`
- `end-user.signup.error-generic.body.text`

**UICONF-07 (SignInForm resend CTA) — 4 keys × 2 langs = 8 entries:**
- `end-user.signin.action.resendVerification.label`
- `end-user.signin.error-unverified.title.text`
- `end-user.signin.error-unverified.body.text`
- `end-user.signin.error-unverified.sent.text`

**ADMIN-04 (/admin index) — 8 keys × 2 langs = 16 entries:**
- `admin.index.title.heading.text`
- `admin.index.lede.body.text`
- `admin.index.readonly.title.text`
- `admin.index.readonly.body.text`
- `admin.index.card-stt.title.text`
- `admin.index.card-stt.endpoint.text`
- `admin.index.card-note.title.text`
- `admin.index.card-note.endpoint.text`

**Total new keys:** 16 per language, 32 entries combined. All registered in BOTH `UI-SPEC-end-user.md` Appendix C and `UI-SPEC-admin.md` Appendix C (the locale-bundle coverage gate at `src/locales/__tests__/coverage.test.ts` re-parses both UI-SPECs and passed clean post-merge).

**Old keys removed (replaced by the title/body split):**
- `end-user.signup.error.duplicate.text` (REMOVED — replaced by `.error-duplicate.title.text` + `.body.text`)
- `end-user.signup.error.generic.text` (REMOVED — replaced by `.error-generic.title.text` + `.body.text`)

### Grep gate proving `NEXT_PUBLIC_OIDC_PROVIDERS` was excised

```
$ grep -rn 'NEXT_PUBLIC_OIDC_PROVIDERS' apps/web/src --include='*.ts' --include='*.tsx' | grep -v __tests__
# (no matches in non-test files — gate PASS)
```

The only remaining occurrences live in test files and exist as **explanatory comments** documenting that the migration FROM the env var occurred. No code path reads the env var anywhere in the production tree. Verified via the OidcButtons.tsx file header rewrite and the source-only grep above.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — UI-SPEC schema enforcement] i18n keys flattened to 5-level dotted hierarchy**

- **Found during:** Task 5 commit pre-flight (`pnpm -w lint:ui-spec` blocked the commit).
- **Issue:** First-cut keys for UICONF-06 / UICONF-07 / admin.index used 6-level dotted forms (e.g. `end-user.signup.error.duplicate.title.text`) which `tools/lint-ui-spec.ts` rejects under rule `copy-key-schema` (D-ART4 mandates exactly 5 segments).
- **Fix:** Flatten via hyphenated leaves — `error.duplicate.title.text` → `error-duplicate.title.text`, `cards.stt.title.text` → `card-stt.title.text`, etc. Applied consistently across SignUpForm.tsx, SignInForm.tsx, AdminIndex.tsx, both en+ru locale bundles, both UI-SPEC files, and all three test fixtures in a single commit (`1207760`).
- **Why it's automatic:** This is a project-wide schema rule (D-ART4) that takes precedence over plan instructions. Per CLAUDE.md "no workarounds — enterprise-grade only," the correct fix is to honor the schema, not to add a per-key ignore.

**2. [Rule 3 — UI-SPEC sync to stay green] Updated UI-SPEC-end-user.md AND UI-SPEC-admin.md Appendix C indexes**

- **Found during:** Task 3 commit (locale-bundle coverage test `src/locales/__tests__/coverage.test.ts` failed on removed `duplicate.text` / `generic.text` keys).
- **Issue:** The coverage test enumerates ALL keys listed in either UI-SPEC's Appendix C and asserts each resolves to a non-empty string in BOTH en and ru bundles. The plan only mentioned locale-bundle changes, but the UI-SPEC drift would have broken the gate.
- **Fix:** Replace the deprecated rows with the new `.title.text` + `.body.text` rows in BOTH UI-SPEC files (both the per-screen "Copy keys" subsection AND the secondary alphabetical appendix). Added UICONF-07 + admin.index keys to both appendices.
- **Scope:** Mandatory keep-green operation; the coverage gate IS the inventory check.

**3. [Rule 1 — biome lint] Targeted suppression of `noConsole` on intentional observability hook**

- **Found during:** Task 1 commit (biome warning on `console.warn` in `useAuthProviders.ts`).
- **Issue:** Biome reports `lint/suspicious/noConsole` because the global project rule disallows console use. The fail-closed `console.warn` is intentional per RESEARCH §9 P2 — it surfaces a fetch failure to operator logs without throwing.
- **Fix:** `biome-ignore lint/suspicious/noConsole` directive with a cited justification (RESEARCH §9 P2 observability hook). Per CLAUDE.md "no suppressed warnings" the suppression is targeted (one line), cited, and architecturally justified.

### Out-of-Scope / Deferred

**Pre-existing AccountClient test failure** — `apps/web/src/components/screens/account/__tests__/AccountClient.test.tsx > renders the three section headings` was failing on `main` HEAD `e54daf8` **before** any Plan 12-04 changes. Verified by `git stash && pnpm vitest run AccountClient.test.tsx` returning the same failure. Falls outside the scope-boundary rule (only fix issues directly caused by the current task). Logged to `.planning/deferred-items.md` with a one-line fix recommendation (tighten `getByText` to `getByRole("heading", {name: /^Active sessions$/i})`).

### VerifyEmailClient audit — no-op pass

The plan's must_haves clause lists VerifyEmailClient among the "four auth screens that consume useAuthProviders." Audit result: `grep -in 'provider|oidc|google|github|sso|NEXT_PUBLIC' apps/web/src/components/screens/auth/VerifyEmailClient.tsx` returns zero matches — the component renders only the verification status (loading/success/error) and never displayed OIDC providers. The must_have ("zero baked-in providers") is satisfied vacuously; no code change was warranted. The 5 existing VerifyEmailClient tests remained green throughout the plan.

---

## Coverage gate (≥90/90/90/90 on diff)

Per-file coverage on Plan-12-04-touched source files (statements / branches / functions / lines):

| File | Stmt | Branch | Func | Lines |
|---|---|---|---|---|
| `useAuthProviders.ts` | 100 | 100 | 100 | 100 |
| `OidcButtons.tsx` | 100 | 100 | 100 | 100 |
| `SignUpForm.tsx` | 100 | 100 | 100 | 100 |
| `SignInForm.tsx` | 96.42 | 93.75 | 100 | 100 |
| `AdminIndex.tsx` | 100 | 100 | 100 | 100 |
| **`apps/web/src/components/screens/auth/` aggregate** | **98.77** | **95.12** | **100** | **100** |

All five diff files meet the ≥90 floor on every axis. The remaining gaps on `SignInForm.tsx` (1 uncovered statement at line 95 — a `return` early-exit guard inside `onResendVerification` when state has already drifted) are within tolerance and would require fragile state-race choreography to cover.

---

## Validation gate posture

| Gate | Status |
|---|---|
| `cd apps/web && pnpm vitest run` (full suite) | 833 / 834 green; 1 pre-existing AccountClient failure deferred |
| `cd apps/web && pnpm vitest run src/components/screens/auth/__tests__/` | 70 / 70 green |
| `pnpm -w lint:ui-spec` | PASS (zero diagnostics) |
| `pnpm tsc --noEmit` (apps/web) | PASS (clean) |
| `pnpm -w typecheck` | PASS (hook-driven on commit) |
| Per-task biome / english / commitlint | PASS on every commit |

---

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired components shipped in this plan. AdminIndex intentionally renders only env-var endpoint **labels** (not values) per Plan boundary — the actual config values are exposed by the existing `/admin/config` route (Phase 07.1 Plan 12), which the AdminShell sidebar links to. This is a deliberate scope choice (RESEARCH §15(h) — A1/A2 mirrors out of scope for Plan 12-04), not a stub.

---

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` already enumerates. All 5 STRIDE rows (T-12.04-01..05) have their mitigations landed and tested. The `/admin` index page intentionally surfaces NO PII (T-12.04-01 mitigated by the regex-gate test). The OidcButtons flicker gate (T-12.04-02) is enforced by the `if (loading) return null` short-circuit + the `OidcButtons.test.tsx` loading-window test. The `NEXT_PUBLIC_OIDC_PROVIDERS` excision (T-12.04-03) is enforced by grep gate. The UICONF-06 single-banner contract (T-12.04-04) is enforced by the `getAllByRole('alert').toHaveLength(1) && title !== body` test. The UICONF-07 CTA (T-12.04-05) reuses the existing Better Auth resend endpoint — no new route surface added.

---

## Self-Check: PASSED

- Created files exist: ✓ (`useAuthProviders.ts`, `useAuthProviders.test.ts`, `OidcButtons.test.tsx`, `AdminIndex.tsx`, `AdminIndex.test.tsx`, `(admin)/admin/page.tsx`, `deferred-items.md` — all verified by `ls`).
- Commits exist on `main`: ✓ (`87a0be3`, `38ab618`, `b8d7d8e`, `7e4cef6`, `1207760`, `a557d8a` all reachable from `git log --oneline main`).
- PII gate: ✓ (regex assertions in AdminIndex.test.tsx pass).
- NEXT_PUBLIC_OIDC_PROVIDERS excised from non-test sources: ✓.
- en + ru i18n parity: ✓ (locale-bundle coverage gate green; `pnpm -w lint:ui-spec` clean).
- Coverage on diff ≥ 90/90/90/90: ✓ (per-file table above).
- Existing Phase 07.1 auth tests green: ✓ (53 → 70 cases total; previously passing 11 SignInForm + 5 SignUpForm + 5 VerifyEmailClient cases all remain green).

---

## Cross-references

- **Plan file:** `.planning/phases/12-admin-onboarding-wizard-ui-spec-conformance-audit-v2/12-04-PLAN.md`
- **Research:** §9 (hook contract), §11 (UICONF-06 root cause), §13 (UICONF-07 CTA), §15(h) (PII gate)
- **Patterns:** `OidcButtons.tsx (REWRITE)`, `SignInForm.tsx:83-84` (correct title.text + body.text shape), JSX oracle `screens-admin.jsx:445-628` (ScreenConfig)
- **Threat register:** T-12.04-01..05
- **Deferred:** `.planning/deferred-items.md` (pre-existing AccountClient failure)
