# Project Research Summary — v2 Production Readiness

**Project:** OpenWhispr Server
**Milestone:** v2 Production Readiness (Phases 12–18, brownfield on top of shipped v1)
**Researched:** 2026-05-14
**Confidence:** HIGH (codebase walked file-by-file; every claim traces to a concrete TECH_DEBT.md entry or live source path)

Detailed findings live in:

- `.planning/research/STACK.md`
- `.planning/research/FEATURES.md`
- `.planning/research/ARCHITECTURE.md`
- `.planning/research/PITFALLS.md`

> Prior v1 SUMMARY content is preserved in git history (last commit on the v1 file: 2026-05-08).

---

## Executive Summary

v2 is **not a feature milestone** — it is a brownfield production-readiness repair milestone triggered by the 2026-05-14 stack-up walkthrough that surfaced ~20 observable symptoms catalogued in `.planning/TECH_DEBT.md`. Every one of those symptoms shipped through v1's verification gate with 90%+ unit coverage and explicit phase sign-off; they still slipped because (a) unit tests use wire-shape-only assertions that pass for the bug AND the fix (`getAllByText(...).length.toBeGreaterThan(0)` — TD-13.a), (b) the journey-level verification harness did not exist (zero Playwright/Cucumber coverage despite `@playwright/test 1.59.1` being installed — TD-13.e), and (c) capability drift between UI and backend was never asserted end-to-end (SSO buttons render for 0 configured providers → 404 → 429 lockout — TD-12.c). The fix for all three is the same: **Phase 13 ships a Cucumber+Playwright harness + CJM artefact, and every subsequent v2 phase writes its tests red against that harness before touching production code.**

The recommended v2 path adds **no new runtime dependencies** to the v1 server stack — additions are entirely test-tooling (`@cucumber/cucumber 12.8.2` + `@playwright/test 1.60.0` + `playwright-bdd 8.4.2`), dev-machine UX (`mkcert 1.4.4`), repo-hygiene tooling (`reuse 5.x` + `git-filter-repo 2.47.0`), and a SPEC-only research artefact for Phase 18 (`@better-auth/sso` + Keycloak 26.6.1 as recommended option-A; `ldapts 8.1.7` only if option-B is chosen — `ldapjs` is decommissioned). Compose slim-core + BYOK and Helm BYOK are pure-spec refactors. Admin onboarding wizard reuses RHF 7 + Zod 3 + shadcn/ui v2 already present. **The v1 stack (Node 24 LTS, Fastify 5, Better Auth 1.x, Drizzle, PostgreSQL 17, PgBouncer, Valkey 8, BullMQ, LiteLLM ≥ 1.83.7-stable, Next.js 15, React 19, Tailwind 4, Traefik 3, LGTM, MinIO, i18next) is LOCKED.**

The dominant risk class is brownfield-specific traps: (1) testcontainers leaks 30GB of orphan volumes on every vitest watch-mode SIGKILL (deferred-items #1); (2) the Phase 15 history scrub force-pushes `main` and breaks every clone, signed commit, and CI cache simultaneously; (3) the FSL relicense touches 675+ SPDX headers + every `package.json` + every Docker LABEL (one-line `LICENSE` edit covers ~1% of surface); (4) compose `profiles: [default]` inverts semantics so bare `docker compose up` selects ZERO services (TD-14.f); (5) BYOK env silently falls back to wrong defaults (`noopSender` at `apps/worker/src/index.ts:68` is the live case study).

---

## Stack Additions (v2 only — full rationale in STACK.md)

| Dependency | Version | Phase | Role |
|---|---|---|---|
| `@cucumber/cucumber` | 12.8.2 | **13** | Gherkin DSL only — NOT runner |
| `@playwright/test` | 1.60.0 | **13** | Browser driver + runner (upgrade from incumbent 1.59.1) |
| `playwright-bdd` | 8.4.2 | **13** | Compiles `.feature` → Playwright spec |
| `@axe-core/playwright` | 4.x | **13** | a11y scan (carried forward from Phase 07.1) |
| `mkcert` (Go binary) | 1.4.4 | **17** | One-shot local-CA install |
| cert-manager (Helm sub-chart, gated) | 1.16+ | **17** | Production ACME on K8s |
| FSL-1.1-ALv2 (license) | — | **15** | Apache-2.0 future grant after 2y |
| `reuse` (FSFE) | 5.x | **15** | SPDX header sweep + `reuse lint` CI gate |
| `git-filter-repo` | 2.47.0 | **15** | One-shot history scrub |
| Compose `profiles:` (native) | Compose ≥ 2.30 | **14** | NO new dep |
| Helm `condition:` (native) | Helm 3.7+ | **14** | NO new dep |
| `@better-auth/sso` | 1.x | **18 SPEC** | SAML + OIDC enterprise plugin; v3 impl |
| `ldapts` (only if option B) | 8.1.7 | **18 SPEC** | Replaces decommissioned `ldapjs` |
| Keycloak (option A recommended) | 26.6.1 | **18 SPEC** | OIDC frontend over LDAP |
| Authentik (option A alt) | 2026.2.2 | **18 SPEC** | Lighter Keycloak alternative |
| (none — v1 stack) | — | **12** | RHF 7 + Zod 3 + shadcn/ui Stepper |
| (none — `ts-morph` in tree) | — | **16** | Phase-tag codemod |

Anti-shortlist (rejected): Selenium / WebDriverIO / Cypress / Cucumber-as-runner / devcert / step-ca / FSL-1.1-MIT / AGPL / BSL / Authelia / `ldapjs` / `passport-ldapauth` / SAML-from-scratch / Cognito SaaS / Caddy as primary ingress / `git filter-branch` / BFG / `-f file1 -f file2` compose stacking.

---

## Feature Table Stakes — per phase

### Phase 13 — E2E + CJM harness

- **Must:** Cucumber+Playwright at `tests/e2e-cjm/` (separate from existing vitest `tests/e2e/`); `docs/customer-journeys.md` with ~20 journeys + `@cjm-N.M` tags; 8 auth scenarios + transcribe round-trip + admin landing + locale switch; Mailpit HTTP API for verification-email assertions; per-scenario DB teardown; `make e2e-cjm`; GHA `E2E_CJM=1` job.
- **Must (atomic with harness):** `apps/worker/src/index.ts:68-134` `noopSender` REPLACED with real nodemailer-backed `EmailSender` extracted to new `packages/email/`. The single most impactful Phase 13 commit.
- **Must (atomic):** testcontainers teardown (`tools/global-vitest-teardown.ts` + SIGINT/SIGTERM + CI `docker container prune --filter label=org.testcontainers=true` in `always()`).
- **Anti:** Real SMTP in CI; cross-browser matrix; full BACKEND_SPEC wire surface in `.feature`; mobile viewports; load/chaos/fuzz inside Cucumber.

### Phase 12 — Admin onboarding + UI-SPEC conformance

- **Must:** `/setup` gated by `setup_state` enum state machine (NOT users-count — brownfield trap); single-page wizard (email + password + display name + workspace + timezone); `POST /api/setup/admin` idempotent; new `GET /api/capabilities` (or `/api/auth/providers`) feeding conditional UI render; `/admin` index page (TD-12.a); resend-verification CTA on 403 screen (TD-12.e); per-field Zod errors (TD-13.b); semantic Playwright DOM conformance vs `design-canvas.jsx` (NOT pixel-diff); axe baseline+delta.
- **Must (migration):** `ALTER TABLE users ADD COLUMN role text`; backfill existing v1 installs to `setup_state.status='skipped_legacy'`.
- **Anti:** Multi-tenant tenant-creation in wizard; user-invite emails in wizard; skip-button without v1-upgrade detection; custom themes; SCIM; wizard redesign deviating from `design-canvas.jsx` (Phase 12 = CONFORMANCE, not redesign — TD-12.d trap).

### Phase 14 — Slim core + BYOK profiles

- **Must:** Slim default = 6 services (api+web+worker+postgres+valkey+litellm); `--profile observability|storage|ingress|pgbouncer|dev` opt-in overlays; `.env.slim.example` ~5 keys; BYOK matrix in `docs/operations.md`; bare `docker compose up` (no flag) MUST work — universal services have NO `profiles:` key (fixes TD-14.f / deferred-items #3a); Helm `*.enabled` ↔ compose overlay 1:1 mapping; loud-fail BYOK (refuse to start if `--with-storage` off AND `S3_ENDPOINT` unset).
- **Must (audit):** sweep `apps/worker/src/index.ts:68-92` for ALL three noops (`noopSender` + `noopLitellmKeyClient` + `noopUserKeyLookup`).
- **Anti:** Profile-of-profiles DSL; `.env` web UI editor; auto-detect cloud vendor; built-in S3; multi-region failover; blue/green automation.

### Phase 15 — Repo refactor + FSL + history scrub

- **Must:** Test colocation codified (recommendation: `apps/<app>/tests/{unit,integration}/` full split); `compose/` directory; Apache → FSL-1.1-ALv2 covering root LICENSE + every workspace `package.json` + 675 SPDX headers + every Docker `LABEL org.opencontainers.image.licenses` + README badges; `REUSE.toml` + `reuse lint` CI; DCO sign-off in CONTRIBUTING.md + retroactive existing-contributor consent thread; `git filter-repo --path speaches-audio.md --invert-paths`; Traefik host split (`web.localhost` vs `api.localhost` — fixes TD-15.g); `apps/web/public/.gitkeep` (fixes deferred-items #2); `Phase15-MOVE-INVENTORY.md` BEFORE any move PR; pre-scrub tag + `MIGRATING.md` + branch-protection lock/unlock/lock.
- **Anti:** Helm split to separate repo (gated on `/gsd-discuss-phase 15`); full Nx migration; BSL/SSPL/AGPL; rewriting history beyond `speaches-audio.md`; per-package versioning.

### Phase 16 — Phase-tag comment audit

- **Must:** AST-based ts-morph codemod (NOT regex); 50-file sample audit BEFORE bulk run; two-bucket REMOVE/KEEP classification; ESLint regression rule; ONE squashed commit OR grouped ≤ 50 files (never 771 atomic commits). **Scope = 771 comments in `apps/` + `packages/`** (TECH_DEBT's "1642" figure includes tests/tools/.planning which are OUT of audit scope — HARD scope correction).
- **Anti:** Auto-JSDoc; remove `// TODO:`; ban all `//` comments; manual line-by-line review.

### Phase 17 — Trusted local TLS + production ACME

- **Must:** `make tls-trust` running `mkcert -install` + explicit-host-list cert (`api.localhost`, `web.localhost`, `app.localhost`, `grafana.localhost`, `mailpit.localhost` — NOT `*.localhost` wildcard); Traefik dev profile serves mkcert certs; production ACME in `--with-ingress` profile; cert-manager Helm `Issuer` template; README quickstart `make tls-trust` step 2; air-gap path documented; dev-cert isolation (`.dockerignore` `**/rootCA*.pem` + prod Dockerfile lint forbids mkcert paths); SPLIT `dynamic.dev.yml` vs `dynamic.prod.yml`.
- **Anti:** Ship a real CA root in repo (CVE territory); auto-install mkcert via container; custom CA implementation; HTTP fallback when TLS fails; multi-domain DNS-01 wildcard.

### Phase 18 — LDAP/Keycloak (SPEC + ADR only — NO code in v2)

- **Must:** `SPEC-ldap-keycloak.md` ≤ 200 lines; option (a) Keycloak/Authentik OIDC frontend (RECOMMENDED — zero Better Auth surgery via existing `genericOAuth`) vs option (b) direct LDAP via `ldapts` + custom Better Auth plugin; decision matrix; JIT user-provisioning spec; group→role mapping spec; red Cucumber scenarios + `compose/test/keycloak.yml`; ADR `docs/adrs/0012-ldap-via-keycloak.md`.
- **Anti:** ANY code/compose/Helm changes in v2; SAML 2.0 (COMPL-01); SCIM (COMPL-02); Kerberos/SPNEGO; self-hosted IdP-portal UI; built-in MFA on top of LDAP; LDAP server compatibility matrix (v3 picks OpenLDAP only).

---

## Architecture Integration

### v2 dependency graph

```
       ┌──────────────────────────────────────────────────────────┐
       │   13 (E2E+CJM harness) ── HARD GATE for all of 12/14/17  │
       v                                                          │
   ┌────────┐    ┌────────┐                                       │
   │   13   │───>│   12   │  (admin wizard + UI conformance;      │
   │ harness│    │ admin  │   /api/capabilities reused by 14)     │
   │ +worker│    │ wizard │                                       │
   │  fix   │    └────────┘                                       │
   └────────┘        │                                            │
       │             v                                            │
       │     ┌─────────────────┐                                  │
       │     │ 15 ↔ 14 ORDER   │  ← DISAGREEMENT (Open Q §1)      │
       │     │  CHOOSE ONE     │                                  │
       │     └─────────────────┘                                  │
       │             │                                            │
       │             v                                            │
       │         ┌────────┐                                       │
       │         │   17   │ (TLS — depends on 14 ingress profile  │
       │         │  TLS   │  + 15 host split)                     │
       │         └────────┘                                       │
       │             │                                            │
       │             v                                            │
       │         ┌────────┐                                       │
       └────────>│   16   │ MUST run AFTER 15 — HARD constraint   │
                 │comments│  (FSL relicense rewrites every SPDX   │
                 └────────┘  header; running 16 first = redo)     │
                             │
                             v
                         ┌────────┐
                         │   18   │ SPEC only; ⊥ all code; ≥ 13
                         │  SPEC  │
                         └────────┘
```

**Hard ordering constraints:**

- 13 → all — non-negotiable
- 13 → 12 — worker `noopSender` fix unblocks signup-verify flow
- 15 → 17 — host split changes mkcert hostname list
- 15 → 16 — FSL codemod rewrites every SPDX header; running 16 first = redo
- 18 ⊥ all — schedulable anytime ≥ 13

### Per-phase scope

| Phase | Scope | Files (est) | New LOC (est) | Risk |
|---|---|---|---|---|
| 13 | L | 30+ new | 2000–3000 | HIGH |
| 12 | L | 6 new + 4 modified | 1500–2200 | MEDIUM |
| 14 | M | 7 new | 600–900 | LOW |
| 15 | L | ~600 moves + 675 headers + host split | mostly mechanical | HIGHEST (irreversible history rewrite) |
| 16 | S | ~771 comments | small | LOW |
| 17 | S | ~3-5 | small | LOW |
| 18 | S | 2 docs | 0 code | NONE |

---

## Watch Out For — Top 10 Pitfalls

Each cites a TECH_DEBT.md entry or deferred-items.md item.

1. **Weak-assertion test patterns ship bugs green** (TD-13.a, TD-13.d) — `getAllByText(...).length.toBeGreaterThan(0)` accepted the duplicate-banner bug. ESLint ban-list + grep sweep in Phase 13 BEFORE first Gherkin file.
2. **Happy-path-only Gherkin / no negative twin** (TD-13.c, TD-12.e) — Sign-in 403 has no resend-verification CTA. CJM.md MUST enumerate every error branch per journey.
3. **Capability drift between UI and backend** (TD-12.c) — SSO buttons render for 0 providers → 404 → 429. Phase 12 introduces `GET /api/capabilities`; Phase 14 reuses for BYOK UI gates.
4. **Brownfield wizard runs at the wrong time** (TD-12.b, TD-12.f) — Naive users-count check creates duplicate admins on v1-upgrade. Phase 12 ships explicit `setup_state` enum + backfill migration.
5. **E2E harness flakes in CI but not locally** (TD-13.e) — `docker compose up --wait` checks liveness not readiness. Readiness probes + per-scenario tenant isolation + BAN retry-on-flake.
6. **testcontainers leak** (deferred-items #1) — 13 orphan postgres containers + ~30GB volumes. SIGINT/SIGTERM cleanup + CI prune in `always()`. Cannot be deferred again.
7. **Compose profile semantics inverted** (TD-14.f, deferred-items #3a) — universal services must have NO `profiles:` key.
8. **BYOK silent fallback to wrong default** (TD-14.c, TD-mailpit) — three live `noopX` adapters at `apps/worker/src/index.ts:68-92`. Loud-fail pattern (refuse to start on misconfigured prod env).
9. **History scrub force-push breaks every downstream clone** (TD-15.f) — rewrites every SHA, invalidates signed commits, breaks fork/CI cache. Stage as release event: 7-day notice + pre-scrub tag + MIGRATING.md + branch-protection lock/unlock/lock + bundle WITH FSL.
10. **License switch misses surface** (TD-15.e) — root LICENSE edit covers ~1%. Codemod covers `package.json` license + SPDX in `.ts/.tsx/.js/.sh/.py/.sql/.yaml/.yml` + Docker LABELs + README badges + DCO + retroactive existing-contributor consent.

---

## Open Questions / Decisions Deferred to `/gsd-discuss-phase`

1. **Phase 14 ↔ 15 order swap** — User-proposed `…→14→15→…` (3 researchers agree: STACK, FEATURES, PITFALLS) vs ARCHITECTURE-proposed `…→15→14→…`. Surfaced, not flattened.
2. **Phase 13 BDD vs plain Playwright** — Cucumber+Playwright+playwright-bdd (STACK locks 8.4.2 + FEATURES advocates) vs plain `@playwright/test` with `describe('@cjm-3.2', …)` tags (ARCHITECTURE alternative). Gated on `/gsd-discuss-phase 13`.
3. **Phase 15 Helm monorepo vs separate repo** — ARCHITECTURE + Outline/Mattermost precedent argue keep-in-monorepo; TD-15.d originally proposed split. Gated on `/gsd-discuss-phase 15`.
4. **Phase 18 option (a) Keycloak/Authentik vs option (b) direct LDAP** — All four research files default to (a). SPEC must record decision after `/gsd-discuss-phase 18`.

---

## Roadmap Implications

- HARD ordering constraints: 13 first; 16 AFTER 15; 18 anytime ≥ 13.
- 4 OPEN decisions surfaced (not flattened): 14↔15 order, Phase 13 BDD-vs-plain, Phase 15 Helm split, Phase 18 option a/b.
- 2 split candidates strongly recommended by ARCHITECTURE: Phase 13 (13.a harness + worker fix + teardown + weak-assert sweep / 13.b feature files + CJM doc) and Phase 15 (15.a structural reorg + Traefik host split + test layout / 15.b FSL codemod + history scrub).
- 1 scope correction: Phase 16 = 771 comments, NOT 1642.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (v2 additions only) | HIGH | All 12 new dep choices verified on npm 2026-05; v1 untouched. |
| Features (per-phase table stakes) | HIGH | Every "must" maps 1:1 to a TECH_DEBT entry; patterns surveyed across Supabase/Plausible/Mattermost/Discourse/Outline/Sentry. |
| Architecture (file-by-file) | HIGH | Every claim traces to a specific live file/line on 2026-05-14. |
| Pitfalls (case-study form) | HIGH | Every pitfall anchored to an observed TECH_DEBT symptom — not hypothetical. |

**Overall confidence: HIGH.**
