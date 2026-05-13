# Requirements: OpenWhispr Server

**Defined:** 2026-05-08
**Core Value:** A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

## v1 Requirements

Requirements for the initial OSS release. Stripe / referrals / quota-enforcement are deferred to v2 — upstream `SELF_HOSTING.md` itself classifies them as "Operational / quota endpoints (recommended)" with stub-as-503 explicitly acceptable.

### Wire Compatibility — Auth Lifecycle (must implement)

Source of truth: `/Users/nick/openwhispr/docs/BACKEND_SPEC.md`, `OAUTH_SPEC.md`, `SELF_HOSTING.md` (1556 lines, byte-for-byte authoritative).

- [x] **WIRE-01**: `POST /api/check-user` — pre-auth; returns `{exists:boolean}` at 200; non-2xx routes desktop to sign-up branch
- [x] **WIRE-02**: `GET /api/auth/verification-status?email=...` — cookie-auth; 5s polling cadence carve-out from rate limiter; 200+`{verified:bool}`, 4xx surfaces "session expired"
- [x] **WIRE-03**: `DELETE /api/auth/delete-account` — cookie-auth; 2xx clears local token+cookie+session

### Wire Compatibility — Operational Endpoints (v1)

- [x] **WIRE-04**: `GET /api/health` — 3s timeout; body unread; only `res.ok` and `res.status` are inspected
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

### Wire Compatibility — CRUD Resource Families (v1, Phase 5 scope-expansion 2026-05-11)

Authoritative wire shapes pinned by the OpenWhispr client TS interfaces at `~/openwhispr/src/services/*.ts`. Every resource: soft-delete via `deleted_at`; `client_<resource>_id` for offline-first idempotent retry; RLS-scoped to `current_setting('app.tenant_id')`; keyset list pagination on `(created_at, id)` via `?limit=&before=&since=`.

- [ ] **WIRE-22**: Notes CRUD + list + search + batch-create — `POST /api/notes/create`, `POST /api/notes/batch-create`, `PATCH /api/notes/update`, `DELETE /api/notes/delete`, `DELETE /api/notes/delete-all`, `GET /api/notes/list`, `POST /api/notes/search` (Postgres `tsvector + GIN`, `'simple'` config); shapes per `~/openwhispr/src/services/NotesService.ts` (`NoteInput`, `CloudNote`, `SearchResult` with `score`)
- [ ] **WIRE-23**: Folders CRUD + list + batch-create — `POST /api/folders/create`, `POST /api/folders/batch-create`, `PATCH /api/folders/update`, `DELETE /api/folders/delete`, `GET /api/folders/list`; shapes per `~/openwhispr/src/services/FoldersService.ts` (`FolderInput`, `CloudFolder`)
- [ ] **WIRE-24**: Conversations CRUD + list + search — `POST /api/conversations/create`, `PATCH /api/conversations/update`, `DELETE /api/conversations/delete`, `GET /api/conversations/list` (supports `include=messages` JOIN), `POST /api/conversations/search`; shapes per `~/openwhispr/src/services/ConversationsService.ts` (`ConversationInput`, `CloudConversation`, `CloudConversationWithMessages`)
- [ ] **WIRE-25**: Conversations messages — `POST /api/conversations/messages` (add single message), `GET /api/conversations/messages?conversation_id=...&limit=&before=` (list messages keyset-paginated); shape `CloudMessage` per same file
- [ ] **WIRE-26**: Transcriptions CRUD + list + batch — `POST /api/transcriptions/create`, `POST /api/transcriptions/batch-create`, `GET /api/transcriptions/list`, `DELETE /api/transcriptions/delete`, `POST /api/transcriptions/batch-delete`; shapes per `~/openwhispr/src/services/TranscriptionsService.ts` (`TranscriptionInput`, `CloudTranscription`)
- [ ] **WIRE-27**: API Keys list + create — `GET /api/v1/keys/list`, `POST /api/v1/keys/create`; shapes per `~/openwhispr/src/services/ApiKeysService.ts` (`ApiKey`, `CreateApiKeyResponse`); UNIQUE `{data: T}` envelope wrapper per client contract (different from rest of API); Argon2id-hashed `key_hash` at rest; `key` field returned **once** on creation only
- [ ] **WIRE-28**: Settings storage — `tenant_settings(tenant_id PK, stt_config JSONB, note_recording_config JSONB)` + `user_settings(user_id PK, tenant_id, stt_overrides JSONB, note_recording_overrides JSONB)` tables with RLS + FORCE RLS; resolution order user_settings → tenant_settings → env defaults; Phase 5 ships GET-only paths (WIRE-11, WIRE-12); mutation deferred to Phase 7 UI
- [ ] **WIRE-29**: CONTRACT-01 negative matrix — for every implemented `/api/*` route AND synthetic `/api/nonexistent-<uuid>` paths, assert non-2xx responses match the global envelope (`{error: string}` default; tolerant of structured `{error: {message, code?}}` only at the receiver per client contract); proves `cloud-api-request` passthrough invariant end-to-end

### Wire Compatibility — Conventions (apply to every endpoint)

- [x] **WIRE-17**: Honor the global error envelope `{ "error": "<human-readable string>" }` for every non-2xx response
- [x] **WIRE-18**: Return HTTP **401** (not 200-with-error) on invalid/expired tokens — `withSessionRefresh()` retry-once-with-backoff path depends on this
- [x] **WIRE-19**: Accept `Authorization: Bearer <opaque>` AND session cookies on every authenticated endpoint (main process attaches both; renderer-direct endpoints rely on cookie alone)
- [x] **WIRE-20**: HTTPS-only — never serve any externally reachable port over plaintext HTTP

### Authentication & OAuth

- [x] **AUTH-01**: Host `${AUTH_URL}/api/desktop-signin/{provider}` shim that initiates the upstream IdP round-trip
- [x] **AUTH-02**: Final OAuth redirect emits `${PROTOCOL}://?bearer_token=<token>` echoing the **exact** scheme received in the `callbackURL` query parameter (production / `openwhispr-dev` / `openwhispr-staging` / arbitrary override per `OPENWHISPR_PROTOCOL`)
- [x] **AUTH-03**: Issue opaque bearer tokens long-lived enough to survive desktop relaunches (≥30 days), with rotation via the `set-auth-token` response header on Better-Auth-style endpoints; new and old tokens overlap ≥5 minutes (covers `withSessionRefresh()` 60s grace window with margin)
- [x] **AUTH-04**: Email/password sign-in via Better Auth — first-class, works without any external IdP configured
- [x] **AUTH-05**: OIDC pluggable via Better Auth's OAuth-Provider plugin — operator configures any OIDC provider (Google Workspace / Azure AD / Okta / generic OIDC) via env/YAML
- [x] **AUTH-06**: `x-openwhispr-source: desktop` header is preserved/observable for feature flagging
- [x] **AUTH-07**: Open IdP scope — IdP is the gatekeeper; no server-side allowlist. Once signed in, the user is automatically a corporate user (no plan/tier distinctions in v1)

### Multi-tenancy & Data

- [x] **DATA-01**: PostgreSQL 17+ schema with row-level security; `app.tenant_id` GUC set via `SET LOCAL` inside every request transaction (PgBouncer transaction-mode safe)
- [x] **DATA-02**: Forward-only migrations via Drizzle; CI verifies forward apply + rollback on real Postgres on every change to `migrations/`
- [ ] **DATA-03**: Usage ledger (transcribe minutes, reason tokens, streaming minutes); idempotent on `request_id`; **observability only — no enforcement** in v1
- [x] **DATA-04**: Audit log for auth events, account deletion, key issuance, provider config changes, admin actions
- [x] **DATA-05**: At-rest encryption for sensitive columns (bearer tokens, LiteLLM virtual keys, third-party API keys) via KEK/DEK pattern; KEK supplied via env / Vault / KMS adapter
- [x] **DATA-06**: Tenants table with explicit "default" tenant created on first migration (single-org installs share the data model)
- [x] **DATA-07**: Backup-and-restore tooling — `make backup` produces an encrypted dump; `make restore` is one-command; both run in CI

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
- [x] **PROVIDER-02**: Storage provider interface: S3-compatible default (MinIO bundled in compose; any S3 / GCS / Azure Blob via env)
- [x] **PROVIDER-03**: Identity provider interface: Better Auth's OAuth-Provider plugin handles OIDC; email+password is built-in; SAML deferred to v2
- [x] **PROVIDER-04**: Email provider interface: SMTP only in v1 (verification + admin notifications)

### Enterprise Scale (1000 concurrent active users)

- [x] **SCALE-01**: API tier is fully stateless; sessions stored in Postgres; cache state in Redis/Valkey; horizontal scaling validated
- [x] **SCALE-02**: PgBouncer transaction-mode in front of Postgres; sized for 1000 concurrent (server-pool 100 × 4 instances)
- [x] **SCALE-03**: BullMQ on Redis/Valkey for background jobs (audit-log fanout, email delivery, usage rollups, virtual-key rotation)
- [x] **SCALE-04**: Anti-abuse rate limiting per-user, per-IP via Redis/Valkey token-bucket (NOT quota — observability ledger has no limits in v1); polling carve-out for `/api/auth/verification-status`
- [ ] **SCALE-05**: Streaming endpoints (NDJSON, WSS) survive ingress timeouts up to 1h; nginx `proxy_buffering off` + `X-Accel-Buffering: no` set; per-line `res.flush()` in NDJSON
- [x] **SCALE-06**: Load test (k6) demonstrates 1000 concurrent active users (mixed transcribe + reason + stream + WSS) at p95 latency SLO; runs nightly in CI against an ephemeral environment
- [x] **SCALE-07**: File-descriptor limits raised to 65535 on API + ingress containers; documented sizing matrix per topology

### Observability

- [x] **OBS-01**: OpenTelemetry SDK auto-instrumentation for Fastify, undici, pg, ioredis; spans cover API → LiteLLM end-to-end with correlation IDs
- [x] **OBS-02**: Prometheus metrics exposed via OTel Collector; default Grafana dashboards shipped for RED + saturation, per-tenant usage, LiteLLM spend
- [x] **OBS-03**: Structured JSON logging to Loki via OTel Collector; bearer tokens scrubbed; correlation IDs propagated; English-only log keys
- [x] **OBS-04**: LiteLLM spend logs piped into the platform usage ledger; reconciled against per-request ledger entries; discrepancy alerts
- [x] **OBS-05**: Liveness, readiness, and startup probes — readiness fails when Postgres / Redis / LiteLLM unhealthy

### Frontend (UI-SPEC only — implementation deferred to v2)

- [ ] **UI-SPEC-01**: `UI-SPEC.md` for **Operator/Admin Console**: tenants list, tenant detail (members, IdP config, LiteLLM endpoint config, observed usage), users list, virtual-key management, audit log, observability deep-links
- [ ] **UI-SPEC-02**: `UI-SPEC.md` for **End-User Self-Service**: profile, observed usage breakdown, account deletion (mirroring desktop-client surface)
- [ ] **UI-SPEC-03**: UI-SPEC targets Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 + TanStack Query 5; follows accessibility (WCAG 2.2 AA), responsive (mobile + tablet + desktop), light + dark theme; component inventory enumerated; design tokens documented

### Frontend Implementation (Phase 07.1)

- [x] **WEB-IMPL-01**: `apps/web/` exists as Next.js 15 App Router + React 19 + TypeScript strict + Tailwind 4 + shadcn/ui v2 project; `pnpm --filter web build` exits 0; bundle ≤200KB gzipped per route enforced by `size-limit` CI gate
- [x] **WEB-IMPL-02**: Every screen from `UI-SPEC-admin.md` (A2, A3) and `UI-SPEC-end-user.md` (U1–U13) is implemented at the exact route paths the spec names; all 4 UI states (loading/empty/error/success) rendered per UI-SPEC; copy keys consumed from `apps/web/src/locales/en/{admin,end-user,common}.json`
- [x] **WEB-IMPL-03**: Same-origin deploy: docker-compose service `web` (Next.js production server), Traefik routes `/` → web and `/api/*` → api; `/admin/*` gated by Traefik basic-auth middleware reading `ADMIN_BASIC_AUTH_USERS` env; CSP/HSTS/X-Frame-Options=DENY headers in `next.config.ts`
- [x] **WEB-IMPL-04**: Playwright e2e covers each of 15 screens × 4 UI states + 1 axe-core WCAG 2.2 AA scan per screen (≈75 tests) against real docker-compose stack (api + Postgres + Valkey + Better Auth); CI green; coverage ≥90/90/90/90 on diff

### Deployment

- [ ] **DEPLOY-01**: `docker-compose.yml` for single-host self-host: API + Postgres 17 + PgBouncer + Redis/Valkey + bundled LiteLLM v1.83.7+ + bundled open-source AI models (Whisper / pyannote / faster-whisper) + MinIO + Traefik + OTel Collector + Grafana + Loki + Tempo + Mimir; compose profile to disable bundled LiteLLM when overriding to corporate
- [ ] **DEPLOY-02**: Helm chart for Kubernetes: HA Postgres via CloudNativePG 1.29, Traefik 3 ingress (NOT ingress-nginx — retired Mar 2026), HPA, cert-manager hooks, OTel-Collector DaemonSet, GPU node-selector for bundled AI workers (with disable-bundled option for corporate-LiteLLM topology)
- [ ] **DEPLOY-03**: One-command bootstrap (`make up` or `helm install`); one-command upgrade with safe rollback; refuse to start on default secrets
- [ ] **DEPLOY-04**: Migrations run as a pre-deploy job; safe under rolling deploy; backwards-compatible across one minor version
- [ ] **DEPLOY-05**: First-launch SLO — operator goes from `git clone` to first authenticated `/api/transcribe` against the bundled LiteLLM in **< 5 minutes**; CI test enforces this

### Engineering Discipline (constitutional)

- [x] **TDD-01**: Strict TDD — tests precede production code on every feature, every bugfix; PR template enforces a "tests first" checklist
- [x] **TDD-02**: Test layers: unit + integration (real Postgres / Redis via testcontainers; LiteLLM mocked at HTTP level via msw or Wiremock — we do not run real LiteLLM in CI) + e2e + contract + load + security + migration + i18n + RLS-property
- [x] **CI-01**: GitHub Actions CI from day one; workflows in `.github/workflows/`; GitHub-hosted runners
- [x] **CI-02**: CI matrix on every PR: lint + typecheck + unit + integration + e2e + contract + license-scan + secrets-scan (gitleaks) + dep-scan (Trivy + Dependabot) + SAST (CodeQL) + container-scan
- [ ] **CI-03**: Branch protection on `main` blocks merge unless required checks are green
- [x] **CONTRACT-01**: Wire-contract conformance test suite asserts the server matches `BACKEND_SPEC.md` byte-for-byte (status codes, JSON shapes, headers, NDJSON line behavior, channel-scheme echo, `set-auth-token` rotation); runs against any deployed instance via `make contract-test BACKEND_URL=...`
- [x] **TEST-COV-01**: Coverage gate ≥ 85% lines / ≥ 80% branches on the API tier (excluding generated code); enforced in CI
- [x] **TEST-MUTATION-01**: Mutation testing (Stryker) on critical modules: auth, multi-tenancy enforcement, virtual-key minting; PR fails on score regression
- [x] **TEST-LOAD-01**: k6 nightly load test asserts 1000 concurrent at p95 SLO; CI fails on regression
  - **Phase 8 deviation (2026-05-13, D-EXEC-1):** Nightly cadence + CI auto-regression-gate deferred. Phase 8 delivers manual on-demand `make load-test PROFILE={mock,realistic}` + published baseline SLO budgets (Run 5, commit `a5e5920`) + operator runbook in `docs/operations.md`. Nightly automation re-opens in a post-v1 phase. See `.planning/phases/08-load-test-tuning-slo-publication/08-SUMMARY.md` and `docs/operations.md#cadence-and-deferrals`.
- [x] **TEST-MIGRATION-01**: Migration tests verify forward apply + rollback on real Postgres in CI on every `migrations/` change
- [ ] **TEST-I18N-01**: i18n completeness test fails CI when a key exists in `en` but is missing in `ru` (or vice versa)
- [x] **TEST-RLS-01**: RLS property tests assert no cross-tenant read or write paths exist; random tenant pairs, every queryable model
- [x] **DEVEX-01**: One-command local dev (`make dev`) brings up the full stack with seeded data; `make test` runs the full suite; tested in CI

### Internationalization

- [ ] **I18N-01**: Runtime user/operator-facing strings (UI copy, email templates, notification text, end-user error messages) use i18next + i18next-icu; **minimum locales: `en` (default), `ru`**; CLDR pluralization (Russian one/few/many handled correctly); `Accept-Language` negotiation for API responses
- [ ] **I18N-02**: Locale resources operator-overridable via mounted volume / config map without forking

### OSS / Documentation

- [x] **DOCS-01**: `README.md` with quickstart (compose path) — under 5 minutes to first authenticated `/api/transcribe`
- [x] **DOCS-02**: `docs/architecture.md` — component decomposition, request lifecycle for the three hot paths, mermaid diagrams
- [x] **DOCS-03**: `docs/operations.md` — deploy, upgrade, scale, backup, restore, troubleshoot
- [x] **DOCS-04**: `docs/litellm-target-spec.md` — bundled-default LiteLLM config + corporate-override LiteLLM config (derived from `speaches-audio.md`)
- [x] **DOCS-05**: `docs/wire-contract.md` — references upstream `BACKEND_SPEC.md` + `OAUTH_SPEC.md`; documents which endpoints are deferred to v2 (Stripe / referrals)
- [x] **DOCS-06**: `docs/auth.md` — how to plug in OIDC providers; how to configure email+password; channel-scheme handling
- [ ] **DOCS-07**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, OSS LICENSE (Apache-2.0 default), license headers
- [ ] **DOCS-08**: ADRs for every Key Decision in this document
- [x] **DOCS-09**: All source artifacts (docs, code, comments, commit messages, identifiers, log keys) in **English only** — hard rule, enforced by lint where mechanical, by review otherwise

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
| WIRE-01 | Phase 2 | Complete |
| WIRE-02 | Phase 2 | Complete |
| WIRE-03 | Phase 2 | Complete |
| WIRE-04 | Phase 2 | Complete |
| WIRE-05 | Phase 3 | Pending |
| WIRE-06 | Phase 3 | Pending |
| WIRE-07 | Phase 4 | Pending |
| WIRE-08 | Phase 5 | Complete |
| WIRE-09 | Phase 5 | Complete |
| WIRE-10 | Phase 5 | Complete |
| WIRE-11 | Phase 5 | Complete |
| WIRE-12 | Phase 5 | Complete |
| WIRE-13 | Phase 4 | Pending |
| WIRE-14 | Phase 4 | Pending |
| WIRE-15 | Phase 4 | Pending |
| WIRE-16 | Phase 5 | Complete |
| WIRE-17 | Phase 2 | Complete |
| WIRE-18 | Phase 2 | Complete |
| WIRE-19 | Phase 2 | Complete |
| WIRE-20 | Phase 2 | Complete |
| WIRE-22 | Phase 5 | Complete |
| WIRE-23 | Phase 5 | Complete |
| WIRE-24 | Phase 5 | Complete |
| WIRE-25 | Phase 5 | Complete |
| WIRE-26 | Phase 5 | Complete |
| WIRE-27 | Phase 5 | Complete |
| WIRE-28 | Phase 5 | Complete |
| WIRE-29 | Phase 5 | Complete |
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| AUTH-05 | Phase 2 | Complete |
| AUTH-06 | Phase 2 | Complete |
| AUTH-07 | Phase 2 | Complete |
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 3 | Pending |
| DATA-04 | Phase 6 | Complete |
| DATA-05 | Phase 1 | Complete |
| DATA-06 | Phase 1 | Complete |
| DATA-07 | Phase 1 | Complete |
| LITELLM-01 | Phase 3 | Pending |
| LITELLM-02 | Phase 3 | Pending |
| LITELLM-03 | Phase 3 | Pending |
| LITELLM-04 | Phase 3 | Pending |
| LITELLM-05 | Phase 3 | Pending |
| LITELLM-06 | Phase 3 | Pending |
| LITELLM-07 | Phase 3 | Pending |
| PROVIDER-01 | Phase 3 | Pending |
| PROVIDER-02 | Phase 1 | Complete |
| PROVIDER-03 | Phase 2 | Complete |
| PROVIDER-04 | Phase 2 | Complete |
| SCALE-01 | Phase 6 | Complete |
| SCALE-02 | Phase 8 | Complete |
| SCALE-03 | Phase 6 | Complete |
| SCALE-04 | Phase 6 | Complete |
| SCALE-05 | Phase 4 | Pending |
| SCALE-06 | Phase 8 | Complete |
| SCALE-07 | Phase 8 | Complete |
| OBS-01 | Phase 6 | Complete |
| OBS-02 | Phase 6 | Complete |
| OBS-03 | Phase 6 | Complete |
| OBS-04 | Phase 6 | Complete |
| OBS-05 | Phase 6 | Complete |
| UI-SPEC-01 | Phase 7 | Complete |
| UI-SPEC-02 | Phase 7 | Complete |
| UI-SPEC-03 | Phase 7 | Complete |
| WEB-IMPL-01 | Phase 07.1 | Complete |
| WEB-IMPL-02 | Phase 07.1 | Complete |
| WEB-IMPL-03 | Phase 07.1 | Complete |
| WEB-IMPL-04 | Phase 07.1 | Complete |
| DEPLOY-01 | Phase 9 | Pending |
| DEPLOY-02 | Phase 9 | Pending |
| DEPLOY-03 | Phase 9 | Pending |
| DEPLOY-04 | Phase 9 | Pending |
| DEPLOY-05 | Phase 9 | Pending |
| TDD-01 | Phase 0 | Complete |
| TDD-02 | Phase 0 | Complete |
| CI-01 | Phase 0 | Complete |
| CI-02 | Phase 0 | Complete |
| CI-03 | Phase 0 | Pending |
| CONTRACT-01 | Phase 2 | Complete |
| TEST-COV-01 | Phase 0 | Complete |
| TEST-MUTATION-01 | Phase 0 | Complete |
| TEST-LOAD-01 | Phase 8 | Complete |
| TEST-MIGRATION-01 | Phase 1 | Complete |
| TEST-I18N-01 | Phase 10 | Pending |
| TEST-RLS-01 | Phase 1 | Complete |
| DEVEX-01 | Phase 0 | Complete |
| I18N-01 | Phase 10 | Pending |
| I18N-02 | Phase 10 | Pending |
| DOCS-01 | Phase 10 | Complete |
| DOCS-02 | Phase 10 | Complete |
| DOCS-03 | Phase 10 | Complete |
| DOCS-04 | Phase 10 | Complete |
| DOCS-05 | Phase 10 | Complete |
| DOCS-06 | Phase 10 | Complete |
| DOCS-07 | Phase 10 | Pending |
| DOCS-08 | Phase 10 | Pending |
| DOCS-09 | Phase 0 | Complete |

**Coverage:**
- v1 requirements: 101 total (89 baseline + 8 added 2026-05-11 for Phase 5 CRUD scope-expansion: WIRE-22..29 + 4 added 2026-05-12 for Phase 07.1 web implementation: WEB-IMPL-01..04)
- Mapped to phases: 101 ✓
- Unmapped: 0
- Phase distribution: 0=9, 1=8, 2=18, 3=11, 4=5, 5=14, 6=9, 7=3, 07.1=4, 8=4, 9=5, 10=11

## Phase-Level Plan Traceability

### Phase 1 — Core Infra & Multi-Tenant Data (planned 2026-05-09)

| Requirement | Plan(s) | Primary Artifacts |
|-------------|---------|-------------------|
| DATA-01 | 01-03, 01-04, 01-05 | `packages/data/migrations/0000_initial.sql` (FORCE RLS), `packages/data/src/tenant-context.ts` (set_config), `packages/data/src/__tests__/rls-property.test.ts` (100 pairs through PgBouncer) |
| DATA-02 | 01-03, 01-05 | drizzle-kit migrations + `.github/workflows/ci.yml` test-migration job (forward+drop+forward+rollback) |
| DATA-05 | 01-02, 01-04 | `tools/bootstrap.sh` MASTER_KEK gen, `apps/api/scripts/check-default-secrets.ts`, `packages/data/src/encryption/{envelope,env-key-provider,vault-key-provider,kms-key-provider}.ts` |
| DATA-06 | 01-01, 01-02, 01-03 | `docker-compose.yml` postgres service, `tools/bootstrap.sh` POSTGRES_*_PASSWORD gen, `0000_initial.sql` default tenant seed (UUID `00000000-...`) |
| DATA-07 | 01-06 | `scripts/backup/{make-backup,make-restore}.sh`, `keys/backup.age.pub`, `.github/workflows/nightly.yml` backup-roundtrip job |
| TEST-MIGRATION-01 | 01-03, 01-05 | `packages/data/src/__tests__/migration-rollback.test.ts`, ci.yml `test-migration` job with pg_dump --schema-only diff |
| TEST-RLS-01 | 01-05 | `tools/lint-rls.ts` + self-test, `packages/data/src/__tests__/rls-property.test.ts` (fast-check 4.7.0 + edoburu/pgbouncer:1.23.1 sidecar) |
| PROVIDER-02 | 01-01, 01-04, 01-06 | MinIO bundled in compose; `packages/data/src/encryption/key-provider.ts` (env / Vault stub / KMS stub); `docs/storage.md` bucket-prefix convention |

Wave structure:
- Wave 1 (parallel): Plan 01 (compose stack) ⊥ Plan 02 (bootstrap + entrypoint check)
- Wave 2 (parallel after Wave 1): Plan 03 (Drizzle + first migration + roles) ⊥ Plan 04 (tenant-context + KEK/DEK envelope)
- Wave 3 (parallel after Wave 2): Plan 05 (RLS lint + property tests + GHA jobs) ⊥ Plan 06 (backup/restore + nightly + docs)



### Phase 2 — Auth + Wire-API Skeleton + Conformance Harness (planned 2026-05-09)

| Requirement | Plan(s) | Primary Artifacts |
|-------------|---------|-------------------|
| WIRE-01 | 02-03, 02-06 | `apps/api/src/routes/check-user.ts`, `packages/contract-tests/src/check-user.test.ts` |
| WIRE-02 | 02-03, 02-04, 02-06 | `apps/api/src/routes/verification-status.ts` (cookie-only via `require-cookie-only.ts`), `@fastify/rate-limit` 30/min/(ip,email) keyGenerator (Plan 04), `packages/contract-tests/src/verification-status.test.ts` |
| WIRE-03 | 02-03, 02-06 | `apps/api/src/routes/delete-account.ts` (cookie-only, cascading delete + audit log + clearCookie), `packages/contract-tests/src/delete-account.test.ts` |
| WIRE-04 | 02-03, 02-06 | `apps/api/src/routes/health.ts` (rateLimit:false), `packages/contract-tests/src/health.test.ts` |
| WIRE-17 | 02-03, 02-06 | `apps/api/src/error-handler.ts` centralized `setErrorHandler`, `packages/contract-tests/src/conventions.test.ts` ErrorEnvelope.parse |
| WIRE-18 | 02-03, 02-06 | `apps/api/src/middleware/dual-auth.ts` throws AuthError → 401 (never 200-with-error), `conventions.test.ts` 401-not-200 matrix |
| WIRE-19 | 02-03, 02-04 | `apps/api/src/plugins/request-log.ts` (x-openwhispr-source pino child field), `apps/api/src/__tests__/openwhispr-source-log.test.ts` |
| WIRE-20 | 02-04 | Traefik `compose/traefik/static.yml` http→websecure 308 redirect, `tests/self-tests/traefik-https-only.test.ts` |
| AUTH-01 | 02-01, 02-03 | `apps/api/src/auth.ts` Better Auth instance (emailAndPassword.enabled), Plan 03 routes use it |
| AUTH-02 | 02-01, 02-05, 02-06 | `apps/api/src/lib/scheme-allowlist.ts` (allow-list + reject + buildProtocolRedirect), `apps/api/src/routes/desktop-signin.ts`, `apps/api/src/routes/auth-callback.ts`, `packages/contract-tests/src/oauth-redirect.test.ts` (4-scheme matrix + reject) |
| AUTH-03 | 02-01, 02-03, 02-05 | Better Auth opaque bearer ≥30-day TTL (`auth.ts` session.expiresIn), dual-auth hook, `apps/api/src/lib/token-rotation.ts` (overlap helpers) |
| AUTH-04 | 02-01, 02-05, 02-06 | `packages/data/migrations/0001_better_auth.sql` (previous_token_hash + previous_token_expires_at + lookup_session_by_previous_token SECURITY DEFINER fn), `apps/api/src/__tests__/token-rotation-overlap.test.ts` (100 concurrent), `packages/contract-tests/src/token-rotation.test.ts` |
| AUTH-05 | 02-01 | `apps/api/src/auth.ts` genericOAuth conditional registration (silent-disable on missing OIDC_* env per D-02) |
| AUTH-06 | 02-03, 02-04 | `apps/api/src/plugins/request-log.ts`, `apps/api/src/__tests__/openwhispr-source-log.test.ts` |
| AUTH-07 | 02-01, 02-05, 02-06 | `apps/api/src/lib/cookie-domain.ts` (eTLD+1 logic), wired into `auth.ts` advanced.crossSubDomainCookies, `packages/contract-tests/src/cookie-host.test.ts` |
| PROVIDER-03 | 02-01, 02-07 | OIDC plug-in via Better Auth genericOAuth (Plan 01); `docs/auth.md`, `docs/oidc-operator-config.md` (Plan 07) |
| PROVIDER-04 | 02-02, 02-04 | `docker-compose.yml` mailpit dev profile, `apps/api/src/email.ts` nodemailer + dev fallback, `apps/api/src/__tests__/email-mailpit.test.ts` |
| CONTRACT-01 | 02-03, 02-06 | `packages/contract-tests/src/schemas.ts` zod source of truth (Plan 03), 8 test files (Plan 06), `Makefile` `contract-test` target, `.github/workflows/ci.yml` `contract-test` job, `scripts/branch-protection.json` updated |

Wave structure:
- Wave 1 (parallel): Plan 02-01 (auth substrate + migrations) ⊥ Plan 02-02 (API container + compose)
- Wave 2 (parallel after Wave 1): Plan 02-03 (wire endpoints + envelope + dual auth) ⊥ Plan 02-04 (HTTPS + rate limit + email)
- Wave 3 (parallel after Wave 2): Plan 02-05 (OAuth shim + token rotation) ⊥ Plan 02-06 (CONTRACT-01 conformance suite)
- Wave 4 (final after Wave 3): Plan 02-07 (docs + state finalization + integration smoke)

---

### Phase 5 — Operational Endpoints + CRUD Resource Families (planned 2026-05-11)

| Requirement | Plan(s) | Primary Artifacts |
|-------------|---------|-------------------|
| WIRE-08 | 05-03 | apps/api/src/routes/agent/web-search.ts, apps/api/src/lib/web-search/{registry,tavily-adapter,yandex-adapter}.ts, packages/contract-tests/src/web-search.test.ts |
| WIRE-09 | 05-02 | apps/api/src/routes/streaming-usage.ts, packages/contract-tests/src/streaming-usage.test.ts |
| WIRE-10 | 05-02 | apps/api/src/routes/usage.ts, packages/contract-tests/src/usage.test.ts |
| WIRE-11 | 05-04 | apps/api/src/routes/stt-config.ts, apps/api/src/lib/settings-resolver.ts |
| WIRE-12 | 05-04 | apps/api/src/routes/note-recording-config.ts, apps/api/src/lib/settings-resolver.ts |
| WIRE-16 | 05-10 | packages/contract-tests/src/negative-matrix.test.ts, packages/contract-tests/src/negative-matrix.ts (TolerantEnvelope z.union per D-33) |
| WIRE-22 | 05-05 | apps/api/src/routes/notes/*.ts, packages/contract-tests/src/notes.test.ts |
| WIRE-23 | 05-06 | apps/api/src/routes/folders/*.ts, packages/contract-tests/src/folders.test.ts |
| WIRE-24 | 05-07 | apps/api/src/routes/conversations/{create,update,delete,list,search}.ts |
| WIRE-25 | 05-07 | apps/api/src/routes/conversations/messages.ts |
| WIRE-26 | 05-08 | apps/api/src/routes/transcriptions/*.ts, packages/contract-tests/src/transcriptions.test.ts |
| WIRE-27 | 05-09 | apps/api/src/routes/v1/keys/*.ts, apps/api/src/lib/argon2-keys.ts |
| WIRE-28 | 05-01, 05-04 | packages/data/migrations/0006_tenant_settings.sql, apps/api/src/lib/settings-resolver.ts |
| WIRE-29 | 05-10 | packages/contract-tests/src/negative-matrix.test.ts, packages/contract-tests/src/__tests__/negative-matrix-enumeration.test.ts, tests/e2e/phase-05-negative-matrix.spec.ts, docs/conventions.md, docs/wire-contract.md |

Wave structure:
- Wave 1 (parallel): Plan 05-01 (settings + CRUD schemas migration) ⊥ Plan 05-02 (streaming-usage + usage ledger) ⊥ Plan 05-03 (web-search adapters) ⊥ Plan 05-04 (settings resolver + read endpoints)
- Wave 2 (parallel after Wave 1): Plan 05-05 (notes CRUD) ⊥ Plan 05-06 (folders CRUD) ⊥ Plan 05-07 (conversations + messages) ⊥ Plan 05-08 (transcriptions CRUD) ⊥ Plan 05-09 (api keys CRUD)
- Wave 3 (final after Wave 2): Plan 05-10 (CONTRACT-01 negative matrix + conventions docs + REQUIREMENTS.md traceability)

---

### Phase 07.1 — Web App Implementation (planned + executed 2026-05-12)

| Requirement | Plan(s) | Primary Artifacts |
|-------------|---------|-------------------|
| WEB-IMPL-01 | 01, 02, 04, 13 | `apps/web/` Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2; `apps/web/next.config.ts` (standalone); `apps/web/.size-limit.json`; bundle gate enforced — max 168.84 kB gz across 15 routes |
| WEB-IMPL-02 | 07, 08, 09, 10, 11, 12 | A2 + A3 + U1–U13 at exact UI-SPEC route paths; 4 UI states per screen; 241 copy keys in `apps/web/src/locales/en/{admin,end-user,common}.json` |
| WEB-IMPL-03 | 01, 03 | `docker-compose.yml` `web` service + Traefik labels (`/` → web, `/api/*` → api, `/admin/*` basic-auth); CSP/HSTS/X-Frame-Options DENY/Referrer-Policy/Permissions-Policy in `next.config.ts` |
| WEB-IMPL-04 | 04, 07–12, 13, 14 | `apps/web/playwright.config.ts` + `apps/web/tests/e2e/*.spec.ts`; 85/85 PASS (15 screens × 4 states + 15 axe + cross-screen smoke + auth flows); vitest 510 PASS; coverage 98.53/92.99/97.79/97.62 |

Wave structure:
- Wave 0 (sequential): 01 (scaffold) → 02 (shadcn) → 03 (compose+traefik) → 04 (vitest+playwright)
- Wave 1 (sequential after 0): 05 (Better Auth) → 06 (providers/i18n/RHF)
- Wave 2 (parallel after 1): 07 (auth slice U1/U2/U3, gating) ⊥ 12 (admin A2/A3)
- Wave 3 (parallel after 07): 08 (U4/U5) ⊥ 09 (U6/U7) ⊥ 10 (U8/U9/U10) ⊥ 11 (U11/U12/U13)
- Wave 4 (sequential): 13 (integration + size-limit + GHA + lefthook + cross-screen smoke)
- Wave 5 (sequential): 14 (finalize — full sweep + SUMMARY + STATE/ROADMAP/REQUIREMENTS)

---

*Requirements defined: 2026-05-08*
*Last updated: 2026-05-12 — Phase 07.1 WEB-IMPL-01..04 flipped to Complete; UI-SPEC-01..03 also flipped to Complete (Phase 7 closed); plan-level traceability added (Plans 07.1-01..07.1-14).*
