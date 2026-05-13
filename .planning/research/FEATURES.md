# Feature Research — v2 Production Readiness

**Domain:** Enterprise self-hosted backend (OSS) — production-readiness milestone
**Researched:** 2026-05-14
**Confidence:** MEDIUM-HIGH (Phases 13/12/14/17 backed by official docs and well-known self-hosted product playbooks — Supabase, Plausible, Mattermost, Discourse, Outline, Sentry. Phase 18 LOWER because corp-SSO patterns vary by buyer; we lean on the dominant Keycloak-as-OIDC-frontend pattern.)

**Scope guard.** This document only addresses v2 production-readiness gaps. v1 features (BACKEND_SPEC wire surface, Better Auth email+pw, OIDC adapter, RLS multi-tenancy, BullMQ, LiteLLM bundle, Helm, LGTM, i18n en+ru, k6 load test, Speaches profile) are **already shipped** and are not re-researched. The "table stakes" lists below are scoped per v2 phase, not for a greenfield product. This file supersedes the v1 FEATURES.md (v1 history preserved in git).

---

## Phase 13 — Cucumber + Playwright E2E + CJM Discovery

### Framing — What is a "Customer Journey Map" in BDD practice

A CJM in BDD is the **catalog of end-to-end user journeys** the product promises to support, written as Gherkin `Feature` files where each `Scenario` is one user-visible outcome (signup→verify→sign-in→transcribe, OIDC sign-in, locale switch, password reset, etc.). The CJM is the document; the `.feature` files are its executable form. The discipline: **every user-visible route ships at least one scenario; every CTA on every state ships at least one step.** This is the "harness every subsequent phase writes test-first against" framing the milestone takes (PROJECT.md core value).

The dominant industry pattern for enterprise SaaS, validated in the dev.to/akdevcraft writeup and the makerkit.dev SaaS guide, is **10–20 critical-path scenarios** covering "the flows that, if broken, would prevent users from using or paying for your service." For OpenWhispr v2 we have a richer surface (transcribe, reason, streaming, admin) so the floor is higher — ~20 features × 2-3 scenarios each.

### Table Stakes (must-have for v2 Phase 13)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cucumber.js + Playwright wired into `apps/web` and a top-level `tests/e2e/` | v1 has only k6 perf + Playwright DOM tests; no Gherkin BDD layer; this IS the harness | M | Use `@cucumber/cucumber` 11.x + `playwright-bdd` (or hand-rolled `World` class); colocate step defs under `tests/e2e/steps/`; gated by `E2E=1` env (CLAUDE.md rule); `make e2e-test` target |
| CJM document at `.planning/research/CJM.md` enumerating ~20 journeys | Without enumeration, "coverage" is unmeasurable; gate criterion = "every CJM journey has a green scenario" | S | Format: ID + persona + preconditions + steps + success criteria; map 1:1 to `.feature` files; cross-reference with `apps/web/src/app/**/page.tsx` routes |
| 8 mandatory auth-flow scenarios (signup, email-verify, sign-in success, sign-in 403 unverified, password reset, sign-out, OIDC success, OIDC mis-config) | TD-13.a/b/c/d/e all live here; dominant bug surface from 2026-05-14 walkthrough | M-L | Each scenario boots the full `docker-compose.embedded-litellm.yml` stack + mailpit; uses mailpit HTTP API (`http://mailpit:8025/api/v1/messages`) to read verification emails — no real SMTP, no flaky email provider; cf. Plausible's mailpit-in-tests pattern |
| Transcribe round-trip scenario (multipart audio → text response) | WIRE-05 is the product's hot path; if it doesn't work end-to-end, nothing else matters | M | Use a fixture WAV; assert against the BACKEND_SPEC envelope shape; cf. existing CONTRACT-01 wire-shape tests for the schema source of truth |
| Admin sign-in + landing scenario | TD-12.a `/admin` 404 only surfaces in E2E — unit tests don't render routes; this scenario IS the regression net for Phase 12 | S | Visit `/admin` → assert redirect to `/admin/config` or `/setup`; assert basicauth still functions as break-glass |
| Locale switch scenario (en ↔ ru) | I18N-01 / I18N-02 are v1 requirements but have no E2E proof | S | Toggle locale, assert page content changes, assert `Accept-Language` round-trips to API |
| Mailpit dockerized in test compose | Real SMTP in CI is flaky and slow; mailpit is OSS standard (~30MB, used by Plausible, Outline, Mattermost CI suites) | S | Already in compose as dev profile per TD-14.a; Phase 13 cements its place in `compose/test/` profile |
| Per-scenario teardown (DB reset / tenant scrub) | Without isolation, scenario N+1 sees N's state; flake city | M | Use testcontainers Postgres-per-scenario OR truncate-and-reseed via `make test-reset`; same pattern packages/data RLS property tests already use |
| Scenarios consumable as test-first input for Phase 12/14/15/17/18 | The reason Phase 13 ships FIRST — subsequent phases write `.feature` red, then make green | — | Documented in Phase 13 PLAN.md as "harness contract" |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-CTA coverage rule (every button on every UI-SPEC state has a step) | Catches "duplicate banner" / "Invalid input" classes of bug that unit tests miss; rule enforced by a lint that grep-counts `data-testid` vs step files | M | Non-blocking CI report in Phase 13, blocking in Phase 13.x if false-positive rate is acceptable |
| Visual regression diffing per scenario (Playwright `toHaveScreenshot()`) | Phase 12 needs this for UI-SPEC conformance enforcement anyway; sharing the harness across phases halves implementation cost | M | Snapshots at `tests/e2e/__screenshots__/`; diff threshold 0.2% pixel ratio; cf. shadcn/ui's own e2e suite |
| axe-core a11y check piggyback per scenario | WEB-IMPL-04 already shipped ~75 axe scans; v2 keeps the regression bar | S | Wired in `apps/web/tests/e2e/`; v2 adopts in Cucumber harness |
| `make e2e-test SCENARIO=<id>` selective runs | One-test reruns during phase work; default run-everything kills DX | S | `cucumber-js --tags "@<id>"`; document in `docs/operations.md` |

### Anti-Features (Phase 13 will NOT ship)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real SMTP integration in CI | "More realistic" | Flaky, network-dependent, leaks emails to real inboxes, requires secrets | Mailpit HTTP API — works the same as Plausible/Outline CI |
| Cross-browser matrix (Firefox + WebKit + Chromium) | "Defensible browser coverage" | 3× CI time, ~95% of bugs reproduce in one browser; we already ship Playwright with Chromium default | Chromium-only baseline; nightly Firefox/WebKit is a Phase 13.x decision |
| Full BACKEND_SPEC wire surface in `.feature` files | Sounds comprehensive | Duplicates CONTRACT-01 which is canonical wire-shape proof; Cucumber overhead per assertion is high | E2E is **user-journey** layer; CONTRACT-01 is **wire-shape** layer; keep separation per Mattermost / Discourse split |
| Mobile viewport scenarios | "Responsive coverage" | UI-SPEC scopes desktop + tablet as primary; mobile is not a Phase 13 promise | Deferred; per-screen `@mobile` tag later if demand surfaces |
| Load / chaos / fuzz inside Cucumber | "More resilience" | k6 already owns load; chaos is v3; fuzz is contract suite | One tool per concern |

---

## Phase 12 — Admin Onboarding Wizard + UI-SPEC Conformance

### Framing — First-run wizard patterns in similar products

Surveyed: Supabase (no wizard; `.env` only — gap acknowledged in community discussions), GitLab Omnibus (HTML wizard at `/users/sign_up` on first run, becomes a normal sign-up page after), Mattermost (System Console wizard with admin email + workspace + site URL), Discourse (5-step wizard: contact email + site title + language + invite + theme), Outline (single-screen wizard: admin email + team name + auth choice). **Dominant pattern: single-page or 3–5 step wizard, gated by a DB flag (`first_run_complete` bool or `count(users) > 0`), with break-glass via env var.** Supabase being the gap is the cautionary tale: 30+ open issues asking for an onboarding wizard.

### Table Stakes (must-have for v2 Phase 12)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `/setup` route gated by `count(users WHERE role='admin') == 0` | TD-12.b — bcrypt-in-`.env` is unrecoverable | M | Server-side check in Next.js middleware OR `GET /api/setup/required` endpoint returning `{required: bool}`; render `/setup` only when required, else redirect to `/sign-in` |
| Wizard collects: admin email, password (min 12 chars per Better Auth rules), display name, workspace/tenant name (defaults "default"), timezone (defaults system) | Discourse / Outline / Mattermost convergent minimum | M | RHF + zod; persist to Better Auth users table with `role='admin'` + tenant_settings row for workspace name + timezone |
| Wizard is single-page or max 3 steps | Linear/Clerk/Supabase Studio sign-in pattern; 5+ steps drops completion to ~60% per Discourse onboarding telemetry | S | One screen, 5 fields, one CTA |
| `htpasswd` basicauth coexists as break-glass | Removing it forces a Docker restart on every operator lockout; corp ops will not accept | S | Document explicitly in `docs/operations.md` as "lost-key recovery only"; basicauth has lower role precedence than DB admin user |
| `/admin` index page (resolves TD-12.a) | Operator typing bare `/admin` URL must not 404 | S | `redirect('/admin/config')` server component at `apps/web/src/app/(admin)/admin/page.tsx` |
| OIDC provider visibility gated by `GET /api/auth/providers` (resolves TD-12.c) | Currently 3 buttons render unconditionally → 404 → 429 ratelimit lockout | M | API returns `[{id: 'google', enabled: true|false}, ...]` based on env; web checks at mount; cf. Outline's `/api/auth.config` |
| Resend-verification CTA on the 403 unverified-email screen (resolves TD-12.e) | Better Auth has the endpoint (`POST /api/auth/send-verification-email`); UI doesn't call it | S | CTA + 60s rate-limit display per UI-SPEC patterns |
| Per-field Zod error messages (resolves TD-13.b) | "Invalid input" is the worst UX failure mode in current build | S | RHF `resolver: zodResolver(schema)` + `<FormMessage>` per field; needs i18n key per error class |
| Visual regression diff against `design-canvas.jsx` for all 5 auth screens | Phase 07 shipped 1437-line design contract; conformance can't be eyeballed | M | Playwright `toHaveScreenshot()` baseline from design-canvas render; fail PR on > 0.2% pixel diff; uses Phase 13 harness |
| axe a11y scan on the setup wizard | WCAG 2.2 AA already a v1 promise (UI-SPEC-03) | S | One scan in Cucumber harness; piggyback Phase 13 pattern |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Setup wizard pre-validates SMTP before persisting admin user | Catches "verification email never arrives" (TD-mailpit) at wizard time, not at first user signup | M | Send a test verification email to admin's own address; only commit on click-through |
| Setup wizard offers "load OIDC config" upload | Ops with pre-existing Keycloak realms save 20 min of env-editing | M | Accept `.json` or `.env` snippet, validate discovery URL, persist to env via Better Auth's `social-providers` config |
| `make setup-status` Makefile target | Ops CI integration — "is the box bootstrapped?" check for terraform/ansible | S | Calls `GET /api/setup/required`, exits 0/1 |
| Onboarding tour after first login | Discourse / Mattermost ship this; nudges admin toward "configure OIDC" / "import users" | M | Tooltip-driven, dismissible; can defer to v3 |

### Anti-Features (Phase 12 will NOT ship)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Multi-tenant tenant-creation in the wizard | "Power admins want multiple orgs" | v1 is single-default-tenant by design (DATA-06); multi-tenant management is a v3 admin-console feature | Wizard creates only the default tenant; renaming exposed in admin console |
| User invite emails in the wizard | "Discourse does this" | Implies SMTP is configured at wizard time; chicken-and-egg with the SMTP validation step | Defer to admin console post-setup |
| Skip-button → "set up later" | "Don't force users to configure right now" | Defeats the purpose; leaves the box in the broken `.env` bcrypt state we are fixing | No skip; setup is mandatory at first run |
| Custom themes / branding in wizard | Outline does it | Out of scope for an OSS backend; UI-SPEC has no theming surface | Defer to v3 / never |
| Wizard redesign deviating from `design-canvas.jsx` | "We can do better" | Phase 12 is CONFORMANCE, not redesign — explicit milestone framing | If `design-canvas` is wrong, file a separate Phase 07.x ticket |
| SCIM endpoint configuration in wizard | "Enterprise polish" | SCIM is explicit v2 anti-feature (deferred per REQUIREMENTS.md COMPL-02) | Wait for v3 SCIM phase |

---

## Phase 14 — Slim Core + BYOK Profiles

### Framing — Minimal vs full compose patterns in similar products

Surveyed: Mattermost (single-binary + Postgres core; Elasticsearch, Calls, Playbooks as separate optional services), GitLab Omnibus (env-driven subsystem toggles), Plausible (core = web+postgres+clickhouse; mail/SMTP BYOK), Outline (core = web+postgres+redis; S3 BYOK + SMTP BYOK + Slack/Google BYOK), Sentry self-hosted (canonical `--with-X` profile flags via `install.sh`). **Dominant pattern: docker-compose profiles + env-driven service toggles + a documented "BYOK matrix" describing which env vars to set to point at external services.**

### Table Stakes (must-have for v2 Phase 14)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Default slim profile = `api + web + worker + postgres + valkey + litellm` (6 services) | Currently default ships 12+ services incl. Grafana stack; 1.3GB+ image cost | M | Drop `profiles:` markers from these 6; everything else gated by `--profile observability` etc. (TD-14.f) |
| `--with-observability` profile (Grafana + Loki + Tempo + Mimir + OTel Collector) | Most corp ops have their own observability (Datadog / Elastic / company Grafana) | M | `OTEL_EXPORTER_OTLP_ENDPOINT` env points to BYOK collector; profile only ships local LGTM stack |
| `--with-storage` profile (MinIO) | TD-14.c; AWS S3 / R2 / GCS via env are common BYOK paths | M | `S3_ENDPOINT` + `S3_REGION` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` env contract; any S3-compat |
| `--with-ingress` profile (Traefik) | K8s deploys have their own ingress; bare-metal ops have nginx/Caddy | M | If disabled, `api` and `web` expose ports directly; document cert handoff |
| `--with-pgbouncer` profile (off by default) | TD-14.d; useful at scale, overkill for first deploy | S | Default = direct Postgres via `pg` driver; PgBouncer wired only when profile active |
| `--profile dev` for mailpit (TD-14.a) | Dev tool in prod = security smell + image bloat | S | Move mailpit out of default; document SMTP BYOK env vars |
| `.env.slim.example` with ~5 keys vs current 12 (TD-14.g) | Cognitive load for first-run | S | Required: `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `LITELLM_MASTER_KEY`, `OPENROUTER_API_KEY` (or equivalent), `BASE_URL` |
| Documented BYOK matrix in `docs/operations.md` | Without it, ops will misconfigure and blame the project | S | Table: subsystem → env vars → external service → smoke test command |
| `docker compose up` without `--profile X` runs the slim default (resolves TD-14.f) | Current state: zero services start without `--profile default` | S | Strip `profiles: [default, ...]` from universally-on services |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `--with-all` mega-profile for one-flag full demo | Demo-friendly; helps OSS evaluation | S | Trivial composition of all profiles |
| Helm parity: each profile maps to a Helm `values.yaml` toggle | Ops use compose for dev, Helm for prod; symmetry reduces surprise | M | `observability.enabled: true`, `storage.minio.enabled: true`, etc. |
| Smoke target per profile (`make smoke-slim`, `make smoke-with-obs`) | CI proves each combination boots; corp ops can run before deploy | M | k6 minimal flow against each profile in nightly CI |
| Cost-of-ownership table (RAM/CPU/disk per profile) | Helps capacity planning; published in `docs/operations.md` | S | Snapshot from `docker stats` on a baseline; refresh on each release |

### Anti-Features (Phase 14 will NOT ship)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Profile-of-profiles inheritance / composition DSL | "More expressive" | Compose profiles flat-list is enough; nesting drives no real use case | Stay flat; document combinations |
| `.env` UI editor / web admin for env vars | "Match Coolify / Dokploy" | Out of scope for an OSS backend; surface area for security bugs | Edit `.env`, run `docker compose up` |
| Auto-detect cloud vendor and pre-fill BYOK | "Magic" | Brittle; vendor APIs change; bad failure mode | Documented per-vendor BYOK guide |
| Built-in S3 implementation (replacing MinIO) | "Drop a dependency" | MinIO IS the OSS S3; reinventing is yak-shaving | Keep MinIO; allow BYOK swap |
| Multi-region failover wiring | "Enterprise readiness" | v2 is single-installation 1000-user; multi-region is v4+ | Out of scope, full stop |
| Blue/green deployment automation | "Zero-downtime" | Compose rolling-deploy is enough for the target; blue/green needs an orchestrator | Helm + K8s native rolling = handles this in cloud topology |

---

## Phase 15 — Repo Refactor + FSL + History Scrub

### Framing — Monorepo and license-switch playbooks

Surveyed: Nx monorepos (Mattermost, Sentry), Turborepo (Vercel, Trigger.dev), plain pnpm workspaces (Better Auth itself, Plausible, Outline). For test colocation, the modern convergence is **`*.test.ts` next to source for unit/integration, top-level `tests/e2e/` for cross-package e2e** (Better Auth, Plausible, Outline). For compose/helm separation, the dominant pattern is **`compose/` for compose files, `charts/` for Helm in the same repo** (Outline, Mattermost) — splitting Helm to a separate repo (TD-15.d) is the minority pattern and adds release-coordination cost. FSL adoption playbook is mature: Sentry's `getsentry/fsl.software` is the reference (templates for FSL-1.1-Apache-2.0 and FSL-1.1-MIT); Liquibase's blog post is the most-cited migration writeup.

### Table Stakes (must-have for v2 Phase 15)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Test colocation convention codified: `*.test.ts` next to source for unit, `*.integration.test.ts` for testcontainer-backed, `tests/e2e/` for Cucumber | TD-15.a; current state is mixed (`__tests__/` in some packages, sibling files in others) | M | Lint rule via `eslint-plugin-vitest` enforcing pattern; codemod sweep to align existing files |
| `compose/` directory for all docker-compose YAML (TD-15.c) | Repo root currently has 4+ `docker-compose.*.yml` | S | `git mv docker-compose.*.yml compose/`; update Makefile + docs |
| Apache 2.0 → FSL-1.1-Apache-2.0 license switch (TD-15.e) | User-requested; aligns with Sentry / Liquibase / PowerSync precedent | M | LICENSE from `fsl.software/FSL-1.1-Apache-2.0.template.md`; update `package.json` `license` in every workspace; SPDX header sweep (codemod); CLA gate via DCO (`Signed-off-by:` line per Liquibase pattern); **per CLAUDE.md, English-only artifacts** |
| `git filter-repo --path speaches-audio.md --invert-paths` history scrub (TD-15.f) | User asked multiple times; sensitive corp config | S | Run on a fresh clone, force-push, document for any contributors with active branches; coordinate timing |
| `(admin)` route-group audit (TD-15.b) | Next.js parenthesized groups are valid but unreadable to new contributors | S | Either rename to plain `admin/` if no shared layout collision, OR add `apps/web/docs/routing.md` documenting the convention |
| Resolve Traefik `/api/*` shadowing of Next.js API routes (TD-15.g) | `apps/web/src/app/api/locale/route.ts` currently unreachable | M | Preferred: separate hosts (`api.localhost` for Fastify, `app.localhost` for Next.js incl. its API routes); fallback: delete Next.js API routes, port to Fastify |
| `apps/web/public/` either committed with `.gitkeep` or Dockerfile COPY conditional | Currently causes Docker build failure on fresh clones | S | Cheapest fix is `.gitkeep` |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Turborepo task graph + remote cache | 3-5× faster CI on hot caches; Better Auth and Outline both use it | M | `turbo.json` with `build`, `test`, `lint`, `e2e` pipelines; remote cache via GHA's built-in artifact cache (no Vercel signup) |
| `CONTRIBUTING.md` with FSL CLA flow documented | Removes ambiguity for OSS PRs | S | Cite Sentry's playbook |
| ADR for the license switch | DOCS-08 already promises ADRs for key decisions | S | Number sequentially after existing ADRs (0012+) |
| Codeowners file mapping directories → reviewers | Helps PR routing when contributors arrive | S | `.github/CODEOWNERS` |

### Anti-Features (Phase 15 will NOT ship)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Helm split to a separate repo (TD-15.d as written) | "Less confusion" | Increases release-coordination cost; Outline / Mattermost both keep Helm in monorepo with no observed confusion | Keep `charts/openwhispr/` in monorepo; document clearly in README |
| Full Nx migration | "More powerful than Turborepo" | Massive learning curve; team uses pnpm; Better Auth is on pnpm | Turborepo is the differentiator path; Nx is overkill |
| BSL / SSPL / AGPL / proprietary license | "Stronger protection" | FSL is what the user asked for; alternatives are too restrictive (SSPL/AGPL) or aggressive (BSL) for OSS adoption | FSL-1.1-Apache-2.0; precedent set |
| Rewriting commit history beyond `speaches-audio.md` scrub | "Cleaner log" | Risk of orphaning contributor branches; high blast radius | Only one file scrubbed |
| Per-package versioning (changesets) | "More precise releases" | Repo ships as one product; per-package versioning is for library publishers | Single `version` field, single release |

---

## Phase 16 — Phase-Tag Comment Audit

### Framing — Comment policies in similar codebases

Better Auth, Tanstack Query, shadcn/ui, Plausible all converge on "**no comment unless WHY is non-obvious**" — same rule as `CLAUDE.md`. Phase-tag comments (e.g. `// Phase 5 / Plan 03 / D-12`) are a GSD-workflow artifact specific to this project and have **no value in production code** once the phase is shipped. The codemod tooling consensus for TS is `ts-morph` (AST-level safe sweeps), with `jscodeshift` as the React-focused alternative. For TS, `ts-morph`'s `Node.getLeadingCommentRanges()` + `removeComment()` is canonical.

### Table Stakes (must-have for v2 Phase 16)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Codemod scanning all `.ts`/`.tsx` for `// Phase XX` / `// Plan YY` / `// D-ZZ` patterns | 1642 such comments identified (TD-16.a); manual sweep infeasible | M | `ts-morph` walks every source file; pattern: `/^\s*\/\/\s*(Phase|Plan|D-)/` plus block-comment variant; outputs `phase-tag-audit-report.json` |
| Two-bucket classification: REMOVE (re-states phase number with no WHY) vs KEEP (annotated WHY that survives without phase context) | Some phase-tags happen to be useful; bulk-delete is destructive | M | Heuristic: a comment KEEPs if removing it leaves surrounding code unintelligible; default REMOVE unless flagged; dry-run first |
| CI lint rule preventing new phase-tag comments | Stops regression; without it, every GSD phase re-introduces them | S | Custom ESLint rule `no-phase-tag-comments` rejecting the regex; `eslint --fix` strips on commit via lefthook |
| Phase 16 ships with full diff review (1642 → ~N kept) | Audit trail per constitutional rule 10 | S | Commit message + COVERAGE.md show before/after count |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Comment-density metric in CI reports | Trend monitoring; surfaces creep | S | `cloc --by-file --report-file` baseline; track over time |
| Doc-comment vs code-comment split (JSDoc preserved, line-comments scrubbed) | JSDoc has tool support (TS LSP); raw `//` comments rarely add value | S | Codemod skips `/** ... */` blocks |

### Anti-Features (Phase 16 will NOT ship)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-generate JSDoc from code | "Better docs" | Auto-generated JSDoc is mostly noise (`@param x The x` etc.) | Hand-write only what adds value |
| Block-comment all `// TODO` removal | "Cleanup" | TODOs are valuable signal — they ARE the WHY for "this is incomplete" | Keep `// TODO:`; track in issue tracker if accumulating |
| Lint rule banning all `//` comments | "Maximum purity" | CLAUDE.md rule allows comments where WHY is non-obvious; banning entirely violates the rule | Only ban phase-tag pattern |
| Manual code-by-code review of all 1642 lines | "Be thorough" | Infeasible; codemod + sample audit is the right tradeoff | Codemod dry-run + 100-sample human spot-check before merge |

---

## Phase 17 — Trusted Local TLS + Production ACME

### Framing — Trusted TLS in dev stacks

mkcert (Filippo Valsorda) is the dominant pattern — installs a local CA into the system root store, generates locally-trusted certs, used by Symfony Docker, Laravel Sail, dunglas/symfony-docker, and most OSS docker-compose templates. Caddy has built-in `tls internal` directive doing the same with no separate tool. **Both produce certs trusted by the browser without warnings; both require a one-time install step** (`mkcert -install` or Caddy's first-run). Production ACME for Traefik is well-documented; cert-manager + Let's Encrypt is the K8s standard. **No major OSS product ships `https://localhost` with warnings — they either bundle a local CA or use Caddy/mkcert in compose.**

### Table Stakes (must-have for v2 Phase 17)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `make tls-trust` target running `mkcert -install` + generating cert chain for `*.localhost` | Operator does `cp .env.example .env && make tls-trust && docker compose up` → no browser warning | M | mkcert script in `tools/tls/`; generates certs in `compose/traefik/certs/`; idempotent (skips if cert valid > 30 days remaining); cf. dunglas/symfony-docker pattern |
| Wildcard cert for `*.localhost` covering `api.localhost`, `app.localhost`, `grafana.localhost`, `mailpit.localhost` | Multi-host setup per TD-15.g resolution; one cert beats four | S | mkcert supports SAN list trivially |
| Traefik configured to serve mkcert certs by default in dev profile | Currently self-signed cert is default (TD-17.a) | S | `compose/traefik/dynamic.yml` pinning `certificates:` to mkcert paths |
| Production ACME via Traefik in `--with-ingress` profile (TD-17.b) | When ingress is enabled, Let's Encrypt should be wired by env (domain + email) | M | `TRAEFIK_LETSENCRYPT_EMAIL` env + `TRAEFIK_DOMAIN`; certs stored in named volume |
| cert-manager + Let's Encrypt Issuer in Helm chart values | K8s deploys need this; currently `DEPLOY-02` notes cert-manager hooks but no end-to-end story | M | Helm `values.yaml` `ingress.tls.acme.enabled: true` + email; templated `Issuer` + `Certificate` resources |
| Documented internal-CA path for corporate environments | Corp ops can't use Let's Encrypt; need to point cert-manager at internal Vault PKI / step-ca / EJBCA | S | `docs/operations.md` § "Corporate TLS"; document `ClusterIssuer` template |
| README quickstart updated to `make tls-trust` as step 2 | First-run UX is the whole point of Phase 17 | S | Step 1 `cp .env.example .env`; 2 `make tls-trust`; 3 `docker compose up`; 4 browse `https://api.localhost` |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Caddy as alternative to mkcert via env flag | Caddy `tls internal` removes the mkcert install step entirely; some operators prefer | M | `COMPOSE_TLS_PROVIDER=caddy` swaps Traefik for Caddy in dev profile |
| Renewal warning in `make status` | Catches expired mkcert certs before browser warning surprises | S | Check cert expiry < 14 days, print warning |
| Documented offline-CA path for air-gapped enterprises | True air-gap corps can't use public ACME at all | M | `docs/operations.md` § "Air-gapped TLS"; bring-your-own-CA with cert-manager + internal-CA Issuer |

### Anti-Features (Phase 17 will NOT ship)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Ship a real CA root in the repo | "No setup needed" | **Security catastrophe** — anyone with the repo can MITM users; multiple OSS projects have shipped CVEs this way | Each operator runs `mkcert -install` locally |
| Auto-install mkcert via container startup | "More magical" | Containers can't modify host root store; sudo elevation impossible from inside Docker | Makefile target runs on host |
| Custom CA implementation (instead of mkcert / Caddy) | "Don't depend on a tool" | mkcert IS the standard; reimplementing is yak-shaving and a CVE pipeline | Use mkcert |
| HTTP fallback when TLS setup fails | "Convenience" | Violates WIRE-20 (HTTPS only); silent insecurity is worse than loud failure | Fail loudly; surface mkcert install instructions |
| Multi-domain ACME (LE rate-limit dance, DNS-01 wildcard) in v2 | "Production-grade" | Phase 17 is single-domain operator deploys; wildcard ACME is enterprise multi-tenant which is v3+ | Single-domain HTTP-01 only in v2 |

---

## Phase 18 — LDAP / Keycloak Integration (Research + SPEC Only)

### Framing — Corporate SSO patterns

Surveyed (Zluri 2026 alternatives report, Authentik/Keycloak comparisons, Better Auth docs, Auth0 enterprise guide): **the dominant corporate-SSO pattern is "deploy Keycloak (or Authentik) as your OIDC server, federate LDAP/AD/Azure-AD into Keycloak, and have your downstream apps speak only OIDC."** This is option (a) from TD-18.a. Direct LDAP plugins in app frameworks are the minority — they tightly couple the app to enterprise directory operations (group sync, password policies, locked accounts, kerberos) that are properly Keycloak's job. SCIM provisioning is **separate from SSO** — SSO is authentication, SCIM is user/group lifecycle. Keycloak notably **does NOT include native SCIM 2.0 endpoints** (community extensions only); Authentik does. JIT provisioning (user created on first OIDC sign-in) is the lighter-weight alternative most products choose first; SCIM is added later when audit requirements force it.

### Table Stakes (Phase 18 SPEC must document)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| SPEC documenting Keycloak-as-OIDC-frontend as the RECOMMENDED path | Industry-dominant pattern; Better Auth OIDC adapter already works with it (AUTH-05); zero code changes for this path | S | Decision recorded as ADR; `docs/auth-corporate.md` shows Keycloak realm config, LDAP federation, OIDC discovery URL |
| SPEC documenting direct LDAP plugin as the ALTERNATE path | Some corp ops cannot deploy Keycloak (air-gap, no infra budget, regulatory) | M | `ldapjs` + custom Better Auth plugin; SPEC enumerates: bind-DN auth, group→role mapping, password-change passthrough, account-lockout sync, kerberos **explicitly OUT of scope** |
| Decision matrix: when to recommend which | Without it, ops will pick the wrong path | S | Table: existing LDAP+Keycloak → (a); air-gap with AD only → (b); neither yet → (a) with Authentik/Zitadel suggestion |
| JIT user-provisioning spec (on first OIDC sign-in, create user with default tenant + role) | MVP for "corporate user shows up, has account" | S | Builds on existing AUTH-07 "open IdP scope" |
| Group/role-mapping spec | OIDC claims (`groups`, `roles`) → Better Auth `role` field | M | SPEC only; implementation deferred to v3 |
| Test plan for the SPEC (Cucumber scenarios using a dockerized Keycloak in test profile) | When v3 implements, scenarios are ready | M | `tests/e2e/keycloak-oidc.feature` red-only in v2; `compose/test/keycloak.yml` defined |

### Differentiators (still in SPEC scope, NOT implementation)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Authentik as the recommended OSS Keycloak alternative | Authentik ships SCIM out of the box; lighter ops footprint; modern UI | S | Document side-by-side in `docs/auth-corporate.md` |
| Zitadel mention as third option | Multi-tenant from day one; useful reference | S | One-paragraph callout |
| Documented Better Auth plugin extension points the LDAP path would touch | Reduces v3 surprise | M | List the Better Auth hooks the plugin would implement |

### Anti-Features (Phase 18 SPEC will NOT cover, v2 will NOT implement)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| SAML 2.0 IdP connector | Some enterprise buyers ask | Better Auth has no native SAML; would require separate plugin; **explicit v2 anti-feature per REQUIREMENTS.md COMPL-01** | OIDC covers Google Workspace / Azure AD / Okta which is 95% of buyers |
| SCIM provisioning endpoints | "Enterprise checkbox" | COMPL-02 deferred to v2/v3 explicitly; Supabase Pro tier defers it; even Keycloak doesn't ship native SCIM | JIT provisioning is enough for v2 SPEC; SCIM is v3 if demand surfaces |
| Implementing the LDAP plugin in v2 | "Why wait" | TD-18.b explicitly says SPEC-only in v2; needs `/gsd-discuss-phase` outcome first | Ship SPEC; implementation = v3 |
| Kerberos / SPNEGO support | "Internal Windows shops want it" | Massive surface area; works inside Keycloak natively — let Keycloak handle it | Document the Keycloak Kerberos federation path |
| Self-hosted IdP-portal UI built into OpenWhispr | "Be a one-stop shop" | **Explicit out-of-scope per PROJECT.md** — defer to bundled Keycloak/Authentik/Zitadel | Document the bundled path |
| Custom group-to-tenant mapping logic | "Multi-tenant per OIDC group" | v1 is single-default-tenant by design (DATA-06); group-to-tenant is v4+ | Single tenant; document for future |
| Built-in MFA (TOTP / WebAuthn) on top of LDAP | "Defense in depth" | Keycloak handles this natively; duplicative | Push to Keycloak; document |

---

## Feature Dependencies

```
Phase 13 (E2E + CJM harness)
    ├──gates──> Phase 12 (admin onboarding)        — scenarios written test-first against 13's harness
    ├──gates──> Phase 14 (slim + BYOK)             — each profile gets a Phase 13 smoke scenario
    ├──gates──> Phase 17 (trusted TLS)             — "no browser warning on first run" IS a Cucumber scenario
    └──gates──> Phase 18 (Keycloak SPEC)           — scenarios authored red-only against dockerized Keycloak

Phase 12 (admin onboarding)
    ├──requires──> Phase 13 (test harness exists)
    └──enhances──> Phase 17 (setup wizard surfaces TLS health)

Phase 14 (slim + BYOK)
    ├──conflicts──> Phase 17 (must decide together: ingress + ACME profile coupling)
    └──enhances──> Phase 15 (compose/ tree refactor lands the profile YAMLs cleanly)

Phase 15 (refactor + FSL + scrub)
    └──independent──> Phase 16 (comment audit — both touch wide swaths of source; sequence to avoid merge hell)

Phase 16 (comment audit)
    └──independent──> Run AFTER Phase 15 so codemod operates on already-restructured tree

Phase 17 (trusted TLS)
    └──requires──> Phase 14 (`--with-ingress` profile decision determines whether ACME is wired)

Phase 18 (Keycloak SPEC)
    └──independent──> Can ship any time after Phase 13; pure documentation
```

### Dependency Notes

- **Phase 13 gates everything because it's the harness.** Without it, every other phase ships blind and the milestone re-introduces the original "unit tests pass and lie" failure mode (TD-13.a/d).
- **Phase 12 requires Phase 13** specifically because the admin onboarding wizard is the most UX-sensitive surface in v2; visual regression + a11y scans + journey scenarios are how we prove conformance.
- **Phase 17 requires Phase 14** because the `--with-ingress` profile decision determines whether Traefik (and thus ACME) is in the default compose at all.
- **Phase 15 + Phase 16 are sequencing-sensitive.** Both touch wide swaths of source. Run 15 first (license headers + structural moves + history scrub), then 16 (comment sweep). Doing 16 first means Phase 15's mass-mv re-introduces phase-tag noise that 16 missed.

---

## MVP Definition

### Phase 13 — Launch With

- [ ] Cucumber.js + Playwright wired, gated by `E2E=1`, `make e2e-test` target
- [ ] `.planning/research/CJM.md` enumerating ~20 user journeys
- [ ] 8 mandatory auth scenarios + transcribe round-trip + admin landing + locale switch (11 minimum green at phase close)
- [ ] Mailpit in test compose; HTTP API used for verification-email assertions
- [ ] Per-scenario DB teardown via testcontainers or `make test-reset`

### Phase 12 — Launch With

- [ ] `/setup` route gated by admin-user count
- [ ] Wizard: email + password + display name + workspace name + timezone, single page
- [ ] `/admin` index page redirecting to `/admin/config`
- [ ] `GET /api/auth/providers` capability endpoint; UI gates buttons on it
- [ ] Resend-verification CTA on unverified-email screen
- [ ] Per-field Zod error messages
- [ ] Visual regression diff against `design-canvas.jsx` for 5 auth screens
- [ ] All flows above ship green Phase 13 Cucumber scenarios

### Phase 14 — Launch With

- [ ] Slim default profile (6 services); strip `profiles:` from universally-on services
- [ ] `--with-observability` / `--with-storage` / `--with-ingress` / `--with-pgbouncer` profiles
- [ ] `--profile dev` for mailpit
- [ ] `.env.slim.example` with ~5 keys + BYOK matrix in `docs/operations.md`
- [ ] Per-profile Cucumber smoke scenario

### Phase 15 — Launch With

- [ ] Test colocation convention + lint rule + codemod sweep
- [ ] `compose/` tree; root cleared of compose YAMLs
- [ ] Apache 2.0 → FSL-1.1-Apache-2.0; SPDX header sweep; CLA via DCO
- [ ] `speaches-audio.md` scrubbed from git history via `git filter-repo`
- [ ] `(admin)` route-group decision applied
- [ ] Traefik/Next.js API route shadowing resolved (separate hosts preferred)
- [ ] `apps/web/public/.gitkeep`

### Phase 16 — Launch With

- [ ] `ts-morph` codemod scanning all 1642 phase-tag comments
- [ ] Two-bucket classification with dry-run report
- [ ] ESLint rule preventing regression
- [ ] 100-sample human spot-check; full sweep committed

### Phase 17 — Launch With

- [ ] `make tls-trust` running `mkcert -install` + wildcard cert generation
- [ ] Traefik dev profile serves mkcert certs by default
- [ ] Production ACME wiring in `--with-ingress` profile (Let's Encrypt + email)
- [ ] cert-manager Issuer template in Helm chart
- [ ] README quickstart updated
- [ ] Cucumber scenario: "first run → browse `https://api.localhost` → no browser warning"

### Phase 18 — Launch With (SPEC only)

- [ ] `docs/auth-corporate.md` covering Keycloak-as-OIDC-frontend (RECOMMENDED) + LDAP-direct (ALTERNATE)
- [ ] Decision matrix
- [ ] JIT provisioning spec
- [ ] Group/role-mapping spec
- [ ] Red Cucumber scenarios in `tests/e2e/keycloak-oidc.feature` + `compose/test/keycloak.yml`
- [ ] ADR for Keycloak-as-OIDC-frontend recommendation

### Add After Validation (v2.x, post-milestone)

- [ ] Turborepo migration + remote cache (Phase 15.x)
- [ ] Cross-browser matrix in nightly E2E (Phase 13.x)
- [ ] Visual regression coverage extended to all UI-SPEC screens (Phase 12.x → 13.x)
- [ ] Onboarding tour after first login (Phase 12.x)
- [ ] `make setup-status` Makefile target (Phase 12.x)
- [ ] Caddy alternative to mkcert via env flag (Phase 17.x)
- [ ] Authentik / Zitadel side-by-side docs (Phase 18.x)

### Future Consideration (v3+)

- [ ] LDAP-direct Better Auth plugin implementation (Phase 18 implementation; gated by `/gsd-discuss-phase` outcome)
- [ ] SCIM 2.0 provisioning endpoints (REQUIREMENTS COMPL-02)
- [ ] SAML 2.0 connector (REQUIREMENTS COMPL-01)
- [ ] Multi-region / blue-green deployment automation
- [ ] Per-tenant admin console (currently single-default-tenant)
- [ ] Onboarding wizard redesign with theming / branding

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Phase 13 Cucumber harness | HIGH | MEDIUM | P1 |
| Phase 13 mailpit-API for email verification scenarios | HIGH | LOW | P1 |
| Phase 12 setup wizard | HIGH | MEDIUM | P1 |
| Phase 12 `/admin` index page | HIGH | LOW | P1 |
| Phase 12 OIDC button gating | HIGH | MEDIUM | P1 |
| Phase 14 slim profile default | HIGH | MEDIUM | P1 |
| Phase 14 BYOK env matrix doc | HIGH | LOW | P1 |
| Phase 15 FSL switch + SPDX sweep | MEDIUM | MEDIUM | P1 |
| Phase 15 `speaches-audio.md` scrub | MEDIUM | LOW | P1 |
| Phase 16 comment codemod | LOW | MEDIUM | P2 |
| Phase 17 mkcert/`make tls-trust` | HIGH | MEDIUM | P1 |
| Phase 17 production ACME wiring | HIGH | MEDIUM | P1 |
| Phase 18 Keycloak-as-OIDC-frontend SPEC | HIGH | LOW | P1 |
| Phase 18 LDAP-direct SPEC | MEDIUM | MEDIUM | P1 |
| Visual regression for all UI-SPEC | MEDIUM | HIGH | P2 |
| Turborepo migration | MEDIUM | MEDIUM | P2 |
| Cross-browser E2E matrix | LOW | HIGH | P3 |
| LDAP plugin implementation | MEDIUM | HIGH | P3 (v3) |
| SCIM endpoints | LOW (v2 buyer) | HIGH | P3 (v3) |

---

## Competitor Feature Analysis

| Feature | Supabase self-host | Plausible | Outline | Mattermost | Discourse | Sentry self-host | Our Approach |
|---------|-------------------|-----------|---------|------------|-----------|------------------|--------------|
| First-run admin wizard | NO (gap) | NO | YES (1 screen) | YES (System Console) | YES (5-step) | partial | YES — single-page, 5 fields (Outline-style) |
| BYOK profile system | partial (env) | YES (mail) | YES (S3/SMTP/social) | YES (modular plugins) | partial | YES (`install.sh --with-X`) | YES — `--with-*` compose profiles |
| Mailpit in dev/test | YES | YES | YES | YES | YES | YES | YES — already in repo; v2 moves to dev profile only |
| Trusted local TLS via mkcert | NO | NO | NO | NO | NO | NO | YES — `make tls-trust`; differentiator |
| FSL license | NO (Apache 2.0) | AGPL | BUSL | AGPL → MIT | GPL | FSL-1.1-Apache-2.0 | YES — FSL-1.1-Apache-2.0 (Sentry / Liquibase precedent) |
| Cucumber BDD + CJM | NO (Vitest/Playwright) | Elixir ExUnit | partial | YES (Cypress) | YES (RSpec system specs) | partial | YES — Cucumber + Playwright, full CJM |
| Visual regression per screen | NO | NO | NO | partial | NO | NO | YES — `design-canvas.jsx` baseline diff |
| Keycloak-as-OIDC SPEC | YES (GoTrue native OIDC) | YES | YES | YES | YES | YES | YES — Phase 18 SPEC documents both Keycloak + LDAP-direct |
| Native LDAP | NO (community plugin) | NO | NO | YES (enterprise) | NO (plugin) | NO | NO in v2; SPEC-only |
| Native SCIM | NO | NO | NO | YES (enterprise) | NO | NO | NO — explicit anti-feature for v2/v3 |
| Native SAML | NO | NO | YES | YES (enterprise) | YES (plugin) | YES | NO — explicit anti-feature; OIDC covers Azure AD / Okta |
| Phase-tag comment policy | n/a | n/a | n/a | n/a | n/a | n/a | YES — ESLint rule + codemod sweep (project-specific) |

---

## Sources

- **Phase 13 — Cucumber + Playwright + CJM**
  - [Playwright BDD: Setup, Gherkin & E2E Testing Guide — TestDino](https://testdino.com/blog/playwright-bdd)
  - [E2E Automation Testing Done Right: Playwright + Cucumber — dev.to / akdevcraft](https://dev.to/akdevcraft/playwright-and-cucumber-are-the-best-tools-for-end-to-end-testing-a28)
  - [End-to-End Testing Your SaaS with Playwright — Makerkit](https://makerkit.dev/blog/tutorials/playwright-testing)
  - [E2E Testing Signup and Login Workflows with Playwright — Better Stack](https://betterstack.com/community/guides/testing/playwright-signup-login/)
  - [Mailpit project — axllent/mailpit](https://github.com/axllent/mailpit)
- **Phase 12 — Admin onboarding wizard**
  - [Supabase self-hosting community discussions (no built-in wizard)](https://github.com/orgs/supabase/discussions/35568)
  - [The ultimate Supabase self-hosting guide — David Lorenz](https://activeno.de/blog/2023-08/the-ultimate-supabase-self-hosting-guide/)
  - [Supabase self-hosting: what's working — Discussion #39820](https://github.com/orgs/supabase/discussions/39820)
- **Phase 14 — Slim + BYOK**
  - Sentry self-hosted install.sh `--with-X` flag pattern (`getsentry/self-hosted`)
  - Outline ENV docs (S3/SMTP/Slack/Google BYOK)
- **Phase 15 — FSL + repo refactor**
  - [Functional Source License — fsl.software](https://fsl.software/)
  - [Sentry: Introducing the Functional Source License](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/)
  - [Liquibase blog: Strengthening Community via FSL](https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl)
  - [SPDX: FSL-1.1-ALv2](https://spdx.org/licenses/FSL-1.1-ALv2.html)
  - [TLDRLegal: FSL in plain English](https://www.tldrlegal.com/license/functional-source-license-fsl)
- **Phase 16 — Comment audit**
  - `ts-morph` README (AST manipulation; canonical TS codemod tool)
- **Phase 17 — Trusted TLS**
  - [Docker Compose Local HTTPS with mkcert — Code with Hugo](https://codewithhugo.com/docker-compose-local-https/)
  - [mkcert + Caddy + Docker Compose — dev.to / moofoo](https://dev.to/moofoo/docker-basics-using-mkcert-and-caddy-with-docker-compose-to-host-web-services-over-https-for-local-2a3d)
  - [symfony-docker TLS docs](https://github.com/dunglas/symfony-docker/blob/main/docs/tls.md)
  - [My setup for local HTTPS with mkcert and Caddy — horus.dev](https://horus.dev/blog/local-https-setup-mkcert-caddy)
  - Traefik ACME docs + cert-manager Issuer guide
- **Phase 18 — Keycloak / LDAP**
  - [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
  - [Zluri: Top 7 Keycloak alternatives 2026](https://www.zluri.com/blog/keycloak-alternatives)
  - [Self-host Authentik or Keycloak 2026 — DanubeData](https://danubedata.ro/blog/self-host-authentik-keycloak-auth0-alternative-2026)
  - [Top 10 self-hosted IAM platforms — New2026 / Medium](https://new2026.medium.com/top-10-full-stack-self-hosted-iam-platforms-keycloak-peers-5b92a3a3426b)
  - [Top 5 OSS IAM providers 2025 — Logto](https://blog.logto.io/top-oss-iam-providers-2025)
  - [Best Keycloak alternatives — Oso](https://www.osohq.com/learn/best-keycloak-alternatives-2025)

---

*Feature research for: OpenWhispr Server v2 production readiness*
*Researched: 2026-05-14*
*Supersedes v1 FEATURES.md (preserved in git history)*
