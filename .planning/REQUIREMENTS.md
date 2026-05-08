# Requirements: OpenWhispr Server

**Defined:** 2026-05-08
**Core Value:** A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

## v1 Requirements

Requirements for the initial OSS release. Stripe / referrals / quota-enforcement are deferred to v2 — upstream `SELF_HOSTING.md` itself classifies them as "Operational / quota endpoints (recommended)" with stub-as-503 explicitly acceptable.

### Wire Compatibility — Auth Lifecycle (must implement)

Source of truth: `/Users/nick/openwhispr/docs/BACKEND_SPEC.md`, `OAUTH_SPEC.md`, `SELF_HOSTING.md` (1556 lines, byte-for-byte authoritative).

- [ ] **WIRE-01**: `POST /api/check-user` — pre-auth; returns `{exists:boolean}` at 200; non-2xx routes desktop to sign-up branch
- [ ] **WIRE-02**: `GET /api/auth/verification-status?email=...` — cookie-auth; 5s polling cadence carve-out from rate limiter; 200+`{verified:bool}`, 4xx surfaces "session expired"
- [ ] **WIRE-03**: `DELETE /api/auth/delete-account` — cookie-auth; 2xx clears local token+cookie+session

### Wire Compatibility — Operational Endpoints (v1)

- [ ] **WIRE-04**: `GET /api/health` — 3s timeout; body unread; only `res.ok` and `res.status` are inspected
- [ ] **WIRE-05**: `POST /api/transcribe` — multipart audio; forwards to LiteLLM `/v1/audio/transcriptions`; returns `{text, wordsUsed, wordsRemaining, plan, limitReached, sttProvider, sttModel, ...}`; **`limitReached` always returns `false` in v1** (schema preserved for desktop compatibility, no enforcement)
- [ ] **WIRE-06**: `POST /api/reason` — cloud LLM via LiteLLM; returns `{text, model, provider, promptMode, matchType}`
- [ ] **WIRE-07**: `POST /api/agent/stream` — `Content-Type: application/x-ndjson`; **flush per line**; no buffering anywhere in the chain
- [ ] **WIRE-08**: `POST /api/agent/web-search` — server-side search tool for the agent
- [ ] **WIRE-09**: `POST /api/streaming-usage` — accept-and-record streaming-session usage
- [ ] **WIRE-10**: `GET /api/usage` — observed usage stats; v1 always reports unlimited plan
- [ ] **WIRE-11**: `GET /api/stt-config` — server-side STT provider/model selection per tenant/user
- [ ] **WIRE-12**: `GET /api/note-recording-config` — note-recording configuration
- [ ] **WIRE-13**: `POST /api/streaming-token` — mints AssemblyAI streaming token from server-held key (gated; 503 if AssemblyAI not configured)
- [ ] **WIRE-14**: `POST /api/deepgram-streaming-token` — Deepgram streaming token (gated same way)
- [ ] **WIRE-15**: `POST /api/openai-realtime-token` — OpenAI Realtime token (`streams=2` for OpenAI realtime; gated same way)
- [ ] **WIRE-16**: Generic passthrough channel `cloud-api-request` — any `/api/<path>` proxied with global error envelope

### Wire Compatibility — Conventions (apply to every endpoint)

- [ ] **WIRE-17**: Honor the global error envelope `{ "error": "<human-readable string>" }` for every non-2xx response
- [ ] **WIRE-18**: Return HTTP **401** (not 200-with-error) on invalid/expired tokens — `withSessionRefresh()` retry-once-with-backoff path depends on this
- [ ] **WIRE-19**: Accept `Authorization: Bearer <opaque>` AND session cookies on every authenticated endpoint (main process attaches both; renderer-direct endpoints rely on cookie alone)
- [ ] **WIRE-20**: HTTPS-only — never serve any externally reachable port over plaintext HTTP

### Authentication & OAuth

- [ ] **AUTH-01**: Host `${AUTH_URL}/api/desktop-signin/{provider}` shim that initiates the upstream IdP round-trip
- [ ] **AUTH-02**: Final OAuth redirect emits `${PROTOCOL}://?bearer_token=<token>` echoing the **exact** scheme received in the `callbackURL` query parameter (production / `openwhispr-dev` / `openwhispr-staging` / arbitrary override per `OPENWHISPR_PROTOCOL`)
- [ ] **AUTH-03**: Issue opaque bearer tokens long-lived enough to survive desktop relaunches (≥30 days), with rotation via the `set-auth-token` response header on Better-Auth-style endpoints; new and old tokens overlap ≥5 minutes (covers `withSessionRefresh()` 60s grace window with margin)
- [ ] **AUTH-04**: Email/password sign-in via Better Auth — first-class, works without any external IdP configured
- [ ] **AUTH-05**: OIDC pluggable via Better Auth's OAuth-Provider plugin — operator configures any OIDC provider (Google Workspace / Azure AD / Okta / generic OIDC) via env/YAML
- [ ] **AUTH-06**: `x-openwhispr-source: desktop` header is preserved/observable for feature flagging
- [ ] **AUTH-07**: Open IdP scope — IdP is the gatekeeper; no server-side allowlist. Once signed in, the user is automatically a corporate user (no plan/tier distinctions in v1)

### Multi-tenancy & Data

- [ ] **DATA-01**: PostgreSQL 17+ schema with row-level security; `app.tenant_id` GUC set via `SET LOCAL` inside every request transaction (PgBouncer transaction-mode safe)
- [ ] **DATA-02**: Forward-only migrations via Drizzle; CI verifies forward apply + rollback on real Postgres on every change to `migrations/`
- [ ] **DATA-03**: Usage ledger (transcribe minutes, reason tokens, streaming minutes); idempotent on `request_id`; **observability only — no enforcement** in v1
- [ ] **DATA-04**: Audit log for auth events, account deletion, key issuance, provider config changes, admin actions
- [ ] **DATA-05**: At-rest encryption for sensitive columns (bearer tokens, LiteLLM virtual keys, third-party API keys) via KEK/DEK pattern; KEK supplied via env / Vault / KMS adapter
- [ ] **DATA-06**: Tenants table with explicit "default" tenant created on first migration (single-org installs share the data model)
- [ ] **DATA-07**: Backup-and-restore tooling — `make backup` produces an encrypted dump; `make restore` is one-command; both run in CI

### Default Backend: Bundled LiteLLM with Open-Source Models

- [ ] **LITELLM-01**: Bundle LiteLLM Proxy **>= v1.83.7-stable** in the default `docker-compose.yml` (multipart-passthrough fix is native — no patches shipped)
- [ ] **LITELLM-02**: Default LiteLLM config wires to **open-source models** out of the box: `Systran/faster-whisper-large-v3` (or equivalent) for transcriptions, `pyannote/speaker-diarization-3.1` for diarization (HF token required at first run), Speaches-compatible open image for `WSS /v1/realtime`
- [ ] **LITELLM-03**: Implement support for the three audio routes via LiteLLM: `POST /v1/audio/transcriptions` (Whisper), `POST /v1/audio/diarization` (pyannote pass-through), `WSS /v1/realtime` (realtime mode); 3600s ingress read/send timeouts on the realtime route
- [ ] **LITELLM-04**: Mint per-user LiteLLM virtual keys via the LiteLLM `/key/generate` API (alias `user-<userId>` for traceability; **no per-user budget caps in v1** — corporate users are unlimited); rotate on tenant config change
- [ ] **LITELLM-05**: Document the env-override path: `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` (or admin master key for minting) point at an existing internal LiteLLM Proxy (the shape described in `speaches-audio.md`); the bundled LiteLLM container can be disabled via compose profile; same wire surface either way
- [ ] **LITELLM-06**: Convert `speaches-audio.md` into `docs/litellm-target-spec.md` covering both bundled-default and corporate-override LiteLLM configs (model definitions, virtual-key auth, `pass_through_endpoints` for diarization, realtime mode, ingress 3600s timeouts)
- [ ] **LITELLM-07**: Ingest LiteLLM spend logs into the platform usage ledger as observability; pass-through endpoints (diarization) are not metered by LiteLLM natively — surface only what LiteLLM gives us, no nginx-log scraping in v1

### Provider Abstraction (lightweight)

- [ ] **PROVIDER-01**: All STT/LLM/Realtime providers route through the configured single LiteLLM endpoint (bundled or operator-supplied); no parallel multi-LLM provider layer in v1
- [ ] **PROVIDER-02**: Storage provider interface: S3-compatible default (MinIO bundled in compose; any S3 / GCS / Azure Blob via env)
- [ ] **PROVIDER-03**: Identity provider interface: Better Auth's OAuth-Provider plugin handles OIDC; email+password is built-in; SAML deferred to v2
- [ ] **PROVIDER-04**: Email provider interface: SMTP only in v1 (verification + admin notifications)

### Enterprise Scale (1000 concurrent active users)

- [ ] **SCALE-01**: API tier is fully stateless; sessions stored in Postgres; cache state in Redis/Valkey; horizontal scaling validated
- [ ] **SCALE-02**: PgBouncer transaction-mode in front of Postgres; sized for 1000 concurrent (server-pool 100 × 4 instances)
- [ ] **SCALE-03**: BullMQ on Redis/Valkey for background jobs (audit-log fanout, email delivery, usage rollups, virtual-key rotation)
- [ ] **SCALE-04**: Anti-abuse rate limiting per-user, per-IP via Redis/Valkey token-bucket (NOT quota — observability ledger has no limits in v1); polling carve-out for `/api/auth/verification-status`
- [ ] **SCALE-05**: Streaming endpoints (NDJSON, WSS) survive ingress timeouts up to 1h; nginx `proxy_buffering off` + `X-Accel-Buffering: no` set; per-line `res.flush()` in NDJSON
- [ ] **SCALE-06**: Load test (k6) demonstrates 1000 concurrent active users (mixed transcribe + reason + stream + WSS) at p95 latency SLO; runs nightly in CI against an ephemeral environment
- [ ] **SCALE-07**: File-descriptor limits raised to 65535 on API + ingress containers; documented sizing matrix per topology

### Observability

- [ ] **OBS-01**: OpenTelemetry SDK auto-instrumentation for Fastify, undici, pg, ioredis; spans cover API → LiteLLM end-to-end with correlation IDs
- [ ] **OBS-02**: Prometheus metrics exposed via OTel Collector; default Grafana dashboards shipped for RED + saturation, per-tenant usage, LiteLLM spend
- [ ] **OBS-03**: Structured JSON logging to Loki via OTel Collector; bearer tokens scrubbed; correlation IDs propagated; English-only log keys
- [ ] **OBS-04**: LiteLLM spend logs piped into the platform usage ledger; reconciled against per-request ledger entries; discrepancy alerts
- [ ] **OBS-05**: Liveness, readiness, and startup probes — readiness fails when Postgres / Redis / LiteLLM unhealthy

### Frontend (UI-SPEC only — implementation deferred to v2)

- [ ] **UI-SPEC-01**: `UI-SPEC.md` for **Operator/Admin Console**: tenants list, tenant detail (members, IdP config, LiteLLM endpoint config, observed usage), users list, virtual-key management, audit log, observability deep-links
- [ ] **UI-SPEC-02**: `UI-SPEC.md` for **End-User Self-Service**: profile, observed usage breakdown, account deletion (mirroring desktop-client surface)
- [ ] **UI-SPEC-03**: UI-SPEC targets Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 + TanStack Query 5; follows accessibility (WCAG 2.2 AA), responsive (mobile + tablet + desktop), light + dark theme; component inventory enumerated; design tokens documented

### Deployment

- [ ] **DEPLOY-01**: `docker-compose.yml` for single-host self-host: API + Postgres 17 + PgBouncer + Redis/Valkey + bundled LiteLLM v1.83.7+ + bundled open-source AI models (Whisper / pyannote / faster-whisper) + MinIO + Traefik + OTel Collector + Grafana + Loki + Tempo + Mimir; compose profile to disable bundled LiteLLM when overriding to corporate
- [ ] **DEPLOY-02**: Helm chart for Kubernetes: HA Postgres via CloudNativePG 1.29, Traefik 3 ingress (NOT ingress-nginx — retired Mar 2026), HPA, cert-manager hooks, OTel-Collector DaemonSet, GPU node-selector for bundled AI workers (with disable-bundled option for corporate-LiteLLM topology)
- [ ] **DEPLOY-03**: One-command bootstrap (`make up` or `helm install`); one-command upgrade with safe rollback; refuse to start on default secrets
- [ ] **DEPLOY-04**: Migrations run as a pre-deploy job; safe under rolling deploy; backwards-compatible across one minor version
- [ ] **DEPLOY-05**: First-launch SLO — operator goes from `git clone` to first authenticated `/api/transcribe` against the bundled LiteLLM in **< 5 minutes**; CI test enforces this

### Engineering Discipline (constitutional)

- [ ] **TDD-01**: Strict TDD — tests precede production code on every feature, every bugfix; PR template enforces a "tests first" checklist
- [ ] **TDD-02**: Test layers: unit + integration (real Postgres / Redis via testcontainers; LiteLLM mocked at HTTP level via msw or Wiremock — we do not run real LiteLLM in CI) + e2e + contract + load + security + migration + i18n + RLS-property
- [ ] **CI-01**: GitHub Actions CI from day one; workflows in `.github/workflows/`; GitHub-hosted runners
- [ ] **CI-02**: CI matrix on every PR: lint + typecheck + unit + integration + e2e + contract + license-scan + secrets-scan (gitleaks) + dep-scan (Trivy + Dependabot) + SAST (CodeQL) + container-scan
- [ ] **CI-03**: Branch protection on `main` blocks merge unless required checks are green
- [ ] **CONTRACT-01**: Wire-contract conformance test suite asserts the server matches `BACKEND_SPEC.md` byte-for-byte (status codes, JSON shapes, headers, NDJSON line behavior, channel-scheme echo, `set-auth-token` rotation); runs against any deployed instance via `make contract-test BACKEND_URL=...`
- [ ] **TEST-COV-01**: Coverage gate ≥ 85% lines / ≥ 80% branches on the API tier (excluding generated code); enforced in CI
- [ ] **TEST-MUTATION-01**: Mutation testing (Stryker) on critical modules: auth, multi-tenancy enforcement, virtual-key minting; PR fails on score regression
- [ ] **TEST-LOAD-01**: k6 nightly load test asserts 1000 concurrent at p95 SLO; CI fails on regression
- [ ] **TEST-MIGRATION-01**: Migration tests verify forward apply + rollback on real Postgres in CI on every `migrations/` change
- [ ] **TEST-I18N-01**: i18n completeness test fails CI when a key exists in `en` but is missing in `ru` (or vice versa)
- [ ] **TEST-RLS-01**: RLS property tests assert no cross-tenant read or write paths exist; random tenant pairs, every queryable model
- [ ] **DEVEX-01**: One-command local dev (`make dev`) brings up the full stack with seeded data; `make test` runs the full suite; tested in CI

### Internationalization

- [ ] **I18N-01**: Runtime user/operator-facing strings (UI copy, email templates, notification text, end-user error messages) use i18next + i18next-icu; **minimum locales: `en` (default), `ru`**; CLDR pluralization (Russian one/few/many handled correctly); `Accept-Language` negotiation for API responses
- [ ] **I18N-02**: Locale resources operator-overridable via mounted volume / config map without forking

### OSS / Documentation

- [ ] **DOCS-01**: `README.md` with quickstart (compose path) — under 5 minutes to first authenticated `/api/transcribe`
- [ ] **DOCS-02**: `docs/architecture.md` — component decomposition, request lifecycle for the three hot paths, mermaid diagrams
- [ ] **DOCS-03**: `docs/operations.md` — deploy, upgrade, scale, backup, restore, troubleshoot
- [ ] **DOCS-04**: `docs/litellm-target-spec.md` — bundled-default LiteLLM config + corporate-override LiteLLM config (derived from `speaches-audio.md`)
- [ ] **DOCS-05**: `docs/wire-contract.md` — references upstream `BACKEND_SPEC.md` + `OAUTH_SPEC.md`; documents which endpoints are deferred to v2 (Stripe / referrals)
- [ ] **DOCS-06**: `docs/auth.md` — how to plug in OIDC providers; how to configure email+password; channel-scheme handling
- [ ] **DOCS-07**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, OSS LICENSE (Apache-2.0 default), license headers
- [ ] **DOCS-08**: ADRs for every Key Decision in this document
- [ ] **DOCS-09**: All source artifacts (docs, code, comments, commit messages, identifiers, log keys) in **English only** — hard rule, enforced by lint where mechanical, by review otherwise

## v2 Requirements

Acknowledged but explicitly deferred from v1.

### Wire Surface Expansion

- **WIRE-V2-01**: Implement `POST /api/stripe/{checkout,portal,switch-plan,preview-switch}` (4 endpoints) — Stripe billing lifecycle
- **WIRE-V2-02**: Implement `GET /api/referrals/stats`, `POST /api/referrals/invite`, `GET /api/referrals/invites` — referrals
- **WIRE-V2-03**: Per-user quota enforcement — surface exhaustion at HTTP 200 with `limitReached: true` for `/api/transcribe`

### Compliance & Enterprise+

- **COMPL-01**: SAML 2.0 IdP connector
- **COMPL-02**: SCIM provisioning
- **COMPL-03**: Audit-log SIEM exports (Splunk / Datadog / Elastic)
- **COMPL-04**: Per-tenant data-residency allow/deny lists with provider routing enforcement

### Operator Productivity

- **OP-01**: Sandbox / test tenant creation flow
- **OP-02**: Per-tenant cost dashboards (live)
- **OP-03**: PII redaction in transcripts (text-stage)
- **OP-04**: Live runtime trace validation tooling (capture-and-diff against deployed cloud)
- **OP-05**: OpenAPI / JSON Schema generation from contract test suite

### Frontend Implementation

- **UI-IMPL-01**: Implementation of the operator/admin console from `UI-SPEC.md`
- **UI-IMPL-02**: Implementation of end-user self-service from `UI-SPEC.md`

### Locale Expansion

- **I18N-V2-01**: Additional locales beyond en+ru (driven by deployer demand)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Modifying the OpenWhispr desktop client | We are wire-compatible by design; the client is the canonical "user" |
| Reimplementing third-party AI vendor SDKs (OpenAI/Anthropic/Gemini/etc.) | LiteLLM Proxy is the AI plane; vendor docs are authoritative for direct-BYOK paths |
| Google Calendar OAuth proxying | Desktop talks to Google directly with embedded Desktop OAuth client ID; the server has no role |
| Hidden/undocumented OpenWhispr endpoints (admin/webhooks/internal) | The wire surface is exactly what the upstream spec enumerates |
| Custom multi-LLM provider abstraction layer beyond LiteLLM | LiteLLM is the abstraction; reimplementing is yak-shaving |
| Custom IdP UI / self-hosted SSO portal | Defer to bundled IdPs (Keycloak / Authentik / Zitadel) if operator needs one |
| Locales beyond `en`+`ru` in v1 | Establish framework first; expand based on demand |
| Plaintext HTTP backends | Client never strips/rewrites the URL scheme — HTTPS is mandatory |
| Live runtime trace validation tooling | Replaced for v1 by the conformance test suite (CONTRACT-01) |
| OpenAPI / JSON-Schema machine-readable spec | Markdown + conformance suite is the v1 deliverable; generate later if v2 typed clients demand it |

## Traceability

All 89 v1 requirements mapped by `gsd-roadmapper` on 2026-05-08.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WIRE-01 | Phase 2 | Pending |
| WIRE-02 | Phase 2 | Pending |
| WIRE-03 | Phase 2 | Pending |
| WIRE-04 | Phase 2 | Pending |
| WIRE-05 | Phase 3 | Pending |
| WIRE-06 | Phase 3 | Pending |
| WIRE-07 | Phase 4 | Pending |
| WIRE-08 | Phase 5 | Pending |
| WIRE-09 | Phase 5 | Pending |
| WIRE-10 | Phase 5 | Pending |
| WIRE-11 | Phase 5 | Pending |
| WIRE-12 | Phase 5 | Pending |
| WIRE-13 | Phase 4 | Pending |
| WIRE-14 | Phase 4 | Pending |
| WIRE-15 | Phase 4 | Pending |
| WIRE-16 | Phase 5 | Pending |
| WIRE-17 | Phase 2 | Pending |
| WIRE-18 | Phase 2 | Pending |
| WIRE-19 | Phase 2 | Pending |
| WIRE-20 | Phase 2 | Pending |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| AUTH-05 | Phase 2 | Pending |
| AUTH-06 | Phase 2 | Pending |
| AUTH-07 | Phase 2 | Pending |
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-03 | Phase 3 | Pending |
| DATA-04 | Phase 6 | Pending |
| DATA-05 | Phase 1 | Pending |
| DATA-06 | Phase 1 | Pending |
| DATA-07 | Phase 1 | Pending |
| LITELLM-01 | Phase 3 | Pending |
| LITELLM-02 | Phase 3 | Pending |
| LITELLM-03 | Phase 3 | Pending |
| LITELLM-04 | Phase 3 | Pending |
| LITELLM-05 | Phase 3 | Pending |
| LITELLM-06 | Phase 3 | Pending |
| LITELLM-07 | Phase 3 | Pending |
| PROVIDER-01 | Phase 3 | Pending |
| PROVIDER-02 | Phase 1 | Pending |
| PROVIDER-03 | Phase 2 | Pending |
| PROVIDER-04 | Phase 2 | Pending |
| SCALE-01 | Phase 6 | Pending |
| SCALE-02 | Phase 8 | Pending |
| SCALE-03 | Phase 6 | Pending |
| SCALE-04 | Phase 6 | Pending |
| SCALE-05 | Phase 4 | Pending |
| SCALE-06 | Phase 8 | Pending |
| SCALE-07 | Phase 8 | Pending |
| OBS-01 | Phase 6 | Pending |
| OBS-02 | Phase 6 | Pending |
| OBS-03 | Phase 6 | Pending |
| OBS-04 | Phase 6 | Pending |
| OBS-05 | Phase 6 | Pending |
| UI-SPEC-01 | Phase 7 | Pending |
| UI-SPEC-02 | Phase 7 | Pending |
| UI-SPEC-03 | Phase 7 | Pending |
| DEPLOY-01 | Phase 9 | Pending |
| DEPLOY-02 | Phase 9 | Pending |
| DEPLOY-03 | Phase 9 | Pending |
| DEPLOY-04 | Phase 9 | Pending |
| DEPLOY-05 | Phase 9 | Pending |
| TDD-01 | Phase 0 | Pending |
| TDD-02 | Phase 0 | Pending |
| CI-01 | Phase 0 | Pending |
| CI-02 | Phase 0 | Pending |
| CI-03 | Phase 0 | Pending |
| CONTRACT-01 | Phase 2 | Pending |
| TEST-COV-01 | Phase 0 | Pending |
| TEST-MUTATION-01 | Phase 0 | Pending |
| TEST-LOAD-01 | Phase 8 | Pending |
| TEST-MIGRATION-01 | Phase 1 | Pending |
| TEST-I18N-01 | Phase 10 | Pending |
| TEST-RLS-01 | Phase 1 | Pending |
| DEVEX-01 | Phase 0 | Pending |
| I18N-01 | Phase 10 | Pending |
| I18N-02 | Phase 10 | Pending |
| DOCS-01 | Phase 10 | Pending |
| DOCS-02 | Phase 10 | Pending |
| DOCS-03 | Phase 10 | Pending |
| DOCS-04 | Phase 10 | Pending |
| DOCS-05 | Phase 10 | Pending |
| DOCS-06 | Phase 10 | Pending |
| DOCS-07 | Phase 10 | Pending |
| DOCS-08 | Phase 10 | Pending |
| DOCS-09 | Phase 0 | Pending |

**Coverage:**
- v1 requirements: 89 total
- Mapped to phases: 89 ✓
- Unmapped: 0
- Phase distribution: 0=9, 1=8, 2=18, 3=11, 4=5, 5=6, 6=9, 7=3, 8=4, 9=5, 10=11

---
*Requirements defined: 2026-05-08*
*Last updated: 2026-05-08 after baseline pivot (defer Stripe/referrals/quotas; bundle LiteLLM with open-source models; UI-SPEC only)*
