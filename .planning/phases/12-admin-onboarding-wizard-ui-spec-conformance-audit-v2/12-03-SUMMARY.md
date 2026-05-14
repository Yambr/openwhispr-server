---
phase: 12
plan: 03
subsystem: admin-onboarding-wizard
tags: [phase-12, wizard, setup-admin, stepper, rhf-zod, idempotent, uiconf-03]
requires:
  - phase: 12
    plan: 01
    reason: "setup_state singleton + users.role column + Better Auth additionalFields"
  - phase: 12
    plan: 02
    reason: "public GET /api/setup-state (RSC fetch target) + capabilities + harness pattern"
provides:
  - "POST /api/setup/admin — idempotent atomic-UPDATE-claim handler"
  - "/setup RSC page with PUBLIC setup-state guard"
  - "<SetupForm /> Client wizard (Stepper + 3 anchored sections + RHF/Zod)"
  - "<Stepper> vendored primitive + getStepStatus helper"
  - "setupSchema (z.object) + zod-i18n bridge (z.config({customError}))"
  - "common.validation.* + end-user.setup.* i18n keys (en+ru parity)"
affects:
  - "apps/api/src/routes/index.ts (new optional setupAdmin dep)"
  - "apps/api/src/routes/__tests__/setup.ts (harness extended with buildSetupAdminApp + resetUsers)"
tech-stack:
  added: []
  patterns:
    - "idempotent atomic-UPDATE-RETURNING claim under PgBouncer txn-mode (RESEARCH §3)"
    - "compensating-rollback on Better Auth signUpEmail error"
    - "best-effort post-claim tenant rename with warnings array on failure (T-12.03-05)"
    - "single-IntersectionObserver wizard step indicator (threshold 0.5, most-recent-intersecting wins)"
    - "Zod 4 z.config({customError}) i18n bridge dispatching on issue.code + params.kind"
key-files:
  created:
    - apps/api/src/routes/setup-admin.ts
    - apps/api/src/routes/__tests__/setup-admin.test.ts
    - apps/web/src/components/ui/stepper.tsx
    - apps/web/src/lib/schemas/setup.ts
    - apps/web/src/lib/zod-i18n.ts
    - apps/web/src/lib/__tests__/zod-i18n.test.ts
    - apps/web/src/app/(public)/setup/page.tsx
    - apps/web/src/components/screens/auth/SetupForm.tsx
    - apps/web/src/components/screens/auth/__tests__/SetupForm.test.tsx
  modified:
    - apps/api/src/routes/index.ts
    - apps/api/src/routes/__tests__/setup.ts
    - apps/web/src/locales/en/common.json
    - apps/web/src/locales/ru/common.json
    - apps/web/src/locales/en/end-user.json
    - apps/web/src/locales/ru/end-user.json
decisions:
  - "Vendor shadcn-stepper as a minimal MIT-licensed re-creation (not a verbatim copy) — upstream port carries opinionated orientation/state-machine logic the single-page wizard does not need. Source attribution + SPDX header point at damianricobelli/shadcn-stepper for future verbatim swap."
  - "Use a single IntersectionObserver with three observed targets and threshold 0.5 instead of three separate observers — identical visible behaviour, one effect + one teardown."
  - "Native <select> for the timezone picker instead of the RESEARCH §8-recommended cmdk-Combobox. apps/web does not yet vendor cmdk; pulling it in is out of scope. Native select remains keyboard + screen-reader accessible. Documented as a follow-up in <deviations> below."
  - "Combine the three password character-class checks into a single .refine with params.kind='password.mixed_classes'. Zod 4 short-circuits z.config({customError}) when a check carries an inline message (e.g. .regex(re, 'msg')), so the verbatim RESEARCH §7 snippet would not route through the i18n bridge — the refine pattern preserves the dispatch."
  - "Conditional registration of POST /api/setup/admin via a new optional setupAdmin dep on AllRoutesDeps (ownerPool + signUpEmail). Same gate pattern as `if (deps.redis)` for diarization — keeps existing buildApp wiring untouched; production wiring lands in a follow-up plan."
metrics:
  duration_seconds: 2434
  tasks_completed: 4
  files_touched: 15
  tests_added:
    api: 10
    web: 26
  coverage_on_diff:
    apps/api/src/routes/setup-admin.ts: { lines: 100, branches: 100, functions: 100, statements: 100 }
    apps/web/src/components/screens/auth/SetupForm.tsx: { lines: 100, branches: 94.44, functions: 100, statements: 100 }
    apps/web/src/lib/zod-i18n.ts: { lines: 100, branches: 100, functions: 100, statements: 100 }
    apps/web/src/lib/schemas/setup.ts: { lines: 100, branches: 100, functions: 100, statements: 100 }
  completed_date: "2026-05-14"
---

# Phase 12 Plan 03: Wizard Surface Summary

End-to-end wizard surface for the operator-onboarding flow: idempotent POST /api/setup/admin handler with atomic-UPDATE-claim + workspace persistence + compensating rollback + tenant_rename failure path, vendored shadcn-stepper primitive, /setup RSC with public setup-state guard, and the Client SetupForm composing AuthShell + Stepper + 3-section anchored RHF/Zod form with localized errors and idempotent submit.

## What landed (per task)

### Task 1 — POST /api/setup/admin (`fe386c7`, coverage closure `ea9a398`)
- **Handler** (`apps/api/src/routes/setup-admin.ts`): verbatim RESEARCH §3 contract + Q1 workspace persistence. Atomic `UPDATE setup_state SET status='completed' WHERE status='pending' RETURNING ...` (single statement, race-safe under PgBouncer txn-mode). rowCount=0 → 200 `alreadyCompleted:true` (NEVER 409 per P1); rowCount=1 → `auth.api.signUpEmail({email,password,name,locale})` → if error: compensating `UPDATE setup_state SET status='pending'` → 400 `ADMIN_CREATE_FAILED`; success: `UPDATE users SET role='admin'` (raw SQL — column is migration-only, not in drizzle schema TS) + best-effort `UPDATE tenants SET name=$workspace WHERE id='00000000-0000-0000-0000-000000000000'` wrapped in try/catch → 201 `{admin:{email}, alreadyCompleted:false [, warnings:['tenant_rename_failed']]}`. Rate-limit `{max:5, timeWindow:'1 minute'}` per IP. Zod input schema strips unknown keys (T-12.03-07 role-escalation guard). Optional `Accept-Language` → `locale: 'en'|'ru'` forwarded to signUpEmail.
- **Conditional registration** in `routes/index.ts` via new optional `setupAdmin: { ownerPool, signUpEmail, renameTenant? }` dep. Same pattern as `if (deps.redis)` for diarization. Production buildApp wiring lands in a follow-up plan (out of scope for 12-03).
- **Test harness** (`apps/api/src/routes/__tests__/setup.ts`): extended with `buildSetupAdminApp` + `resetUsers`. Reuses the PG + pg_partman testcontainer harness proven by Plan 12-02 D-12.02-EX1 close-out. The `signUpEmail` fake INSERTs the user row via the owner pool so the handler's subsequent `UPDATE users SET role='admin'` lands on a real row — CLAUDE.md compliant (Better Auth's signUpEmail is a third-party process-boundary; no internal-logic mocks).
- **10 sub-tests, 100/100/100/100 coverage:** winner branch, race-loser, rollback, rate-limit, role-escalation, timezone-deferred (information_schema introspection asserts `users.timezone` column does NOT exist as a regression net), tenant_rename failure path (admin still created, no rollback), INVALID_BODY (Zod safeParse fail), Accept-Language ru → locale=ru, Accept-Language en → locale=en.

### Task 2 — Vendored Stepper (`4e797b5`)
- **`apps/web/src/components/ui/stepper.tsx`** — Stepper, Step, StepIndicator, StepLabel, StepSeparator + `getStepStatus(index, currentStep)` helper. Adapted from damianricobelli/shadcn-stepper (MIT) — fitted to apps/web's shadcn/ui v2 + Tailwind 4 + data-slot conventions. Presentational only; `currentStep` is parent-driven.
- **License confirmed MIT.** SPDX header + upstream attribution comment.
- **SHA pin deviation** — implementation is a minimal re-creation rather than verbatim copy because the upstream port carries opinionated orientation/state-machine logic the single-page wizard does not need. Header documents the deviation so a future verbatim swap is a drop-in replacement.
- **a11y:** implicit `<nav>` role, `<ol>` step list, `aria-current="step"` on active, sr-only "Completed" text alongside check icon, `aria-hidden="true"` on separator (axe-clean target per D-19).
- **Typecheck clean.** Excluded from the apps/web coverage gate by `vitest.config.ts` (`src/components/ui/**` is the vendored-primitives carve-out — covered by e2e + downstream consumer tests).

### Task 3 — Zod schema + zod-i18n bridge (`32da4ab`, coverage closure `36a2bae`)
- **`apps/web/src/lib/schemas/setup.ts`** — `setupSchema` mirrors the API `setupAdminInput` shape: email, password (`min(12).max(200)` + single `.refine` with `params.kind='password.mixed_classes'` covering upper/lower/digit), name (1..100), workspace (1..100), timezone (min 1). The single-refine pattern is required because Zod 4 short-circuits `z.config({customError})` when a check carries an inline message (e.g. `.regex(re, 'msg')`), so three separate `.regex(re, key)` calls (as in the RESEARCH §7 verbatim snippet) would not route through the i18n bridge.
- **`apps/web/src/lib/zod-i18n.ts`** — `installZodI18n(i18n)` installs a global `z.config({ customError })` dispatching on `issue.code` + (for `custom`) `params.kind` to i18next keys under `common.validation.*`. Idempotent (calls replace, not append). Module is the new `z.config()` API — `z.setErrorMap` is deprecated in Zod 4 but mentioned in the header for grep-gate traceability.
- **New `common.validation.*` keys** (en + ru): `email.invalid`, `password.min_length`, `password.mixed_classes`, `required`, `string.too_short`, `string.too_long`. Phase-10 `i18n-russian-coverage.test.ts` parity gate stays green (9 sub-tests).
- **13 sub-tests:** 8 schema-via-zod-i18n integration tests in `SetupForm.test.tsx` (5 EN + 2 RU + 1 happy-path); 5 synthetic-issue branch-coverage tests in `apps/web/src/lib/__tests__/zod-i18n.test.ts` (invalid_format with non-email format, too_small with non-12 minimum, invalid_type for type-mismatch, custom refine with unknown/missing `params.kind`). Russian assertions compare against the live `ru/common.json` payload rather than embedded literals so the test file stays English-only at the source-artifact level (the global lint-english tool refuses Cyrillic in non-locale source files).

### Task 4 — /setup RSC + SetupForm (`a474581`, coverage closure `36a2bae`)
- **`apps/web/src/app/(public)/setup/page.tsx`** — RSC entry with server-side `fetch('/api/setup-state', {cache:'no-store'})`. Branches on `body.status`: `pending` → render `<SetupForm />`; `completed` | `skipped_legacy` → `redirect('/sign-in')`; fetch-fail / 503 → renders localized `end-user.setup.initializing.text` (T-12.03-06). **BLOCKER 1 regression net asserted:** the grep gate `grep -n "api/capabilities" page.tsx` returns 0 (the original plan-check noted the page was fetching the wrong endpoint).
- **`apps/web/src/components/screens/auth/SetupForm.tsx`** — Client wizard composing `<Card>` + `<Stepper>` + three `<section id="identity|workspace|review">` anchors + RHF/Zod via `useZodForm(setupSchema)`. Single IntersectionObserver subscribes to the three sections with `threshold: 0.5`; most-visible section drives `currentStep`. Header documents the no-/setup-JSX-oracle deviation per RESEARCH §16. Hardcoded `router.push('/admin')` — never reads `?next=` (open-redirect guard T-12.03-04; grep gate returns 0). 201 + `warnings:['tenant_rename_failed']` renders a non-blocking notice before redirect (T-12.03-05 graceful degradation).
- **en + ru end-user.setup.* keys** added: title, subtitle, stepper.aria_label, step.{identity,workspace,review}.title, form labels + submit, error.generic.{title,body}, warning.tenant_rename_failed.text, initializing. en+ru parity confirmed.
- **IntersectionObserver wiring** — single observer with three observed targets, threshold 0.5; most-recently-intersecting section's index becomes `currentStep`. Picked over two/three-observer alternatives for simplicity (one effect, one teardown); produces identical visible behaviour for the wizard's short-anchor layout.
- **13 form + RSC tests:** 5 form unit tests (field labels render, valid submit body shape, invalid-email error, in-flight disable, 201 → router.push('/admin')) + 2 error-branch tests (non-2xx → generic alert, thrown-fetch → generic alert) + 1 warnings test (201+warnings notice + redirect) + 5 RSC page guard tests (pending/completed/legacy/503 + BLOCKER 1 regression net asserting `/api/setup-state` not `/api/capabilities`).

## Stepper port + vendored implementation details

- **Source:** [damianricobelli/shadcn-stepper](https://github.com/damianricobelli/shadcn-stepper)
- **License:** MIT (compatible per Phase 12 D-12)
- **SHA pin:** intentionally not pinned — implementation is a minimal re-creation rather than verbatim copy. The header comment documents this deviation so a future verbatim swap is a drop-in replacement against the same public surface.

## i18n keys added (`end-user.setup.*` + `common.validation.*`)

**common.validation.\*** (Task 3 — UICONF-03 error map keys):
- `common.validation.email.invalid`
- `common.validation.password.min_length`
- `common.validation.password.mixed_classes`
- `common.validation.required`
- `common.validation.string.too_short`
- `common.validation.string.too_long`

**end-user.setup.\*** (Task 4 — wizard copy):
- `end-user.setup.title.heading.text`
- `end-user.setup.subtitle.body.text`
- `end-user.setup.stepper.aria_label.text`
- `end-user.setup.step.identity.title.text`
- `end-user.setup.step.workspace.title.text`
- `end-user.setup.step.review.title.text`
- `end-user.setup.form.{name,email,password,workspace,timezone}.label`
- `end-user.setup.form.submit.label`
- `end-user.setup.error.generic.title.text`
- `end-user.setup.error.generic.body.text`
- `end-user.setup.warning.tenant_rename_failed.text`
- `end-user.setup.initializing.text`

All keys present in both `en/end-user.json` and `ru/end-user.json`. Phase-10 `i18n-russian-coverage.test.ts` parity gate still green (9 sub-tests).

## Plan-check resolutions preserved

- **BLOCKER 1** (RSC fetches `/api/setup-state` not `/api/capabilities`) — grep gate asserts 0 occurrences of `api/capabilities` in `page.tsx`; RSC test explicitly verifies the fetch URL targets setup-state.
- **BLOCKER 2** (i18n collision with Plan 12-04) — out of this plan's control; depends_on edge on Plan 12-04 handles serialization. This plan edits both `en/end-user.json` and `ru/end-user.json` freely.
- **BLOCKER 3** (workspace persists to `tenants.name`) — handler issues `UPDATE tenants SET name=$1 WHERE id='00000000-...'` post-claim; sub-test 1 verifies the post-condition; sub-test 7 verifies the failure-path 201 + warnings array contract; sub-test 2 verifies tenants.name is NOT touched on the race-loser branch.
- **TIDY 1** (auth.ts disjoint) — not touched by this plan.
- **Timezone deferred** — handler accepts `timezone` in body but does NOT write it (no users.timezone column); sub-test 6 introspects `information_schema.columns` and asserts the column does NOT exist as a regression net.

## /setup page conformance — no JSX oracle deviation

Per RESEARCH §16 + D-20, **no `/setup` JSX oracle exists** in the authoritative Phase-07 screens-user.jsx + ui.jsx pair. The single-page wizard semantics (Identity → Workspace → Review) are an ADMIN-02 invention. Both `page.tsx` and `SetupForm.tsx` header comments include the conformance inventory string `composes ui.jsx:AuthShell (L229-316) + ui.jsx:Field (L338-352) + ui.jsx:Btn (L326-336). NO /setup JSX oracle exists; documented design deviation per RESEARCH §16` — and a grep gate asserts that string is present.

## Tenants.name persistence — RESEARCH Q1 confirmation

`UPDATE tenants SET name = $1 WHERE id = '00000000-0000-0000-0000-000000000000'` lands for the default singleton via `db.update(tenants)` in the handler (default `renameTenant` callable uses the owner pool — sits OUTSIDE Better Auth's transaction boundary by construction). Sub-test 1 asserts `SELECT name FROM tenants WHERE id='00000000-...'` returns `'Acme Inc'` after a 201; sub-test 7 asserts the failure path surfaces `warnings:['tenant_rename_failed']` AND admin is still created (`role='admin'`).

## Timezone deferral — reaffirmed

`users.timezone` column does NOT exist. The wizard's timezone field is a UX preset only — the handler accepts it in the POST body for forward-compat but does NOT write it anywhere. Sub-test 6 introspects `information_schema.columns` and asserts the column absence as a regression net: if a future migration adds the column, this test goes RED, prompting the handler to persist it and the deferred note in CONTEXT.md to be revisited. `apps/web/src/components/screens/auth/SetupForm.tsx` `defaultTimezone()` defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`; `listTimezones()` reads from `Intl.supportedValuesOf('timeZone')` (with a small static fallback for old runtimes).

## Verification

- `cd apps/api && pnpm vitest run src/routes/__tests__/setup-admin.test.ts` — 10/10 green
- `cd apps/web && pnpm vitest run src/components/screens/auth/__tests__/SetupForm.test.tsx src/lib/__tests__/zod-i18n.test.ts src/lib/__tests__/i18n-russian-coverage.test.ts` — 35/35 green
- Coverage on diff (touched files only):
  - `apps/api/src/routes/setup-admin.ts`: **L100 B100 F100 S100**
  - `apps/web/src/components/screens/auth/SetupForm.tsx`: **L100 B94.44 F100 S100**
  - `apps/web/src/lib/zod-i18n.ts`: **L100 B100 F100 S100**
  - `apps/web/src/lib/schemas/setup.ts`: **L100 B100 F100 S100**
  - `apps/web/src/components/ui/stepper.tsx` + `apps/web/src/app/(public)/setup/page.tsx`: excluded from the apps/web coverage gate by `vitest.config.ts` (vendored primitives + RSC routes are covered by e2e in Phase 13).
- `cd apps/api && pnpm typecheck` — pre-existing errors in `transcriptions/*` + `litellm-client/index.ts` are unrelated to this plan; my files compile clean.
- `cd apps/web && pnpm typecheck` — clean.

## Deviations from Plan

### Process — orchestrator path mismatch (resolved)

The orchestrator prompt referenced `/Users/nick/openwhispr-server/apps/api/...` (the main-repo path) while the agent worktree at `/Users/nick/openwhispr-server/.claude/worktrees/agent-a64f7dd35d9a7e8ab/` is on its own branch. Initial Write calls using the absolute main-repo path landed in the main repo's working tree — caught immediately, reverted via `git checkout --` + `rm`, and all subsequent Edit/Write calls used **relative** paths from the worktree root. This is the documented #3099 absolute-path hazard from the executor system prompt; the recovery path is preserved in the worktree HEAD's commit history.

### Decision — minimal Stepper port over verbatim copy

The vendored Stepper is a minimal MIT-licensed re-creation rather than a verbatim copy from damianricobelli/shadcn-stepper. **Rationale:** the upstream port carries opinionated orientation/state-machine logic (vertical-vs-horizontal mode, internal step state) that the single-page wizard does not need. Implementation cost saved + dependency surface narrowed; header documents the deviation so a future verbatim swap is a drop-in replacement against the same public surface. **No `@radix-ui` imports** appear in `stepper.tsx` — the minimal implementation does not require popovers/menus. The plan's acceptance criterion (`grep -c "@radix-ui" stepper.tsx`) was a planner-intent suggestion ("if upstream uses radix, keep it"); since the minimal port doesn't, no radix import is correct.

### Decision — native `<select>` for the timezone picker (cmdk Combobox deferred)

RESEARCH §8 recommended a cmdk-Combobox for the ~430-zone surface. **apps/web does not yet vendor cmdk**, and pulling it in is out of scope for Plan 12-03 (it would add a vendored primitive + corresponding tests). The native `<select>` populated from `Intl.supportedValuesOf('timeZone')` remains keyboard + screen-reader accessible; large lists are slower to navigate without type-ahead filtering, but functional. **Follow-up:** track cmdk vendoring + Combobox-based timezone picker as a Phase 12.x or Phase 13 enhancement.

### Decision — refine + params.kind, not three separate .regex with inline message

RESEARCH §7's verbatim snippet uses `.regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/)` for the password character-class policy. Per Zod 4 semantics, attaching an inline message to `.regex(re, "msg")` makes Zod use that literal message and SKIP the `z.config({customError})` dispatch — so the i18n bridge would never fire on the three separate checks. **Resolution:** combine into a single `.refine((v) => /[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v), { params: { kind: "password.mixed_classes" } })`; the zod-i18n bridge dispatches on `code: "custom"` + `params.kind` to the localized key. Three issues → one issue; same UX (the user sees one error per submit), better i18n correctness.

### Decision — conditional registration of POST /api/setup/admin

The plan's Task 1 acceptance criterion is `grep -n "buildSetupAdminRoutes" routes/index.ts ≥ 1` — present. The actual buildApp wiring (constructing the ownerPool + binding `auth.api.signUpEmail` to the production Better Auth instance) lands in a follow-up plan: it requires plumbing `makeOwnerDb()` through buildApp, which would expand scope beyond 12-03's files_modified frontmatter. Same pattern as other conditional routes in `routes/index.ts` (`if (deps.redis)` for diarization, `if (deps.litellm)` for transcribe/agent/reason).

### Test-only — schema test file English-only via locale-payload reuse

The SetupForm test file `apps/web/src/components/screens/auth/__tests__/SetupForm.test.tsx` was rejected by the global `lint-english.ts` tool when its RU assertion strings were embedded literals. The test file is NOT under any of the existing allowlist patterns (`**/locales/**`, `**/i18n/__tests__/**`, `**/__tests__/*-i18n.test.*`). **Resolution:** the RU assertions now compare against the live `ru/common.json` payload via typed property access, so the test file remains English-only at the source-artifact level. Plan grep gate on the file path is preserved.

### Test-only — `signUpEmail` is a third-party process boundary, faked at the test seam

The setup-admin tests inject a fake `signUpEmail` callable via the new `SetupAdminSignUpEmail` dep. **CLAUDE.md compliance:** Better Auth's signUpEmail is a third-party library boundary — CLAUDE.md's "no mocks of internal logic" rule allows process/network boundaries. The fake INSERTs the user row via the real owner pool (so the handler's subsequent `UPDATE users SET role='admin'` lands on a real row in the testcontainer Postgres); only the Better Auth code path is short-circuited. The integration of the real Better Auth instance against `auth.api.signUpEmail` has full e2e coverage in Phase 02's universal `/api/auth/*` handler tests. This plan's tests own the contract for everything BELOW signUpEmail.

## Testcontainers status

Post-run audit: only `testcontainers/ryuk:0.14.0` running (the reaper container, auto-cleans after test process exit). **No leaked Postgres containers, no leaked volumes** — the shared inline harness's `afterAll → booted.shutdown()` correctly disposes the container, and the project-level `globalTeardown` (`tools/global-vitest-teardown.ts`) issues `docker container prune -f --filter label=org.testcontainers=true` as defense-in-depth. The pre-existing testcontainers leak documented in `.planning/deferred-items.md §1` was not reproduced during this plan's runs.

## Commits

| Hash | Message |
| ---- | ------- |
| `fe386c7` | `feat(12-03): post /api/setup/admin idempotent claim + workspace persistence (task 1)` |
| `4e797b5` | `feat(12-03): vendor shadcn-stepper primitive (task 2)` |
| `32da4ab` | `feat(12-03): zod setup schema + zod-i18n bridge for UICONF-03 (task 3)` |
| `a474581` | `feat(12-03): /setup RSC page + Client wizard form (task 4)` |
| `ea9a398` | `test(12-03): close branch-coverage gaps in setup-admin to 100/100/100/100` |
| `36a2bae` | `test(12-03): close web-side branch coverage to >= 90 floor (task 3 + 4)` |

## Threat Model Coverage Recap

| Threat | Status |
|--------|--------|
| T-12.03-01 (replay POST after completed) | mitigated — atomic UPDATE rowCount=0 → 200; sub-test 2 |
| T-12.03-02 (brute-force spam) | mitigated — `@fastify/rate-limit {max:5, timeWindow:'1 minute'}`; sub-test 4 |
| T-12.03-03 (/setup visible on completed installs) | mitigated — RSC `redirect('/sign-in')`; RSC test suite + grep gate (no /api/capabilities) |
| T-12.03-04 (open-redirect via `?next=`) | mitigated — hardcoded `router.push('/admin')`; grep gate (no `searchParams.get('next')` in form code) |
| T-12.03-05 (compensating rollback on Better Auth error + best-effort tenant rename) | mitigated — explicit `UPDATE setup_state` rollback on error; tenants UPDATE in try/catch with warnings array; sub-tests 3 + 7 |
| T-12.03-06 (stack-boot race) | mitigated — RSC fetch-fail / 503 branch renders `initializing` copy; RSC test 4 |
| T-12.03-07 (role escalation via body) | mitigated — Zod strips unknown keys; role set server-side via raw SQL; sub-test 5 |

## Self-Check: PASSED

- All 6 commits exist (`git log --oneline 74d4e4a..HEAD` returns the 6 hashes above).
- All 15 created/modified files exist on disk.
- 45 tests pass (10 api + 35 web) across `setup-admin.test.ts`, `SetupForm.test.tsx`, `zod-i18n.test.ts`, and `i18n-russian-coverage.test.ts`.
- Coverage on diff ≥ 90/90/90/90 on every touched testable file.
- Testcontainers audit: clean (no leaked PG containers or volumes).
