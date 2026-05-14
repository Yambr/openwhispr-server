# Phase 12: Admin Onboarding Wizard + UI-SPEC Conformance Audit (v2) - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Discuss mode:** advisor-researched (4 gray areas, all locked to recommended option)

<domain>
## Phase Boundary

A fresh operator goes from `git clone && docker compose up` to a logged-in admin in one wizard pass with zero bcrypt-in-`.env` traps; every auth screen renders only the OIDC providers the operator actually configured; auth surface conforms to `design-canvas.jsx` + `UI-SPEC-end-user.md` + `UI-SPEC-admin.md`.

**In scope:**
- `setup_state` enum state machine (`pending` / `completed` / `skipped_legacy`) in a NEW singleton `setup_state` table — gates `/setup` route, NOT a users-count check.
- `/setup` route at `apps/web/src/app/(public)/setup/page.tsx` — single-page wizard (Identity / Workspace / Review) with shadcn-stepper visual progress.
- Idempotent `POST /api/setup/admin` — atomic `UPDATE setup_state SET status='completed' WHERE id=1 AND status='pending' RETURNING` under PgBouncer transaction-mode.
- `ALTER TABLE users ADD COLUMN role text` + Better Auth `additionalFields.role` extension + v1 backfill to `skipped_legacy`.
- `/admin` Next.js index page (closes TD-12.a 404).
- Public `GET /api/auth/providers` (OIDC providers + emailVerification status) + authed `GET /api/capabilities` (BYOK/SLIM caps for Phase 14).
- Auth screens (`SignInForm`, `SignUpForm`, `OidcButtons`, `VerifyEmailClient`) conditionally render against `/api/auth/providers`.
- Per-field Zod errors localized en+ru.
- SignUpForm duplicate-banner regression fix (exactly one banner element).
- Resend-verification CTA on sign-in 403 screen.
- UI-SPEC conformance suite (Hybrid): Vitest+RTL structural at `apps/web/src/components/__tests__/conformance/` + Playwright `@axe-core/playwright` axe baseline at `tests/conformance/ui-spec/`.
- `@cjm-5.1` + `@cjm-5.3` + `@cjm-1.5` + `@cjm-7.1` + `@cjm-7.2` Gherkin scenarios — currently `@expected-red @after-phase-12`, must flip GREEN at Phase 12 close.

**Out of scope (explicit deferrals):**
- Phase 14 (SLIM core / BYOK profiles) — Phase 12 only adds the authed `/api/capabilities` endpoint shape; the BYOK semantics fill in during Phase 14.
- Phase 13 harness changes — features were authored in Phase 13 with `@expected-red @after-phase-12`; Phase 12 flips them GREEN by shipping the missing surfaces, not by editing the harness.
- Phase 15 (host split, FSL relicense) — `/setup` lives under web app's existing host; no Traefik rules change here.
- Pixel-diff visual snapshots — UI-SPEC conformance is semantic DOM only (UICONF-04 locked).
- Password strength meter (zxcvbn) — Zod policy is sufficient (research-confirmed; UX requirement can revisit).

</domain>

<decisions>
## Implementation Decisions

### setup_state storage (Option A — advisor-recommended)
- **D-01:** **Singleton `setup_state` table in `packages/data/src/schema/`** — `CREATE TABLE setup_state (id SMALLINT PRIMARY KEY CHECK (id=1), status setup_state_status NOT NULL DEFAULT 'pending', completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`. Drizzle `pgEnum('setup_state_status', ['pending','completed','skipped_legacy'])` — typo-loud-fail at PG layer.
- **D-02:** **Operator-global, NOT tenant-scoped, NO RLS attaches** — mirrors the `tenants` root pattern in `packages/data/src/schema/tenants.ts`. Setup is an operator-level event, not a property of any tenant.
- **D-03:** **Idempotency mechanism for `POST /api/setup/admin`** — single-statement `UPDATE setup_state SET status='completed', completed_at=now() WHERE id=1 AND status='pending' RETURNING *`. Atomic under PgBouncer transaction-mode, no advisory locks, no cross-call session state. Concurrent retries collapse to one winner; loser sees `status='completed'` row → returns 200 with the already-created admin (NOT 409).
- **D-04:** **v1 backfill** — migration seeds the single row with `status='skipped_legacy'` IF prior `users` rows exist at migration time, else `status='pending'`. Single additive migration satisfying ADMIN-01 + ADMIN-03; passes `tools/lint-migrations.ts` (no destructive ops, no NOT NULL on populated big tables).
- **D-05:** **Rejected alternatives:** Option B (column on existing tenancy table `tenants`) — muddies operator-global vs per-tenant semantics; would later require a second migration. Option C (Redis NX) — violates Postgres-as-source-of-truth, lost on FLUSHALL, breaks backup/restore.

### Capability discovery endpoints (Option C — advisor-recommended split)
- **D-06:** **Public `GET /api/auth/providers`** — returns `{ providers: [{id, name, enabled}], emailVerification: {required, configured} }`. Lives under Better Auth's `/api/auth/*` namespace; per-IP Better Auth ratelimit applies. `Cache-Control: public, max-age=60` + weak ETag derived from env-hash. Sign-in page calls this at mount; conditionally renders `OidcButtons` (closes TD-12.c).
- **D-07:** **Authed `GET /api/capabilities`** — requires session (`requireSession` preHandler). Returns Phase 14 BYOK/SLIM caps, model catalog, per-tenant quotas. `Cache-Control: private, max-age=30` + ETag keyed on `(tenantId, env-hash)`. Phase 12 scope: ship the endpoint with minimal payload `{ auth: {provider-status snapshot}, features: { transcribe: bool, agent: bool, realtime: bool } }`. Phase 14 grows it additively — no breaking shape change.
- **D-08:** **Provider derivation source-of-truth** — `apps/api/src/auth.ts:109-122` (env-driven Better Auth genericOAuth registration). The public providers endpoint reads the same env-gating logic — zero drift.
- **D-09:** **Error envelope** — `{ error: { code, message, requestId } }` per existing wire convention (BACKEND_SPEC.md is not present in the tree; path unreserved).
- **D-10:** **Rejected alternatives:** Option A (minimal-only) under-serves Phase 14. Option B (broad union public) leaks tenant-shaped data to unauth clients; violates "no workarounds — enterprise-grade only."

### Wizard form UX (Option B — advisor-recommended)
- **D-11:** **Single-page form with shadcn-stepper visual progress** (Identity / Workspace / Review). Honors both ADMIN-02 clauses verbatim ("single-page wizard" + "shadcn Stepper composition"). One RHF form, one Zod schema, one submit → one `POST /api/setup/admin` call.
- **D-12:** **Vendor `shadcn-stepper` community port** into `apps/web/src/components/ui/stepper.tsx` — shadcn/ui has no official Stepper primitive (confirmed via shadcn-ui/ui discussion #1422). MIT/Apache-compatible vendor with SPDX header following existing `ui/*` convention.
- **D-13:** **Timezone picker** — native `Intl.supportedValuesOf('timeZone')` populating a shadcn `Select` (Combobox via `cmdk` if filtering needed). Default preselected from `Intl.DateTimeFormat().resolvedOptions().timeZone`. Zero new deps. Reject `timezone-select-js` (no functional gain).
- **D-14:** **NO password strength meter** in v1. Zod policy enforces min 12 chars + mixed character classes (mirror Better Auth password policy already in `signUpSchema`). UICONF-03 per-field localized error mapping carries the policy message. Reject `zxcvbn` (size-limit budget) and visual bar (canvas does not show it).
- **D-15:** **Idempotent submit** — form disables on submit; concurrent submits resolve to 200 with the already-created admin (per D-03), NOT 409.
- **D-16:** **Mirror existing pattern** — `apps/web/src/components/screens/auth/SignUpForm.tsx` is the RHF7+Zod3+`Form`+`Card` template; wizard reuses idioms wholesale.
- **D-17:** **Rejected alternatives:** Option A (true multi-step wizard) — ~2× form-test surface, harder UICONF-04 conformance, more i18n copy keys. Option C (no Stepper) — violates ADMIN-02 wording.

### UI-SPEC conformance test approach (Option C — advisor-recommended hybrid)
- **D-18:** **Vitest + @testing-library/react structural conformance** at `apps/web/src/components/__tests__/conformance/{SignInForm,SignUpForm,OidcButtons,VerifyEmailClient,setup}.test.tsx`. Asserts presence/order/aria-labels/roles/landmarks/banner-counts vs UI-SPEC.md inventory. Lands inside `pnpm test:unit` → counts toward ≥90/90/90/90 coverage gate on `apps/web/src/**`.
- **D-19:** **Playwright `@axe-core/playwright` axe baseline** at `tests/conformance/ui-spec/axe.spec.ts`. Boots Phase 13 compose harness primitive (`tests/e2e-cjm/support/compose-harness.ts` reused); one test per auth screen + `/setup`. Real Chromium — required for contrast / focus-visible / landmark-unique rules that happy-dom cannot honestly evaluate. Versions locked: `@axe-core/playwright@4.11.2` + `@playwright/test@1.60.0` (Phase 13 lockfile).
- **D-20:** **`design-canvas.jsx` as STATIC oracle** — confirmed via advisor research: 1437-LOC Figma-canvas host (DC = bg/grid/postit wrapper) with inline artboards; NOT mountable production component. The suite walks it as a reference (parse JSX OR hand-derived role/label inventory in `UI-SPEC-end-user.md` / `UI-SPEC-admin.md`), assert presence in the real screens.
- **D-21:** **UICONF-06 specific gate** — `expect(screen.getAllByRole('alert')).toHaveLength(1)` in the SignUpForm conformance test. Closes the duplicate-banner regression.
- **D-22:** **No retry-on-flake** — Phase 13 D-12 lock carries over. axe spec is deterministic on a booted stack.
- **D-23:** **Rejected alternatives:** Option A (standalone Playwright only) — slow, no coverage credit, duplicates compose boot. Option B (Vitest only) — fails UICONF-05 honestly (happy-dom does not implement layout/contrast rules).

### Cross-cutting locks (carried forward from prior phases & PROJECT.md)
- **D-24:** Strict TDD constitutional (CLAUDE.md / PROJECT.md TDD-01b ≥ 90% per-phase coverage on touched files); each fix lands with its tests in the SAME atomic commit.
- **D-25:** English-only source artifacts; runtime UI copy en+ru from day one (Phase 10 lock).
- **D-26:** No mocks of internal logic — DB-touching tests use real Postgres via testcontainers (Phase 13 global-vitest-teardown closes leaks).
- **D-27:** All Phase 12 e2e scenarios MUST flip the existing `@cjm-5.1` + `@cjm-5.3` + `@cjm-1.5` + `@cjm-7.1` + `@cjm-7.2` from `@expected-red @after-phase-12` to GREEN by removing those tags as part of Phase 12 plans (NOT by editing the harness).

### Claude's Discretion
- Exact wizard step-anchor implementation (IntersectionObserver vs scroll-listener) — researcher/planner chooses.
- Whether `/api/capabilities` requires a single endpoint or one-shot batched discovery (still Option C scope) — planner chooses.
- Whether the duplicate-banner fix lives in `SignUpForm.tsx` template OR upstream Form component — researcher inspects.
- Exact axe rule subset for Phase 12 (full axe-core default vs WCAG-2.1-AA-only) — planner chooses; must report ZERO violations whichever is chosen.
- shadcn-stepper exact community port (damianricobelli vs reui.io) — planner picks per Apache/MIT compatibility check.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 12 requirements & roadmap
- `.planning/REQUIREMENTS.md` §ADMIN-01..06 + §UICONF-01..07 — 13 locked requirements for Phase 12 wire shape.
- `.planning/ROADMAP.md` §"Phase 12: Admin Onboarding Wizard + UI-SPEC Conformance Audit (v2)" — goal + 5 success criteria.
- `.planning/TECH_DEBT.md` §TD-12.a..f — the operator-trap inventory this phase closes (admin 404, bcrypt-in-`.env`, OIDC button cascade, design pass, post-state for unverified, bcrypt `$` escape).

### Schema + Better Auth integration
- `packages/data/src/schema/tenants.ts` — root-singleton pattern to mirror for `setup_state` (operator-global, NO RLS).
- `apps/api/src/auth.ts` — Better Auth wiring; `additionalFields.role` extension goes here; `emailVerification.sendVerificationEmail` closure (Phase 13 fix landed in `5c579d3`).
- `apps/api/src/routes/index.ts` — Fastify route registration; conditional-on-env pattern (`lines 119-152, 343-404` per advisor).

### UI surface
- `apps/web/src/app/(public)/` — current public route group (sign-in / sign-up / verify-email). `/setup` lands here.
- `apps/web/src/app/(admin)/admin/` — current admin route group; needs an `page.tsx` index (closes TD-12.a).
- `apps/web/src/components/screens/auth/{SignInForm,SignUpForm,OidcButtons,VerifyEmailClient}.tsx` — conditional rendering against `/api/auth/providers`.
- `apps/web/src/components/screens/auth/__tests__/{SignInForm,SignUpForm,VerifyEmailClient}.test.tsx` — existing Vitest+RTL pattern to extend.
- `apps/web/src/components/ui/` — where the vendored `stepper.tsx` lands.
- `.planning/phases/07-frontend-ui-spec/design/design-canvas.jsx` — STATIC oracle for UICONF-04 (1437 LOC, Figma canvas wrapper).
- `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` — end-user-facing spec for conformance asserts.
- `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` — admin-facing spec for `/setup` + `/admin` conformance asserts.

### CJM scenarios to flip GREEN
- `tests/e2e-cjm/features/admin-onboarding.feature` — `@cjm-5.1` `/admin` reaches a real page; `@cjm-5.3` Wizard happy path.
- `tests/e2e-cjm/features/signup-verify.feature` — `@cjm-1.5` Zero providers → zero social buttons.
- `tests/e2e-cjm/features/oidc-providers.feature` — `@cjm-7.1` Zero providers; `@cjm-7.2` One provider → one button.
- `docs/customer-journeys.md` — sections `§5.1`, `§5.3`, `§1.5`, `§7.1`, `§7.2` are the journey docs; verifier asserts feature↔doc parity (Phase 13 `tools/lint-cjm-doc.ts`).

### Migration / lint gates
- `tools/lint-migrations.ts` — squawk PR gate (Phase 09); 16 rules; `setup_state` migration must pass.
- `packages/email/src/EmailSender.ts` + `apps/worker/src/jobs/email-delivery.ts` — Phase 13 + post-review HI-01 fix (commit `5c579d3`); resend-verification CTA (UICONF-07) wires here.

### Constitutional + cross-phase locks
- `CLAUDE.md` (root + `.planning/`) — strict TDD ≥ 90/90/90/90 on diff; no mocks of internal logic; English-only sources; no `--legacy` workarounds.
- `.planning/PROJECT.md` — 1000-concurrent-user enterprise constraints.
- `.planning/phases/13-e2e-cjm-harness-v2-ships-first/13-CONTEXT.md` §D-12 — no retry-on-flake in CI (carries to Phase 12 conformance lane).

</canonical_refs>

<code_context>
## Reusable Assets & Patterns

### Reusable directly (no changes)
- `apps/web/src/components/screens/auth/SignUpForm.tsx` — RHF7+Zod3+`Form`+`Card` template for the wizard.
- `apps/web/src/components/ui/{form,card,input,select,button}.tsx` — shadcn primitives, all already vendored.
- `apps/api/src/auth.ts` env-driven Better Auth genericOAuth registration block (advisor cites `lines 109-122`) — public `/api/auth/providers` reads the same env.
- `packages/data/src/schema/tenants.ts` — root-singleton pattern (no RLS).
- `tests/e2e-cjm/support/compose-harness.ts` — Phase 13 primitive reused by the axe conformance spec.
- `tools/lint-migrations.ts` + 5 fixtures + 35 vitest tests — Phase 09 squawk gate; `setup_state` migration runs through it.
- `tests/e2e-cjm/features/{admin-onboarding,signup-verify,oidc-providers}.feature` — the 5 `@expected-red @after-phase-12` scenarios that flip GREEN.

### Extend (add minimal surface)
- `packages/data/src/schema/index.ts` — export new `setup_state` table.
- `packages/data/migrations/` — add `NNNN_setup_state.sql` (number per Phase 09 migrations convention).
- `apps/api/src/auth.ts` — add `additionalFields.role` to Better Auth user table extension.
- `apps/api/src/routes/index.ts` — register `GET /api/auth/providers` + `GET /api/capabilities` + `POST /api/setup/admin`.
- `apps/web/src/components/ui/stepper.tsx` — NEW; vendor shadcn community port with SPDX.
- `apps/web/src/app/(public)/setup/page.tsx` — NEW; wizard page.
- `apps/web/src/app/(admin)/admin/page.tsx` — NEW; admin index (closes TD-12.a).
- `apps/web/src/components/screens/auth/{SignInForm,SignUpForm,OidcButtons,VerifyEmailClient}.tsx` — read `/api/auth/providers` at mount; render conditionally.

### Avoid / hands off
- `tests/e2e-cjm/**` harness primitives — Phase 13 territory; Phase 12 only REMOVES `@expected-red @after-phase-12` tags from existing scenarios.
- Better Auth's own `users` / `account` / `session` / `verification` table shape — RESERVED by Better Auth 1.6.9; ADMIN-03 only adds a column via `additionalFields.role` (NOT a direct schema mutation).
- `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx` test that already asserts banner count — extend with conformance test; DO NOT replace.

</code_context>

<deferred_ideas>
## Noted for Later

- `/api/capabilities` BYOK/SLIM payload extension — Phase 14 (`SLIM-01..04`, `BYOK-01..03`). Phase 12 ships the endpoint with minimal payload; Phase 14 grows it additively.
- Password strength meter UX — revisit if a UX requirement lands; current Zod-policy + UICONF-03 localized errors suffices.
- Multi-step wizard variant (Option A) — if onboarding UX research surfaces operator confusion, can refactor Stepper-progress → true multi-step without changing the `/api/setup/admin` contract.
- `design-canvas.jsx` runnable conformance — currently STATIC oracle (Figma canvas wrapper); future phase could mount it as a Storybook artboard if visual regression becomes valuable. Phase 12 keeps it static.
- Email-template "resend verification" copy update — UICONF-07 requires the CTA; copy may benefit from a Phase 18 i18n review pass (not blocking Phase 12).

</deferred_ideas>
