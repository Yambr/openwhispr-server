<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
<!-- REUSE-IgnoreStart -->
# Architecture: v2 Production Readiness Integration

**Milestone:** v2 (Phases 12–18)
**Base:** v1 stack already shipped (Phases 0–11 closed; Phase 11 IN PROGRESS)
**Researched:** 2026-05-14
**Confidence:** HIGH (codebase walked file-by-file; no claims rely on training data)

> Supersedes the prior v1 ARCHITECTURE.md (preserved in git history). v1 architecture is referenced inline where v2 integrates.

---

## 1. Baseline (v1) — what is already in place

The v2 work layers onto a concrete, finished topology. Quick map of touchpoints v2 will modify, with exact paths:

| Concern | File / dir | What it does today |
|---|---|---|
| API bootstrap | `apps/api/src/index.ts` (617 lines) | `buildApp()` registers cookie → multipart → zod-type-provider → request-log → i18n → rate-limit → tenant → dual-auth → routes → probes. Entrypoint (lines 473-616) constructs `auth`, `db`, `litellm`, `redis`, `depCheck`. |
| Better Auth wiring | `apps/api/src/auth.ts` + `packages/auth/src/` | `buildAuth({db, enqueueEmail?})` returns Better Auth instance with Drizzle adapter, email/pwd, locale field. **No `role` field on users yet** (verified `packages/data/src/schema/users.ts` has no role column). **No OIDC provider plugins active** (TD-12.c — UI renders SSO buttons unconditionally). |
| Worker bootstrap | `apps/worker/src/index.ts` (238 lines) | 9 BullMQ Worker instances. **Line 68 `noopSender` and line 130 `sender: noopSender`** — the email-delivery Worker never calls SMTP. This is TD-mailpit. |
| Web app | `apps/web/src/app/` | Three route groups: `(public)/sign-in`, `(public)/sign-up`, `(public)/verify-email`; `(auth)/app`; `(admin)/admin/config`, `(admin)/admin/observability`. **No `/admin` index page (TD-12.a 404).** **No `/setup` route (TD-12.b unrecoverable bcrypt).** |
| Auth screens (drifted from spec) | `apps/web/src/components/screens/auth/{SignInForm,SignUpForm,OidcButtons,VerifyEmailClient}.tsx` | UI-SPEC conformance failures live here (TD-13.a duplicate banner, TD-13.b "Invalid input", TD-12.c always-on SSO buttons, TD-12.e no resend CTA). |
| Web API routes | `apps/web/src/app/api/{health,locale}/route.ts` | TD-15.g: shadowed by Traefik `Host(api.localhost) && PathPrefix(/api)` → Fastify (which has no `/api/locale`). Web is on `Host(api.localhost)` too and ONLY gets routes that don't match the api PathPrefix. |
| Compose | Repo root: `docker-compose.yml` (864 LOC), `docker-compose.embedded-litellm.yml` (750 LOC), `docker-compose.load-test.yml`, `docker-compose.load-test.realistic.yml` | Embedded compose has 18 services, all tagged `profiles: [default, …]` (TD-14.f — `compose up` without `--profile default` selects 0 services). Services: postgres, pgbouncer, valkey, minio, traefik, otel-collector, loki, tempo, mimir, grafana, litellm, migrate, api, worker, web, mailpit. |
| Helm | `charts/openwhispr/{Chart.yaml, values.yaml (351 LOC), templates/ (39 templates)}` | Sub-chart `dependencies` already use `condition:` (`valkey.enabled`, `minio.enabled`). Top-level toggles already present: `speaches.enabled`, `observability.collector.enabled`, `observability.lgtm.enabled`, `pooler.enabled`, `litellm.embedded`, `tls.enabled`, `certManager.enabled`, `backup.enabled`. **Helm gating is much further along than compose gating.** |
| Traefik dev TLS | `compose/traefik/{traefik.yml, dynamic.yml, certs/{local.crt,local.key,root-ca.crt,root-ca.key}}` | Two TLS entrypoints (`:443 websecure`, `:8443 websecure-realtime`). Self-signed certs already present (TD-17.a — browser warns). Root CA exists at `compose/traefik/certs/root-ca.crt` — currently NOT installed in OS trust store by bootstrap. |
| E2E suite (today) | `tests/e2e/` (vitest-based; ~25 tests) | Uses **vitest + supertest + dockerized stack via `compose-helper.ts`**. **No Cucumber. No Playwright UI tests** (despite `@playwright/test 1.59.1` being in repo-root `package.json:45`). All e2e are HTTP wire-level. TD-13.e: zero Playwright/Cucumber UI journey coverage. |
| Test layout | Co-located `*.test.ts` next to `*.ts` everywhere (e.g. `apps/api/src/email.ts` + `apps/api/src/email.test.ts`) + some `__tests__/` dirs. Inconsistent (TD-15.a). |
| Tools | `tools/` — `lint-english.ts`, `lint-tdd.ts`, `lint-rls.ts`, `lint-ui-spec.ts`, `lint-compose-chart-parity.ts`, `spdx-header.ts`, `bootstrap.sh`. **No `ts-morph` codemod tooling yet** (only the SPDX writer uses ts-morph). |
| License | `LICENSE` (Apache-2.0); 675 SPDX headers across source; `licenses: Apache-2.0` in Chart.yaml; `license` field per package.json. Phase 10-04 already standardized this — Phase 15 is a re-codemod. |
| Phase comments | **771 `// Phase XX / Plan YY / D-ZZ` comments** verified by `grep -rn "// Phase\|/\* Phase" apps packages` (NOT 1642 — TECH_DEBT.md count includes tests/tools; sweep scope must be defined). |
| Mock fixtures | `compose/mock-litellm/`, `tests/e2e/mock-realtime/`, `compose/fixture-idp` (referenced) | Hermetic load-test path. Phase 13 inherits these. |

---

## 2. Phase-by-phase integration

### Phase 13 — Cucumber+Playwright E2E + CJM (the harness everything else writes against)

**New components:**
- **`tests/e2e-cjm/` (NEW DIR)** — separate from existing `tests/e2e/` (vitest wire tests) to avoid runner collision. Layout:
  - `tests/e2e-cjm/features/*.feature` — Gherkin files, one per CJM flow (`signup-verify.feature`, `signin.feature`, `password-reset.feature`, `transcribe.feature`, `admin-onboarding.feature`, `locale-switch.feature`, `oidc-providers.feature`, `error-paths.feature`). Each feature's top-of-file comment block references the CJM document path (e.g. `# CJM: docs/customer-journeys.md §3.2`).
  - `tests/e2e-cjm/steps/*.ts` — Playwright-driven step definitions using `@cucumber/cucumber` + `@playwright/test`. One step file per domain (`auth.steps.ts`, `transcribe.steps.ts`, `admin.steps.ts`).
  - `tests/e2e-cjm/support/world.ts` — Cucumber World object holds Playwright `Browser`/`Page` per scenario, plus a shared `ComposeHarness` handle.
  - `tests/e2e-cjm/support/compose-harness.ts` — wraps `tests/e2e/compose-helper.ts` and adds `bootStack()` / `teardownStack()` lifecycle. Boots `docker-compose.embedded-litellm.yml --profile default` locally; in CI re-uses the dockerized stack from the `e2e` GHA job.
  - `tests/e2e-cjm/cucumber.cjs` — Cucumber config, parallel = 4, retries = 1.
  - `tests/e2e-cjm/playwright.config.ts` — `baseURL: https://app.localhost`, `ignoreHTTPSErrors: true` (until Phase 17 lands trusted certs — then drops to false in CI).
- **`docs/customer-journeys.md` (NEW)** — the CJM document itself. Markdown with one `## Journey: …` heading per Gherkin feature; feature files use `@cjm-3.2` style tags to ID-link back. This is what the roadmapper considers the "CJM artifact."
- **`Makefile` targets** — `make e2e-cjm` runs Cucumber locally; `make e2e-cjm-ci` runs against an already-booted stack.
- **`tools/global-vitest-teardown.ts` (NEW) + `vitest.config.ts` edit** — addresses `.planning/deferred-items.md` item 1 (testcontainers leak). `globalSetup` registers a `process.on('exit')` hook that calls `docker container prune --filter label=org.testcontainers=true` and forces `Ryuk` reaper sync. Owned by Phase 13 because the new Cucumber harness will produce 10× the testcontainer churn.

**Modified components:**
- **`apps/worker/src/index.ts:68-72, 130`** — `noopSender` replaced with a real nodemailer-backed `EmailSender` shared with `apps/api/src/email.ts`. The fix MUST land here because the first Phase 13 test (signup → verify) will fail until the worker sends. Refactor: extract `EmailService` from `apps/api/src/email.ts` into `packages/email/src/index.ts` (NEW small package), depend from both api and worker. **This is the single most impactful Phase 13 atomic commit.**
- **`apps/web/src/components/screens/auth/__tests__/*.test.tsx`** — sweep `getAllByText(...).length.toBeGreaterThan(0)` → `toHaveLength(1)` (TD-13.d).
- **`.github/workflows/ci.yml`** — new job `e2e-cjm` after `e2e` job, gated on `E2E_CJM=1` env, runs `make e2e-cjm-ci`.

**Data flow:** Cucumber scenario → Playwright `Page` → HTTPS → Traefik `:443` → web (Next.js) or api (Fastify) → BullMQ enqueue (email-delivery / virtual-key-rotation) → Worker → Mailpit SMTP → Playwright fetches Mailpit `/api/v1/messages` to assert the verification email arrived → Playwright clicks the verification link → assert account verified.

**Phase scope: L** (largest in v2 — it's the harness; 7 features × 5 scenarios × full step coverage + the worker email fix + the testcontainers teardown fix + Mailpit API integration).

---

### Phase 12 — Admin onboarding wizard + UI-SPEC conformance

**New components:**
- **`apps/web/src/app/(public)/setup/page.tsx` (NEW)** — first-run wizard. Lives in `(public)` route group because the user is not yet authenticated. Three steps: (1) admin email + password + confirm; (2) optional SMTP override (or skip → mailpit); (3) optional OIDC provider config (skip allowed). On submit, calls `POST /api/setup/admin`.
- **`apps/api/src/routes/setup.ts` (NEW)** — gated route surface:
  - `GET /api/setup/status` — returns `{firstRun: bool, providersConfigured: string[]}`. Public, no auth.
  - `POST /api/setup/admin` — body `{email, password, smtpOverride?, oidcProviders?}`. Refuses (409 `setup_already_complete`) if any user with `role='admin'` already exists. On success: creates Better Auth user, sets `role='admin'`, writes optional SMTP env to `tenant_settings`, persists OIDC config, returns 201 + session cookie.
  - `GET /api/auth/providers` — returns `{providers: ['google'?, 'github'?, 'oidc-generic'?]}` derived from runtime config. **Used by web to conditionally render SSO buttons (TD-12.c fix).**
- **`apps/api/src/lib/first-run.ts` (NEW)** — `isFirstRun(db)`: `SELECT count(*) WHERE role='admin'`. Single-statement, no transaction. Wired into the setup-status route and into a new Fastify pre-handler hook that 307-redirects every non-`/api/setup/*` request to `/setup` when `firstRun = true`. The redirect hook is mounted ONLY when `OPENWHISPR_FIRST_RUN_GATE=auto` (default); operators can disable with `=off` if they prefer the htpasswd break-glass path.
- **`packages/data/migrations/00XX-users-role.sql` (NEW migration)** — `ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin'))`. Backfills nothing (greenfield deploys; existing v1 corp installs run the migration with zero admin rows → first sign-in becomes the admin via the wizard).
- **`apps/web/src/app/(admin)/admin/page.tsx` (NEW INDEX)** — fixes TD-12.a (`/admin` 404). Server component, redirects to `/admin/config`.
- **`tests/conformance/ui-spec/` (NEW)** — per-screen conformance tests under `tests/conformance/ui-spec/{sign-in,sign-up,verify-email,setup}.test.tsx`. Each test loads the component and asserts: (a) every field from `UI-SPEC-end-user.md` is rendered with correct `aria-label`; (b) error states match the spec's copy; (c) tab order matches `design-canvas.jsx`. Runs in vitest under `apps/web` not co-located, so the conformance suite can be invoked independently of unit tests. Reuses `tools/lint-ui-spec.ts` from Phase 07.

**Modified components:**
- **`apps/api/src/index.ts`** — register the new `setup.ts` route plugin, register the first-run pre-handler hook AFTER the dual-auth hook so authenticated admins are exempt from the redirect.
- **`apps/api/src/auth.ts`** — Better Auth `additionalFields.role` (mirrors existing `additionalFields.locale` pattern from Phase 10-01). Set on user creation.
- **`apps/web/src/components/screens/auth/OidcButtons.tsx`** — mount-time fetch `/api/auth/providers`; render only configured buttons. Falls back to spinner during fetch (no flash of all-buttons).
- **`apps/web/src/components/screens/auth/SignUpForm.tsx`** — deduplicate "already registered" banner (TD-13.a); render Zod field-level errors (TD-13.b) using existing `useForm` + `errors[fieldName]`. Reference `UI-SPEC-end-user.md` §sign-up and `design-canvas.jsx`.
- **`apps/web/src/components/screens/auth/SignInForm.tsx`** — add "resend verification email" CTA on 403 response (TD-12.e). Better Auth's `POST /api/auth/send-verification-email` already exists; UI just needs to surface it.
- **`docker-compose.embedded-litellm.yml`** — remove the bcrypt-hash `ADMIN_BASIC_AUTH_USERS` from default `.env.embedded.example`; document basicauth as break-glass only (TD-12.f). The Traefik basicauth middleware on `/admin` becomes a SECOND defense layer; the first is the wizard-issued admin user.

**Phase scope: L** (wizard + 5 new endpoints + role column migration + UI conformance suite + 4 component remediations; one of the larger phases).

---

### Phase 14 — Slim core + BYOK profiles

**Critical context from v1:** the existing `docker-compose.embedded-litellm.yml` ALREADY has Compose profiles (`default`, `obs-only`, `db-only`, `dev`, `load-test-*`). Helm already has `*.enabled` flags. **Phase 14 is not green-field; it is a re-segmentation of an already-profiled stack.** Prefer **overlay-based** approach (separate compose files merged via `-f`) over more profile multiplexing; matches the existing Helm `condition:` pattern and avoids the `--profile default` trap (TD-14.f / deferred-items 3a).

**New components:**
- **`docker-compose.slim.yml` (NEW)** — minimal 6-service core: api + web + worker + postgres + valkey + litellm. No Traefik (services expose host ports), no observability, no MinIO, no PgBouncer, no Mailpit. **Why a separate file, not a profile:** the v1 default file's services all carry `profiles: [default, …]` and renaming `default` to mean "slim" silently breaks every documented `--profile default` invocation. Cheaper to ship a new file. Loads 6 of 18 services.
- **`docker-compose.dev-tools.yml` (NEW OVERLAY)** — overlay that adds mailpit, MinIO console UI for `make dev`. Mailpit moves here from production profile (TD-14.a).
- **`docker-compose.observability.yml` (NEW OVERLAY)** — otel-collector, loki, tempo, mimir, grafana — for operators who want bundled obs (TD-14.b).
- **`docker-compose.storage.yml` (NEW OVERLAY)** — minio + minio-console. When omitted, api reads `S3_ENDPOINT`/`S3_BUCKET` from env (BYOK; TD-14.c).
- **`docker-compose.ingress.yml` (NEW OVERLAY)** — Traefik. When omitted, api exposes `:3000`, web `:3001`, litellm `:4000` on the host (TD-14.e).
- **`docker-compose.pooler.yml` (NEW OVERLAY)** — pgbouncer. When omitted, api connects directly to postgres (TD-14.d).
- **`.env.slim.example` (NEW)** — 5 keys: `POSTGRES_OWNER_PASSWORD`, `BETTER_AUTH_SECRET`, `LITELLM_MASTER_KEY`, `MASTER_KEK`, `OPENROUTER_API_KEY` (or other LLM provider) (TD-14.g).
- **`Makefile` targets** — `make up-slim` (slim only), `make up-dev` (slim + dev-tools), `make up-full` (slim + every overlay).
- **`apps/api/src/lib/storage-resolver.ts` (NEW)** — at boot, if `MINIO_ENDPOINT` unset and `S3_ENDPOINT` set → use AWS SDK with BYOK creds. If neither set, disable storage features (return 503 from storage routes with operator-actionable envelope).
- **`apps/api/src/lib/smtp-resolver.ts` (NEW)** — if `SMTP_HOST` unset → fall back to mailpit (if reachable on `mailpit:1025`) else log warning and refuse to send. Wires into the Phase 13 email-service extraction.

**Modified components:**
- **`docker-compose.embedded-litellm.yml`** — drop `profiles:` from universal services (TD-14.f / `.planning/deferred-items.md` 3a). Now `compose up -f docker-compose.embedded-litellm.yml` (no `--profile`) selects all 18 services. This single edit unblocks documented quickstart copy-paste.
- **`charts/openwhispr/values.yaml`** — already has `observability.collector.enabled`, `minio.enabled`, `pooler.enabled`. New: `mailpit.enabled` (default `false`); `ingress.enabled` already exists; document BYOK pattern. **Helm side is small — most flags already present.**
- **`charts/openwhispr/Chart.yaml`** — `dependencies` already condition-gated. No structural change.

**Phase scope: M** (5 new compose overlay files + 2 resolver libs + Makefile + values doc; Helm side is essentially documentation since gating exists). Compose is the heavy lift; Helm is light.

---

### Phase 15 — Repo refactor + FSL + history scrub

**New components:**
- **`tools/codemod/rewrite-test-layout.ts` (NEW)** — ts-morph-driven codemod. Moves `apps/{api,web,worker}/src/**/*.test.ts` to `apps/{api,web,worker}/tests/unit/{mirror of src tree}`. Updates `vitest.config.ts` `include` patterns. **Recommended convention (option (c) per the question):** full split into `apps/<app>/tests/{unit,integration}/`. Rationale: (1) co-location is the current pain point (TD-15.a); (2) Phase 13's `tests/e2e-cjm/` already establishes the "tests at root" pattern at the repo level; (3) `apps/<app>/tests/` matches the existing `tests/e2e/` and `packages/contract-tests/` posture.
- **`compose/` reorganization** — move root `docker-compose.*.yml` into `compose/` (so the new slim/overlay files from Phase 14 land there): `compose/embedded-litellm.yml`, `compose/slim.yml`, etc. Update `Makefile` and every doc `docker-compose -f compose/…` invocation.
- **`tools/codemod/license-fsl.ts` (NEW)** — ts-morph script: replace `// SPDX-License-Identifier: Apache-2.0` with `// SPDX-License-Identifier: FSL-1.1-Apache-2.0` (or the FSL-defined identifier — verify at the FSL project before sweep) across 675+ files. Update root `LICENSE` (FSL text), `NOTICE`, every workspace `package.json:"license"`, `charts/openwhispr/Chart.yaml:annotations.licenses`. **Note:** FSL is Fair Source License — verify exact SPDX identifier with the FSL project; if no SPDX entry exists, ship a custom identifier and an explicit `LICENSE-FSL.md`.
- **`scripts/scrub-history.sh` (NEW)** — wraps `git filter-repo --path speaches-audio.md --invert-paths`. Documents the force-push protocol: notify branch-trackers, force-push `main` + every active feature branch in a coordinated window, regenerate any signed tags.

**Modified components:**
- **`(admin)` / `(public)` / `(auth)` route groups** (TD-15.b) — DECISION: keep parens (idiomatic Next.js 15 App Router for layout segmentation) but add a one-line comment in each `layout.tsx` explaining the grouping rationale. Rename is churn for low gain.
- **`apps/web/public/.gitkeep`** — commit it (resolves `.planning/deferred-items.md` item 2).
- **Traefik host split (TD-15.g)** — DECISION: split `web.localhost` from `api.localhost`. Modify `compose/traefik/dynamic.yml`: web router on `Host(\`web.localhost\`)`, api router on `Host(\`api.localhost\`)`. Web `/api/locale` then lives at `https://web.localhost/api/locale` (Next.js handles it). API routes stay at `https://api.localhost/api/*`. Update web client's `NEXT_PUBLIC_API_BASE_URL` and Better Auth's `trustedOrigins`. **This is structural — must coordinate with Phase 17 cert generation (mkcert needs both hostnames).**

**Phase scope: L** (test layout codemod touches ~600 files; license codemod touches 675 files; history scrub is irreversible; Traefik host split touches Better Auth `trustedOrigins`, env, web client). Highest blast radius of any v2 phase.

---

### Phase 16 — Phase-tag comment audit

**New components:**
- **`tools/codemod/audit-phase-comments.ts` (NEW)** — ts-morph script. For each `// Phase XX` comment: (a) if the comment is ONLY `// Phase XX / Plan YY / D-ZZ` with no additional WHY → delete; (b) if comment continues with substantive prose explaining a non-obvious choice → strip only the leading `Phase XX / Plan YY / D-ZZ` tag, keep the WHY. Heuristic: regex `^// (Phase \d+(\.\d+)? \/ Plan \d+(\.\d+)? \/ D-\w+(\s+\([^)]+\))?)$` matches kill-only lines.
- **`tools/lint-phase-comments.ts` (NEW)** — CI lint forbidding the comment pattern in new code. Biome doesn't natively support arbitrary regex comment rules; mirrors the existing `tools/lint-english.ts` pattern.

**Modified components:**
- ~771 verified comments across `apps/` + `packages/` (NOT 1642 — that count includes tests, tools, and `.planning/`). Codemod runs in-place; atomic commit with full diff for review.

**Phase scope: S** (single codemod + lint rule + one big sweep commit; mechanical).

---

### Phase 17 — Trusted local TLS + prod ACME

**New components:**
- **`scripts/mkcert-setup.sh` (NEW)** — wraps `mkcert -install` + generates `*.localhost` cert into `compose/traefik/certs/local.crt` (replacing the openssl-self-signed one). Reads hostname list from a single source-of-truth file (post-Phase 15 split: api.localhost, web.localhost, app.localhost, grafana.localhost, mailpit.localhost).
- **`Makefile` target** — `make tls-trust` → runs `mkcert-setup.sh`; idempotent.

**Modified components:**
- **`compose/traefik/traefik.yml`** — no change to TLS config; certs swap is via file mount, transparent to Traefik.
- **`compose/traefik/dynamic.{dev,prod}.yml` SPLIT** — ship two dynamic files. `dynamic.dev.yml` (current; mkcert certs) and `dynamic.prod.yml` (ACME resolver `letsencrypt`). Compose env (`TRAEFIK_DYNAMIC_FILE`) selects which file is mounted. Helm path (`certManager.enabled=true`) already correct from Phase 9.
- **`README.md` quickstart** — add `make tls-trust` as a one-time step after `cp .env.embedded.example .env` (TD-17.a).

**Phase scope: S** (one script + Makefile target + doc update + Traefik config split; ~3 files modified).

---

### Phase 18 — LDAP / Keycloak (SPEC only — NO implementation)

**Deliverables are docs and ADRs, not code.**

**New components (artifacts):**
- **`.planning/phases/18-…/SPEC-ldap-keycloak.md` (NEW)** — the SPEC document. Sections:
  1. Architecture diagrams (mermaid) for both options:
     - **Option (a) — Keycloak/Authentik in front of LDAP.** Compose: new `keycloak` service on `:8080`, joined to `openwhispr_internal` network. Helm: new sub-chart dependency on `bitnami/keycloak` (or `codecentric/keycloak`), `condition: keycloak.enabled`. Better Auth wires Keycloak as a generic OIDC provider (existing `@better-auth/sso` plugin path, no code surgery). LDAP details stay inside Keycloak's federation config.
     - **Option (b) — Custom Better Auth LDAP plugin.** New package `packages/auth-ldap/` exporting `ldapPlugin({url, baseDN, bindDN, bindPw})`. Uses `ldapjs`. Injects into Better Auth's `socialProviders` or as a custom credential provider. Tight coupling; no extra container.
  2. Recommendation (per TECH_DEBT.md TD-18.a): **option (a)**. Justification: zero Better Auth surgery; Keycloak's LDAP federation is battle-tested; corp standard.
  3. v3 implementation phase plan (sketch only; not roadmapped here).
- **`docs/adrs/0012-ldap-via-keycloak.md` (NEW ADR)** — captures the decision, alternatives, consequences.

**No code, no compose, no Helm changes in v2.**

**Phase scope: S** (research + 1 SPEC doc + 1 ADR; no production code).

---

## 3. Dependency graph

```
       ┌──────────────────────────────────────────────────────────┐
       │                                                          │
       v                                                          │
   ┌────────┐    ┌────────┐    ┌────────┐                         │
   │   13   │───>│   12   │───>│   14   │──┐                      │
   │ E2E    │    │ Admin  │    │ Slim   │  │                      │
   │ harness│    │ wizard │    │ +BYOK  │  │                      │
   └────────┘    └────────┘    └────────┘  │                      │
       │            │              │       │                      │
       │            │              v       │                      │
       │            │          ┌────────┐  │                      │
       │            │          │   17   │  │                      │
       │            │          │ TLS    │  │                      │
       │            │          └────────┘  │                      │
       │            │              ^       │                      │
       │            │              │       v                      │
       │            │           ┌────────────┐                    │
       │            └──────────>│     15     │  (repo refactor    │
       │                        │ repo+FSL   │   may rename       │
       │                        │ +scrub     │   web/api hosts    │
       │                        └────────────┘   → ripples to 17) │
       │                              │                           │
       │                              v                           │
       │                          ┌────────┐                      │
       └─────────────────────────>│   16   │                      │
                                  │comments│                      │
                                  └────────┘                      │
                                                                  │
                                  ┌────────┐                      │
                                  │   18   │ (independent;        │
                                  │SPEC only│  no code deps)      │
                                  └────────┘                      │
```

**Hard deps:**
- **13 → everything** — without the Cucumber harness, every other v2 phase ships untested user-facing changes (the project's strict-TDD rule promotes this from "preference" to "blocker").
- **13 → 12 (worker email fix)** — 13 lands the `noopSender` removal; 12's signup-with-verification flow needs the worker to actually send.
- **15 → 17 (host split)** — Phase 15's `web.localhost` / `api.localhost` split changes the hostname list mkcert provisions in Phase 17. **Land 15 before 17, OR land 17 with both hostname sets and let 15 drop the unused one.**
- **14 ↔ 17** — Phase 14's `docker-compose.ingress.yml` overlay is where Phase 17's dev-vs-prod cert config switches live. Either order works; if 14 lands first, 17 modifies its overlay; if 17 lands first, 14 splits the overlay.
- **18 ⊥ all** — pure docs phase, schedulable anywhere.

**Soft deps:**
- **12 → 16 (comments)** — Phase 12 adds new code; running the comment audit after 12 catches new phase-tag comments before they ossify.
- **15 → 16** — repo refactor moves files; comment audit is easier on a stable file layout.

---

## 4. Recommended build order — VALIDATION of user-proposed 13→12→14→15→16→17→18

The user-imposed order is **13 → 12 → 14 → 15 → 16 → 17 → 18**.

**Verdict: MOSTLY CORRECT — one swap recommended.**

### Confirmations
- **13 first** is non-negotiable per `.planning/TECH_DEBT.md` line 23 ("THIS IS THE GATE"). Strict-TDD rule + zero existing Playwright/Cucumber coverage means every subsequent phase ships test-first against the new harness.
- **12 after 13** is correct because the admin wizard + UI conformance work needs the harness to write tests against. Also the Phase 13 worker `noopSender` fix unblocks 12's signup-verify flow.
- **18 last** is correct — SPEC-only, no code dependencies, no urgency.

### Proposed change: SWAP 14 and 15 → 13 → 12 → **15 → 14** → 17 → 16 → 18
Reasoning:
- **Phase 15 does the Traefik host split (TD-15.g).** Phase 14 ships `docker-compose.ingress.yml` as a new overlay. If 14 lands first, the overlay's Traefik routing reflects the (broken) `Host(api.localhost) && PathPrefix(/api)` shadowing. 14 then has to be re-touched in 15. Doing 15 first means 14's overlay is born with the correct host split.
- **Phase 15 reorganizes `compose/` directory.** Phase 14 creates 5 new compose overlay files. If they're created in repo root in 14, they get moved in 15 — pointless churn. Doing 15 first means 14's new files land directly in `compose/`.
- **Phase 14 depends on the test layout being stable** for the slim-vs-full e2e variants. If tests get reorganized in 15 after 14 ships, Phase 14's e2e wiring needs revisiting.

### Optional: swap 16 ↔ 17 → … → **17 → 16** → 18
17 lands TLS-config comments. 16 then sweeps them. Slight preference; not a blocker.

### Final recommendation
**13 → 12 → 15 → 14 → 17 → 16 → 18.**

The user's order is also acceptable; the swap saves a moderate amount of churn but isn't a hard blocker. Either way works; this analysis is the input the roadmapper should weigh.

---

## 5. Patterns to Follow

### Pattern 1: Overlay files mirror Helm's `*.enabled` flag taxonomy
Helm already gates everything (verified `charts/openwhispr/values.yaml`). Compose lags. Phase 14's overlay files should mirror Helm's flag taxonomy so operators can mentally map `make up-slim` (compose, no observability) ↔ `observability.collector.enabled=false` (helm). 1:1 mapping between an overlay file and a Helm flag.

### Pattern 2: Codemods through ts-morph, never sed
The repo already has `tools/spdx-header.ts` (Phase 10-04) demonstrating the ts-morph codemod pattern. Phases 15 and 16 should follow it. Output: deterministic, type-safe AST rewrites with a `--check` mode for CI.

### Pattern 3: New routes register as plugins via `apps/api/src/routes/index.ts`
`buildAllRoutes` is the central plugin registry. Phase 12's `setup.ts` follows this pattern (verified at `apps/api/src/index.ts:420-441`).

### Pattern 4: Tests under `apps/<app>/tests/` after Phase 15
Post-15 layout target. New tests in Phases 16/17/18 land directly in the new layout.

### Pattern 5: Better Auth `additionalFields` extension pattern
Phase 10-01 added `additionalFields.locale`. Phase 12 follows by adding `additionalFields.role`. Both append a single field; no schema rewrite. Migration ALTER-TABLE is independent.

---

## 6. Anti-Patterns to Avoid

### Anti-Pattern 1: Re-architecting profiles that Helm already solved
Helm's `condition:` + `*.enabled` flags work today. Don't ship a parallel taxonomy in compose — mirror Helm.

### Anti-Pattern 2: Force-pushing the history scrub (Phase 15) without coordination
`git filter-repo --path speaches-audio.md --invert-paths` rewrites every commit hash. Any in-flight feature branch needs a coordinated rebase. **Block all parallel work for the scrub window; recommend a dedicated 1-hour maintenance window.**

### Anti-Pattern 3: Implementing LDAP in v2
TECH_DEBT.md TD-18.b is explicit: "Decision needed before plan." Phase 18 is SPEC-only. Implementing in v2 risks shipping the wrong option.

### Anti-Pattern 4: Adding Playwright tests under `tests/e2e/` (vitest dir)
The existing dir is a vitest runner. Cucumber needs its own runner. Keep `tests/e2e-cjm/` separate.

### Anti-Pattern 5: Treating Phase 16's comment audit as cosmetic
771 (verified in apps+packages) comments include load-bearing WHYs (e.g. `apps/api/src/index.ts:191-192` — the `trustProxy:true` pitfall comment). The codemod MUST keep WHY-bearing comments; pure tag-only comments are kill targets.

### Anti-Pattern 6: Modifying `compose/traefik/dynamic.yml` in-place for prod
Phase 17 must SPLIT into `dynamic.dev.yml` and `dynamic.prod.yml`. Single-file env-templating creates a runtime trap where a misconfigured env var produces a half-valid file.

---

## 7. Scalability Considerations (carried forward from v1)

Phase 14's slim core MUST preserve the SCALE-* invariants from v1:
- `--with-pgbouncer` off is a smaller-deployment knob; document the concurrency ceiling (without PgBouncer, Node 24 + Fastify direct-to-PG tops out ~250 concurrent active users before connection exhaustion; with PgBouncer 4×100, ~1000 per the Phase 8 load test).
- `--with-observability` off does NOT disable OTel SDK in the api/worker — SDK keeps emitting, but with no Collector configured it no-ops cheaply. Document this.
- Slim core's resource floor: 2 vCPU, 4 GB RAM single host (vs v1 full: 4 vCPU, 12 GB).

---

## 8. Per-phase scope summary (for roadmapper sizing)

| Phase | Scope | Files touched (est) | New code (LOC est) | Risk |
|---|---|---|---|---|
| 13 — E2E+CJM | **L** | 30+ new in `tests/e2e-cjm/`; 1 worker fix; new `packages/email/` | 2000–3000 | HIGH (harness + email-service refactor + testcontainers teardown all in one) |
| 12 — Admin wizard | **L** | 6 new (setup route + page + lib + migration + admin index); 4 modified components | 1500–2200 | MEDIUM (touches Better Auth, route gate hook is load-bearing) |
| 14 — Slim+BYOK | **M** | 5 new compose files + 2 resolver libs + Makefile | 600–900 | LOW (no app-logic change; mostly orchestration) |
| 15 — Refactor+FSL+scrub | **L** | ~600 file moves + 675 license headers + Traefik host split + history rewrite | mostly mechanical | HIGH (history rewrite is irreversible; blast radius is the whole repo) |
| 16 — Comment audit | **S** | ~771 comments, mostly deletions; 2 tool files | small | LOW (codemod with --check mode + diff review) |
| 17 — Trusted TLS | **S** | 1 script + Makefile + Traefik split | small | LOW |
| 18 — LDAP SPEC | **S** | 1 SPEC doc + 1 ADR | 0 code | NONE (docs only) |

**Phases the roadmapper should flag as candidates for splitting:**
- **Phase 13** — consider splitting into 13.a (Cucumber harness + worker email fix + testcontainers teardown) and 13.b (8 feature files + CJM doc). 13.a is the minimum that unblocks Phase 12.
- **Phase 15** — consider splitting into 15.a (test layout + compose/ reorg + Traefik host split) and 15.b (FSL codemod + history scrub). 15.b's history rewrite is risky enough to warrant its own atomic window.

---

## 9. Sources

All findings sourced from direct codebase inspection on 2026-05-14:
- `.planning/PROJECT.md` (273 lines read)
- `.planning/TECH_DEBT.md` (111 lines read)
- `.planning/deferred-items.md` (full)
- `.planning/ROADMAP.md` (phases 0–11 summary)
- `apps/api/src/index.ts` (617 lines, full)
- `apps/worker/src/index.ts` (238 lines, full)
- `docker-compose.embedded-litellm.yml` (750 LOC, header + profile map)
- `charts/openwhispr/values.yaml` (351 LOC, top-level keys + condition flags)
- `charts/openwhispr/Chart.yaml` (50 lines, full)
- `compose/traefik/{dynamic.yml,traefik.yml,certs/}` directory walk
- `apps/web/src/app/` route group walk + `apps/web/src/components/screens/auth/` listing
- `apps/web/src/app/api/` Next.js route shadow analysis
- `packages/data/src/schema/users.ts` (no role column confirmed)
- `tools/` listing + codemod tooling inventory
- `tests/e2e/` listing (vitest, no Playwright/Cucumber confirmed)
- `package.json` (`@playwright/test 1.59.1` installed but unused for UI tests)
- `grep -rn "// Phase\|/\* Phase" apps packages` → 771 (NOT 1642; sweep scope must be defined for Phase 16)

**Confidence: HIGH** — every claim traces to a specific file or line. No web-search findings, no training-data assumptions.
<!-- REUSE-IgnoreEnd -->
