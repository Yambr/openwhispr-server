---
created: 2026-05-14
status: living document
owner: project
---

# Tech Debt Inventory — v2 milestone

Captured during the 2026-05-14 stack-up smoke session. Source: hands-on
browser walkthrough of `docker-compose.embedded-litellm.yml` stack + grep
through `apps/`, `packages/`, `.planning/`. The point of the session was
to actually USE the app for the first time; the symptoms below are what
real operators / users will hit on `git clone && docker compose up`.

Every entry links to the v2 phase that owns the fix. Phases here are
**proposals** awaiting `/gsd-phase` insertion into ROADMAP.md; the v2
milestone has not been formally opened yet.

## Proposed v2 phases (priority order)

| # | Phase | Why first |
|---|---|---|
| 13 | **Cucumber+Playwright E2E + CJM discovery** | Root cause for half of TD below: nothing in user journeys is E2E-tested. Unit tests pass and lie. THIS IS THE GATE — must land before anything else, because every other phase needs E2E to prove its fix. |
| 12 | **Admin onboarding wizard + auth UX redesign** | Currently no way for an operator to discover/set admin creds; `/admin` 404; SSO buttons render with 0 providers. UX is dead-on-arrival without this. Runs after 13 harness exists so the new flow ships test-first. |
| 14 | **Slim core + BYOK profiles** | `--with-observability`, `--with-storage`, `--with-ingress`, `--with-pgbouncer` opt-in. Mailpit only in dev profile. Default = api+web+worker+postgres+valkey+litellm. |
| 15 | **Repo refactor + license + history scrub** | compose/helm to separate trees, tests next to code review, route-groups `(admin)` audit, license Apache→FSL, `git filter-repo` removing `speaches-audio.md` from history. |
| 16 | **Phase-tag comment audit** | 1642 `// Phase XX / Plan YY / D-ZZ` comments in source. Decide policy, sweep. |
| 17 | **Trusted local TLS + prod ACME** | mkcert/Caddy local CA so browser does not warn on `https://*.localhost`. Prod Let's Encrypt in core profile. |
| 18 | **LDAP / Keycloak integration (research + SPEC)** | Better Auth has no native LDAP. Two options: (a) Keycloak/Authentik as OIDC frontend over LDAP, BetterAuth uses social provider; (b) custom Better Auth plugin with `ldapjs`. Needs spec before plan. Enterprise self-host blocker. |

## TD items

### Phase 13 — E2E coverage gaps (root cause for many UI bugs below)

- **TD-13.a — Duplicate "already registered" banner.** `apps/web/src/components/screens/auth/SignUpForm.tsx` renders the dup-warning twice. Unit test asserts `getAllByText(/already registered/i).length.toBeGreaterThan(0)` — passes for 1 AND for 2. Test is gaslighting us.
- **TD-13.b — Zod errors surface as bare "Invalid input".** `apps/web/src/lib/schemas/auth.ts` enforces `password.min(8)`. Client shows no per-field message, no localization, no "must be at least 8 chars". User has no idea why submit failed.
- **TD-13.c — Sign-in 403 with no explanation.** After signup, verification email never arrives (TD-mailpit). User tries sign-in → 403 from Better Auth `requireEmailVerification`. UI shows generic error; no resend link, no "check your spam", no "your verification email was never sent because the worker is broken".
- **TD-13.d — `getAllByText` weak assertion pattern.** Likely repeated across SignInForm, ResetPasswordForm, VerifyEmailScreen. Sweep all `auth/__tests__/*.test.tsx` for `toBeGreaterThan(0)` and tighten to `toHaveLength(1)` where exclusivity matters.
- **TD-13.e — No E2E for any auth journey.** `tests/e2e/` contains only `phase6-scale-dynamic.yml` (k6 perf). Zero Playwright/Cucumber. CJM unmapped — there is no document listing the journeys that SHOULD be tested.
- **TD-13.f — DevTools `FrameDoesNotExistError`** — browser extension noise, NOT our bug. Document so future sessions skip it.

### Phase 12 — UI-SPEC conformance audit + admin onboarding

**Crucial framing (corrected 2026-05-14):** auth UX is NOT free-design territory. Phase 07 shipped a full design contract:

- `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` (1915 lines) — sign-in, sign-up, verify-email, account, transcriptions, notes, conversations states, fields, error handling, OIDC button layout, validation messaging.
- `.planning/phases/07-frontend-ui-spec/UI-SPEC-admin.md` (758 lines) — admin surface contract.
- `.planning/phases/07-frontend-ui-spec/design/design-canvas.jsx` (1437 lines) — concrete component-level reference.

The live `apps/web/src/components/screens/auth/*` implementation has drifted from this contract. Symptoms (duplicate banner, "Invalid input" non-message, SSO buttons always rendered, no resend-verification CTA) are NOT free-design questions — they are **conformance failures against an existing locked design**. Phase 12 is therefore a **conformance audit + remediation**, not a redesign.

- **TD-12.a — `/admin` returns 404.** Next.js route group `(admin)/admin/config` exists; page at `/admin` itself does NOT. Operator typing `https://api.localhost/admin` sees a Next.js 404 (after Traefik basicauth passes). Need either an index page or a redirect to `/admin/config` or `/setup`.
- **TD-12.b — Admin bootstrap password unrecoverable.** `.env` ships `ADMIN_BASIC_AUTH_USERS=admin:$$2y$$05$$...` — a bcrypt hash with no companion plaintext. Operators cannot log in. There is no documented path "first run? do X". Possible fixes:
  - (preferred) First-run onboarding wizard: `/setup` route, app detects empty `users` table → operator sets admin email+password → stored in Better Auth `users` with `role=admin`. htpasswd remains as break-glass with the hash documented as "lost-key recovery only".
  - (alt) `make admin-password` Makefile target prints the password from a sealed secret.
- **TD-12.c — SSO/OIDC buttons render with 0 providers configured.** Web shows Google/GitHub/OIDC sign-in buttons unconditionally. Clicking → POST `/api/auth/sign-in/social` → 404 (`Provider not found`) → repeated clicks trigger Better Auth ratelimit → 429. UI should call a `GET /api/auth/providers` (or similar capability endpoint) at mount and only render buttons for configured providers. **The provider config is operator-side env — UI must honour it.**
- **TD-12.d — Auth pages are this-session's own free-handed design.** Not run through `ui-ux-pro-max` skill. Reference patterns: Supabase / Clerk / Linear sign-in. Needs design pass with the design skill before re-implementation.
- **TD-12.e — Sign-in success has no clear post-state for unverified users.** No "resend verification email" CTA on the 403 screen.
- **TD-12.f — Bcrypt `$` escape requirement in `.env` is invisible to operators.** Documented in YAML comment buried at line 642 of `docker-compose.embedded-litellm.yml`. Setup wizard removes this trap entirely.

### Phase 14 — Slim core + BYOK

- **TD-14.a — Mailpit ships in production profile.** Dev tool. Move to `--profile dev` only. Production operators bring their own SMTP relay via env (or use the wizard from Phase 12).
- **TD-14.b — Observability stack non-optional.** Grafana + Loki + Tempo + Mimir + OTel Collector = ~1.3 GB images + significant RAM. Most corp ops have their own observability (Datadog / Elastic / company Grafana). Add `--with-observability` flag.
- **TD-14.c — MinIO non-optional.** S3 storage; many ops use AWS S3 / Cloudflare R2 / GCS. Add `--with-storage` flag + `S3_ENDPOINT` BYOK pattern.
- **TD-14.d — PgBouncer non-optional.** Useful at high concurrency, overkill for first deploy. `--with-pgbouncer` flag; default to direct Postgres connection.
- **TD-14.e — Traefik non-optional.** K8s deploys already have ingress; corp ops have their own LB. `--with-ingress` flag; if disabled, services expose ports directly.
- **TD-14.f — `--profile default` UX gotcha.** Already in [[deferred-items]] item 3a. Every service is `profiles: [default, ...]` — `docker compose up` without `--profile default` selects zero services. Fix: drop `profiles:` from universally-on services OR document the flag prominently.
- **TD-14.g — `.env.example` for slim core.** Currently `.env.embedded.example` lists 12 keys — but several are for services that should be opt-in. Slim core needs ~5 keys.

### Phase 15 — Repo structure & enterprise refactor

- **TD-15.a — Tests interleaved with source.** `apps/api/src/email.ts` + `apps/api/src/email.test.ts` co-located. Some packages have `__tests__/`. Inconsistent. Decide convention; sweep.
- **TD-15.b — `(admin)` route-group naming.** Next.js parenthesized route groups are valid syntax but readability is awful. Audit all `apps/web/src/app/(*)`; rename to plain dirs or document why parens are used.
- **TD-15.c — `docker-compose.*.yml` files in repo root pollute the top-level.** Move to `compose/`. Helm chart already in `charts/openwhispr/` — confirm location is right.
- **TD-15.d — Helm in same repo as code.** Discussed: split helm to its own branch (or repo) so end users don't get confused between operator artefacts and source.
- **TD-15.e — Apache 2.0 → FSL.** Update LICENSE, package.json `license` field, every SPDX header in source. Mass codemod.
- **TD-15.f — `speaches-audio.md` in git history.** User has asked for removal multiple times. `git filter-repo --path speaches-audio.md --invert-paths` + force-push. Coordinate with anyone tracking the branch.
- **TD-15.g — Traefik `/api/*` shadows Next.js API routes.** `apps/web/src/app/api/locale/route.ts` exists and is callable from the web app, but Traefik routes `Host(api.localhost) && PathPrefix(/api)` → Fastify, which has no `/api/locale` → 404. Decide:
  - move Next.js API routes under `/_next/api/` (non-standard, fights framework), OR
  - delete Next.js API routes entirely and reimplement as server actions or Fastify endpoints, OR
  - separate the web host from the api host (`web.localhost` vs `api.localhost`) instead of pathprefix-multiplexing on one host.
- **TD-15.h — Self-signed cert is the default.** Discussed in Phase 17. Affects "first run" trust UX.

### Phase 16 — Phase-tag comment audit

- **TD-16.a — 1642 `// Phase XX / Plan YY / D-ZZ` comments in source.** CLAUDE.md says "Default to writing no comments. Only add one when the WHY is non-obvious." Many of these phase-tags are historic provenance with no current value. Audit: keep the ones that explain non-obvious WHY; remove the ones that just re-state the phase number. Heuristic for removal: if grep-removing the comment would not confuse a reader of the surrounding code, kill it.

### Phase 17 — Trusted local TLS + prod ACME

- **TD-17.a — `https://*.localhost` shows browser cert warning.** Self-signed. Adopt `mkcert` (or Caddy's local CA) for dev. Operator runs `mkcert -install` once; cert chain is then trusted by the system store.
- **TD-17.b — Production ACME wiring not in slim-core compose.** When Phase 14 lands `--with-ingress`, ensure Let's Encrypt config ships when ingress is enabled; document the cert-manager path for K8s.

### Phase 18 — LDAP / Keycloak integration

- **TD-18.a — Better Auth has no native LDAP.** Two paths:
  - **(a)** Stand up Keycloak / Authentik as an OIDC server in front of LDAP. Better Auth uses standard OIDC social provider (`@better-auth/sso` plugin). LDAP details stay inside Keycloak. **Recommended** — no Better Auth surgery required, this is the corporate-standard architecture.
  - **(b)** Write a custom Better Auth plugin that uses `ldapjs` to bind/auth against LDAP and synthesizes a Better Auth session on success. Tight coupling, more code, but no Keycloak ops.
- **TD-18.b — Decision needed before plan.** Run `/gsd-discuss-phase 18` with both options on the table; assumption verification on what corp ops actually want.

### Cross-cutting: Mailpit `noopSender`

- **TD-mailpit — `apps/worker/src/index.ts:128-134` uses a hardcoded `noopSender`** instead of the nodemailer-backed `EmailService` from `apps/api/src/email.ts`. Worker reads the email-delivery job from BullMQ, returns `{ delivered: true, reason: "no-op-sender" }` without ever calling SMTP. Mailpit inbox stays empty forever. **Owned by Phase 13** because the E2E test for signup→verify is what exposes this and gates the fix.

### Cross-cutting: testcontainers cleanup

- Already in `.planning/deferred-items.md` item 1. Owner: a small sub-phase under testing-infra or piggyback on Phase 13 harness work (since 13 will heavily use testcontainers + dockerized stack).

### Cross-cutting: `apps/web/public/` missing dir

- Already in `.planning/deferred-items.md` item 2. Phase 15 (repo refactor) is a good moment to either commit `.gitkeep` or make Dockerfile COPY conditional.
