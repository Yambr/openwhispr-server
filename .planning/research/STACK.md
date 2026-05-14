<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
<!-- REUSE-IgnoreStart -->
# Stack Research — v2 Production Readiness (Brownfield)

**Domain:** v2 milestone deltas on top of the locked v1 OpenWhispr Server stack
**Researched:** 2026-05-14
**Overall confidence:** HIGH
**Scope:** v2 ADDITIONS ONLY. The v1 stack — Node 24 LTS, Fastify 5, Better Auth 1.x, Drizzle, PostgreSQL 17, PgBouncer 1.23+, Valkey 8, BullMQ, LiteLLM ≥ 1.83.7-stable, Next.js 15, React 19, Tailwind 4, shadcn/ui v2, Docker Compose, Helm 3, Traefik 3, LGTM observability, MinIO, i18next + i18next-icu — is **locked** and not re-researched here. See `.planning/research/STACK-SUMMARY.md` and the prior v1 STACK content (preserved at git revision `f3bb03e` if needed) for that rationale. **This file documents only what v2 phases 12–18 add.**

---

## TL;DR — v2 Additions Only

| Concern | Pick | Version | Phase | Confidence |
|---|---|---|---|---|
| BDD feature-file authoring (Gherkin DSL) | **`@cucumber/cucumber`** (NOT as runner) | **12.8.2** | 13 | HIGH |
| E2E browser driver + runner | **`@playwright/test`** | **1.60.0** | 13 | HIGH |
| BDD ↔ Playwright glue | **`playwright-bdd`** (compiles `.feature` → spec; keeps Playwright runner) | **8.4.2** | 13 | HIGH |
| Accessibility scan (CJM screens) | `@axe-core/playwright` — already in v1 Phase 07.1 | 4.x | 13 | HIGH |
| Local trusted TLS (dev) | **mkcert** binary (Go, OS trust-store installer) | **1.4.4** | 17 | HIGH |
| Production ACME (compose) | Traefik 3 `certificatesResolvers.acme` — already shipped | Traefik 3.x | 17 | HIGH |
| Production ACME (K8s) | **cert-manager** (Helm sub-chart, conditional) | **1.16+** | 17 | HIGH |
| License | **FSL-1.1-ALv2** (Apache-2.0 future grant) | FSL-1.1 | 15 | HIGH |
| SPDX-header sweep | **`reuse`** (FSFE) | **5.x** | 15 | MEDIUM |
| Git history scrub | **`git-filter-repo`** | **2.47.0** | 15 | HIGH |
| Compose slim-core / BYOK | Compose Spec `profiles:` (no new dep) | Compose ≥ 2.30 | 14 | HIGH |
| Helm BYOK conditionals | Native `dependencies[].condition` + `{{ if .Values.X.enabled }}` (no new dep) | Helm 3.x | 14 | HIGH |
| Better Auth enterprise SSO | **`@better-auth/sso`** (SAML + OIDC, multi-tenant) | latest 1.x (Better Auth 1.5+) | 18 (SPEC only) | HIGH |
| Direct LDAP (option B) | **`ldapts`** (NOT decommissioned `ldapjs`) | **8.1.7** | 18 (only if Opt-B picked) | HIGH |
| LDAP-fronting IdP (option A, recommended) | **Keycloak** (rolling, no LTS) | **26.6.1** | 18 | HIGH |
| LDAP-fronting IdP alternative | **Authentik** | **2026.2.2** | 18 | HIGH |
| Admin onboarding wizard | **No new lib** — RHF 7 + Zod 3 + shadcn/ui Stepper (Tabs + Progress) | uses v1 stack | 12 | HIGH |

---

## 1. Cucumber + Playwright E2E Harness (Phase 13)

### Pick

| Package | Version | Role |
|---|---|---|
| `@playwright/test` | **1.60.0** | Browser driver + runner. Keep this in control — do NOT replace with Cucumber's runner. |
| `playwright-bdd` | **8.4.2** | Compiles `.feature` → Playwright spec files via `npx bddgen`. Preserves fixtures, parallel workers, trace viewer, retries, sharding. |
| `@cucumber/cucumber` | **12.8.2** | Peer dep of `playwright-bdd`. Used for Gherkin syntax (`Given/When/Then` decorators) — **never invoked as the runner**. TS-native config since 12.4. |

### Rationale

The Phase 07.1 web stack already invests in `@playwright/test` (85 PASS, real docker-compose stack, GHA matrix, `apps/web/playwright.config.ts`). The v2 ask is **Gherkin CJM coverage** so non-engineers can author/audit journeys. Two architectures exist:

1. **`@cucumber/cucumber` as the runner** — replaces Playwright's runner with Cucumber's. Loses parallel workers, fixtures, `--ui` trace viewer, `--retries`, `--shard`, `playwright-report/`. **Rejected.**
2. **`playwright-bdd` adapter** — `bddgen` compiles `.feature` → `*.spec.ts`; Playwright runner stays in control. **Chosen.**

Industry consensus 2026: playwright-bdd is the preferred path when Playwright is already established (community comparisons on npm-compare, vitalets.github.io/playwright-bdd, Medium/DEV posts).

### Integration

```
tests/e2e/
├── CJM.md                       # Customer Journey Map ↔ feature-file traceability table
├── features/                    # Gherkin sources — co-located by journey
│   ├── auth/signup-then-verify.feature
│   ├── auth/signin.feature
│   ├── auth/password-reset.feature
│   ├── auth/resend-verification.feature
│   ├── admin/first-run-onboarding.feature
│   ├── admin/oidc-provider-config.feature
│   ├── transcribe/upload-and-poll.feature
│   ├── locale/switch-en-ru.feature
│   └── errors/invalid-creds.feature
├── steps/                       # TS step defs (Given/When/Then implementations)
├── fixtures/                    # Playwright fixtures (user, tenant, mailpit client, axe)
├── playwright.config.ts         # extends apps/web/playwright.config.ts; testDir=.features-gen
└── .features-gen/               # bddgen output — .gitignored
```

`package.json` (root):
```jsonc
{
  "scripts": {
    "test:e2e": "bddgen --config tests/e2e/playwright.config.ts && playwright test --config=tests/e2e/playwright.config.ts",
    "test:e2e:ui": "bddgen && playwright test --ui --config=tests/e2e/playwright.config.ts"
  },
  "devDependencies": {
    "@cucumber/cucumber": "^12.8.2",
    "@playwright/test": "^1.60.0",
    "playwright-bdd": "^8.4.2"
  }
}
```

`Makefile` adds `e2e-test: ; pnpm test:e2e`. GHA workflow `.github/workflows/ci.yml` adds an `e2e` job that boots `docker compose --profile dev up -d --wait` then runs `pnpm test:e2e`. Mailpit (dev profile) is used for the signup→verify journey — and the CJM E2E test for that journey is exactly what surfaces the `apps/worker/src/index.ts:128-134` noopSender bug (TD-mailpit).

### Anti-shortlist

| Tool | Why not |
|---|---|
| **Selenium / WebDriverIO** | Slower, flakier; no built-in trace viewer; Playwright is v1 incumbent. |
| **Cypress** | Single-tab limitation breaks OIDC popup flow; awkward cross-context sharing. |
| **TestCafe / Nightwatch** | Declining ecosystems; no Gherkin first-class. |
| **Jest** | Not a browser runner. Vitest is already the v1 unit runner — don't fork. |
| **Mocha + chai** for E2E | No headless browser, no parallel sharding. |
| **`@cucumber/cucumber` *as the runner*** | Discards Phase 07.1 Playwright infra (workers, fixtures, trace viewer). |
| **Roll-our-own Gherkin parser** | Reinvents `@cucumber/gherkin`. |

Sources:
- [@cucumber/cucumber 12.8.2 — npm](https://www.npmjs.com/package/@cucumber/cucumber)
- [@playwright/test 1.60.0 — npm](https://www.npmjs.com/package/@playwright/test)
- [playwright-bdd 8.4.2 — npm](https://www.npmjs.com/package/playwright-bdd)
- [Playwright-BDD documentation](https://vitalets.github.io/playwright-bdd/)

---

## 2. Trusted Local TLS (Phase 17)

### Pick

| Tool | Version | Role |
|---|---|---|
| **mkcert** (Go binary) | **1.4.4** | One-shot install of a per-machine local CA into the OS trust store + Firefox NSS; mints `*.localhost` certificates the browser accepts without warning |
| **Traefik 3 `file` provider** | existing v1 | Loads the mkcert-minted cert via `tls.certificates` block from a mounted dir |
| **Traefik 3 `certificatesResolvers.acme`** | existing v1 | Production Let's Encrypt (HTTP-01 + TLS-ALPN-01); activates when `--with-ingress` profile + `LETSENCRYPT_EMAIL` env are set |
| **cert-manager** (K8s alt) | 1.16+ | Helm sub-chart `if .Values.ingress.certManager.enabled` |

### Rationale

mkcert 1.4.4 (Dec 2022) remains the canonical local-CA tool in 2026 (brew, choco, mise). Not a runtime dep — operators run `mkcert -install` ONCE on their dev machine. Per-machine `rootCA.pem` lives in `~/.local/share/mkcert/` (Linux), `~/Library/Application Support/mkcert/` (macOS), `%LOCALAPPDATA%/mkcert/` (Windows) and is trusted by the system keychain + Firefox NSS.

Caddy's `tls internal` directive accomplishes the same effect with no separate tool, but our v1 ingress is Traefik 3 — switching dev to Caddy introduces a dev/prod divergence not worth absorbing. Keep Traefik 3; feed it a mkcert cert.

### Integration

`compose/traefik/dynamic/tls-dev.yml` (new file, mounted only in dev/local profile):
```yaml
tls:
  certificates:
    - certFile: /certs/api.localhost.pem
      keyFile:  /certs/api.localhost-key.pem
      stores: [default]
  stores:
    default:
      defaultCertificate:
        certFile: /certs/api.localhost.pem
        keyFile:  /certs/api.localhost-key.pem
```

`Makefile`:
```make
.PHONY: trust-local-tls
trust-local-tls:
	@which mkcert >/dev/null || (echo "Install: brew install mkcert nss" && exit 1)
	mkcert -install
	mkdir -p compose/traefik/certs
	cd compose/traefik/certs && mkcert -cert-file api.localhost.pem -key-file api.localhost-key.pem \
	  api.localhost web.localhost '*.localhost' 127.0.0.1 ::1
	@echo "Local CA trusted. Restart: docker compose restart traefik"
```

**CI:** mkcert does NOT run in CI. CI E2E either uses Playwright `ignoreHTTPSErrors: true` against the self-signed default, OR a checked-in dev CA referenced via `NODE_EXTRA_CA_CERTS=tests/e2e/fixtures/test-ca.pem`. mkcert is dev-machine UX, full stop.

**Prod:** Traefik ACME issuer wires through automatically when Phase 14's `--with-ingress` profile + `LETSENCRYPT_EMAIL` are set. Phase 17 confirms this wiring + ships docs.

### Anti-shortlist

| Tool | Why not |
|---|---|
| **Self-signed openssl one-liners** | Status quo — TD-17.a, browser red-warning UX kills first-run trust. |
| **smallstep/step-ca daemon** | Full PKI daemon for dev is overkill. |
| **`devcert` npm package** | Unmaintained since 2020 (v1.2.2). |
| **`mkcert` npm package** (JS reimplementation) | Doesn't install into OS trust store reliably. Use the Go binary. |
| **Let's Encrypt staging cert** | Can't issue for `*.localhost` (no public DNS). |
| **Caddy as primary dev ingress** | Forks dev/prod (prod = Traefik 3). |
| **NGINX self-signed** | Excluded by v1 ingress decision. |

Sources:
- [mkcert GitHub releases](https://github.com/FiloSottile/mkcert/releases) — 1.4.4 current
- [mkcert Homebrew formula](https://formulae.brew.sh/formula/mkcert)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) (reference)

---

## 3. First-Run Admin Onboarding Wizard (Phase 12)

### Pick

**No new dependencies.** Reuse v1 web stack:

| Layer | Library | Source |
|---|---|---|
| Router | Next.js 15 App Router | v1 |
| Form state | React Hook Form 7 + Zod 3 | v1 (Phase 07.1) |
| UI primitives | shadcn/ui v2 — `Tabs` + `Progress` composed into a Stepper | v1 (Phase 07.1) |
| Auth backend | Better Auth 1.x `signUp.email` + new `POST /api/admin/bootstrap` route | v1 + new route |
| i18n | i18next + i18next-icu (en, ru) | v1 (Phase 10) |

### Rationale

TD-12.a/b/f are UX gaps, not tech gaps. Wizard references (Supabase Studio first-run, Plausible self-host setup, Outline first-admin, Sentry onboarding) all use the same stack we have. Introducing a "wizard library" (e.g. `react-step-wizard`, `formik-stepper`, `@stepperize/react`) duplicates RHF + shadcn.

### Integration

- `apps/web/src/app/setup/page.tsx` — server component checks `GET /api/admin/bootstrap/status` → `{needsBootstrap}`. If true, render wizard; if false, redirect to `/admin`.
- `apps/api/src/routes/admin/bootstrap.ts` — `POST /api/admin/bootstrap` accepts `{email, password, tenantName?}`, idempotent (refuses if an admin already exists), creates user via `auth.api.signUpEmail({ role: "admin" })`, audits, returns session cookie.
- E2E coverage: `tests/e2e/features/admin/first-run-onboarding.feature` (Phase 13 harness).
- Phase 12 simultaneously executes the UI-SPEC conformance audit (TD-12.d) — wizard + auth screens drift back to `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` + `design-canvas.jsx`.

### Anti-shortlist

| Library | Why not |
|---|---|
| `react-step-wizard` | Unmaintained since 2022 (v5.3.11). |
| `formik` + `formik-stepper` | RHF 7 is the v1 standard; forking form state is a regression. |
| `@stepperize/react` | Third-party state machine; RHF + Zod discriminated union covers this. |
| `xstate` | Overkill for a 4-step linear flow. |
| Custom auth UI bypassing Better Auth | Defeats the "admin lives in `users` with `role=admin`" plan. |

---

## 4. FSL Relicense + SPDX Sweep (Phase 15)

### Pick

| Artefact | Choice |
|---|---|
| License | **FSL-1.1-ALv2** (Functional Source License 1.1 with Apache-2.0 future grant after 2 years) |
| SPDX identifier | `FSL-1.1-ALv2` (recognised in SPDX License List since 2024) |
| `package.json` | `"license": "FSL-1.1-ALv2"` across all workspaces (api, web, worker, packages/*, charts) |
| `LICENSE` file | Verbatim text from fsl.software FSL-1.1-ALv2 template |
| Sweep tool | **`reuse`** (FSFE) v5.x — SPDX-3.0-compatible bulk annotator + linter |
| Manifest | `REUSE.toml` at repo root |
| CI gate | `reuse lint` job in `.github/workflows/ci.yml` |

### Rationale

FSL-1.1-ALv2 vs FSL-1.1-MIT: the `-ALv2` suffix declares Apache-2.0 as the future license; this matches the v1 Apache-2.0 choice, so the 2-year sunset converges to the license we already use (no semantic break for downstream redistribution). The Competing-Use restriction during the 2-year source-available window is the only deviation — exactly the protection requested.

`reuse` is the FSFE-canonical SPDX header tool, used by Linux Foundation projects, KDE, GNOME. Idempotent re-runs; CI-friendly; understands shebangs, YAML front-matter, JSX.

### Integration

1. Replace `LICENSE` with FSL-1.1-ALv2 template.
2. Update every workspace `package.json` `license` field.
3. Create `REUSE.toml`:
   ```toml
   version = 1
   SPDX-PackageName = "openwhispr-server"
   SPDX-PackageSupplier = "OpenWhispr"

   [[annotations]]
   path = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.py", "**/*.go", "**/*.sh"]
   SPDX-FileCopyrightText = "2026 OpenWhispr"
   SPDX-License-Identifier = "FSL-1.1-ALv2"
   ```
4. `pipx install reuse-tool && reuse annotate --recursive .` rewrites headers.
5. Add `reuse lint` GHA step.
6. Update `CONTRIBUTING.md`: every new file MUST carry `SPDX-License-Identifier: FSL-1.1-ALv2`.
7. Update `NOTICE.md` with attribution for Apache-2.0 deps.

### Anti-shortlist

| Tool / Choice | Why not |
|---|---|
| `license-check-and-add` (npm) | npm-only, no SPDX-3.0 awareness. |
| `addlicense` (Google Go) | Doesn't read REUSE manifest; opinionated. |
| `licensee` (GitHub) | Detector, not annotator. |
| Custom bash codemod | Reinvents `reuse`; edge cases. |
| **FSL-1.1-MIT** | Changes future-license from v1's Apache-2.0 to MIT. |
| **BUSL-1.1** | FSL is the simpler non-parameterised alternative. |
| **AGPL-3.0** | Corporate legal blocker; rejects our target audience. |
| **PolyForm** licenses | Niche, not in SPDX core list. |

Sources:
- [FSL-1.1-ALv2 — SPDX License List](https://spdx.org/licenses/FSL-1.1-ALv2.html)
- [Functional Source License — fsl.software](https://fsl.software/)
- [Sentry FSL announcement](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/)
- [reuse tool — FSFE](https://reuse.software/)

---

## 5. Git History Scrub (Phase 15)

### Pick

**`git-filter-repo` 2.47.0** (Dec 2024 stable). Install via `brew install git-filter-repo` or `pipx install git-filter-repo`.

### Rationale

GitHub's own docs recommend it as the `filter-branch` replacement. 2.47.0 added `--sensitive-data-removal` diagnostics. Operations that take hours under `filter-branch` complete in seconds.

### Integration

```bash
git clone --mirror git@github.com:openwhispr/openwhispr-server.git scrub.git
cd scrub.git
git filter-repo --path speaches-audio.md --invert-paths --force
git log --all --full-history -- speaches-audio.md   # expect empty
git push --force --all
git push --force --tags
```

**Coordination runbook in Phase 15 PLAN.md MUST include:**
1. Lock branch protection on `main`.
2. Tag the pre-scrub commit (`v2-pre-scrub`).
3. Announcement issue requiring ack from every collaborator (`git log --format='%ae' | sort -u`).
4. Force-push.
5. Every collaborator: `git fetch --all && git reset --hard origin/<branch>`.
6. Reopen / rebase any in-flight PRs against the new history.
7. Note: GitHub retains rewritten SHAs in PR caches for ≈90 days; acceptable for our threat model (operator config doc, not a secret).

### Anti-shortlist

| Tool | Why not |
|---|---|
| `git filter-branch` | Officially deprecated, hours-slow. |
| BFG Repo Cleaner | Java JAR, dated, weaker UX. |
| Manual rebase + cherry-pick | Breaks signed commits, infeasible at scale. |
| GitHub support ticket | Only for PII, not config files. |

Sources:
- [git-filter-repo GitHub](https://github.com/newren/git-filter-repo) — 2.47.0
- [Homebrew formula](https://formulae.brew.sh/formula/git-filter-repo)

---

## 6. Compose Slim-Core + BYOK Profiles (Phase 14)

### Pick

**Pure Compose Spec `profiles:` (Docker Compose ≥ 2.30). No new dependency.**

### Rationale

Compose Spec: services without a `profiles:` key are always-on (the "core"); services WITH a profile key are opt-in via `--profile <name>` or `COMPOSE_PROFILES=<name>`. Enable multiple profiles with `--profile A --profile B`.

Critical default-profile gotcha (TD-14.f): v1's compose marks every service `profiles: [default]`, so a bare `docker compose up` selects zero services. Phase 14 MUST drop `profiles:` from the slim-core set entirely, not just add new optional profiles.

### Integration

```yaml
# compose/docker-compose.yml — slim-core has NO profiles: key on:
services:
  api: { ... }
  web: { ... }
  worker: { ... }
  postgres: { ... }
  valkey: { ... }
  litellm: { ... }      # set LITELLM_BASE_URL to disable + BYOK-out

  # Opt-in groups:
  grafana:        { profiles: [observability], ... }
  loki:           { profiles: [observability], ... }
  tempo:          { profiles: [observability], ... }
  mimir:          { profiles: [observability], ... }
  otel-collector: { profiles: [observability], ... }

  minio:          { profiles: [storage], ... }
  traefik:        { profiles: [ingress], ... }
  pgbouncer:      { profiles: [pgbouncer], ... }

  # Dev-only:
  mailpit:        { profiles: [dev], ... }
```

Use YAML anchors `x-common-env: &common-env` to avoid env duplication across services.

`.env.slim.example` ships ≈5 keys (DATABASE_URL, VALKEY_URL, LITELLM_VIRTUAL_KEY, MASTER_KEK, ADMIN_BOOTSTRAP_TOKEN). `.env.full.example` extends with observability/storage/ingress keys.

`Makefile`:
```make
up:           ; docker compose up -d --wait                      # slim
up-full:      ; docker compose --profile observability --profile storage --profile ingress --profile pgbouncer up -d --wait
dev:          ; docker compose --profile dev up -d --wait
```

### Anti-shortlist

| Approach | Why not |
|---|---|
| Multiple `-f file1.yml -f file2.yml` stacking | Bash gymnastics; confusing for operators. |
| `docker-compose.override.yml` magic merge | Implicit; obscures prod toggles. |
| Bash + `envsubst` template wrapper | Re-invents Helm. |
| `COMPOSE_FILE=...` env tricks | Same problem as `-f`. |
| Docker Swarm stack | Different runtime; v1 is single-host. |
| Podman quadlets | Excludes Docker Desktop users. |

Sources:
- [Docker Compose profiles — docs.docker.com](https://docs.docker.com/compose/how-tos/profiles/)
- [Compose Spec profiles reference](https://docs.docker.com/reference/compose-file/profiles/)

---

## 7. Helm BYOK Conditional Dependencies (Phase 14)

### Pick

**Helm 3 native `Chart.yaml dependencies[].condition` + `{{ if .Values.X.enabled }}` template gates. No new dependency.**

### Rationale

Two mechanisms:
- `condition: foo.enabled` in `Chart.yaml` dependencies → gates sub-chart installation.
- `{{ if .Values.foo.enabled }}…{{ end }}` in templates → gates inline resources within the parent chart.

Helm best-practices doc explicitly recommends `condition` over `tags` for individual-component control. Default of `condition` if path absent is `true` — v2 convention: **explicitly set `enabled: false` for optional sub-charts** to force opt-in.

### Integration

`charts/openwhispr/Chart.yaml`:
```yaml
apiVersion: v2
name: openwhispr-server
version: 2.0.0
dependencies:
  - name: postgresql
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
  - name: valkey
    repository: oci://registry-1.docker.io/bitnamicharts
    condition: valkey.enabled
  - { name: grafana, repository: https://grafana.github.io/helm-charts, condition: observability.enabled }
  - { name: loki,    repository: https://grafana.github.io/helm-charts, condition: observability.enabled }
  - { name: tempo,   repository: https://grafana.github.io/helm-charts, condition: observability.enabled }
  - { name: mimir-distributed, repository: https://grafana.github.io/helm-charts, condition: observability.enabled }
  - { name: opentelemetry-collector, repository: https://open-telemetry.github.io/opentelemetry-helm-charts, condition: observability.enabled }
  - { name: minio,   repository: https://charts.bitnami.com/bitnami, condition: storage.enabled }
  - { name: cloudnative-pg, repository: https://cloudnative-pg.github.io/charts, version: "1.29.x", condition: postgresql.cnpg.enabled }
  - { name: cert-manager, repository: https://charts.jetstack.io, version: "1.16.x", condition: ingress.certManager.enabled }
```

`values.yaml`:
```yaml
postgresql:    { enabled: true, cnpg: { enabled: false } }
valkey:        { enabled: true }
observability: { enabled: false }
storage:       { enabled: false }
ingress:       { enabled: true,  certManager: { enabled: false } }
```

Test: `helm template . --set observability.enabled=false | grep -c grafana` should return 0; same with `=true` returns > 0. Snapshot tests at `charts/openwhispr/tests/`.

### Anti-shortlist

| Approach | Why not |
|---|---|
| Umbrella chart with everything always-on | Same anti-pattern as Compose-without-profiles. |
| `tags:` instead of `condition:` | Helm docs recommend condition for individual-control cases. |
| Helmfile | Wrapper tool, unnecessary at our scale. |
| Kustomize overlays | Mixes paradigms with Helm. |
| `lookup` for runtime detection | Brittle across clusters. |

Sources:
- [Helm dependencies best practices](https://helm.sh/docs/chart_best_practices/dependencies/)
- [Helm Charts: dependencies field](https://helm.sh/docs/topics/charts/)

---

## 8. Better Auth + LDAP/Keycloak SSO (Phase 18 — SPEC only in v2)

v2 ships a SPEC + ADR; implementation lands in v3 after the `/gsd-discuss-phase 18` outcome.

### Option A (RECOMMENDED): Keycloak/Authentik OIDC frontend over LDAP

| Component | Pick | Version |
|---|---|---|
| Better Auth core | already in v1 | 1.5+ |
| Enterprise SSO plugin | **`@better-auth/sso`** | latest 1.x (separate npm package; SAML 2.0 + OIDC; multi-tenant via `registerSSOProvider`) |
| LDAP-fronting IdP (primary) | **Keycloak** | **26.6.1** (Apr 2026) |
| LDAP-fronting IdP (alt) | **Authentik** | **2026.2.2** (Feb 2026) |

`@better-auth/sso` adds enterprise SSO atop Better Auth (Better Auth 1.5+ baseline). 2026.02 brought shared OIDC redirect URI + OIDC `aud` claim validation. Multi-tenant runtime registration of providers via `registerSSOProvider`. Distinct from v1's `genericOAuth` (which we already use for global Google/Azure/Okta per AUTH-05) — `@better-auth/sso` is the enterprise tier with per-tenant config + SAML.

Keycloak 26.6.1 has no traditional LTS; each major receives 2–3 years Full Support then Maintenance. 26.x is the current line. Built-in LDAP User Federation exposes corporate LDAP as OIDC + SAML to our server.

Authentik 2026.2.2 is the active alternative (switching to 3-month release cadence from 2026.5).

### Option B: Direct LDAP via custom Better Auth plugin

| Component | Pick | Version |
|---|---|---|
| LDAP client | **`ldapts`** (NOT `ldapjs`) | **8.1.7** |
| Custom Better Auth plugin | built in-house | — |

`ldapjs` was decommissioned 2024-05-14 by its last maintainer. `ldapts` is the TypeScript-native, promise-based, actively-maintained replacement (8.1.7, two months ago). Custom plugin: on `signIn.email`, `bind()` against LDAP using user credentials → success synthesizes a Better Auth session, failure throws `AuthError`. Tighter coupling, more code, but no Keycloak ops.

### Decision criteria

| Question | Favours A | Favours B |
|---|---|---|
| Operator already runs Keycloak / Authentik | ✅ | — |
| Zero extra services desired | — | ✅ |
| Need SAML alongside LDAP | ✅ | ❌ (separate impl) |
| Need MFA, password policy, federation | ✅ | ❌ (must rebuild) |
| Compliance demands a discrete IdP product | ✅ | ❌ |

**Default recommendation: A.** Final pick = `/gsd-discuss-phase 18` outcome.

### Anti-shortlist

| Library / Choice | Why not |
|---|---|
| **`ldapjs`** | Decommissioned 2024-05-14. |
| `passport-ldapauth` / Passport.js | Better Auth replaces Passport in v1. |
| `activedirectory` / `activedirectory2` | AD-specific; we need generic LDAP. |
| Roll-our-own SAML | xmldsig/canonicalisation = security minefield. |
| **Authelia** | Forward-auth proxy model, not OIDC IdP for desktop bearer flow. |
| Cognito / Okta / Auth0 SaaS | Incompatible with self-host audience. |
| Bundle Keycloak in slim-core | Adds ~600MB + JVM; opt-in via `--profile sso` only. |
| FreeIPA | Heavy; not the corp standard for new deploys. |
| OpenLDAP container in default compose | Same overweight problem. |

Sources:
- [@better-auth/sso — npm](https://www.npmjs.com/package/@better-auth/sso)
- [Better Auth SSO docs](https://better-auth.com/docs/plugins/sso)
- [Better Auth 1.5 release](https://better-auth.com/blog/1-5)
- [Keycloak 26.6.1 release notes](https://www.keycloak.org/2026/04/keycloak-2661-released)
- [Keycloak endoflife.date](https://endoflife.date/keycloak)
- [Authentik 2026.2 release](https://goauthentik.io/blog/2026-02-27-authentik-version-2026-2/)
- [ldapts 8.1.7 — npm](https://www.npmjs.com/package/ldapts)
- [ldapjs decommissioned — ldapjs.org](https://ldapjs.org/)

---

## 9. Phase-Tag Comment Audit (Phase 16) — Tooling Note

No new dependencies. The 1642 `// Phase XX / Plan YY / D-ZZ` comments are addressed via:
- `grep -rn --include='*.ts' --include='*.tsx' -E '// (Phase|Plan|D-)[0-9.]+' apps/ packages/` → inventory.
- Heuristic for removal: if grep-removing the comment would NOT confuse a reader, kill it. Keep only those documenting non-obvious WHY.
- Codemod via `jscodeshift` (already in dev tree from Next.js, no new install) for mechanical bulk-removal once policy is approved.

### Anti-shortlist

| Tool | Why not |
|---|---|
| `ts-morph` | Heavier than needed; `jscodeshift` AST suffices. |
| Custom regex `sed -i` | OK for very mechanical patterns; jscodeshift handles edge cases (JSDoc preservation). |
| ESLint rule | Would flag every existing comment; one-shot codemod is cleaner. |

---

## Version Compatibility Matrix (v2 additions)

| Package A | Compatible With | Notes |
|---|---|---|
| `@cucumber/cucumber` 12.x | Node ≥ 20, TS 5.x | TS-native config since 12.4 |
| `playwright-bdd` 8.x | `@cucumber/cucumber` ≥ 11, `@playwright/test` ≥ 1.50 | Drops Cucumber runner |
| `@playwright/test` 1.60 | Node ≥ 20 (Node 24 OK) | Chromium 132, Firefox 134, WebKit 18.2 |
| mkcert 1.4.4 | macOS 12+, Linux glibc 2.31+, Windows 10+ | Go binary; no npm runtime dep |
| FSL-1.1-ALv2 | npm registry accepts SPDX id | Apache-2.0 grant 2y after release |
| `reuse` 5.x | Python ≥ 3.10, SPDX-3.0 | FSFE official |
| git-filter-repo 2.47.0 | git ≥ 2.36, Python ≥ 3.8 | Brew installable |
| Compose `profiles:` | Compose Spec v1.x, Docker Compose ≥ 2.30 | Ships in all current Docker Desktop |
| Helm `condition:` | Helm ≥ 3.7 | Current 3.x |
| `@better-auth/sso` 1.x | Better Auth core 1.5+ | Separate npm package |
| `ldapts` 8.1.7 | Node ≥ 18, TS-native | Drop-in for ldapjs |
| Keycloak 26.6.1 | OpenJDK 21 | Multi-arch container |
| Authentik 2026.2.2 | Python 3.14, PostgreSQL ≥ 12 | Helm chart available |
| cert-manager 1.16 | K8s ≥ 1.28, Helm 3 | Works with Traefik / ingress-class agnostic |

---

## Hard "do not use" Shortlist (v2 anti-additions, aggregated)

1. Selenium / WebDriverIO / Cypress / TestCafe / Nightwatch — Playwright is incumbent.
2. `@cucumber/cucumber` as the test runner — DSL only; runner = Playwright via `playwright-bdd`.
3. Jest for E2E or unit — Vitest is the v1 unit runner.
4. `devcert` npm — unmaintained.
5. smallstep/step-ca daemon — dev overkill.
6. `mkcert` npm package (JS reimpl) — use the Go binary.
7. Caddy as primary dev ingress — forks dev/prod from Traefik 3.
8. NGINX self-signed — excluded by v1.
9. `react-step-wizard` / Formik / xstate for onboarding — RHF + shadcn Tabs is sufficient.
10. FSL-1.1-MIT — would shift future-license from v1's Apache-2.0 to MIT.
11. AGPL-3.0 / BUSL-1.1 — overrestrictive for corporate self-host.
12. `license-check-and-add` / `addlicense` / `licensee` (as annotator) — use `reuse`.
13. `git filter-branch` / BFG Repo Cleaner — `git-filter-repo` is the modern tool.
14. `-f file1.yml -f file2.yml` stacking / `docker-compose.override.yml` magic — use `profiles:`.
15. Helmfile / Kustomize overlays — native `condition:` is sufficient.
16. `ldapjs` — decommissioned 2024-05-14.
17. `passport-ldapauth` / Passport.js — Better Auth replaces Passport in v1.
18. `activedirectory[2]` — AD-specific.
19. Roll-our-own SAML / xmldsig parser — security minefield.
20. Authelia — wrong model (forward-auth proxy, not OIDC IdP).
21. Cognito / Okta / Auth0 SaaS — incompatible with self-host target.
22. Bundling Keycloak in slim-core — opt-in via `--profile sso`.
23. `ts-morph` for comment audit — `jscodeshift` (already in tree) is enough.

---

## Confidence Assessment

| Area | Level | Reason |
|---|---|---|
| Cucumber + Playwright (playwright-bdd) | HIGH | All three packages verified on npm 2026-05; 12.8.2 / 1.60.0 / 8.4.2 current. |
| mkcert + Traefik dev TLS | HIGH | 1.4.4 confirmed current stable; pattern unchanged. |
| Onboarding wizard (no new dep) | HIGH | Reuses v1 stack; references widely-deployed precedent. |
| FSL-1.1-ALv2 + `reuse` | HIGH | SPDX-recognised since 2024; FSFE-canonical tool. |
| `git-filter-repo` 2.47.0 | HIGH | GitHub-recommended; current stable. |
| Compose `profiles:` | HIGH | Pure spec feature; widely deployed. |
| Helm `condition:` | HIGH | Helm-official best practice. |
| Better Auth SSO + Keycloak/Authentik | HIGH | Versions current Apr/Feb 2026; `@better-auth/sso` is documented enterprise plugin. |
| `ldapts` vs `ldapjs` | HIGH | `ldapjs` decommissioned per official site; `ldapts` 8.1.7 active. |
| Phase 16 tooling | MEDIUM | `jscodeshift` is in-tree but exact codemod logic depends on Phase 16 PLAN policy. |

---

## Roadmap Implications

| New dep | Goes into | Tests-first artefact |
|---|---|---|
| `@playwright/test` 1.60, `@cucumber/cucumber` 12.8.2, `playwright-bdd` 8.4.2 | **Phase 13 (FIRST — harness)** | `tests/e2e/features/*.feature` + `steps/*.ts`; `pnpm test:e2e` GHA job; CJM.md traceability |
| mkcert binary, Traefik dynamic TLS config, cert-manager Helm sub-chart | Phase 17 | `make trust-local-tls`; CI uses `NODE_EXTRA_CA_CERTS` + a checked-in dev CA |
| FSL LICENSE, `reuse` CLI, SPDX headers, `REUSE.toml` | Phase 15 | `reuse lint` GHA job; per-file headers; root LICENSE swap |
| `git-filter-repo` (one-shot, not a runtime dep) | Phase 15 | Coordinated force-push runbook + collaborator-ack checklist in PLAN.md |
| Compose `profiles:` refactor (no new dep) | Phase 14 | `tests/e2e/features/profiles/slim-core-boot.feature`; `.env.slim.example` |
| Helm `condition:` refactor (no new dep) | Phase 14 | `helm template` snapshot tests at `charts/openwhispr/tests/` |
| `@better-auth/sso`, `ldapts`, Keycloak/Authentik | **Phase 18 (SPEC + ADR only in v2)** | ADR + SPEC.md; impl deferred to v3 post-`/gsd-discuss-phase 18` |
| No new dep | Phase 12 (onboarding) | `tests/e2e/features/admin/first-run-onboarding.feature` (depends on 13 harness) |
| No new dep | Phase 16 (comment audit) | Inventory grep + codemod commit chain; per-file diff review |

**Phase ordering — `13 → 12 → 14 → 15 → 16 → 17 → 18`:**

- **13 first** (E2E harness) — every other v2 phase writes test-first against it; without 13, fixes ship blind.
- **12 next** (admin onboarding + UI conformance) — depends on 13 harness for first-run-onboarding.feature.
- **14** (slim-core + BYOK) — independent of 12 but easier with 13's profile-boot E2E in place.
- **15** (refactor + FSL + history scrub) — done late so 13's tests + CI gates protect the refactor.
- **16** (comment audit) — pure cleanup; safer after 15 settles structure.
- **17** (trusted TLS) — depends on Phase 14's `--with-ingress` profile being defined.
- **18** (LDAP/Keycloak SPEC) — research + SPEC only in v2; impl in v3.

Sources: see per-section citations above.
<!-- REUSE-IgnoreEnd -->
