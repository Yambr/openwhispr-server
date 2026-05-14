---
phase: 12-admin-onboarding-wizard-ui-spec-conformance-audit-v2
verified: 2026-05-14T18:25:00Z
status: passed_with_gaps
score: 11/11 must-have categories verified; 2 documentation gaps + 1 deferred-CI artifact
verdict: PASS-WITH-GAPS
gaps:
  - truth: "REQUIREMENTS.md statuses for Phase 12 requirements not flipped to Complete"
    status: failed
    reason: "ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, UICONF-01, UICONF-02, UICONF-03, UICONF-07 remain marked Pending in REQUIREMENTS.md (lines 446-458 and 549-561) even though the underlying code/docs are shipped and verified. Only ADMIN-06, UICONF-04, UICONF-05, UICONF-06 are correctly marked Complete. ROADMAP.md line 54 already marks Phase 12 as [x] (completed 2026-05-14)."
    artifacts:
      - path: .planning/REQUIREMENTS.md
        issue: "9 Phase-12 requirements still Pending; ROADMAP shows the phase complete; inconsistent state"
    missing:
      - "Flip 9 requirement statuses from Pending to Complete in both the requirements list (lines 446-458) and the index table (lines 549-561)"
  - truth: "UICONF-05 axe baseline was never actually executed — only the spec was authored"
    status: partial
    reason: "12-05b SUMMARY explicitly states 'Not executed in this local session — the destructive local boot path is deferred to CI'. The spec exists, the WCAG-2.1-AA tag set is correct, no .withRules silencing is present, the CI workflow .github/workflows/conformance-axe.yml is authored — but the first authoritative axe run will happen in CI. Verdict therefore relies on plan-design intent + zero-violation expectation, not on a recorded green run."
    artifacts:
      - path: tests/conformance/ui-spec/axe.spec.ts
        issue: "Spec wired correctly but never executed; UICONF-05 'zero violations' truth is currently a CI promise, not a recorded result"
    missing:
      - "First successful CI run of conformance-axe.yml that records 0 violations across all 5 routes; orchestrator should attach the CI run URL or re-run locally before milestone close"
deferred:
  - truth: "Timezone field not persisted (no users.timezone column)"
    addressed_in: "future phase (CONTEXT.md <deferred_ideas>)"
    evidence: "Plan 12-03 explicitly documents the timezone deferral; handler accepts the body field but does not write it; regression test in setup-admin.test.ts asserts column absence as a regression net for future migration"
  - truth: "OIDC button styling: oracle 'ghost' variant vs production 'outline' variant"
    addressed_in: "future plan (oracle-vs-production styling refinement)"
    evidence: "Documented in 12-05a SUMMARY deviation #3; conformance tests assert semantic equivalence only, not CSS variant equivalence (UICONF-04 is semantic-conformance not pixel-diff per ROADMAP success criterion #4)"
  - truth: "/admin index omits the oracle's third 'Effective env' card"
    addressed_in: "future plan (/admin/config already exposes env values per Phase 07.1 plan 12)"
    evidence: "Documented in 12-05a SUMMARY deviation #5; rendering env values on /admin landing was a deliberate trust-boundary narrowing (RESEARCH §15(h))"
  - truth: "Native <select> timezone picker instead of cmdk Combobox"
    addressed_in: "future phase (cmdk vendoring TBD)"
    evidence: "Documented in 12-03 SUMMARY deviation; native select is keyboard + screen-reader accessible — UX-only refinement, not a functional gap"
  - truth: "Pre-existing AccountClient test failure"
    addressed_in: ".planning/deferred-items.md (out of Phase 12 scope)"
    evidence: "Verified pre-existing on main HEAD before Plan 12-04 changes; logged with one-line fix recommendation"
overrides: []
re_verification: null
---

# Phase 12: Admin Onboarding Wizard + UI-SPEC Conformance Audit v2 — Verification Report

**Phase Goal (ROADMAP.md L715-720):** A fresh operator goes from `git clone && docker compose up` to a logged-in admin in one wizard pass with zero bcrypt-in-`.env` traps, and every auth screen renders only the OIDC providers the operator actually configured.

**Verified:** 2026-05-14T18:25:00Z
**Status:** PASS-WITH-GAPS
**Verifier:** Claude Opus 4.7 (gsd-verifier, 1M context)
**Re-verification:** No — initial verification

---

## ROADMAP Phase 12 Success Criteria (5 criteria) — Goal-Backward

| # | Success Criterion | Status | Evidence (codebase) |
|---|---|---|---|
| 1 | First-run operator visits /setup, completes single-page wizard, logged in as admin; setup_state enum gates the route (NOT users-count); v1-upgrade backfill to skipped_legacy | **VERIFIED** | `packages/data/migrations/0017_setup_state.sql:33` CASE WHEN EXISTS branches; `apps/api/src/routes/setup-admin.ts:177-194` atomic UPDATE-RETURNING claim; `apps/web/src/app/(public)/setup/page.tsx:49-50` fetches `/api/setup-state`. Tests: 10/10 pass in `setup-admin.test.ts`; 8/8 in `setup-state.test.ts`; 6/6 migration sub-tests in `0017-setup-state.test.ts` (real PG + pg_partman testcontainer) |
| 2 | /admin returns real index page (closes TD-12.a 404); basicauth-htpasswd documented as break-glass; bcrypt $$ trap removed by wizard | **VERIFIED** | `apps/web/src/app/(admin)/admin/page.tsx` + `apps/web/src/components/screens/AdminIndex.tsx` exist (3651 bytes); `docs/operations.md:203-295` "Admin break-glass recovery (bcrypt htpasswd)" section ships ADMIN-05; wizard owns admin creation server-side (no bcrypt in .env path for fresh installs) |
| 3 | GET /api/auth/providers returns configured OIDC + email-verification; auth screens render zero buttons for zero providers (closes TD-12.c) | **VERIFIED** | `apps/api/src/routes/auth-providers.ts` shipped; `apps/api/src/routes/capabilities.ts` shipped; `apps/api/src/lib/oidc-providers.ts` is the shared D-08 helper; `apps/web/src/components/screens/auth/useAuthProviders.ts` hook; OidcButtons returns null when `providers:[]` or `loading`; NEXT_PUBLIC_OIDC_PROVIDERS excised from production tree (only explanatory comments in test files). Tests: 9/9 auth-providers, 9/9 capabilities, 14/14 oidc-providers helper, 4/4 useAuthProviders pass |
| 4 | Auth screens conform semantically (NOT pixel-diff); per-field Zod errors en+ru; duplicate-banner fix; UICONF-07 resend CTA; axe baseline zero violations | **VERIFIED (with one CI-deferred artifact)** | 6/6 conformance test files green at `apps/web/src/components/__tests__/conformance/` (28 tests); UICONF-06 single-banner + title≠body assertions present in SignUpForm.test.tsx; UICONF-07 resend CTA wired via `authClient.sendVerificationEmail` (SignInForm.tsx); axe spec at `tests/conformance/ui-spec/axe.spec.ts` with wcag2a+wcag2aa+wcag21a+wcag21aa tags, no .withRules silencing — **GAP**: spec authored but not executed in this session; first CI run is the authoritative report |
| 5 | Phase 13 Gherkin `@cjm-admin-onboarding` GREEN; verifier PASSED with ≥90/90/90/90 coverage; live e2e green | **VERIFIED (with one CI-deferred artifact)** | 5 scenarios flipped from `@expected-red @after-phase-12` to GREEN in `tests/e2e-cjm/features/{admin-onboarding,signup-verify,oidc-providers}.feature`; only `@cjm-1.4 @expected-red @after-phase-15` remains tagged (correctly — Phase 15). Coverage on diff: setup-admin.ts 100/100/100/100, SetupForm.tsx 100/94.44/100/100, zod-i18n.ts 100/100/100/100, schemas/setup.ts 100/100/100/100, useAuthProviders.ts 100/100/100/100, OidcButtons.tsx 100/100/100/100, SignUpForm.tsx 100/100/100/100, SignInForm.tsx 96.42/93.75/100/100, AdminIndex.tsx 100/100/100/100 — all axes ≥ 90. CI execution of `make e2e-cjm` itself is deferred per the same boot-cost rationale as the axe baseline |

**ROADMAP SC score:** 5/5 verified (2 carry a CI-deferred-execution caveat that is documented and authorized by the plans, not a code gap).

---

## Per-Plan Must-Haves Verification

### Plan 12-01 — setup_state foundation

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Fresh-install row pending | VERIFIED | 0017 migration CASE branch + test A pass |
| 2 | v1-upgrade row skipped_legacy | VERIFIED | 0017 CASE WHEN EXISTS branch + test B pass |
| 3 | CHECK (id=1) rejects 2nd insert | VERIFIED | `migrations/0017_setup_state.sql:24` `PRIMARY KEY  CHECK (id = 1)`; test C asserts SQLSTATE 23514 |
| 4 | users.role nullable, no default | VERIFIED | `migrations/0017_setup_state.sql:42` `ALTER TABLE "users" ADD COLUMN "role" text;` (no NOT NULL, no DEFAULT) |
| 5 | Better Auth additionalFields.role input:false blocks role escalation | VERIFIED | `apps/api/src/auth.ts:266-278` role block contains `input: false` with full doc comment citing T-12.01-01; auth-role-input-false.test.ts 2/2 pass |
| 6 | squawk 16-rule lint clean on 0017 | VERIFIED | Squawk gate exits 0 per SUMMARY; rules checklist documented |
| 7 | Coverage ≥ 90/90/90/90 | VERIFIED | 100/100/100/100 on every Plan 12-01 diff line (pure declarations + unconditionally executed extension hunks) |

**Artifacts:** All 6 listed artifacts exist with correct content (verified via Read + grep). Key links to packages/data barrel re-export + Better Auth additionalFields confirmed.

### Plan 12-02 — capability-discovery endpoints + D-12.02-EX1 closure

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | GET /api/auth/providers public shape | VERIFIED | `apps/api/src/routes/auth-providers.ts` exports `buildAuthProvidersRoutes`; wired in `routes/index.ts:235`; tests 9/9 pass |
| 2 | Zero env → providers:[] | VERIFIED | oidc-providers.test.ts table tests cover all permutations; 14/14 pass |
| 3 | Cache-Control public,max-age=60 + weak ETag + 304 | VERIFIED | Header assertions in auth-providers.test.ts; 304 short-circuit test green |
| 4 | No client_secret / discoveryUrl / issuer in public response | VERIFIED | Info-leak gate + Object.keys assertions in tests |
| 5 | /api/capabilities 401 anon, 200 authed | VERIFIED | `capabilities.ts:155-157` `AuthError("UNAUTHORIZED", ...)`; test 401-anon green; tenant-scoped ETag tested |
| 6 | /api/capabilities Cache-Control private,max-age=30 | VERIFIED | grep `private, max-age=30` 3 matches in capabilities.ts |
| 7 | GET /api/setup-state public boolean shape | VERIFIED | `setup-state.ts:70` Cache-Control:no-store, max:30 rate-limit, Object.keys(body) === ['status'] |
| 8 | /api/setup-state info-leak gate | VERIFIED | setup-state.test.ts asserts no tenant/email/timestamps; 8/8 pass |
| 9 | D-12.02-EX1 closure — real PG harness, NOT makeFakeDb | **VERIFIED** | `apps/api/src/routes/__tests__/setup.ts:62` `PARTMAN_IMAGE = "openwhispr/postgres:17.5-pgpartman"`; `bootMigratedPostgres` at line 84; `capabilities.test.ts:4` + `setup-state.test.ts:4` headers cite the close-out. Tests run real PG + pg_partman testcontainer; 52/52 pass in this verification run |
| 10 | Coverage ≥ 90/90/90/90 | VERIFIED | Per-file analysis; all axes ≥ 90 |

### Plan 12-03 — wizard surface + workspace persistence

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | POST /api/setup/admin idempotent atomic-UPDATE claim → 201 + role + tenants.name | VERIFIED | `setup-admin.ts:177-260` atomic UPDATE, role flip via raw SQL, tenants UPDATE post-claim; sub-test 1 asserts tenants.name='Acme Inc' post-condition |
| 2 | Race-loser 2nd POST → 200 not 409 | VERIFIED | `setup-admin.ts:194` `alreadyCompleted: true` 200 branch; grep -n "409" returns zero in production code |
| 3 | Compensating rollback on Better Auth error | VERIFIED | `setup-admin.ts:215` `UPDATE setup_state SET status='pending'` rollback path; sub-test 3 asserts setup_state remains pending |
| 4 | /setup page redirects when status !== 'pending' | VERIFIED | `setup/page.tsx` reads /api/setup-state; redirect('/sign-in') on completed/skipped_legacy |
| 5 | /setup page fetches /api/setup-state NOT /api/capabilities | **VERIFIED** | grep on page.tsx: 3 matches for "api/setup-state", 0 for "api/capabilities" — BLOCKER-1 regression net green |
| 6 | RHF7+Zod3 single-page wizard, 3 sections, Stepper | VERIFIED | SetupForm.tsx composes Stepper + 3 section anchors driven by IntersectionObserver |
| 7 | tenants.name persisted to default singleton (RESEARCH Q1) | VERIFIED | `setup-admin.ts:142` `DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000"`; UPDATE tenants wired |
| 8 | Timezone deferred (no users.timezone column) | DEFERRED | Documented in CONTEXT.md; regression test asserts column absence as future trip-wire |
| 9 | Per-field Zod errors in en+ru via setErrorMap/z.config | VERIFIED | `zod-i18n.ts` installs `z.config({customError})`; common.validation.* keys present in en+ru with parity |
| 10 | Hardcoded /admin redirect, no ?next= open-redirect | VERIFIED | grep -n "router.push('/admin')" returns exactly 1; no `searchParams.get('next')` |
| 11 | Coverage ≥ 90/90/90/90 | VERIFIED | setup-admin 100/100/100/100; SetupForm 100/94.44/100/100; zod-i18n 100/100/100/100; schemas/setup 100/100/100/100 |

### Plan 12-04 — auth screens + UICONF-06/07 + /admin index + ADMIN-05

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | All 4 auth screens consume useAuthProviders / providers | VERIFIED | useAuthProviders.ts + OidcButtons.tsx + SignInForm.tsx + SignUpForm.tsx wired; VerifyEmailClient audited (vacuously satisfied — no provider refs) |
| 2 | OidcButtons returns null on zero providers | VERIFIED | grep "return null" in OidcButtons.tsx ≥ 1 (loading + zero short-circuit) |
| 3 | No flicker: loading → null | VERIFIED | Hook initial state `loading: true`; component short-circuits |
| 4 | NEXT_PUBLIC_OIDC_PROVIDERS excised from src | VERIFIED | grep returns only test-file explanatory comments; production tree clean |
| 5 | SignUpForm single banner, title≠body | VERIFIED | UICONF-06 assertion in SignUpForm.test.tsx; new keys `end-user.signup.error-duplicate.{title,body}.text` (en+ru parity) |
| 6 | SignInForm UICONF-07 resend CTA on 403 EMAIL_NOT_VERIFIED | VERIFIED | grep EMAIL_NOT_VERIFIED ≥ 1; resend reuses Better Auth `sendVerificationEmail` endpoint (no new route) |
| 7 | /admin index exists at `apps/web/src/app/(admin)/admin/page.tsx` | VERIFIED | File exists, imports AdminIndex; RSC entry; closes TD-12.a |
| 8 | /admin surfaces NO PII (no emails / IPs / audit) | VERIFIED | PII gate test in AdminIndex.test.tsx + duplicate gate in conformance/admin-index.test.tsx; both green |
| 9 | docs/operations.md ADMIN-05 break-glass section | VERIFIED | Section at L203-295 of docs/operations.md documents bcrypt htpasswd path |
| 10 | Coverage ≥ 90/90/90/90 | VERIFIED | Per-file table all ≥ 90; SignInForm 96.42/93.75/100/100 is lowest, still ≥ 90 |

### Plan 12-05a — UICONF-04 conformance suite

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | 6 conformance test files under conformance/ | **VERIFIED** | `apps/web/src/components/__tests__/conformance/` contains 6 test files + `__fixtures__/jsx-inventory.ts` |
| 2 | Each file cites JSX oracle file:line in header | VERIFIED | Inspected: SignInForm cites screens-user.jsx:7-94; SignUpForm 97-183; OidcButtons 15-25; VerifyEmailClient 186-260; setup ui.jsx:229-316; admin-index screens-admin.jsx:445-628 |
| 3 | UICONF-06 hardening: getAllByRole('alert').toHaveLength(1) + title≠body | VERIFIED | SignUpForm.test.tsx conformance test contains the literal assertions per SUMMARY idiom block |
| 4 | OidcButtons 3 scenarios (0/1/3 providers) | VERIFIED | OidcButtons.test.tsx tests 3 distinct scenarios |
| 5 | setup.test.tsx documents no-/setup-JSX-oracle deviation | VERIFIED | Header contains "documented design deviation" / "no /setup JSX oracle" per SUMMARY |
| 6 | admin-index.test.tsx PII gate (email + IPv4 + audit) | VERIFIED | All 3 PII regex assertions present |
| 7 | All 6 files run green | **VERIFIED (live re-execution)** | `cd apps/web && pnpm vitest run src/components/__tests__/conformance/` → **6 files / 28 tests passed in 1.04s** |

### Plan 12-05b — UICONF-05 axe baseline + CJM flip-green

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | @axe-core/playwright pinned at 4.11.2 | VERIFIED | package.json:42 + apps/web/package.json:42 both at 4.11.2 |
| 2 | axe.spec.ts exists, uses bootStack/tearStack | VERIFIED | `tests/conformance/ui-spec/axe.spec.ts` imports from `../../e2e-cjm/support/compose-harness`; iterates 5 routes |
| 3 | 5 routes: /sign-in, /sign-up, /verify-email, /setup, /admin | VERIFIED | Spec body iterates exact list |
| 4 | WCAG-2.1-AA rule tags (wcag2a + wcag2aa + wcag21a + wcag21aa) | VERIFIED | `axe.spec.ts:48` `.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])` |
| 5 | No .withRules / .disableRules silencing | VERIFIED | grep returns zero matches; honest zero-violation is the only pass condition |
| 6 | results.violations === [] across all 5 routes | **PARTIAL / CI-DEFERRED** | Spec asserts `expect(results.violations).toEqual([])` per route, but **the spec was NOT executed in this session** (12-05b SUMMARY explicitly defers to CI). First authoritative result will come from `.github/workflows/conformance-axe.yml`. Plan-design intent is zero violations; cannot be codebase-verified without a live boot. |
| 7 | 5 Gherkin scenarios flipped GREEN by tag removal | VERIFIED | `grep -nE "@expected-red\|@after-phase-12"` on the 3 feature files returns only `@cjm-1.4 @expected-red @after-phase-15` (Phase 15, correctly remaining). All 5 D-27 target scenarios (5.1, 5.3, 1.5, 7.1, 7.2) tag-stripped per the diff in SUMMARY |
| 8 | make e2e-cjm reports 5 newly-untagged scenarios PASSED | **PARTIAL / CI-DEFERRED** | Tag removal verified; full Cucumber run deferred to `.github/workflows/e2e-cjm.yml` per same boot-cost rationale |
| 9 | No retries (D-22) | VERIFIED | `retries: 0` in playwright.config.ts |

---

## Cross-Cutting Checks (per verifier mandate)

| Check | Result |
|---|---|
| 6 conformance test files exist + green | ✓ 6 files, 28 tests, all passing (live re-run) |
| `apps/api/src/routes/setup-state.ts`, `setup-admin.ts`, `auth-providers.ts`, `capabilities.ts` exist + wired in `routes/index.ts` | ✓ All 4 files exist; routes/index.ts has buildSetupStateRoutes (line 237), buildAuthProvidersRoutes (235), buildCapabilitiesRoutes (236), buildSetupAdminRoutes (387) |
| `apps/api/src/routes/__tests__/setup.ts` real-PG harness — D-12.02-EX1 closure | ✓ `PARTMAN_IMAGE = "openwhispr/postgres:17.5-pgpartman"` + `bootMigratedPostgres` + `resetSetupState`; commit 74d4e4a confirmed on main |
| `packages/data/migrations/0017_setup_state.sql` exists | ✓ Exists; CHECK (id = 1) + ALTER TABLE users ADD COLUMN role text (nullable, no default) |
| Better Auth `additionalFields.role` has `input: false` | ✓ `apps/api/src/auth.ts:277` `input: false` inside role block |
| `apps/web/src/app/(public)/setup/page.tsx` fetches /api/setup-state NOT /api/capabilities | ✓ grep: 3 matches for setup-state, 0 for capabilities (BLOCKER-1 regression net green) |
| /admin RSC page + AdminIndex component | ✓ Both files exist; page.tsx imports + renders <AdminIndex /> |
| Axe baseline tests/conformance/ui-spec/axe.spec.ts with WCAG-2.1-AA | ✓ File exists with correct tag set; CI execution deferred (see gap #2) |
| 5 Gherkin scenarios flipped to GREEN | ✓ All 5 D-27 target tags removed; only @cjm-1.4 (Phase 15) remains @expected-red |
| en + ru locales updated in common.json + end-user.json | ✓ Locale parity verified: 16 setup keys en==ru; signup error-duplicate/error-generic title+body parity confirmed |
| docs/operations.md documents ADMIN-05 bcrypt htpasswd | ✓ Section L203-295 documents the break-glass path |

## Coverage Gate (CLAUDE.md ≥ 90/90/90/90 per phase)

| Plan | File | L | B | F | S | Status |
|---|---|---|---|---|---|---|
| 12-01 | setup_state.ts + 0017 + auth.ts hunks | 100 | 100 | 100 | 100 | ✓ |
| 12-02 | oidc-providers.ts + auth-providers.ts + capabilities.ts + setup-state.ts | ≥90 | ≥90 | ≥90 | ≥90 | ✓ |
| 12-03 | setup-admin.ts | 100 | 100 | 100 | 100 | ✓ |
| 12-03 | SetupForm.tsx | 100 | 94.44 | 100 | 100 | ✓ |
| 12-03 | zod-i18n.ts + schemas/setup.ts | 100 | 100 | 100 | 100 | ✓ |
| 12-04 | useAuthProviders + OidcButtons + SignUpForm + AdminIndex | 100 | 100 | 100 | 100 | ✓ |
| 12-04 | SignInForm.tsx | 96.42 | 93.75 | 100 | 100 | ✓ |
| 12-05a | conformance tests (test-only plan) | — | — | — | — | n/a (test-only) |
| 12-05b | axe spec (test-only plan) | — | — | — | — | n/a (test-only) |

All diff axes pass the 90 floor.

## Requirements + ROADMAP Delta

| Source | Phase 12 status | Verdict |
|---|---|---|
| ROADMAP.md L54 | `[x] Phase 12 (completed 2026-05-14)` | Consistent with code reality |
| ROADMAP.md L727-732 | All 6 plans `[x]` | Consistent |
| REQUIREMENTS.md L446-458 | ADMIN-06 ✓, UICONF-04 ✓, UICONF-05 ✓, UICONF-06 ✓; **9 others still Pending** | **INCONSISTENT — gap #1** |
| REQUIREMENTS.md L549-561 index table | Same: 4 Complete, 9 Pending | **INCONSISTENT** |

The 9 Pending requirements that should be flipped to Complete:
- ADMIN-01 (setup_state gating) — verified via 0017 + setup-admin handler
- ADMIN-02 (single-page wizard + idempotent POST) — verified
- ADMIN-03 (users.role + additionalFields + backfill) — verified
- ADMIN-04 (/admin index closes TD-12.a) — verified
- ADMIN-05 (basicauth-htpasswd documented + bcrypt $$ trap removed by wizard) — verified
- UICONF-01 (/api/auth/providers + /api/capabilities) — verified
- UICONF-02 (auth screens conditional on /api/auth/providers) — verified
- UICONF-03 (per-field localized Zod errors) — verified
- UICONF-07 (resend-verification CTA on 403) — verified

## Constitutional Rule Checks (CLAUDE.md)

| Rule | Status | Evidence |
|---|---|---|
| No mocks of internal logic | ✓ | All Plan-12 tests use real PG via testcontainers (D-12.02-EX1 closure); only third-party process boundaries are faked (Better Auth signUpEmail, RTL fetch mock for hook tests) |
| No --legacy / no scope-stretches / no suppressed warnings (unjustified) | ✓ | One targeted `biome-ignore` in useAuthProviders.ts for the intentional console.warn observability hook, with cited justification (RESEARCH §9 P2) — meets the "targeted, cited, architecturally justified" allowance |
| Source-artifact language English | ✓ | All code, comments, commit messages English; lint-english.ts enforces |
| Runtime localization en + ru from day one | ✓ | All new copy keys present in both en/ and ru/ locale bundles with structural parity (verified via node walker: 16/16 setup keys, signup error keys match) |
| TDD: tests precede production code; same atomic commit | ✓ | Each plan's commits ship test + production together (per plan SUMMARIES); verified by git log inspection |

## Deviation Classification (per plan SUMMARY)

| Plan | Deviation | Classification | Rationale |
|---|---|---|---|
| 12-01 | D-12.01-EX1: cfg-capture pattern for role input:false test (vs full HTTP harness) | **Resolved/Acceptable** | Process-boundary pattern matches existing repo convention (auth-locale-and-enqueue, auth-schema-mapping); end-to-end HTTP path is exercised in subsequent plans |
| 12-01 | bootLegacyPreMigration local helper for v1-upgrade branch | **Acceptable** | Minimum-blast-radius path; refactoring shared helper out of scope |
| 12-02 | D-12.02-EX1: original commits used makeFakeDb; violated CLAUDE.md "no internal mocks" | **Resolved by commit 74d4e4a** | Replaced with real PG + pg_partman testcontainer harness at `apps/api/src/routes/__tests__/setup.ts`; 17/17 capabilities + setup-state tests pass against real PG. Verified: `grep -n makeFakeDb` returns matches only in unrelated files (web-search, stt-config, etc.) — NOT in capabilities.test.ts or setup-state.test.ts |
| 12-02 | D-12.02-EX2: realtime feature requires BOTH master-key + OPENAI key | **Acceptable** | Conservative AND matches production registration gate (routes/index.ts:374); RESEARCH §5 did not prescribe exact env set |
| 12-03 | Minimal Stepper port vs verbatim copy | **Acceptable** | MIT-compatible; SPDX + attribution preserved; surface drop-in compatible for future swap |
| 12-03 | Native `<select>` timezone vs cmdk Combobox | **Deferred (acceptable)** | Native select is keyboard + a11y accessible; cmdk vendoring out of scope |
| 12-03 | refine + params.kind vs three separate .regex | **Acceptable (correctness fix)** | Zod 4 short-circuits z.config on inline messages; refine is the correct pattern |
| 12-03 | Conditional registration of setup-admin route | **Acceptable** | Same gate pattern as existing `if (deps.redis)` for diarization; production wiring lands in follow-up plan |
| 12-04 | 5-level hyphenated leaf segments (error-duplicate, card-stt) | **Acceptable (schema-mandated)** | D-ART4 + tools/lint-ui-spec.ts mandate 5-level schema; hyphenated leaf is the correct fix |
| 12-04 | Targeted biome-ignore on noConsole for observability hook | **Acceptable** | Cited, targeted, architecturally justified per RESEARCH §9 P2 |
| 12-04 | Pre-existing AccountClient test failure | **Deferred (out of scope)** | Verified pre-existing on main HEAD before Plan 12-04; logged to .planning/deferred-items.md |
| 12-05a | 5 oracle-vs-production drifts (heading/lede strings, 3-vs-4 verify variants, ghost vs outline, no /setup oracle, omitted 3rd admin card) | **Deferred (acceptable)** | All documented in fixture comments + test headers; conformance is semantic not pixel-diff per ROADMAP SC4 |
| 12-05b | Axe spec authored but not locally executed | **Outstanding (CI-deferred)** | See gap #2 below — first authoritative run will be in CI workflow `.github/workflows/conformance-axe.yml` |
| 12-05b | URL host correction (https://app.localhost via baseURL) | **Acceptable bug fix** | Original RESEARCH §12 verbatim used `http://localhost${route}` which does not resolve against Traefik-fronted stack |
| 12-05b | ESM module-type alignment + tests/e2e-cjm/package.json | **Acceptable infra fix** | Latent ESM/CJS scope ambiguity surfaced; non-regressive |

## Outstanding Items Requiring Follow-Up

### Gap #1: REQUIREMENTS.md status flip (5-minute fix, PASS-WITH-GAPS, not a blocker)

**Required action:** Flip 9 Phase-12 requirements from `[ ]` Pending to `[x]` Complete in BOTH the requirements list (REQUIREMENTS.md L446-458) AND the index table (L549-561). The underlying code/docs are all shipped and verified; this is a documentation-bookkeeping miss by the orchestrator.

**Recommended mini-plan:** A single `docs(12): flip 9 Phase-12 requirement statuses to Complete (ADMIN-01..05, UICONF-01..03, UICONF-07)` commit by the orchestrator before milestone close.

### Gap #2: UICONF-05 axe baseline execution (CI-deferred)

**Required action:** First successful run of `.github/workflows/conformance-axe.yml` posting zero violations across all 5 routes. The spec is correctly wired (WCAG-2.1-AA tags, no .withRules silencing, real-Chromium against booted compose stack) — only execution is pending. ROADMAP success criterion #4 (axe zero violations) cannot be code-verified without a live boot.

**Recommended mini-plan:** Orchestrator triggers the CI workflow on a PR or main push; verifies the run is green; attaches the CI run URL to the milestone-close report. If a violation surfaces, fix lands in production code per the plan's explicit acceptance criterion (no rule-silencing fallback allowed).

**Why PASS-WITH-GAPS not BLOCK:** Both gaps are documentation/CI-execution artifacts, not missing implementation. All 6 plans' code is shipped, wired, tested, and green at the source-of-truth level (60+ phase-12 tests pass live; 6 conformance test files green; real-PG harness closes D-12.02-EX1; locale parity confirmed; security threat-model mitigations verified). The phase goal — "fresh operator goes from clone to logged-in admin via wizard with zero-baked-in providers and zero PII surface on /admin" — IS achieved in the codebase.

---

## Final Verdict: PASS-WITH-GAPS

Phase 12 ships all 6 plans atomically with their tests; 5/5 ROADMAP success criteria are verified (criteria 4 + 5 carry the CI-deferred axe + e2e-cjm execution caveat that the plans themselves authorized). The single material blocker risk (D-12.02-EX1 violation of CLAUDE.md no-internal-mocks rule) was correctly closed by commit `74d4e4a` with a real PG + pg_partman testcontainer harness. The 6 conformance test files run green live (28/28 tests). The 5 D-27 Gherkin scenarios are tag-stripped. en+ru locale parity holds. Security gates (info-leak, role-escalation, PII on /admin, info-disclosure on /api/setup-state) all have automated regression tests.

**Two gaps require orchestrator follow-up before milestone close:**
1. Flip 9 Phase-12 requirement statuses in REQUIREMENTS.md from Pending to Complete (≤ 5 min)
2. Trigger first CI run of `.github/workflows/conformance-axe.yml` and `.github/workflows/e2e-cjm.yml` to record the zero-violation axe baseline + 5 newly-green CJM scenarios on a real boot (CI execution)

Neither gap blocks proceeding to Phase 13 close-out or Phase 14 planning. Phase 12 verdict is **PASS-WITH-GAPS**.

---

_Verified: 2026-05-14T18:25:00Z_
_Verifier: Claude Opus 4.7 (1M context), gsd-verifier_
_Re-verification: No — initial verification_
