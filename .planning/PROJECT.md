# OpenWhispr Server

## What This Is

An open-source, self-hosted **enterprise** backend for the (forked) OpenWhispr Electron desktop client. It exposes only the wire surface the corporate fork still calls — auth lifecycle, transcription, reasoning, agent NDJSON streaming, realtime tokens, and a few read-only config endpoints — and proxies all AI work to an **already-deployed LiteLLM Proxy** (the one described in `speaches-audio.md`, e.g. Alfaleasing's `aimodels.inner.alfaleasing.ru`). Stripe / referrals / quota-enforcement / BYOK billing surfaces have been **removed from the desktop fork** and are therefore explicitly out of scope on the server.

The server is a thin, well-tested edge in front of an existing LiteLLM/Speaches deployment: corporate users sign in (email+password or OIDC), the desktop attaches a bearer token, every authenticated request is rewritten to a LiteLLM call with a per-user virtual key, and LiteLLM's spend logs + nginx access logs feed our observability/usage dashboards (read-only — no enforcement).

## Core Value

**A clean, enterprise-ready edge between the OpenWhispr desktop fork and an existing corporate LiteLLM Proxy.** Anything that wasn't strictly required for that — quotas, plans, billing, referrals, BYOK key minting beyond LiteLLM virtual keys, GPU/Speaches infrastructure — is removed. Every other goal (multi-IdP auth, multi-tenancy, observability, OSS docs, UI-SPEC for the admin console) exists to serve this one outcome.

## Requirements

### Validated

(None yet — ship to validate)

### Active

#### Wire compatibility (corporate-fork surface)
- [ ] **WIRE-01**: `POST /api/check-user` — pre-auth, returns `{exists}`
- [ ] **WIRE-02**: `GET /api/auth/verification-status?email=...` — 5s polling, cookie-auth (only used if email signup is enabled)
- [ ] **WIRE-03**: `DELETE /api/auth/delete-account` — cookie-auth
- [ ] **WIRE-04**: `GET /api/health` — 3s timeout, body unread
- [ ] **WIRE-05**: `POST /api/transcribe` — multipart audio; forwards to LiteLLM `/v1/audio/transcriptions`; **returns `limitReached: false` always** (corporate users are unlimited); still emits `{text, wordsUsed, plan, sttProvider, sttModel, ...}` so unmodified desktop builds keep working
- [ ] **WIRE-06**: `POST /api/reason` — forwards to LiteLLM chat-completions
- [ ] **WIRE-07**: `POST /api/agent/stream` — `application/x-ndjson`, **flush per line**, no buffering anywhere
- [ ] **WIRE-08**: `POST /api/agent/web-search` — server-side search tool
- [ ] **WIRE-09**: `POST /api/streaming-usage` — accept-and-record (no enforcement)
- [ ] **WIRE-10**: `GET /api/usage` — returns observed usage stats (transcribe minutes, reason tokens, streaming minutes); always reports unlimited plan
- [ ] **WIRE-11**: `GET /api/stt-config` — server-side STT provider/model selection
- [ ] **WIRE-12**: `GET /api/note-recording-config` — note-recording configuration
- [ ] **WIRE-13**: `POST /api/streaming-token` — mints AssemblyAI streaming token (only if AssemblyAI is configured; otherwise 410 Gone)
- [ ] **WIRE-14**: `POST /api/deepgram-streaming-token` — Deepgram streaming token (gated same way)
- [ ] **WIRE-15**: `POST /api/openai-realtime-token` — OpenAI Realtime token (gated same way)
- [ ] **WIRE-16**: Generic passthrough channel `cloud-api-request` — proxied with global error envelope
- [ ] **WIRE-17**: Honor global error envelope `{ "error": "<string>" }` for every non-2xx
- [ ] **WIRE-18**: HTTP **401** (not 200-with-error) on invalid/expired tokens
- [ ] **WIRE-19**: Accept `Authorization: Bearer <opaque>` AND session cookies on every authenticated endpoint
- [ ] **WIRE-20**: HTTPS-only on every externally reachable port
- [ ] **WIRE-21**: Stripe + referrals routes are explicitly **NOT served** (removed from desktop fork). Document this in DOCS-06.

#### Authentication & OAuth
- [ ] **AUTH-01**: Host `${AUTH_URL}/api/desktop-signin/{provider}` shim that initiates upstream IdP round-trip
- [ ] **AUTH-02**: Final OAuth redirect emits `${PROTOCOL}://?bearer_token=<token>` echoing the **exact** scheme received in the `callbackURL` query parameter
- [ ] **AUTH-03**: Issue opaque bearer tokens (≥30 days), with rotation via `set-auth-token`; new and old overlap ≥5 min
- [ ] **AUTH-04**: Email/password sign-in via Better Auth contract — first-class, works without any external IdP configured
- [ ] **AUTH-05**: OIDC pluggable adapter — any OIDC provider configurable (Google Workspace / Azure AD / Okta / generic OIDC); operator picks one or more per installation
- [ ] **AUTH-06**: `x-openwhispr-source: desktop` header preserved/observable for feature flagging
- [ ] **AUTH-07**: Open registration model — IdP is the gatekeeper; whoever the configured IdP authorizes gets in. No allowlist on our side. Once signed in, the user is automatically a corporate enterprise user with no plan/tier distinctions.

#### Multi-tenancy & Data
- [ ] **DATA-01**: PostgreSQL 17+ schema with row-level security; `app.tenant_id` GUC via `SET LOCAL` (PgBouncer transaction-mode safe)
- [ ] **DATA-02**: Forward-only Drizzle migrations; CI verifies forward apply + rollback
- [ ] **DATA-03**: Usage ledger (transcribe minutes, reason tokens, streaming minutes); idempotent on `request_id`; **observability only — no enforcement**
- [ ] **DATA-04**: Audit log for auth events, account deletion, key issuance, provider config changes, admin actions
- [ ] **DATA-05**: At-rest encryption for sensitive columns (bearer tokens, LiteLLM virtual keys) via KEK/DEK; KEK from env / Vault / KMS adapter
- [ ] **DATA-06**: Tenants table — single "default" tenant created on first migration; multi-tenant model retained for future per-org installs but enterprise installs run on the default tenant
- [ ] **DATA-07**: Backup-and-restore tooling — `make backup` produces an encrypted dump; `make restore` is one-command; both run in CI

#### LiteLLM integration (Speaches lives behind LiteLLM — externally managed)
- [ ] **LITELLM-01**: Configure to call an **already-deployed** LiteLLM Proxy (>= v1.83.7-stable per upstream advisory). The server itself does **not** ship LiteLLM, Speaches, GPUs, or pyannote — those are operator-managed infrastructure
- [ ] **LITELLM-02**: Convert `speaches-audio.md` into `docs/litellm-target-spec.md` — the **target shape** of the LiteLLM config the operator is expected to have running (Whisper models, pyannote pass-through diarization, Speaches Realtime via `realtime` mode, virtual-key auth, ingress 3600s timeouts)
- [ ] **LITELLM-03**: Wire calls to the three audio routes via the existing LiteLLM: `POST /v1/audio/transcriptions`, `POST /v1/audio/diarization` (pass-through), `WSS /v1/realtime`
- [ ] **LITELLM-04**: Mint per-user LiteLLM virtual keys via the LiteLLM `/key/generate` API (no per-user budgets — corporate users are unlimited; key alias is `user-<userId>` for traceability)
- [ ] **LITELLM-05**: Ingest LiteLLM spend logs into the usage ledger as **observability**; pass-through endpoints (diarization) are not metered by LiteLLM natively — accept this and surface only what LiteLLM gives us (no nginx-log scraping in v1)

#### Provider abstraction (lightweight)
- [ ] **PROVIDER-01**: STT/LLM/Realtime providers are uniformly served via the configured **single LiteLLM endpoint**. The "multi-provider" story = LiteLLM's own model routing config; we do not implement our own LLM/STT abstraction layer
- [ ] **PROVIDER-02**: Storage provider interface: S3-compatible default (MinIO for self-host or any S3 / GCS / Azure Blob via env)
- [ ] **PROVIDER-03**: Identity provider interface: Better Auth's OAuth-Provider plugin handles OIDC; email+password is built-in; SAML is out of scope for v1
- [ ] **PROVIDER-04**: Email provider interface: SMTP only in v1 (verification + admin notifications)

#### Enterprise scale (1000 concurrent active users)
- [ ] **SCALE-01**: API tier is fully stateless; sessions in Postgres; cache state in Redis/Valkey
- [ ] **SCALE-02**: PgBouncer transaction-mode in front of Postgres; sized for 1000 concurrent
- [ ] **SCALE-03**: BullMQ on Redis/Valkey for background jobs (audit-log fanout, email delivery, usage rollups)
- [ ] **SCALE-04**: Rate limiting per-user, per-IP via Redis token-bucket (anti-abuse, NOT quota); polling carve-out for `/api/auth/verification-status`
- [ ] **SCALE-05**: Streaming endpoints (NDJSON, WSS) survive ingress timeouts up to 1h; `proxy_buffering off` + `X-Accel-Buffering: no`; per-line `res.flush()`
- [ ] **SCALE-06**: Load test (k6) demonstrates 1000 concurrent active users (mixed transcribe + reason + stream + WSS) at p95 SLO; runs nightly in CI

#### Observability
- [ ] **OBS-01**: OpenTelemetry auto-instrumentation across the API (Fastify, undici, pg, ioredis); spans correlate API → LiteLLM
- [ ] **OBS-02**: Prometheus metrics via OTel Collector; default Grafana dashboards for RED + saturation + per-user usage + LiteLLM spend
- [ ] **OBS-03**: Structured JSON logging to Loki; bearer tokens scrubbed; correlation IDs propagated; English-only log keys
- [ ] **OBS-04**: LiteLLM spend logs ingested into the usage ledger; reconciliation pass alerts on discrepancies
- [ ] **OBS-05**: Liveness, readiness, startup probes — readiness fails when Postgres / Redis / LiteLLM unhealthy

#### Frontend
- [ ] **UI-01**: Stack pre-decided: **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui v2**; this is what the UI-SPEC targets and what gets implemented later
- [ ] **UI-02**: Produce `UI-SPEC.md` for **Admin Console**: users list, user detail (auth provider, LiteLLM virtual key alias, observed usage), audit log, IdP config, LiteLLM endpoint config, observability deep-links
- [ ] **UI-03**: Produce `UI-SPEC.md` for **End-User Self-Service**: profile, observed usage breakdown, account deletion (mirroring desktop-client surface)
- [ ] **UI-04**: UI-SPEC follows accessibility (WCAG 2.2 AA), responsive, light + dark theme; component inventory enumerated; user generates Claude Design from spec, then I implement against the design
- [ ] **UI-05**: Implement the frontend in v1 against the Claude-Design output; deployed as a Next.js app behind Traefik in the same compose/Helm stack

#### Deployment
- [ ] **DEPLOY-01**: `docker-compose.yml` for single-host self-host: API + Frontend (Next.js) + Postgres 17 + PgBouncer + Redis/Valkey + MinIO + Traefik + OTel Collector + Grafana + Loki + Tempo + Mimir. **No Speaches / no LiteLLM** — operator points the server at their existing LiteLLM via env
- [ ] **DEPLOY-02**: Helm chart for Kubernetes: HA Postgres via CloudNativePG, Traefik 3 ingress (NOT ingress-nginx — retired Mar 2026), HPA, cert-manager hooks, OTel-Collector
- [ ] **DEPLOY-03**: One-command bootstrap (`make up` or `helm install`); one-command upgrade with safe rollback; refuse to start on default secrets
- [ ] **DEPLOY-04**: Migrations run as a pre-deploy job; safe under rolling deploy; backwards-compatible across one minor version
- [ ] **DEPLOY-05**: First-launch SLO — operator goes from `git clone` to first authenticated `/api/transcribe` against their LiteLLM in **< 5 minutes**

#### Engineering discipline (constitutional)
- [ ] **TDD-01**: Strict TDD — tests precede production code on every feature, every bugfix
- [ ] **TDD-02**: Test layers: unit + integration (real Postgres / Redis via testcontainers; LiteLLM mocked at HTTP level via msw or Wiremock — we don't run real LiteLLM in CI) + e2e + contract + load + security + migration + i18n + RLS-property
- [ ] **CI-01**: GitHub Actions CI from day one; workflows in `.github/workflows/`; GitHub-hosted runners
- [ ] **CI-02**: CI matrix on every PR: lint + typecheck + unit + integration + e2e + contract + license-scan + secrets-scan (gitleaks) + dep-scan (Trivy + Dependabot) + SAST (CodeQL) + container-scan
- [ ] **CI-03**: Branch protection on `main` blocks merge unless required checks are green
- [ ] **CONTRACT-01**: Wire-contract conformance test suite asserts the server matches the corporate-fork surface byte-for-byte (status codes, JSON shapes, headers, NDJSON line behavior, channel-scheme echo, `set-auth-token` rotation); runs against any deployed instance via `make contract-test BACKEND_URL=...`
- [ ] **TEST-COV-01**: Coverage gate ≥ 85% lines / ≥ 80% branches on the API tier (excluding generated code)
- [ ] **TEST-MUTATION-01**: Mutation testing (Stryker) on critical modules: auth, multi-tenancy enforcement, virtual-key minting
- [ ] **TEST-LOAD-01**: k6 nightly load test asserts 1000 concurrent at p95 SLO
- [ ] **TEST-MIGRATION-01**: Migration tests verify forward apply + rollback on real Postgres in CI on every `migrations/` change
- [ ] **TEST-I18N-01**: i18n completeness test fails CI when a key exists in `en` but is missing in `ru` (or vice versa)
- [ ] **TEST-RLS-01**: RLS property tests assert no cross-tenant read or write paths exist
- [ ] **DEVEX-01**: One-command local dev (`make dev`) brings up the full stack with seeded data + a mock LiteLLM responder; `make test` runs the full suite

#### Internationalization
- [ ] **I18N-01**: Runtime user/operator-facing strings (UI copy, email templates, end-user error messages) use i18next + i18next-icu; **minimum locales `en` (default), `ru`**; CLDR pluralization; `Accept-Language` negotiation
- [ ] **I18N-02**: Locale resources are operator-overridable via mounted volume / config map without forking

#### OSS / docs
- [ ] **DOCS-01**: `README.md` with quickstart — < 5 min to first authenticated `/api/transcribe` against operator's LiteLLM
- [ ] **DOCS-02**: `docs/architecture.md` — components, request lifecycle, mermaid diagrams
- [ ] **DOCS-03**: `docs/operations.md` — deploy, upgrade, scale, backup, restore, troubleshoot
- [ ] **DOCS-04**: `docs/litellm-target-spec.md` — the LiteLLM config the operator must have running (derived from `speaches-audio.md`)
- [ ] **DOCS-05**: `docs/wire-contract.md` — the corporate-fork wire surface; documents which OpenWhispr-cloud endpoints are intentionally absent (Stripe, referrals)
- [ ] **DOCS-06**: `docs/auth.md` — how to plug in OIDC providers; how to switch on/off email+password
- [ ] **DOCS-07**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, OSS license headers
- [ ] **DOCS-08**: ADRs for every Key Decision in this document
- [ ] **DOCS-09**: All source artifacts in **English only** — hard rule

### Out of Scope (v1)

- **Stripe / billing / plans** — desktop fork removed these; no `/api/stripe/*` served.
- **Referrals** — desktop fork removed these; no `/api/referrals/*` served.
- **Per-user quotas / `limitReached: true` enforcement** — corporate users are unlimited; ledger is observability only.
- **Running our own Speaches / pyannote / GPU pool** — operator already has a LiteLLM Proxy with these wired up; we connect to it.
- **Custom multi-LLM-provider abstraction layer** — LiteLLM is the abstraction; we don't reinvent it.
- **SAML 2.0 / SCIM provisioning** — defer to v2; OIDC covers Google Workspace / Azure AD / Okta in v1.
- **Magic-link / passwordless email** — defer to v2.
- **BYOK third-party AI keys (OpenAI/Anthropic/etc. direct from desktop)** — server has no role; if operator wants direct providers, they configure them in their LiteLLM.
- **Google Calendar OAuth** — desktop talks to Google directly.
- **Hidden / undocumented OpenWhispr endpoints** — corporate-fork wire surface is the contract.
- **Live runtime trace validation tooling** — replaced by the conformance suite.
- **OpenAPI / JSON-Schema generation** — defer to v2.
- **Reference desktop client modifications** — the fork is owned and modified by the user; server only consumes its requests.

## Context

- **Upstream client repo**: `/Users/nick/openwhispr` — already forked by the user; Stripe / referrals / quota UI removed; we're building the matching server.
- **Authoritative wire spec (full upstream)**: `/Users/nick/openwhispr/docs/SELF_HOSTING.md`, `BACKEND_SPEC.md`, `OAUTH_SPEC.md` (1556 lines). The corporate-fork surface is a **subset**: subtract Stripe + referrals + quota-enforcement; everything else stays byte-compatible.
- **LiteLLM target config**: `/Users/nick/openwhispr-server/speaches-audio.md` — describes the **already-running** corporate LiteLLM (Alfaleasing's `aimodels.inner.alfaleasing.ru`). Three audio routes (Whisper, pyannote pass-through, Speaches Realtime), one virtual key. We connect to such a deployment, we do not run it.
- **Deployment target diversity**: docker-compose on a single VM or Helm on K8s. Both must yield the same wire surface and both connect to the operator's existing LiteLLM endpoint via `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` (or admin master key for minting per-user keys).
- **Frontend workflow**: I produce UI-SPEC; user runs Claude Design to generate visuals; I implement Next.js + shadcn/ui + Tailwind 4 to match the design.

## Constraints

- **Tech stack (server)**: Node.js 24 LTS + Fastify 5 + TypeScript + Better Auth + Drizzle + Postgres 17 + PgBouncer + Redis/Valkey + BullMQ — boring, well-staffed, multi-arch (amd64+arm64).
- **Tech stack (frontend)**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui v2.
- **Database**: PostgreSQL 17+ — non-negotiable.
- **AI plane**: served by the operator's existing LiteLLM Proxy — server does not bundle it.
- **Wire compatibility**: every endpoint we serve matches the corporate fork's expectations byte-for-byte. Endpoints we **don't** serve (Stripe/referrals) must be confirmed-removed in the fork.
- **HTTPS only**: never plaintext HTTP on any externally reachable port.
- **Concurrency**: 1000 active concurrent users, p95 latency budgets validated by load test.
- **Source-artifact language**: **English only** for docs, code, comments, commit messages, identifiers, log keys.
- **Runtime localization**: `en` + `ru` minimum from day one for UI copy, emails, end-user error messages.
- **Engineering discipline (constitutional)**:
  - **Strict TDD** — tests precede production code.
  - **GitHub Actions** is the only sanctioned CI; workflows in `.github/workflows/`.
  - **Maximum test automation** — no human QA; coverage spans unit, integration, e2e, contract, load, security, migration, i18n, RLS-property tests.
- **Open source**: every requirement ships with corresponding documentation; no closed/internal subsystems.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Wire-compatible only with the **corporate fork** of the desktop (no Stripe / no referrals / no quota enforcement) | The user already forked the desktop and removed those surfaces; implementing them server-side would be dead code | — Pending |
| Server connects to an **existing** LiteLLM Proxy; does not bundle Speaches / GPUs / pyannote | The user already has a corporate LiteLLM deployment matching `speaches-audio.md`; bundling would duplicate effort and confuse operators | — Pending |
| Usage ledger is **observability-only** (no enforcement / `limitReached` always false) | Corporate users are unlimited; we still want activity dashboards for ops/finance | — Pending |
| Single-LiteLLM-endpoint provider model (no custom multi-LLM abstraction) | LiteLLM is itself the abstraction; reimplementing it is yak-shaving | — Pending |
| **Frontend is implemented in v1**, against a Claude-Design output | User explicitly wants a current, polished UI generated by Claude Design from the UI-SPEC | — Pending |
| Stack: Node 24 + Fastify 5 + Better Auth + Drizzle + Postgres 17 (server); Next.js 15 + Tailwind 4 + shadcn/ui v2 (frontend) | Modern, well-staffed, OSS-mainstream; Better Auth's wire shape already matches the desktop fork | — Pending |
| Postgres + Redis as the only required infra services | Boring, ubiquitous, operator-friendly | — Pending |
| Multi-tenancy data model retained, single "default" tenant in v1 | Cheap to keep; gives a future per-org install path without a rewrite | — Pending |
| Email+password is first-class, no "dev mode" hidden flag | Corporate operators want this for fallback access; no reason to hide it | — Pending |
| OIDC pluggable via Better Auth OAuth-Provider plugin | Covers Google Workspace / Azure AD / Okta / generic OIDC with one adapter | — Pending |
| Open IdP scope (no allowlist) | The IdP is the gatekeeper; making the server enforce its own allowlist duplicates configuration | — Pending |
| All docs/code in English only | Mixed-language artifacts confuse contributors and tooling | — Pending |
| Open-source from day one | OSS-grade docs and licensing decisions are easier to make at start than retrofit | — Pending |
| Strict TDD constitutional | No QA testers; correctness must be enforced at the CI gate | — Pending |
| GitHub Actions as the only CI | Operator audience already uses GitHub; runs reproducibly on hosted runners | — Pending |
| Contract suite is the canonical conformance check | Replaces "live runtime trace validation"; runs against any deployed instance | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-08 after corporate-scope pivot (Stripe/referrals/quota removed; Speaches externalized; frontend implementation included)*
