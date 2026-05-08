# Requirements: OpenWhispr Server

**Defined:** 2026-05-08
**Core Value:** A drop-in OpenWhispr cloud backend that any organization can self-host on its own infrastructure with its own AI providers — without modifying the desktop client.

## v1 Requirements

Requirements for the initial OSS release. Each maps to one roadmap phase.

### Wire Compatibility (the contract)

Source of truth: `/Users/dev/openwhispr/docs/BACKEND_SPEC.md`, `OAUTH_SPEC.md`, `SELF_HOSTING.md` (1556 lines, byte-for-byte authoritative).

- [ ] **WIRE-01**: Implement `POST /api/check-user` (pre-auth; returns `{exists:boolean}` at 200; non-2xx routes desktop to sign-up branch)
- [ ] **WIRE-02**: Implement `GET /api/auth/verification-status?email=...` (cookie-auth; 5s polling cadence carve-out from rate limiter; 200+`{verified:bool}`, 4xx surfaces "session expired")
- [ ] **WIRE-03**: Implement `DELETE /api/auth/delete-account` (cookie-auth; 2xx clears local token+cookie+session)
- [ ] **WIRE-04**: Implement `GET /api/health` (3s timeout; body unread; only `res.ok` and `res.status` are inspected)
- [ ] **WIRE-05**: Implement `POST /api/transcribe` (multipart audio; returns `{text, wordsUsed, wordsRemaining, plan, limitReached, sttProvider, sttModel, ...}`; **quota exhaustion at HTTP 200 with `limitReached:true`**, never 4xx)
- [ ] **WIRE-06**: Implement `POST /api/reason` (cloud LLM; returns `{text, model, provider, promptMode, matchType}`)
- [ ] **WIRE-07**: Implement `POST /api/agent/stream` (`Content-Type: application/x-ndjson`, **flush per line**, no buffering anywhere in the chain)
- [ ] **WIRE-08**: Implement `POST /api/agent/web-search` (server-side search tool for the agent)
- [ ] **WIRE-09**: Implement `POST /api/streaming-usage` (reports streaming-session usage)
- [ ] **WIRE-10**: Implement `GET /api/usage` (per-user quota / plan info)
- [ ] **WIRE-11**: Implement `GET /api/stt-config` (server-side STT provider/model selection per tenant/user)
- [ ] **WIRE-12**: Implement `GET /api/note-recording-config` (note-recording configuration)
- [ ] **WIRE-13**: Implement `POST /api/streaming-token` (mints AssemblyAI streaming token from server-held key)
- [ ] **WIRE-14**: Implement `POST /api/deepgram-streaming-token` (mints Deepgram streaming token)
- [ ] **WIRE-15**: Implement `POST /api/openai-realtime-token` (mints OpenAI Realtime token; `streams=2` for OpenAI realtime as required)
- [ ] **WIRE-16**: Implement Stripe lifecycle: `POST /api/stripe/checkout`, `POST /api/stripe/portal`, `POST /api/stripe/switch-plan`, `POST /api/stripe/preview-switch` (all bearer-auth; null-adapter when billing disabled)
- [ ] **WIRE-17**: Implement referrals: `GET /api/referrals/stats`, `POST /api/referrals/invite`, `GET /api/referrals/invites`
- [ ] **WIRE-18**: Implement generic passthrough channel `cloud-api-request` (any `/api/<path>` proxied via main process; honors global error envelope)
- [ ] **WIRE-19**: Honor the global error envelope `{ "error": "<human-readable string>" }` for every non-2xx response
- [ ] **WIRE-20**: Return HTTP **401** (not 200-with-error) on invalid/expired tokens — `withSessionRefresh()` retry-once-with-backoff path depends on this
- [ ] **WIRE-21**: Accept `Authorization: Bearer <opaque>` AND session cookies on every authenticated endpoint (main process attaches both; renderer-direct endpoints rely on cookie alone)
- [ ] **WIRE-22**: HTTPS-only — never serve any externally reachable port over plaintext HTTP

### Authentication & OAuth

- [ ] **AUTH-01**: Host `${AUTH_URL}/api/desktop-signin/{provider}` shim that initiates the upstream IdP round-trip
- [ ] **AUTH-02**: Final OAuth redirect emits `${PROTOCOL}://?bearer_token=<token>` echoing the **exact** scheme received in the `callbackURL` query parameter (production / `openwhispr-dev` / `openwhispr-staging` / arbitrary override per `OPENWHISPR_PROTOCOL`)
- [ ] **AUTH-03**: Issue opaque bearer tokens long-lived enough to survive desktop relaunches (≥30 days), with rotation via the `set-auth-token` response header on Better-Auth-style endpoints; new and old tokens overlap ≥5 minutes (covers `withSessionRefresh()` 60s grace window with margin)
- [ ] **AUTH-04**: Support email/password sign-in via Better Auth contract; expose verification status to the desktop's 5-second polling
- [ ] **AUTH-05**: At least 2 OIDC IdPs in v1 (Google + generic OIDC); architecture supports Microsoft, Apple, GitHub, magic-link, SAML as later-added providers
- [ ] **AUTH-06**: `x-openwhispr-source: desktop` header is preserved/observable for feature flagging
- [ ] **AUTH-07**: Built-in dev mode: email+password works without any external IdP configured (operator can `compose up` and immediately sign in)

### Multi-tenancy & Data

- [ ] **DATA-01**: PostgreSQL 17+ schema with row-level security; `app.tenant_id` GUC set via `SET LOCAL` inside every request transaction (PgBouncer transaction-mode safe)
- [ ] **DATA-02**: Forward-only migrations via Drizzle; CI verifies forward apply + rollback on real Postgres on every change to `migrations/`
- [ ] **DATA-03**: Per-tenant quota / plan / usage ledger (transcribe minutes, reason tokens, streaming minutes); idempotent on `request_id`
- [ ] **DATA-04**: Audit log for auth events, account deletion, key issuance, quota changes, plan changes, provider config changes
- [ ] **DATA-05**: At-rest encryption for sensitive columns (bearer tokens, provider API keys) via KEK/DEK pattern; KEK supplied via env / Vault / KMS adapter
- [ ] **DATA-06**: Tenants table with explicit "default" tenant created on first migration (so single-org installs use the same data model)
- [ ] **DATA-07**: Backup-and-restore tooling — `make backup` produces an encrypted dump; `make restore` is one-command; both run in CI

### Default Backend: LiteLLM Proxy + Speaches

- [ ] **LITELLM-01**: Embed LiteLLM Proxy **>= v1.83.7-stable** as the default LLM/audio gateway (multipart-passthrough fix is native — no patch shipped)
- [ ] **LITELLM-02**: Convert `/Users/dev/openwhispr-server/speaches-audio.md` into `docs/litellm-config-spec.md` covering: model definitions for `examplecorp/whisper-large-v3-russian` / `-english` / `canary-1b-v2`, virtual-key auth, `pass_through_endpoints` for diarization, realtime mode for `/v1/realtime`, ingress 3600s read/send timeouts
- [ ] **LITELLM-03**: Built-in support for the three Speaches audio routes: `POST /v1/audio/transcriptions` (Whisper), `POST /v1/audio/diarization` (pyannote pass-through), `WSS /v1/realtime` (Speaches Realtime per OpenAI Realtime spec)
- [ ] **LITELLM-04**: Mint per-user / per-tenant LiteLLM virtual keys via the LiteLLM `/key/generate` API with budget + alias + model-allowlist; rotate on tenant config change
- [ ] **LITELLM-05**: Ingest LiteLLM spend logs into the platform usage ledger (callback plugin or Postgres co-tenant — phase-2 spike decides); pass-through endpoints (diarization) metered via nginx access log + post-call guardrails (LiteLLM does not natively meter pass-through)

### Multi-Provider Abstraction

Provider interfaces defined as TypeScript types in a `providers/` package; runtime selection per-tenant via versioned config snapshot resolved per-request.

- [ ] **PROVIDER-01**: STT providers: LiteLLM/Speaches (default), AssemblyAI, Deepgram, OpenAI Whisper API, Groq Whisper — selectable per-tenant
- [ ] **PROVIDER-02**: LLM providers: LiteLLM-routed (default), direct OpenAI, Anthropic, Gemini, Mistral, Bedrock, Azure OpenAI, Vertex — selectable per-tenant
- [ ] **PROVIDER-03**: Realtime providers: Speaches Realtime (default), OpenAI Realtime, AssemblyAI streaming, Deepgram streaming
- [ ] **PROVIDER-04**: Storage providers: S3-compatible (MinIO default for self-host; S3 / GCS / Azure Blob via adapter)
- [ ] **PROVIDER-05**: Billing providers: Stripe (default), null/disabled (license-only installs)
- [ ] **PROVIDER-06**: Email providers: SMTP (default), SendGrid, SES, Postmark — used for verification + referral invites
- [ ] **PROVIDER-07**: Identity providers: pluggable behind Better Auth's OAuth-Provider plugin; bundled connectors for Google, generic OIDC, email+password
- [ ] **PROVIDER-08**: Per-tenant provider override — org A can use LiteLLM, org B can use Bedrock-direct, in the same installation; overrides hot-reload safely (in-flight requests pinned to their config snapshot)

### Enterprise Scale (1000 concurrent active users)

- [ ] **SCALE-01**: API tier is fully stateless; sessions stored in Postgres; cache state in Redis/Valkey; horizontal scaling validated
- [ ] **SCALE-02**: PgBouncer transaction-mode in front of Postgres; sized for 1000 concurrent (server-pool 100 × 4 instances)
- [ ] **SCALE-03**: BullMQ on Redis/Valkey for background jobs (transcription orchestration, webhook fanout, email delivery, usage rollups, tenant cleanup); workers run the same image with a queue entrypoint
- [ ] **SCALE-04**: Rate limiting per-user, per-tenant, per-IP via Redis-backed token bucket; verification-polling carve-out for `/api/auth/verification-status`
- [ ] **SCALE-05**: Streaming endpoints (NDJSON, WSS) survive ingress timeouts up to 1h; nginx `proxy_buffering off` + `X-Accel-Buffering: no` set; per-line `res.flush()` in NDJSON
- [ ] **SCALE-06**: Load test (k6) demonstrates 1000 concurrent active users (mixed transcribe + reason + stream + WSS) at p95 latency SLO; runs nightly in CI against an ephemeral environment
- [ ] **SCALE-07**: File-descriptor limits raised to 65535 on API + ingress containers; documented sizing matrix per topology

### Observability

- [ ] **OBS-01**: OpenTelemetry SDK auto-instrumentation for Fastify, undici, pg, ioredis; spans cover API → LiteLLM → Speaches end-to-end with correlation IDs
- [ ] **OBS-02**: Prometheus metrics exposed via OTel Collector; default Grafana dashboards shipped for RED + saturation, per-tenant usage, LiteLLM spend
- [ ] **OBS-03**: Structured JSON logging to Loki via OTel Collector; bearer tokens scrubbed; correlation IDs propagated; English-only log keys
- [ ] **OBS-04**: LiteLLM spend logs piped into the platform usage ledger; reconciled against per-request ledger entries; discrepancy alerts
- [ ] **OBS-05**: Liveness, readiness, and startup probes — readiness fails when Postgres / Redis / LiteLLM unhealthy

### Frontend (UI-SPEC only — implementation out of v1 scope)

- [ ] **UI-SPEC-01**: `UI-SPEC.md` for **Operator/Admin Console**: tenants list, tenant detail (members, providers, quotas), users list, key management, audit log, observability deep-links, billing config, provider config, dev mode
- [ ] **UI-SPEC-02**: `UI-SPEC.md` for **End-User Self-Service**: profile, plan, usage breakdown, referrals (stats / invite / invites), account deletion (mirroring desktop-client surfaces)
- [ ] **UI-SPEC-03**: UI-SPEC follows accessibility (WCAG 2.2 AA), responsive (mobile + tablet + desktop), light + dark theme; component inventory enumerated against shadcn/ui v2 + Tailwind 4; design tokens documented; user generates code from the spec downstream

### Deployment

- [ ] **DEPLOY-01**: `docker-compose.yml` for single-host self-host: API, Postgres 17, Redis/Valkey, LiteLLM v1.83.7+, Speaches (GPU optional — fallback to remote API), MinIO, Traefik, OTel Collector, Grafana+Loki+Tempo+Mimir
- [ ] **DEPLOY-02**: Helm chart for Kubernetes: HA Postgres via CloudNativePG 1.29, Traefik 3 ingress (NOT ingress-nginx — retired Mar 2026), HPA, cert-manager hooks, OTel-Collector DaemonSet, GPU node-selector for Speaches
- [ ] **DEPLOY-03**: One-command bootstrap (`make up` or `helm install`); one-command upgrade with safe rollback; refuse to start on default secrets
- [ ] **DEPLOY-04**: Migrations run as a pre-deploy job; safe under rolling deploy; backwards-compatible across one minor version
- [ ] **DEPLOY-05**: First-launch SLO — operator goes from `git clone` to first authenticated `/api/transcribe` in **< 5 minutes**; CI test enforces this

### Engineering Discipline (constitutional)

- [ ] **TDD-01**: Strict TDD — tests precede production code on every feature, every bugfix; PR template enforces a "tests first" checklist
- [ ] **TDD-02**: Test layers: unit + integration (real Postgres / Redis / LiteLLM / Speaches via testcontainers) + e2e + contract + load + security + migration + i18n + RLS-property
- [ ] **CI-01**: GitHub Actions CI from day one; workflows in `.github/workflows/`; GitHub-hosted runners (self-hosted only for GPU jobs)
- [ ] **CI-02**: CI matrix on every PR: lint + typecheck + unit + integration + e2e + contract + license-scan + secrets-scan (gitleaks) + dep-scan (Trivy + Dependabot) + SAST (CodeQL) + container-scan
- [ ] **CI-03**: Branch protection on `main` blocks merge unless required checks are green
- [ ] **CONTRACT-01**: Wire-contract conformance test suite asserts the server matches `BACKEND_SPEC.md` byte-for-byte (status codes, JSON shapes, headers, NDJSON line behavior, channel-scheme echo, `set-auth-token` rotation); runs against any deployed instance via `make contract-test BACKEND_URL=...`
- [ ] **TEST-COV-01**: Coverage gate ≥ 85% lines / ≥ 80% branches on the API tier (excluding generated code); enforced in CI
- [ ] **TEST-MUTATION-01**: Mutation testing (Stryker) on critical modules: auth, multi-tenancy enforcement, quota math, billing math; PR fails on score regression
- [ ] **TEST-LOAD-01**: k6 nightly load test asserts 1000 concurrent at p95 SLO; CI fails on regression
- [ ] **TEST-MIGRATION-01**: Migration tests verify forward apply + rollback on real Postgres in CI on every `migrations/` change
- [ ] **TEST-I18N-01**: i18n completeness test fails CI when a key exists in `en` but is missing in `ru` (or vice versa)
- [ ] **TEST-RLS-01**: RLS property tests assert no cross-tenant read or write paths exist; random tenant pairs, every queryable model
- [ ] **DEVEX-01**: One-command local dev (`make dev`) brings up the full stack with seeded data; `make test` runs the full suite; tested in CI

### Internationalization

- [ ] **I18N-01**: Runtime user/operator-facing strings (UI copy, email templates, notification text, end-user error messages) use i18next + i18next-icu; **minimum locales: `en` (default), `ru`**; CLDR pluralization (Russian one/few/many handled correctly); `Accept-Language` negotiation for API responses
- [ ] **I18N-02**: Locale resources are operator-overridable without forking — operator drops files into a mounted volume / config map and they layer on top of bundled resources

### OSS / Documentation

- [ ] **DOCS-01**: `README.md` with quickstart (compose path) — under 5 minutes to first authenticated `/api/transcribe`
- [ ] **DOCS-02**: `docs/architecture.md` — component decomposition, request lifecycle for the three hot paths, mermaid diagrams
- [ ] **DOCS-03**: `docs/operations.md` — deploy, upgrade, scale, backup, restore, troubleshoot
- [ ] **DOCS-04**: `docs/providers.md` — how to swap LLM / STT / Realtime / storage / auth / billing / email providers per tenant
- [ ] **DOCS-05**: `docs/litellm-config-spec.md` — derived from `speaches-audio.md`
- [ ] **DOCS-06**: `docs/wire-contract.md` — reproduces upstream `BACKEND_SPEC.md` + `OAUTH_SPEC.md` contract surface; cross-links the conformance suite
- [ ] **DOCS-07**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, OSS LICENSE (Apache-2.0 default — confirm with operator at first commit), license headers
- [ ] **DOCS-08**: ADRs for every Key Decision (one ADR per row in `PROJECT.md` § Key Decisions)
- [ ] **DOCS-09**: All source artifacts (docs, code, comments, commit messages, identifiers, log keys) are in **English only** — hard rule, enforced by lint where mechanical, by review otherwise

## v2 Requirements

Acknowledged but explicitly deferred from v1.

### Compliance & Enterprise+

- **COMPL-01**: SAML 2.0 IdP connector
- **COMPL-02**: SCIM provisioning
- **COMPL-03**: Audit-log SIEM exports (Splunk / Datadog / Elastic)
- **COMPL-04**: FedRAMP-grade isolation modes
- **COMPL-05**: Per-tenant data-residency allow/deny lists with provider routing enforcement

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
| Hidden/undocumented OpenWhispr endpoints (admin/webhooks/internal) | The wire surface is exactly what the current desktop binary sends |
| The actual frontend implementation in v1 | UI-SPEC ships in v1; UI generation is a downstream task by the operator |
| Custom IdP UI / self-hosted SSO portal in v1 | Defer to bundled Keycloak / Authentik / Zitadel; we are the OIDC client, not the IdP |
| Locales beyond `en`+`ru` in v1 | Establish the framework first; expand based on demand |
| Plaintext HTTP backends | Client never strips/rewrites the URL scheme — HTTPS is mandatory |
| Live runtime trace validation tooling | Replaced for v1 by the conformance test suite (DIFF-12 / CONTRACT-01) |
| OpenAPI / JSON-Schema machine-readable spec | Markdown + conformance suite is the v1 deliverable; generate later if v2 typed clients demand it |

## Traceability

All v1 requirements mapped to exactly one phase. Phase mappings populated by `gsd-roadmapper` on 2026-05-08.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WIRE-01 | Phase 2 | Pending |
| WIRE-02 | Phase 2 | Pending |
| WIRE-03 | Phase 2 | Pending |
| WIRE-04 | Phase 2 | Pending |
| WIRE-05 | Phase 3 | Pending |
| WIRE-06 | Phase 3 | Pending |
| WIRE-07 | Phase 4 | Pending |
| WIRE-08 | Phase 4 | Pending |
| WIRE-09 | Phase 6 | Pending |
| WIRE-10 | Phase 6 | Pending |
| WIRE-11 | Phase 5 | Pending |
| WIRE-12 | Phase 5 | Pending |
| WIRE-13 | Phase 4 | Pending |
| WIRE-14 | Phase 4 | Pending |
| WIRE-15 | Phase 4 | Pending |
| WIRE-16 | Phase 6 | Pending |
| WIRE-17 | Phase 6 | Pending |
| WIRE-18 | Phase 6 | Pending |
| WIRE-19 | Phase 2 | Pending |
| WIRE-20 | Phase 2 | Pending |
| WIRE-21 | Phase 2 | Pending |
| WIRE-22 | Phase 1 | Pending |
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
| DATA-04 | Phase 7 | Pending |
| DATA-05 | Phase 3 | Pending |
| DATA-06 | Phase 1 | Pending |
| DATA-07 | Phase 7 | Pending |
| LITELLM-01 | Phase 3 | Pending |
| LITELLM-02 | Phase 3 | Pending |
| LITELLM-03 | Phase 3 | Pending |
| LITELLM-04 | Phase 3 | Pending |
| LITELLM-05 | Phase 3 | Pending |
| PROVIDER-01 | Phase 5 | Pending |
| PROVIDER-02 | Phase 5 | Pending |
| PROVIDER-03 | Phase 5 | Pending |
| PROVIDER-04 | Phase 5 | Pending |
| PROVIDER-05 | Phase 6 | Pending |
| PROVIDER-06 | Phase 5 | Pending |
| PROVIDER-07 | Phase 5 | Pending |
| PROVIDER-08 | Phase 5 | Pending |
| SCALE-01 | Phase 1 | Pending |
| SCALE-02 | Phase 1 | Pending |
| SCALE-03 | Phase 7 | Pending |
| SCALE-04 | Phase 7 | Pending |
| SCALE-05 | Phase 4 | Pending |
| SCALE-06 | Phase 9 | Pending |
| SCALE-07 | Phase 9 | Pending |
| OBS-01 | Phase 7 | Pending |
| OBS-02 | Phase 7 | Pending |
| OBS-03 | Phase 7 | Pending |
| OBS-04 | Phase 7 | Pending |
| OBS-05 | Phase 1 | Pending |
| UI-SPEC-01 | Phase 8 | Pending |
| UI-SPEC-02 | Phase 8 | Pending |
| UI-SPEC-03 | Phase 8 | Pending |
| DEPLOY-01 | Phase 10 | Pending |
| DEPLOY-02 | Phase 10 | Pending |
| DEPLOY-03 | Phase 1 (bootstrap + refuse-default-secrets) / Phase 10 (helm upgrade) | Pending |
| DEPLOY-04 | Phase 10 | Pending |
| DEPLOY-05 | Phase 10 | Pending |
| TDD-01 | Phase 0 | Pending |
| TDD-02 | Phase 0 | Pending |
| CI-01 | Phase 0 | Pending |
| CI-02 | Phase 0 | Pending |
| CI-03 | Phase 0 | Pending |
| CONTRACT-01 | Phase 2 | Pending |
| TEST-COV-01 | Phase 0 | Pending |
| TEST-MUTATION-01 | Phase 0 | Pending |
| TEST-LOAD-01 | Phase 9 | Pending |
| TEST-MIGRATION-01 | Phase 1 | Pending |
| TEST-I18N-01 | Phase 11 | Pending |
| TEST-RLS-01 | Phase 1 | Pending |
| DEVEX-01 | Phase 0 | Pending |
| I18N-01 | Phase 11 | Pending |
| I18N-02 | Phase 11 | Pending |
| DOCS-01 | Phase 11 | Pending |
| DOCS-02 | Phase 11 | Pending |
| DOCS-03 | Phase 11 | Pending |
| DOCS-04 | Phase 11 | Pending |
| DOCS-05 | Phase 11 | Pending |
| DOCS-06 | Phase 11 | Pending |
| DOCS-07 | Phase 11 | Pending |
| DOCS-08 | Phase 11 | Pending |
| DOCS-09 | Phase 0 | Pending |

**Coverage:**
- v1 requirements: 93 total (line-item count; preamble figure of "78" predated the constitutional/test-discipline expansion)
- Mapped to phases: 93 ✓
- Unmapped: 0 ✓
- Duplicates: 0 ✓ (DEPLOY-03 is split-mapped between Phase 1 and Phase 10 by deliverable scope, not duplicated)

---
*Requirements defined: 2026-05-08*
*Traceability populated: 2026-05-08 by gsd-roadmapper*
