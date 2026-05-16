# Requirements: OpenWhispr Server

**Defined:** 2026-05-08
**Core Value:** A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.

## v1 Requirements

Requirements for the initial OSS release. Stripe / referrals / quota-enforcement are deferred to v2 — upstream `SELF_HOSTING.md` itself classifies them as "Operational / quota endpoints (recommended)" with stub-as-503 explicitly acceptable.

### Wire Compatibility — Auth Lifecycle (must implement)

Source of truth: `/Users/dev/openwhispr/docs/BACKEND_SPEC.md`, `OAUTH_SPEC.md`, `SELF_HOSTING.md` (1556 lines, byte-for-byte authoritative).

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

## Milestone v2 — Production Readiness Requirements

**Defined:** 2026-05-14 — symptom-driven from the v1→v2 stack-up walkthrough (TECH_DEBT.md). Every REQ-ID traces to a TD-XX entry or research finding. v1 stack is LOCKED; v2 adds NO new runtime deps to the server.

### E2E coverage + Customer Journey Map (Phase 13)

- [x] **E2E-01**: Cucumber+Playwright harness at `tests/e2e-cjm/` (separate from existing vitest `tests/e2e/`) booting the docker-compose stack; `make e2e-cjm` runs locally and in GHA `E2E_CJM=1` job
- [x] **E2E-02**: `docs/customer-journeys.md` (CJM) enumerates ~20 user journeys with `@cjm-N.M` Gherkin tags; every happy-path scenario has at least one negative-twin scenario (no journey ships happy-path-only)
- [ ] **E2E-03**: Auth journey coverage — signup happy path + 4 negative twins (already-registered dedup, password<8 per-field error, locale-scoped error copy, social-button gating)
- [ ] **E2E-04**: Verification journey via Mailpit HTTP API (`/api/v1/messages` polling), end-to-end signup → email → token → verified-state
- [x] **E2E-05**: Sign-in journey + 403 unverified path with resend-verification CTA (TD-13.c)
- [ ] **E2E-06**: Transcribe round-trip journey (multipart audio → `/api/transcribe` → response shape match)
- [ ] **E2E-07**: Admin landing journey — `/admin` reaches a real page (not 404), basicauth break-glass tested separately from app-level admin role
- [ ] **E2E-08**: Locale-switch journey covering the `/api/locale` routing split (TD-15.g symptom)
- [ ] **E2E-09**: Worker email-delivery path verified end-to-end — replaces `noopSender` at `apps/worker/src/index.ts:68-134` with real nodemailer; new `packages/email/` shared package
- [ ] **E2E-10**: testcontainers cleanup — `tools/global-vitest-teardown.ts` + SIGINT/SIGTERM hook + CI `docker container prune --filter label=org.testcontainers=true` in `always()`; closes `.planning/deferred-items.md` #1
- [ ] **E2E-11**: Weak-assertion ban — ESLint rule blocks `getAllByText(...).length.toBeGreaterThan(0)` and the family; one-shot sweep of `apps/web/src/components/screens/auth/__tests__/*.test.tsx` (TD-13.a/d)
- [ ] **E2E-12**: Readiness probes (not just liveness) before scenarios run; per-scenario tenant isolation; retry-on-flake banned (a flake IS a bug — see PITFALLS §5)

### Admin onboarding + UI-SPEC conformance (Phase 12)

- [x] **ADMIN-01**: `/setup` route at `apps/web/src/app/(public)/setup/page.tsx` gated by `setup_state` enum state machine (NOT users-count) with explicit states: `pending`, `completed`, `skipped_legacy`
- [x] **ADMIN-02**: Single-page wizard fields (email, password, display name, workspace name, timezone); RHF7+Zod3+shadcn Stepper composition; idempotent `POST /api/setup/admin`
- [x] **ADMIN-03**: `ALTER TABLE users ADD COLUMN role text` migration + Better Auth `additionalFields.role` extension; backfill existing v1 installs to `setup_state.status='skipped_legacy'`
- [x] **ADMIN-04**: `/admin` Next.js index page (closes TD-12.a 404); admin breadcrumb / nav surface drives to `config` and future subpages
- [x] **ADMIN-05**: Basicauth-htpasswd remains as documented break-glass recovery path with secret rotation documented in `docs/operations.md`; Bcrypt-`$$` escape trap removed by wizard (TD-12.f)
- [x] **ADMIN-06**: Wizard onboarding e2e test in Phase 13 harness — green Gherkin journey before merge
- [x] **UICONF-01**: `GET /api/capabilities` (or `/api/auth/providers`) endpoint returns the configured OIDC providers + email-verification status; closes UI/BE capability drift (TD-12.c)
- [x] **UICONF-02**: Auth screens (`SignInForm`, `SignUpForm`, `OidcButtons`, `VerifyEmailClient`) conditionally render against `/api/capabilities` — zero buttons for zero providers
- [x] **UICONF-03**: Per-field Zod error mapping (TD-13.b) — every form field surfaces its own error message, localized en+ru, no bare "Invalid input"
- [x] **UICONF-04**: Semantic Playwright DOM conformance suite vs `.planning/phases/07-frontend-ui-spec/design/design-canvas.jsx` + `UI-SPEC-end-user.md` + `UI-SPEC-admin.md` — NOT pixel-diff; lives in `tests/conformance/ui-spec/`
- [x] **UICONF-05**: Axe a11y baseline + per-screen delta gate; auth screens MUST pass with zero violations
- [x] **UICONF-06**: SignUpForm duplicate-banner regression fixed; conformance test asserts exactly one banner element (TD-13.a)
- [x] **UICONF-07**: Resend-verification CTA on sign-in 403 screen (TD-12.e)

### Slim core + BYOK profiles (Phase 14)

- [x] **SLIM-01**: Slim default = 6 services (api+web+worker+postgres+valkey+litellm); bare `docker compose up` (no flag) selects all slim-core services (TD-14.f / deferred-items #3a fix)
- [x] **SLIM-02**: Opt-in compose overlay files: `compose/docker-compose.observability.yml`, `.storage.yml`, `.ingress.yml`, `.pgbouncer.yml`, `.dev-tools.yml` (mailpit only here, TD-14.a)
- [x] **SLIM-03**: `.env.slim.example` with ~5 keys (DATABASE_URL, BETTER_AUTH_SECRET, LITELLM_MASTER_KEY, plus storage / ingress when enabled)
- [x] **SLIM-04**: BYOK env-var contracts documented in `docs/operations.md` — `S3_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `INGRESS_BASE_URL`, `SMTP_HOST`
- [x] **BYOK-01**: Helm `*.enabled` toggles 1:1 with compose overlays — `observability.enabled`, `storage.enabled`, `pooler.enabled`, `tls.enabled`, `mailpit.enabled` (already present in `charts/openwhispr/values.yaml` — audited)
- [x] **BYOK-02**: Loud-fail BYOK — api refuses to start if any required BYOK service is unconfigured (e.g., `--with-storage` off AND `S3_ENDPOINT` unset)
- [x] **BYOK-03**: Worker `noopX` audit at `apps/worker/src/index.ts:68-92` — sweep ALL three (`noopSender` + `noopLitellmKeyClient` + `noopUserKeyLookup`); replace with real adapters or loud-fail (TD-mailpit + TD-14.c symptoms)

### Repo structure refactor (Phase 15)

- [ ] **STRUCT-01**: Test-layout convention codified (`apps/<app>/tests/{unit,integration}/` full split; `tests/e2e-cjm/` at root) + `Phase15-MOVE-INVENTORY.md` deliverable BEFORE any move PR
- [ ] **STRUCT-02**: `compose/` directory holds every compose YAML; root no longer carries operator-facing compose files (TD-15.c)
- [x] **STRUCT-03**: Helm stays in monorepo unless `/gsd-discuss-phase 15` decides otherwise (open question; TD-15.d)
- [ ] **STRUCT-04**: Traefik host split — `web.localhost` for Next.js app, `api.localhost` for Fastify; closes the `/api/locale` 404 shadowing (TD-15.g)
- [ ] **STRUCT-05**: Better Auth `trustedOrigins` updated to match new host split; Playwright baseURL in Phase 13 harness uses the new hosts
- [ ] **STRUCT-06**: `apps/web/public/.gitkeep` committed (closes deferred-items #2)
- [ ] **STRUCT-07**: Route-group naming audit — `(admin)`, `(public)`, `(authed)` etc. — convention documented in `docs/conventions.md` or eliminated (TD-15.b)
- [x] **FSL-01**: Apache 2.0 → FSL-1.1-ALv2 — root `LICENSE` replaced; `MIGRATING.md` + 7-day notice; pre-scrub tag created
- [x] **FSL-02**: SPDX header sweep via `reuse` codemod — every `.ts/.tsx/.js/.sh/.py/.sql/.yaml/.yml` file; `REUSE.toml` + `reuse lint` CI gate
- [x] **FSL-03**: Every workspace `package.json` `license` field updated; Docker `LABEL org.opencontainers.image.licenses` updated; README badges updated
- [x] **FSL-04**: CONTRIBUTING.md DCO `Signed-off-by:` requirement; retroactive consent thread with existing v1 contributors
- [x] **FSL-05**: ADR `docs/adrs/0013-fsl-relicense.md` documenting Apache→FSL transition reasoning
- [ ] **FSL-06**: `git filter-repo --path speaches-audio.md --invert-paths` history scrub; bundled WITH FSL relicense as ONE release event (PITFALLS §10 — two force-pushes amortise badly)
- [ ] **FSL-07**: Branch-protection lock → scrub → unlock → push → re-lock runbook; CI cache invalidation documented

### Phase-tag comment audit (Phase 16)

- [ ] **COMMENT-01**: regex-on-text codemod (NOT AST traversal; ts-morph dep reserved for deferred inline-comment phase) audits approximately 754 `// Phase XX / Plan YY / D-ZZ` header comments in `apps/` + `packages/` (NOT tests/tools/.planning); per-area sweep canary (smallest area first) before bulk run
- [ ] **COMMENT-02**: Two-bucket classification REMOVE (re-states phase number) / KEEP (explains non-obvious WHY); heuristic-only with conservative-KEEP defaults; CLAUDE.md policy ratified
- [ ] **COMMENT-03**: lint regression rule (tsx CLI per Phase 15-01 pivot) prevents re-introduction of phase-tag comments in future code
- [ ] **COMMENT-04**: Sweep delivered as per-area atomic commits (each area < ~300 files for comment-only deletions per Phase 15-03 precedent; never 754 atomic commits)

### Trusted local TLS + production ACME (Phase 17)

- [ ] **TLS-01**: `make tls-trust` Makefile target wraps `mkcert -install` + cert generation for the canonical 10-host explicit list (`localhost`, `api.localhost`, `web.localhost`, `app.localhost`, `auth.localhost`, `grafana.localhost`, `minio-console.localhost`, `mailpit.localhost`, `api.example.test`, `auth.example.test`, plus IPs `127.0.0.1` + `::1`) — NOT `*.localhost` wildcard. Host list must match `tools/bootstrap.sh:362-371` byte-for-byte so the mkcert and openssl paths produce SAN-equivalent certs (WR-02 review fix, 2026-05-15).
- [ ] **TLS-02**: Traefik dev profile (`compose/traefik/dynamic.dev.yml`) serves mkcert certs from `compose/traefik/certs/`; production profile (`dynamic.prod.yml`) uses ACME
- [ ] **TLS-03**: `--with-ingress` compose profile auto-wires Let's Encrypt ACME; cert-manager Helm sub-chart (`cert-manager 1.16+`) gated by `ingress.enabled` on K8s
- [ ] **TLS-04**: README quickstart includes `make tls-trust` step 2 (after `cp .env.example .env`); browser does not warn on first run
- [ ] **TLS-05**: Dev-cert isolation — `.dockerignore` excludes `**/rootCA*.pem`; production Dockerfile lint forbids mkcert paths
- [ ] **TLS-06**: Air-gap install path documented for operators without internet access to mkcert

### LDAP / Keycloak SSO (Phase 18 — SPEC + ADR only, NO code in v2)

- [ ] **SSO-01**: `.planning/phases/18-…/SPEC-ldap-keycloak.md` ≤ 200 lines: option (a) Keycloak/Authentik OIDC frontend vs option (b) direct LDAP via `ldapts`+plugin; decision matrix
- [ ] **SSO-02**: JIT user provisioning specification — Better Auth lifecycle hooks, role mapping, group→role projection
- [ ] **SSO-03**: Red Cucumber scenarios in `tests/e2e-cjm/features/sso/` (skipped pending v3 impl) + `compose/test/keycloak.yml` fixture stub
- [ ] **SSO-04**: ADR `docs/adrs/0012-ldap-via-keycloak.md` captures the option-(a)-vs-(b) decision and v3 implementation plan
- [ ] **SSO-05**: Operator-demand survey documented (option a vs option b) — PITFALLS §14 prerequisite

### Future / Out of Scope for v2

**Future (deferred to v3):**
- SSO option-(a)-or-(b) IMPLEMENTATION (Phase 18 only ships SPEC in v2)
- SAML 2.0 (COMPL-01 from v1 remains deferred)
- SCIM provisioning (COMPL-02 from v1 remains deferred)
- Per-tenant admin console
- Multi-region / blue-green deploy automation
- Stripe / billing endpoints

**Out of scope (v2 explicitly NOT building):**
- Full repo restructure beyond test-layout codification + `compose/` move (Nx migration, package-of-packages)
- Helm split to separate repo unless `/gsd-discuss-phase 15` decides (TD-15.d)
- Real CA root shipped in repo (CVE territory — anti-feature)
- Mobile viewport / cross-browser E2E matrix in v2
- Selenium / WebDriverIO / Cypress / Cucumber-as-runner (anti-shortlist)
- BSL / SSPL / AGPL license variants (FSL-1.1-ALv2 only)
- Kerberos / SPNEGO / Self-hosted IdP portal UI (Phase 18 anti)
- Auto-JSDoc / `// TODO` removal in Phase 16 (anti)

### Traceability — v2 (mapped 2026-05-14 by gsd-roadmapper)

Work-order: **13 → 12 → 14 → 15 → 16 → 17 → 18**. 61 REQ-IDs mapped to 7 phases, 100% coverage, no orphans.

| Requirement | Phase | Status | Notes |
|-------------|-------|--------|-------|
| E2E-01 | 13 | Complete (13-01) | Cucumber+Playwright harness at `tests/e2e-cjm/` + `make e2e-cjm` + GHA `E2E_CJM=1` |
| E2E-02 | 13 | Complete (13-02) | `docs/customer-journeys.md` + `@cjm-N.M` tags + negative twins |
| E2E-03 | 13 | Pending | Auth journey: signup happy + 4 negative twins |
| E2E-04 | 13 | Pending | Verification via Mailpit HTTP API |
| E2E-05 | 13 | Complete (13-02) | Sign-in + 403 unverified resend-CTA journey |
| E2E-06 | 13 | Pending | Transcribe round-trip journey |
| E2E-07 | 13 | Pending | `/admin` landing journey |
| E2E-08 | 13 | Pending | Locale-switch journey |
| E2E-09 | 13 | Pending | Worker `noopSender` → nodemailer; atomic with harness commit |
| E2E-10 | 13 | Pending | testcontainers teardown + CI prune in always() |
| E2E-11 | 13 | Pending | Weak-assertion ESLint ban + sweep |
| E2E-12 | 13 | Pending | Readiness probes + retry-on-flake ban |
| ADMIN-01 | 12 | Complete | `/setup` gated by `setup_state` enum (NOT users-count) |
| ADMIN-02 | 12 | Complete | Single-page wizard (RHF+Zod+shadcn Stepper); idempotent `POST /api/setup/admin` |
| ADMIN-03 | 12 | Complete | `users.role` migration + Better Auth `additionalFields.role` + `skipped_legacy` backfill |
| ADMIN-04 | 12 | Complete | `/admin` index page (closes TD-12.a 404) |
| ADMIN-05 | 12 | Complete | basicauth-htpasswd break-glass documented; bcrypt `$$` trap removed |
| ADMIN-06 | 12 | Complete | Wizard `@cjm-admin-onboarding` Gherkin GREEN in Phase 13 harness |
| UICONF-01 | 12 | Complete | `GET /api/capabilities` returns providers + verification status |
| UICONF-02 | 12 | Complete | Auth screens render conditionally vs `/api/capabilities` |
| UICONF-03 | 12 | Complete | Per-field Zod errors localized en+ru |
| UICONF-04 | 12 | Complete | Semantic Playwright DOM conformance vs `design-canvas.jsx` |
| UICONF-05 | 12 | Complete | Axe a11y baseline + per-screen delta gate |
| UICONF-06 | 12 | Complete | SignUpForm duplicate-banner regression fixed |
| UICONF-07 | 12 | Complete | Resend-verification CTA on sign-in 403 |
| SLIM-01 | 14 | Complete | Slim default = 6 services; bare `docker compose up` selects them |
| SLIM-02 | 14 | Complete | Opt-in compose overlays (observability/storage/ingress/pgbouncer/dev-tools) |
| SLIM-03 | 14 | Complete | `.env.slim.example` ~5 keys |
| SLIM-04 | 14 | Complete | BYOK env contracts documented in `docs/operations.md` |
| BYOK-01 | 14 | Complete | Helm `*.enabled` toggles 1:1 with compose overlays |
| BYOK-02 | 14 | Complete | Loud-fail BYOK — refuse to start on misconfigured prod env |
| BYOK-03 | 14 | Complete | Worker noop audit (all 3 adapters) at `apps/worker/src/index.ts:68-92` |
| STRUCT-01 | 15 | Pending | Test-layout codified + `Phase15-MOVE-INVENTORY.md` before move PR |
| STRUCT-02 | 15 | Pending | `compose/` directory holds every compose YAML |
| STRUCT-03 | 15 | Complete | Helm monorepo vs separate repo — **TBD via `/gsd-discuss-phase 15`** |
| STRUCT-04 | 15 | Pending | Traefik host split (`web.localhost` vs `api.localhost`) |
| STRUCT-05 | 15 | Pending | Better Auth `trustedOrigins` updated; Phase 13 Playwright baseURL updated |
| STRUCT-06 | 15 | Pending | `apps/web/public/.gitkeep` committed (closes deferred-items #2) |
| STRUCT-07 | 15 | Pending | Route-group naming audit + `docs/conventions.md` |
| FSL-01 | 15 | Complete | Apache-2.0 → FSL-1.1-ALv2 LICENSE replacement |
| FSL-02 | 15 | Complete | `reuse` codemod SPDX sweep + `REUSE.toml` + `reuse lint` CI |
| FSL-03 | 15 | Complete | Every workspace `package.json` + Docker LABEL + README badges |
| FSL-04 | 15 | Complete | CONTRIBUTING.md DCO `Signed-off-by:` + retroactive consent |
| FSL-05 | 15 | Complete | ADR `docs/adrs/0013-fsl-relicense.md` |
| FSL-06 | 15 | Pending | `git filter-repo` history scrub bundled WITH FSL as ONE release event |
| FSL-07 | 15 | Pending | Branch-protection lock → scrub → unlock runbook |
| COMMENT-01 | 16 | Pending | ts-morph AST codemod over 771 comments in `apps/`+`packages/` |
| COMMENT-02 | 16 | Pending | REMOVE/KEEP classification + CLAUDE.md policy ratified |
| COMMENT-03 | 16 | Pending | lint regression rule (tsx CLI) prevents re-introduction |
| COMMENT-04 | 16 | Pending | ONE squashed commit OR grouped ≤ 50 files |
| TLS-01 | 17 | Pending | `make tls-trust` + mkcert -install + explicit host list |
| TLS-02 | 17 | Pending | Traefik dev/prod dynamic.yml split |
| TLS-03 | 17 | Pending | `--with-ingress` auto-ACME + cert-manager Helm sub-chart |
| TLS-04 | 17 | Pending | README quickstart `make tls-trust` step 2 |
| TLS-05 | 17 | Pending | Dev-cert isolation (`.dockerignore` + prod Dockerfile lint) |
| TLS-06 | 17 | Pending | Air-gap install path documented |
| SSO-01 | 18 | Pending (SPEC only) | SPEC ≤ 200 lines; option (a) vs (b) — **TBD via `/gsd-discuss-phase 18`** |
| SSO-02 | 18 | Pending (SPEC only) | JIT user provisioning specification |
| SSO-03 | 18 | Pending (SPEC only) | Red Cucumber scenarios + `compose/test/keycloak.yml` fixture |
| SSO-04 | 18 | Pending (SPEC only) | ADR `docs/adrs/0012-ldap-via-keycloak.md` |
| SSO-05 | 18 | Pending (SPEC only) | Operator-demand survey documented |

**v2 coverage:** 61/61 mapped (100%), 0 orphans, 0 duplicates.
**v2 distribution:** Phase 12=13, Phase 13=12, Phase 14=7, Phase 15=14, Phase 16=4, Phase 17=6, Phase 18=5 → 61 total ✓

**Open questions deferred to `/gsd-discuss-phase`** (per research SUMMARY.md):
1. Phase 14 ↔ 15 order swap — user order (14 → 15) authoritative; ARCHITECTURE alternative (15 → 14) logged for discuss-phase review.
2. Phase 13 BDD vs plain Playwright — Cucumber+Playwright+playwright-bdd authoritative per E2E-01; may be revisited.
3. Phase 15 Helm monorepo vs separate repo — STRUCT-03 marked TBD.
4. Phase 18 option (a) Keycloak vs (b) direct LDAP — SSO-01 records decision matrix; final pick in ADR 0012.

### Traceability — v2.2 (mapped 2026-05-16 by gsd-roadmapper)

Work-order: **31 → 32 → 33 → 34 → 35 → 36 → 37 → 38 → 39 → 40 → 41**. 32 REQ-IDs mapped to 11 phases, 100% coverage, no orphans. Phase 31 (lockers) ships FIRST as the gate Phases 32–41 are tested against; Phase 33 depends on Phase 32 (RLS posture before encryption-at-rest migration touches the same Better Auth schemas).

| Requirement | Phase | Status | Notes |
|-------------|-------|--------|-------|
| LOCKER-01 | 31 | Pending | `tools/lint-no-env-branches.ts` + tests at ≥ 90/90/90/90 |
| LOCKER-02 | 31 | Pending | `tools/lint-no-suppressions.ts` + tests + seeded allowlist |
| LOCKER-03 | 31 | Complete | `tools/lint-no-hardcode.ts` + tests + allowlist for tests/.env.example/compose/docs/charts/tools — Phase 31 Plan 03 (commits d0309f0, cd49775) |
| LOCKER-04 | 31 | Pending | `tools/lint-prod-readiness.ts` — Fastify routes need zod+rateLimit; exports need non-test importer |
| LOCKER-05 | 31 | Pending | `tools/lint-secret-shape-in-error.ts` — refuses untruncated `bodyText`/`responseBody`/`upstreamPayload` on Error subclasses |
| LOCKER-06 | 31 | Pending | `tools/lint-shell-credential-interpolation.ts` — refuses `bash -c "...${*_URL\|KEY\|PASSWORD\|SECRET\|TOKEN}..."` |
| LOCKER-07 | 31 | Pending | `.planning/DISCIPLINE.md` Rules 11–14 + `CLAUDE.md` mirror, SAME commit as linter source |
| LOCKER-08 | 31 | Pending | Lefthook + `ci.yml` + `nightly.yml` wired; `make lint:lockers` shipped |
| LOCKER-09 | 31 | Pending | Per-locker allowlists seeded; CI fails on net additions; each entry has tracking-issue ID |
| CRIT-FIX-01 | 32 | Pending | Migration `0017_rls_fail_closed.sql` + 88-case property test on real Postgres testcontainer — Source: `data.md` CR-01 + HI-04 |
| CRIT-FIX-02 | 33 | Pending | Migration `0018_envelope_encrypt_secret_columns.sql` + Drizzle lens + `lint-no-plaintext-secret-columns` (Rule 15) + `docs/security.md` — Source: `data.md` CR-02 |
| CRIT-FIX-03 | 34 | Pending | `tenantPlugin` deleted OR replaced with `req.untrustedTenantHint` guard; E2E forged-header refusal — Source: `api-core.md` CR-01 |
| CRIT-FIX-04 | 35.a | Pending | `config: { auth: false }` on `/api/locale`, `/api/auth/providers`, `/api/setup-state` — Source: `api-routes-rest.md` CR-01 |
| CRIT-FIX-05 | 35.b | Pending | `headers.getSetCookie()` in `better-auth-handler.ts` — Source: `api-routes-rest.md` CR-02 |
| CRIT-FIX-06 | 35.c | Pending | `setup-admin` step-4 + state flip wrapped in single tx with rollback — Source: `api-routes-rest.md` CR-03 |
| CRIT-FIX-07 | 36.a | Pending | `audit-archive.ts` replaces `bash -c` with Node `spawn('pg_dump', ...)` + `PGPASSWORD` env — Source: `worker.md` CR-01 |
| CRIT-FIX-08 | 36.b | Pending | `reconciliation-discrepancy.ts` honest windowed backfill OR delete with rationale — Source: `worker.md` CR-02 |
| CRIT-FIX-09 | 37 | Pending | `LitellmUpstreamError.bodyText` truncated+private+`toJSON()` override — Source: `litellm-client.md` CR-01 |
| CRIT-FIX-10 | 38 | Pending | `packages/auth/` deleted OR renamed to `-stub` with `private: true` — Source: `small-pkgs.md` CR-01 |
| HIGH-FIX-WIRE-01 | 39 | Pending | `.strict()` on every input zod schema — Source: `wire-schemas.md` HI-1 |
| HIGH-FIX-WIRE-02 | 39 | Pending | Output schemas use `.uuid()`/`.datetime({offset:true})`/`.url()` — Source: `wire-schemas.md` HI-2 |
| HIGH-FIX-WIRE-03 | 39 | Pending | Long-text + metadata bounded by `.max()` — Source: `wire-schemas.md` HI-3, HI-4 |
| HIGH-FIX-WIRE-04 | 39 | Pending | Symmetrical enums + `.int().nonneg()` counts — Source: `wire-schemas.md` HI-5, HI-6 |
| HIGH-FIX-BYOK-01 | 40 | Pending | Wire schemas moved to `@openwhispr/wire-schemas`; `@openwhispr/contract-tests` `private: true` — Source: `byok-guard-contract-tests.md` HI-1 |
| HIGH-FIX-BYOK-02 | 40 | Pending | `redactUrl` query-string + SigV4 + bearer-in-path + drift-as-failure parity test — Source: `byok-guard-contract-tests.md` HI-2 |
| HIGH-FIX-BYOK-03 | 40 | Pending | `fetchAndParse` envelope enforcement on non-2xx — Source: `byok-guard-contract-tests.md` HI-3 |
| HIGH-FIX-API-CORE | 41.a | Pending | `resolveDefaultTenantId()` swap at `auth.ts:330,380` + delete `placeholder.ts` — Source: `api-core.md` HI-01..03 |
| HIGH-FIX-AGENT-STREAM | 41.b | Pending | `/api/agent/stream` model reconciliation + zod body + per-user rateLimit — Source: `api-routes-transcriptions.md` HI-01..03 |
| HIGH-FIX-WEB | 41.c | Pending | RSC role-check on `/admin/*` + remove `PLAYWRIGHT_DISABLE_SSR_PREFETCH` from prod — Source: `web.md` HI-1, HI-2 |
| HIGH-FIX-WORKER | 41.d | Pending | Shared redact factory + reconciliation-daily-check bound + fresh `driftStore` + `metadata.duration` validation — Source: `worker.md` HI-1..4 |
| HIGH-FIX-DATA | 41.e | Pending | LiteLLM-init idempotency + migration `0019` (TRUNCATE → UPSERT) + account-token TTL — Source: `data.md` HI-01..03 (HI-04 closed by Phase 32) |
| HIGH-FIX-LITELLM | 41.f | Pending | `headersTimeout`/`bodyTimeout`/required `AbortSignal` + SSRF dispatcher assert + model-alias single-source + `streamOptions` opt-out — Source: `litellm-client.md` HI-01..04 |
| HIGH-FIX-SMALL | 41.g | Pending | Real en/ru bundles OR i18n→stub + byok/redact parity test + `SMTP_SECURE` flexible parser — Source: `small-pkgs.md` HI-01..03 |

**v2.2 coverage:** 32/32 mapped (100%), 0 orphans, 0 duplicates.
**v2.2 distribution:** Phase 31=9, Phase 32=1, Phase 33=1, Phase 34=1, Phase 35=3 (a/b/c), Phase 36=2 (a/b), Phase 37=1, Phase 38=1, Phase 39=4, Phase 40=3, Phase 41=7 (a/b/c/d/e/f/g) = 33 line items across 32 REQ-IDs (Phase 41 has 7 sub-plans for 7 REQ-IDs; Phase 35/36 sub-letters group multiple REQ-IDs per phase) ✓.

**Milestone close criterion:** re-run the 11-agent `gsd-code-reviewer` pre-publication review against main; expect ≤ 5 residual HIGH and 0 CRITICAL. Anything else → milestone remains open and additional phases inserted.

---

## v2.2 Requirements — Pre-OSS Security & Hygiene

Driven entirely by `.planning/review/REVIEW-INDEX.md` (10 CRITICAL + 35 HIGH from 11-agent pre-publication review against main @ `1832f28`). Every requirement closes one or more numbered findings; the Source column cites the per-package report.

### Constitutional lockers (Phase 31 — ships FIRST)

- [ ] **LOCKER-01**: `tools/lint-no-env-branches.ts` — refuse any `process.env.NODE_ENV` / `NODE_ENV` comparison in `apps/**/src/**` and `packages/**/src/**`; allowlist limited to `bootstrap.ts`, `config/*.ts`, `otel-bootstrap.ts`, and explicit `*.config.ts`. Coverage ≥ 90/90/90/90 on the linter. Wired into Lefthook + GitHub Actions.
- [ ] **LOCKER-02**: `tools/lint-no-suppressions.ts` — refuse `as any`, `as unknown as`, `@ts-ignore`, `@ts-nocheck`; require `@ts-expect-error` to carry a reason comment + tracking-issue ID. Seed allowlist with current main inventory; CI fails on net additions. Coverage ≥ 90/90/90/90.
- [x] **LOCKER-03**: `tools/lint-no-hardcode.ts` — refuse hardcoded `localhost`, `127.0.0.1`, `:3000`/`:4000`/`:8080`, UUID literals, fake-token shapes (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`, `Bearer ey…`) outside `tests/`, `.env.*.example`, `compose/`, `docs/`, `charts/`, `tools/`. Coverage ≥ 90/90/90/90. — Phase 31 Plan 03 (d0309f0, cd49775).
- [ ] **LOCKER-04**: `tools/lint-prod-readiness.ts` — AST scan of `apps/**/src/**` + `packages/**/src/**`: (a) every Fastify `app.route/get/post/...` MUST have `schema: { body|querystring|params: <ZodSchema> }` AND `config: { rateLimit: ... }` (or explicit `rateLimit: false` only for `/api/health`); (b) every exported symbol MUST have ≥ 1 non-test importer. Coverage ≥ 90/90/90/90.
- [ ] **LOCKER-05**: `tools/lint-secret-shape-in-error.ts` — refuse `class X extends Error { public/readonly <bodyText|responseBody|upstreamPayload|response|body>: string }` unless constructor truncates the field. Coverage ≥ 90/90/90/90.
- [ ] **LOCKER-06**: `tools/lint-shell-credential-interpolation.ts` — refuse template-literal strings passed to `spawn('bash', ['-c', ...])` / `execSync` / `exec` referencing `*_URL`, `*_KEY`, `*_PASSWORD`, `*_SECRET`, `*_TOKEN` bindings or env vars. Coverage ≥ 90/90/90/90.
- [ ] **LOCKER-07**: `.planning/DISCIPLINE.md` Rules 11–14 amended in (NODE_ENV branches / suppressions / hardcode / prod-readiness) and mirrored to `CLAUDE.md` § Engineering Discipline in the SAME commit as the linter source.
- [ ] **LOCKER-08**: Lefthook pre-commit + GitHub Actions `ci.yml` + `nightly.yml` updated to invoke all six lockers BLOCKING; `make lint:lockers` target shipped.
- [ ] **LOCKER-09**: Per-locker allowlist files (`tools/lint-*-allowlist.txt`) seeded with current main inventory; CI MUST fail on any net addition. Each allowlist entry has a tracking-issue ID.

### Critical fixes (Phases 32–38)

- [ ] **CRIT-FIX-01** (Phase 32): Migration `0017_rls_fail_closed.sql` reverses 0003's `ALTER ROLE openwhispr_app SET app.tenant_id` + drops the GUC-bound `tenant_id` column DEFAULT. RLS policies use `current_setting(...) IS NOT NULL AND tenant_id = current_setting(...)::uuid`. Property test (88 = 11 tables × 4 ops × 2 ctx) on real Postgres testcontainer asserts ALWAYS deny when context absent. — Source: `data.md` CR-01, HI-04.
- [ ] **CRIT-FIX-02** (Phase 33): Migration `0018_envelope_encrypt_secret_columns.sql` converts `account.{access_token, refresh_token, id_token, password}`, `verification.value`, `sessions.{token, previous_token}`, `oauth_state.code_verifier` to envelope-encrypted `bytea` (AES-256-GCM, per-row DEK, `MASTER_KEK` env). Drizzle-level encryption lens wires `packages/data/src/encryption/envelope.ts` to all six column families. Sign-in / sign-out / password-reset integration tests round-trip end-to-end with ciphertext-on-disk assertion. KEK rotation property test green. `tools/lint-no-plaintext-secret-columns.ts` (becomes Rule 15) prevents future text-column drift. Operator docs in `docs/security.md`. — Source: `data.md` CR-02.
- [ ] **CRIT-FIX-03** (Phase 34): `apps/api/src/middleware/tenant.ts` + index.ts:382 registration deleted (preferred) OR renamed to `req.untrustedTenantHint` with a runtime guard that throws on `req.tenant ≠ req.untrustedTenantHint`. E2E `tests/e2e/tenant-isolation.spec.ts` asserts forged `x-tenant-id` cannot escalate. — Source: `api-core.md` CR-01.
- [ ] **CRIT-FIX-04** (Phase 35.a): `apps/api/src/routes/{locale,auth-providers,setup-state}.ts` add `config: { auth: false }`. Integration test boots full app and asserts 200 (not 401) for each. — Source: `api-routes-rest.md` CR-01.
- [ ] **CRIT-FIX-05** (Phase 35.b): `apps/api/src/lib/better-auth-handler.ts:179-182` replaces `Headers.forEach` with `Headers.getSetCookie()` per-value emission. Test asserts N independent `set-cookie` reply headers (not comma-joined). E2E sign-in flow green against real Better Auth + browser. — Source: `api-routes-rest.md` CR-02.
- [ ] **CRIT-FIX-06** (Phase 35.c): `apps/api/src/routes/setup-admin.ts:234` wraps step-4 role flip + `setup_state=completed` in single transaction with rollback. RED test asserts injected `pg` failure does NOT leave `completed=true` without admin user. — Source: `api-routes-rest.md` CR-03.
- [ ] **CRIT-FIX-07** (Phase 36.a): `apps/worker/src/jobs/audit-archive.ts:96-128` replaces `spawn('bash', ['-c', script])` with Node-side `spawn('pg_dump', [...args])` + `PGPASSWORD` env + piped streams to `gzip`/`mc`/`aws`. RED test: redact-audit asserts NO `DATABASE_URL`/password in `failedReason` after injected pg_dump failure. — Source: `worker.md` CR-01.
- [ ] **CRIT-FIX-08** (Phase 36.b): `apps/worker/src/jobs/reconciliation-discrepancy.ts:45-61` implements the windowed backfill properly (`since/until/tenant_id` read from payload; `runIngestOnce` signature extended) returning real `{rowsProcessed, rowsScanned}` — `as unknown as` cast removed. OR job deleted with rationale. RED test: destructured awaited result matches fixture counts. — Source: `worker.md` CR-02.
- [ ] **CRIT-FIX-09** (Phase 37): `packages/litellm-client/src/errors.ts` truncates `bodyText` at construction + marks `private` + adds `toJSON()` override returning `{name, message, status}` only. Test asserts `JSON.stringify(new LitellmUpstreamError(500, 'x'.repeat(10000)))` < 500 bytes; pino structured-log contains no `bodyText` field. — Source: `litellm-client.md` CR-01.
- [ ] **CRIT-FIX-10** (Phase 38): `packages/auth/` deleted OR renamed to `@openwhispr/auth-stub` with `private: true` in package.json. Stryker config audited for stale references. — Source: `small-pkgs.md` CR-01.

### High-severity sweep (Phases 39–41)

- [ ] **HIGH-FIX-WIRE-01** (Phase 39): `.strict()` on every input zod schema in `packages/wire-schemas/` (NoteInput, FolderInput, ConversationInput, TranscriptionInput, StreamingUsageBody, WebSearchRequest, CreateApiKeyOptions). Property tests reject unknown keys.
- [ ] **HIGH-FIX-WIRE-02** (Phase 39): All output schemas use `z.string().uuid()` / `.datetime({offset:true})` / `.url()` for IDs / timestamps / URLs. Property tests reject malformed strings.
- [ ] **HIGH-FIX-WIRE-03** (Phase 39): Long-text body fields and `metadata` records bounded by `.max()` per BACKEND_SPEC limits.
- [ ] **HIGH-FIX-WIRE-04** (Phase 39): Symmetrical enums on note_type and other previously-asymmetrical input/output fields; non-negative integer counts via `.int().nonneg()`.
- [ ] **HIGH-FIX-BYOK-01** (Phase 40): Wire schemas moved from `@openwhispr/contract-tests` into `@openwhispr/wire-schemas`; `contract-tests` becomes `private: true`. API routes import from `wire-schemas` only.
- [ ] **HIGH-FIX-BYOK-02** (Phase 40): `redactUrl` covers query-string credentials (`api_key`, `token`, `key`, `code`, `secret`, AWS SigV4 `X-Amz-Signature`), URL userinfo, and bearer-token-shaped path segments (`sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`). Drift-as-failure parity test against every `process.env.*_API_KEY` actually read by the codebase.
- [ ] **HIGH-FIX-BYOK-03** (Phase 40): `fetchAndParse` envelope enforcement removes the `typeof body === "object"` guard; non-JSON / empty body raises `MalformedUpstreamEnvelopeError`.
- [ ] **HIGH-FIX-API-CORE** (Phase 41.a): hardcoded `"00000000-..."` in `apps/api/src/auth.ts:330, 380` replaced with `resolveDefaultTenantId()`; `apps/api/src/placeholder.ts` deleted; residual bootstrap concerns audited.
- [ ] **HIGH-FIX-AGENT-STREAM** (Phase 41.b): `apps/api/src/routes/agent/stream.ts` — `DEFAULT_AGENT_MODEL` reconciled with LiteLLM config (single source of truth); body zod validation added; per-user `rateLimit` config added.
- [ ] **HIGH-FIX-WEB** (Phase 41.c): app-level role-check RSC guard added to `/admin/*` layout (defense-in-depth on Traefik basic-auth); `PLAYWRIGHT_DISABLE_SSR_PREFETCH` test-only branch removed from 5 production RSC pages.
- [ ] **HIGH-FIX-WORKER** (Phase 41.d): bare `pino()` replaced with shared redact factory in worker `index.ts` and `ingest-litellm-spend.ts`; reconciliation-daily-check loop bound corrected; OTel gauge callbacks read fresh `driftStore`; minutes-priced model `metadata.duration` validation + warn-log + counter metric added.
- [ ] **HIGH-FIX-DATA** (Phase 41.e): `migrate.ts` LiteLLM DB init idempotency enforced; migration `0019` replaces 0005's TRUNCATE with idempotent UPSERT; account-token TTL enforcement (post-encryption from Phase 33).
- [ ] **HIGH-FIX-LITELLM** (Phase 41.f): `chatCompletions`, `audioTranscriptions`, `passthrough` get `headersTimeout`/`bodyTimeout`/required `AbortSignal`; SSRF dispatcher asserted at module load (throw if `getGlobalDispatcher()` is not wrapped); model alias drift fixed via single-source-of-truth read from `compose/litellm/litellm_config.yaml`; `streamOptions` spread allows caller opt-out of `include_usage`.
- [ ] **HIGH-FIX-SMALL** (Phase 41.g): real en/ru locale bundles OR `packages/i18n` renamed to `-stub` (verify against Phase 10 coverage); CI parity test between `byok-guard` and `observability/redact` provider lists; `SMTP_SECURE` parsing accepts `1`/`true`/`yes`/`on` (case-insensitive).

**v2.2 coverage:** 32/32 mapped (100% — 9 LOCKER + 10 CRIT-FIX + 13 HIGH-FIX).
**v2.2 distribution:** Phase 31=9, Phase 32=1, Phase 33=1, Phase 34=1, Phase 35=3, Phase 36=2, Phase 37=1, Phase 38=1, Phase 39=4, Phase 40=3, Phase 41=6 = 32 ✓.

**Milestone close criterion (v2.2 only):** re-run the 11-agent `gsd-code-reviewer` pre-publication review against main; expect ≤ 5 residual HIGH and 0 CRITICAL. Anything else → milestone remains open and additional phases inserted.

---

*Requirements defined: 2026-05-08*
*v2 requirements added: 2026-05-14 — 61 REQ-IDs across 10 categories driven by TECH_DEBT.md.*
*v2 traceability mapped: 2026-05-14 by gsd-roadmapper — 7 phases (12–18), 100% coverage, work-order 13 → 12 → 14 → 15 → 16 → 17 → 18.*
*v2.2 requirements added: 2026-05-16 — 32 REQ-IDs (LOCKER-01..09 + CRIT-FIX-01..10 + HIGH-FIX-*) driven by `.planning/review/REVIEW-INDEX.md`. Phases 31–41; Phase 31 ships first as the locker GATE. Phase 20 (compose+Helm guardrails, 2026-05-16 audit) is unrelated and proceeds in parallel.*
*Last updated: 2026-05-16 — v2.2 milestone opened.*
