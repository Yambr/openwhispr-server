# Roadmap: OpenWhispr Server

**Created:** 2026-05-08 (rebaselined after pivot)
**Granularity:** standard
**Total v1 requirements:** 89
**Coverage:** 89/89 mapped (100%)

## Core Value

A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

## Constitutional Rules (apply to every phase)

1. **Strict TDD.** Tests precede production code on every feature, every bugfix.
2. **GitHub Actions CI must be green** before any merge to `main`.
3. **English-only** for all source artifacts (docs, code, comments, identifiers, log keys).
4. **Wire-contract conformance** — every endpoint added in Phases 2-5 extends the CONTRACT-01 suite in the same PR.
5. **Coverage gate** ≥ 85% lines / ≥ 80% branches enforced in CI.
6. **Per-endpoint p95 SLOs are NOT published until Phase 8 load test validates them.**

## Phases

- [ ] **Phase 0: Repo Bootstrap & Constitutional CI** — Establish TDD discipline, GitHub Actions, license/secrets/dep scanning, coverage gate from commit #1
- [ ] **Phase 1: Core Infra & Multi-Tenant Data** — Compose stack scaffolding (Postgres+PgBouncer+Redis+observability+Traefik+MinIO), RLS DDL, tenant-context middleware, no-default-secrets gate
- [ ] **Phase 2: Auth + Wire-API Skeleton + Conformance Harness** — Better Auth (email+pwd + OIDC pluggable), OAuth shim with channel-scheme echo, token rotation, CONTRACT-01 harness, all 3 auth-lifecycle endpoints + `/api/health`
- [ ] **Phase 3: LiteLLM Integration + Bundled OSS Models** — Bundle LiteLLM ≥1.83.7 with faster-whisper / pyannote / Speaches-compatible image; env-override path documented; sync `/api/transcribe` + `/api/reason` end-to-end with usage ledger (observability only)
- [ ] **Phase 4: Streaming + Realtime** — `/api/agent/stream` NDJSON line-flush + WSS realtime 3600s + 3 realtime token endpoints
- [ ] **Phase 5: Operational Endpoints** — `/api/usage`, `/api/stt-config`, `/api/note-recording-config`, `/api/streaming-usage`, `/api/agent/web-search`, generic `cloud-api-request` passthrough
- [ ] **Phase 6: Observability + Ops Hardening + Workers** — OTel/Prom/Loki end-to-end + audit log + BullMQ workers + tenant-context job middleware + anti-abuse rate limit + SSRF defense
- [ ] **Phase 7: Frontend UI-SPEC** — Admin console + end-user self-service specs targeting Next.js 15 + shadcn/ui v2; design tokens; component inventory
- [ ] **Phase 8: Load Test, Tuning & SLO Publication** — k6 1000-concurrent nightly; PgBouncer/FD/sizing-matrix tuning; SLOs published only after this passes
- [ ] **Phase 9: Helm Chart & Cloud Deploy** — CNPG + Traefik 3 + online-migration discipline + upgrade-matrix CI + first-launch SLO test
- [ ] **Phase 10: i18n + Docs + OSS Housekeeping** — en+ru ICU plurals + DOCS-01..08 + ADRs + CONTRIBUTING/SECURITY/COC

## Phase Details

### Phase 0: Repo Bootstrap & Constitutional CI
**Goal**: A fresh `git clone` lands in a repo where every constitutional discipline (TDD, CI, scanning, coverage, English-only) is already enforced — no retrofit possible.
**Depends on**: Nothing (first phase)
**Requirements**: TDD-01, TDD-02, CI-01, CI-02, CI-03, TEST-COV-01, TEST-MUTATION-01, DEVEX-01, DOCS-09
**Success Criteria** (what must be TRUE):
  1. A contributor can run `make dev` and `make test` from a clean clone and the full local suite passes.
  2. Every PR opened against `main` triggers GHA workflows (lint + typecheck + unit + integration + e2e + contract + license-scan + gitleaks + Trivy + CodeQL + container-scan) and `main` is branch-protected against unchecked merges.
  3. CI fails any PR that drops API-tier coverage below 85% lines / 80% branches, that introduces a non-English string in a source artifact, or that lands production code without a preceding test commit (PR template "tests first" checklist enforced).
  4. Mutation testing (Stryker) runs on auth, multi-tenancy, and virtual-key modules and fails PRs on score regression — even though those modules don't yet exist, the harness scaffolding is wired and runs against placeholder code.
  5. All CI checks green on the bootstrap PR; tests written first (TDD).
**Plans**: 6 plans (3 waves)
- [x] 00-01-PLAN.md — Workspace + TS + Biome + Lefthook + commitlint scaffold (Wave 1)
- [x] 00-02-PLAN.md — Vitest 4 + Stryker 9 + skeleton workspaces with placeholders (Wave 1)
- [x] 00-03-PLAN.md — tools/lint-english.ts, lint-tdd.ts, Makefile, docker-compose placeholder, branch-protection script (Wave 1)
- [x] 00-04-PLAN.md — GHA workflows (ci.yml, security.yml, nightly.yml, release.yml) + dependabot + PR template (Wave 2)
- [x] 00-05-PLAN.md — Constitutional self-tests + harness-self-check CI job (Wave 2)
- [ ] 00-06-PLAN.md — README/CONTRIBUTING/SECURITY/COC/operations + ADRs 0000-0003 + integration smoke (Wave 3)
**UI hint**: no

### Phase 1: Core Infra & Multi-Tenant Data
**Goal**: A single `docker compose up` brings up the full data plane (Postgres 17 + PgBouncer transaction-mode + Redis/Valkey + MinIO + Traefik 3 + OTel Collector + Loki + Tempo + Mimir + Grafana) with row-level multi-tenancy enforced at the database and a refuse-to-start gate on default secrets.
**Depends on**: Phase 0
**Requirements**: DATA-01, DATA-02, DATA-05, DATA-06, DATA-07, TEST-MIGRATION-01, TEST-RLS-01, PROVIDER-02
**Success Criteria** (what must be TRUE):
  1. An operator runs `bootstrap.sh && docker compose up` and lands on a healthy stack where every required secret was generated (the runtime aborts on any known-default value like `changeme` or `sk-1234`).
  2. The `default` tenant exists after first migration; every `tenant_id`-bearing table has `ENABLE ROW LEVEL SECURITY` and a policy referencing `current_setting('app.tenant_id')`; an RLS-introspection lint blocks any future migration that adds an unguarded table.
  3. A property test (TEST-RLS-01) runs random tenant pairs against every queryable model and observes zero cross-tenant reads or writes; a `SET LOCAL` framework middleware contract test interleaves 100 tenant-A / tenant-B queries through PgBouncer transaction-mode without leakage.
  4. `make backup` produces a KEK/DEK-encrypted dump; `make restore` reconstructs the database in one command; both run in CI on every `migrations/` change, including forward-apply + rollback verification on real Postgres.
  5. MinIO is reachable on the compose network with a per-tenant bucket-prefix convention documented; sensitive columns are encrypted at rest via the KEK/DEK envelope (KEK from env / Vault / KMS adapter).
  6. Tests written first (TDD); all CI checks green.
**Plans**: 6 plans (3 waves)
- [x] 01-01-PLAN.md — Compose stack expansion (10 services with healthchecks) + observability config + Traefik file provider + PgBouncer transaction-mode (Wave 1)
- [x] 01-02-PLAN.md — bootstrap.sh refuse-to-start gate + entrypoint defense-in-depth + deny-list self-test (Wave 1)
- [x] 01-03-PLAN.md — Drizzle schema + first migration with FORCE RLS + role init (openwhispr_owner BYPASSRLS / openwhispr_app RLS-subject) + two-pool client factory (Wave 2)
- [x] 01-04-PLAN.md — Tenant-context middleware (set_config app.tenant_id) + Fastify hook + KEK/DEK envelope encryption + KeyProvider env/Vault/KMS (Wave 2)
- [x] 01-05-PLAN.md — RLS-introspection lint + TEST-RLS-01 property test (fast-check 100 tenant pairs through PgBouncer) + GHA lint-rls/test-migration jobs + branch protection (Wave 3)
- [x] 01-06-PLAN.md — Backup/restore via age envelope encryption + nightly round-trip + operations.md + storage.md (Wave 3)
**UI hint**: no

### Phase 2: Auth + Wire-API Skeleton + Conformance Harness
**Goal**: A desktop client can complete the full auth lifecycle (sign-up / sign-in / verification-poll / delete-account) against the server over any channel scheme it presents, receive opaque bearer tokens that rotate cleanly without logging the user out, and the wire-contract conformance suite (CONTRACT-01) is the canonical regression net for everything subsequent phases add.
**Depends on**: Phase 1
**Requirements**: WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-17, WIRE-18, WIRE-19, WIRE-20, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, PROVIDER-03, PROVIDER-04, CONTRACT-01
**Success Criteria** (what must be TRUE):
  1. A user signs in with email+password (no external IdP configured) and receives a bearer token ≥30 days old; the same code path also accepts an OIDC provider plugged in via Better Auth's OAuth-Provider plugin (Google Workspace / Azure AD / Okta / generic OIDC) selected by env/YAML, with no server-side allowlist.
  2. The OAuth final redirect emits `<scheme>://?bearer_token=<token>` echoing the **exact** scheme received in the `callbackURL` query parameter — verified against a multi-channel matrix (`openwhispr` / `openwhispr-dev` / `openwhispr-staging` / arbitrary `OPENWHISPR_PROTOCOL` override) — and never hardcodes a scheme.
  3. Every authenticated endpoint accepts `Authorization: Bearer <opaque>` AND session cookies; every non-2xx response carries the global `{"error":"<human-readable>"}` envelope; every invalid/expired token receives HTTP **401** (not 200-with-error); every externally reachable port refuses plaintext HTTP.
  4. Token rotation via `set-auth-token` overlaps the old token by ≥5 minutes; a concurrent-request rotation contract test confirms that R1/R2/R3 issued mid-rotation never see a 401 cascade.
  5. The CONTRACT-01 conformance suite is runnable via `make contract-test BACKEND_URL=...`, asserts byte-for-byte spec compliance for the auth-lifecycle endpoints + `/api/health` + global conventions, and is wired as a required GHA check on every PR — Phases 3, 4, 5 will extend it endpoint by endpoint.
  6. `/api/check-user`, `/api/auth/verification-status` (with 5s polling carve-out from rate limiting), `/api/auth/delete-account`, `/api/health` (3s timeout, body unread) all conform; `x-openwhispr-source: desktop` is preserved/observable.
  7. SMTP email provider is wired for verification + admin notifications; tests written first (TDD); all CI checks green.
**Plans**: TBD
**UI hint**: no

### Phase 3: LiteLLM Integration + Bundled OSS Models
**Goal**: Out of the box, an OSS operator gets a working `/api/transcribe` and `/api/reason` against bundled open-source models (faster-whisper + pyannote + Speaches-compatible realtime image) via a bundled LiteLLM Proxy ≥1.83.7; a corporate operator overrides `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` and hits the same wire surface against their internal LiteLLM (the shape described in `speaches-audio.md`) with zero code changes.
**Depends on**: Phase 2
**Requirements**: WIRE-05, WIRE-06, LITELLM-01, LITELLM-02, LITELLM-03, LITELLM-04, LITELLM-05, LITELLM-06, LITELLM-07, PROVIDER-01, DATA-03
**Success Criteria** (what must be TRUE):
  1. With no env overrides set, `docker compose up` starts the bundled LiteLLM v1.83.7-stable+ container wired to `Systran/faster-whisper-large-v3` for transcriptions, `pyannote/speaker-diarization-3.1` for diarization (HF token required at first run), and a Speaches-compatible open image for `WSS /v1/realtime` — and `POST /api/transcribe` end-to-end against this stack returns the documented JSON shape (`{text, wordsUsed, wordsRemaining, plan, limitReached:false, sttProvider, sttModel, ...}`).
  2. Setting `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` (or admin master key) in env disables the bundled LiteLLM container (compose profile) and routes all STT/LLM/Realtime traffic to the operator's existing LiteLLM Proxy — the wire surface for `/api/transcribe` and `/api/reason` is identical, verified by a parametrized contract-suite run against both modes.
  3. Per-user LiteLLM virtual keys are minted on first sign-in via `/key/generate` with alias `user-<userId>`; no per-user budget caps are set (corporate users are unlimited); rotation occurs on tenant config change.
  4. The three audio routes (`POST /v1/audio/transcriptions`, `POST /v1/audio/diarization` pass-through, `WSS /v1/realtime`) are reachable through LiteLLM with 3600s ingress read/send timeouts on the realtime route.
  5. `POST /api/reason` returns `{text, model, provider, promptMode, matchType}` against the configured cloud LLM via LiteLLM; `limitReached` is always `false` in v1 (schema preserved); the usage ledger records `request_id`-idempotent rows for transcribe minutes + reason tokens, observability only with no enforcement.
  6. LiteLLM spend logs are ingested into the platform usage ledger via a BullMQ-driven sync (every 30s); pass-through endpoints (diarization) are not metered by LiteLLM natively and we surface only what LiteLLM gives us — no nginx-log scraping in v1.
  7. `docs/litellm-target-spec.md` exists (derived from `speaches-audio.md`) and documents both the bundled-default and corporate-override LiteLLM configurations including model definitions, virtual-key auth, `pass_through_endpoints` for diarization, realtime mode, and 3600s ingress timeouts.
  8. CONTRACT-01 extended for `/api/transcribe` and `/api/reason`; tests written first (TDD); all CI checks green.
**Plans**: TBD
**UI hint**: no

### Phase 4: Streaming + Realtime
**Goal**: A desktop client opens an NDJSON agent stream and sees the first line within 500ms of the first server token through the full ingress chain (no buffering anywhere) and holds a WSS realtime session for ≥1h without ingress-timeout disconnects.
**Depends on**: Phase 3
**Requirements**: WIRE-07, WIRE-13, WIRE-14, WIRE-15, SCALE-05
**Success Criteria** (what must be TRUE):
  1. `POST /api/agent/stream` returns `Content-Type: application/x-ndjson` and a first-line-latency contract test confirms < 500ms first-line through full Traefik + API + LiteLLM chain — explicit `res.flush()` per line, `X-Accel-Buffering: no`, per-route `proxy_buffering off` confirmed by a buffering-injection negative test.
  2. A 65-minute synthetic WSS smoke test against `WSS /v1/realtime` survives end-to-end with zero ingress-timeout disconnects (3600s read/send timeouts on the realtime route).
  3. `POST /api/streaming-token` mints AssemblyAI streaming tokens from the server-held key (or returns 503 when AssemblyAI is not configured); `POST /api/deepgram-streaming-token` does the same for Deepgram; `POST /api/openai-realtime-token` mints OpenAI Realtime tokens with `streams=2` and returns `clientSecrets[]`.
  4. CONTRACT-01 extended for all four streaming/realtime endpoints (NDJSON line-flush behavior, gating-503 shape, `streams=2` payload); tests written first (TDD); all CI checks green.
**Plans**: TBD
**UI hint**: no

### Phase 5: Operational Endpoints
**Goal**: The desktop client can fetch its STT/note-recording configuration, observe its (unlimited-plan) usage stats, record streaming-session usage, invoke the agent's web-search tool, and proxy any other documented `/api/<path>` through the generic passthrough channel — completing the v1 wire surface.
**Depends on**: Phase 3
**Requirements**: WIRE-08, WIRE-09, WIRE-10, WIRE-11, WIRE-12, WIRE-16
**Success Criteria** (what must be TRUE):
  1. `GET /api/usage` returns observed usage stats with `plan: "unlimited"` always (v1 has no enforcement); `POST /api/streaming-usage` accepts and records streaming-session usage idempotently into the ledger.
  2. `GET /api/stt-config` returns server-side STT provider/model selection per tenant/user; `GET /api/note-recording-config` returns note-recording configuration — both honor the tenant context.
  3. `POST /api/agent/web-search` provides the server-side search tool for the agent.
  4. The generic passthrough channel `cloud-api-request` proxies any `/api/<path>` with the global error envelope preserved on every non-2xx.
  5. CONTRACT-01 extended for all six operational endpoints; tests written first (TDD); all CI checks green.
**Plans**: TBD
**UI hint**: no

### Phase 6: Observability + Ops Hardening + Workers
**Goal**: An operator opens the shipped Grafana dashboards and sees end-to-end traces (API → LiteLLM → models), per-tenant usage, LiteLLM spend, RED + saturation, and audit-log activity; bearer tokens never appear in logs; background jobs always run with full tenant context; anti-abuse rate limiting is live; SSRF-safe HTTP client gates all server-side outbound calls.
**Depends on**: Phase 5
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, DATA-04, SCALE-01, SCALE-03, SCALE-04
**Success Criteria** (what must be TRUE):
  1. OpenTelemetry SDK auto-instrumentation covers Fastify + undici + pg + ioredis with correlation IDs propagated through to LiteLLM; default Grafana dashboards (RED + saturation, per-tenant usage, LiteLLM spend) are shipped in-tree.
  2. Structured JSON logs flow to Loki via the OTel Collector; a sentinel-token log-scrub test confirms `Authorization`, `Cookie`, `set-auth-token`, and `*token*`/`*secret*`/`*password*`/`*key*` patterns are scrubbed; all log keys are English-only.
  3. The `audit_log` table records auth events, account deletion, key issuance, provider config changes, admin actions, and cross-tenant attempts; LiteLLM spend logs are reconciled against per-request ledger entries with a daily discrepancy alert.
  4. Liveness, readiness, and startup probes are wired; readiness fails when Postgres / Redis / LiteLLM are unhealthy; the API tier is fully stateless (sessions in Postgres, cache in Redis/Valkey) and horizontal scaling is verified by spinning a second replica and observing zero session loss.
  5. BullMQ workers run audit-log fanout, email delivery, usage rollups, and virtual-key rotation; a tenant-context job middleware re-establishes the DB GUC + log MDC + OTel context before every handler invocation, verified by a CI introspection gate.
  6. Anti-abuse rate limiting (per-user, per-IP, Redis token-bucket) is enforced with the polling carve-out for `/api/auth/verification-status`; SSRF defense (private-IP block + DNS-rebinding defense) gates every server-side outbound HTTP call.
  7. Tests written first (TDD); all CI checks green.
**Plans**: TBD
**UI hint**: no

### Phase 7: Frontend UI-SPEC
**Goal**: An operator (or downstream code-generation agent) reads two markdown specs and can implement the admin console + end-user self-service UI in Next.js 15 + shadcn/ui v2 without ambiguity — every screen, component, design token, and accessibility requirement is enumerated.
**Depends on**: Phase 6
**Requirements**: UI-SPEC-01, UI-SPEC-02, UI-SPEC-03
**Success Criteria** (what must be TRUE):
  1. `UI-SPEC-admin.md` enumerates the operator/admin console: tenants list, tenant detail (members, IdP config, LiteLLM endpoint config, observed usage), users list, virtual-key management, audit log, observability deep-links — each screen broken into shadcn/ui v2 components with props, states, and copy keys.
  2. `UI-SPEC-end-user.md` enumerates end-user self-service: profile, observed usage breakdown, account deletion (mirroring the desktop-client surface) — same component-level decomposition.
  3. Both specs target Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 + TanStack Query 5; document WCAG 2.2 AA conformance, responsive breakpoints (mobile + tablet + desktop), light + dark theme, design tokens, locale-negotiation chain, and a complete component inventory.
  4. Tests written first (TDD — spec linter validates structure); all CI checks green.
**Plans**: TBD
**UI hint**: yes

### Phase 8: Load Test, Tuning & SLO Publication
**Goal**: The k6 load test demonstrates 1000 concurrent active users (mixed transcribe + reason + stream + WSS) at validated p95 SLOs, runs nightly in CI against an ephemeral environment, and the per-endpoint p95 budgets are published to operators only after this phase passes.
**Depends on**: Phase 6
**Requirements**: SCALE-02, SCALE-06, SCALE-07, TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. The k6 nightly test simulates 1000 concurrent active users at the documented mix ratios (transcribe + reason + agent stream + WSS realtime per ARCHITECTURE.md § 10) and asserts p95 latency budgets per endpoint; CI fails on regression.
  2. PgBouncer is sized for 1000 concurrent (server-pool 100 × 4 instances) in transaction-mode and verified under load; file-descriptor limits are raised to 65535 on API + ingress containers and a startup probe verifies (default 1024 must NOT silently regress).
  3. A documented sizing matrix per topology (compose / Helm / GPU pool) is published to `docs/operations.md` with measured numbers — not extrapolated estimates.
  4. Per-endpoint p95 SLO budgets are published in operator-facing documentation **only after** this phase passes (constitutional rule); discrepancy alerts trigger on any nightly regression beyond budget.
  5. Tests written first (TDD); all CI checks green.
**Plans**: TBD
**UI hint**: no

### Phase 9: Helm Chart & Cloud Deploy
**Goal**: An operator runs `helm install` against a fresh Kubernetes cluster and lands on a production-grade deployment (CNPG HA Postgres + Traefik 3 ingress + cert-manager + HPA + GPU node-selector for bundled AI workers) with one-command upgrade, safe rollback, and a refuse-to-start gate on default secrets — going from `git clone` to first authenticated `/api/transcribe` in under 5 minutes via the compose path.
**Depends on**: Phase 8
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05
**Success Criteria** (what must be TRUE):
  1. The shipped `docker-compose.yml` brings up API + Postgres 17 + PgBouncer + Redis/Valkey + bundled LiteLLM + bundled open-source AI models (Whisper / pyannote / faster-whisper) + MinIO + Traefik + OTel Collector + Grafana + Loki + Tempo + Mimir, with a compose profile to disable bundled LiteLLM when overriding to corporate.
  2. The Helm chart deploys against a fresh Kubernetes cluster with HA Postgres via CloudNativePG 1.29 (PG 17 image catalog override), Traefik 3 ingress (NOT ingress-nginx — retired Mar 2026), HPA on API + worker tiers, cert-manager hooks for TLS, OTel-Collector DaemonSet, GPU node-selector for bundled AI workers, and a documented option to disable bundled AI and point at corporate LiteLLM.
  3. Migrations run as a pre-deploy job and are safe under rolling deploy and backwards-compatible across one minor version; an upgrade-matrix CI test installs N-1, populates data, upgrades to N, and asserts health and integrity.
  4. Online-migration discipline is enforced (CONCURRENTLY indexes, NOT VALID then VALIDATE constraints, batched column adds) by a `squawk`/`pgroll` lint that blocks PRs with blocking patterns.
  5. The DEPLOY-05 first-launch SLO test gates CI: from `git clone` to first authenticated `/api/transcribe` against the bundled LiteLLM in **< 5 minutes**.
  6. Tests written first (TDD); all CI checks green.
**Plans**: TBD
**UI hint**: no

### Phase 10: i18n + Docs + OSS Housekeeping
**Goal**: An operator (or contributor) lands on a fully localized (en + ru) runtime with operator-overridable locale resources, complete OSS documentation (README, architecture, operations, LiteLLM spec, wire contract, auth, ADRs), and the OSS housekeeping (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, Apache-2.0 LICENSE) needed to accept the first community contribution.
**Depends on**: Phase 9
**Requirements**: I18N-01, I18N-02, TEST-I18N-01, DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05, DOCS-06, DOCS-07, DOCS-08
**Success Criteria** (what must be TRUE):
  1. All runtime user/operator-facing strings (UI copy, email templates including subject lines, notification text, end-user error messages) use i18next + i18next-icu with `en` (default) + `ru`; CLDR plural rules are applied (Russian one/few/many/other handled correctly with boundary-case snapshot tests); `Accept-Language` negotiation drives API responses.
  2. Locale resources are operator-overridable via mounted volume / config map without forking; a TEST-I18N-01 CI gate fails when a key exists in `en` but is missing in `ru` (or vice versa); ESLint forbids string literals in user-facing surfaces.
  3. The full documentation suite is shipped: `README.md` with < 5min quickstart, `docs/architecture.md` with mermaid diagrams of the three hot paths, `docs/operations.md` (deploy / upgrade / scale / backup / restore / troubleshoot), `docs/litellm-target-spec.md` (already created in Phase 3), `docs/wire-contract.md` referencing upstream specs and listing v2-deferred endpoints (Stripe / referrals), `docs/auth.md` covering OIDC plug-in + email+password + channel-scheme handling.
  4. `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, Apache-2.0 LICENSE with license headers are present; ADRs exist for every Key Decision listed in PROJECT.md.
  5. Tests written first (TDD); all CI checks green.
**Plans**: TBD
**UI hint**: no

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Repo Bootstrap & Constitutional CI | 5/6 | In progress | - |
| 1. Core Infra & Multi-Tenant Data | 0/6 | Planned | - |
| 2. Auth + Wire-API Skeleton + Conformance | 0/0 | Not started | - |
| 3. LiteLLM Integration + Bundled OSS Models | 0/0 | Not started | - |
| 4. Streaming + Realtime | 0/0 | Not started | - |
| 5. Operational Endpoints | 0/0 | Not started | - |
| 6. Observability + Ops Hardening + Workers | 0/0 | Not started | - |
| 7. Frontend UI-SPEC | 0/0 | Not started | - |
| 8. Load Test, Tuning & SLO Publication | 0/0 | Not started | - |
| 9. Helm Chart & Cloud Deploy | 0/0 | Not started | - |
| 10. i18n + Docs + OSS Housekeeping | 0/0 | Not started | - |

## Coverage Map

89 v1 requirements → 11 phases, no orphans, no duplicates.

| Requirement | Phase |
|-------------|-------|
| WIRE-01 | 2 |
| WIRE-02 | 2 |
| WIRE-03 | 2 |
| WIRE-04 | 2 |
| WIRE-05 | 3 |
| WIRE-06 | 3 |
| WIRE-07 | 4 |
| WIRE-08 | 5 |
| WIRE-09 | 5 |
| WIRE-10 | 5 |
| WIRE-11 | 5 |
| WIRE-12 | 5 |
| WIRE-13 | 4 |
| WIRE-14 | 4 |
| WIRE-15 | 4 |
| WIRE-16 | 5 |
| WIRE-17 | 2 |
| WIRE-18 | 2 |
| WIRE-19 | 2 |
| WIRE-20 | 2 |
| AUTH-01 | 2 |
| AUTH-02 | 2 |
| AUTH-03 | 2 |
| AUTH-04 | 2 |
| AUTH-05 | 2 |
| AUTH-06 | 2 |
| AUTH-07 | 2 |
| DATA-01 | 1 |
| DATA-02 | 1 |
| DATA-03 | 3 |
| DATA-04 | 6 |
| DATA-05 | 1 |
| DATA-06 | 1 |
| DATA-07 | 1 |
| LITELLM-01 | 3 |
| LITELLM-02 | 3 |
| LITELLM-03 | 3 |
| LITELLM-04 | 3 |
| LITELLM-05 | 3 |
| LITELLM-06 | 3 |
| LITELLM-07 | 3 |
| PROVIDER-01 | 3 |
| PROVIDER-02 | 1 |
| PROVIDER-03 | 2 |
| PROVIDER-04 | 2 |
| SCALE-01 | 6 |
| SCALE-02 | 8 |
| SCALE-03 | 6 |
| SCALE-04 | 6 |
| SCALE-05 | 4 |
| SCALE-06 | 8 |
| SCALE-07 | 8 |
| OBS-01 | 6 |
| OBS-02 | 6 |
| OBS-03 | 6 |
| OBS-04 | 6 |
| OBS-05 | 6 |
| UI-SPEC-01 | 7 |
| UI-SPEC-02 | 7 |
| UI-SPEC-03 | 7 |
| DEPLOY-01 | 9 |
| DEPLOY-02 | 9 |
| DEPLOY-03 | 9 |
| DEPLOY-04 | 9 |
| DEPLOY-05 | 9 |
| TDD-01 | 0 |
| TDD-02 | 0 |
| CI-01 | 0 |
| CI-02 | 0 |
| CI-03 | 0 |
| CONTRACT-01 | 2 |
| TEST-COV-01 | 0 |
| TEST-MUTATION-01 | 0 |
| TEST-LOAD-01 | 8 |
| TEST-MIGRATION-01 | 1 |
| TEST-I18N-01 | 10 |
| TEST-RLS-01 | 1 |
| DEVEX-01 | 0 |
| I18N-01 | 10 |
| I18N-02 | 10 |
| DOCS-01 | 10 |
| DOCS-02 | 10 |
| DOCS-03 | 10 |
| DOCS-04 | 10 |
| DOCS-05 | 10 |
| DOCS-06 | 10 |
| DOCS-07 | 10 |
| DOCS-08 | 10 |
| DOCS-09 | 0 |

---
*Roadmap created: 2026-05-08 after baseline pivot (defer Stripe/referrals/quotas to v2; bundle LiteLLM with OSS models; UI-SPEC only)*
*Last updated: 2026-05-09 — Phase 1 plan list populated (6 plans across 3 waves).*
