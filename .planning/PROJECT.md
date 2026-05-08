# OpenWhispr Server

## What This Is

An open-source, self-hosted, **wire-compatible** backend for the OpenWhispr Electron desktop client. It implements the full `${OPENWHISPR_API_URL}/api/...` surface (auth lifecycle, transcription, reasoning, agent streaming, quotas, billing, referrals) plus the OAuth shim that ends in the `<scheme>://?bearer_token=<token>` custom-protocol redirect, with a default audio/LLM stack built on **LiteLLM Proxy + Speaches** and a multi-provider abstraction so any operator can swap backends (LLM, STT, storage, auth, billing) for their own infrastructure when self-hosting.

It is built to enterprise standards for **1000 concurrent active users** in one installation: HA Postgres, horizontal autoscaling, queues, rate limiting, multi-tenancy, full observability, and reproducible deploys via docker-compose (single-host self-host) and Helm/Kustomize (Kubernetes cloud).

## Core Value

**A drop-in OpenWhispr cloud backend that any organization can run on its own infrastructure with its own AI providers — without modifying the desktop client.** Every other goal (multi-provider, multi-tenancy, observability, frontend, OSS docs) exists to serve this one outcome.

## Requirements

### Validated

(None yet — ship to validate)

### Active

#### Wire compatibility (the contract)
- [ ] **WIRE-01**: Implement all 3 mandatory auth-lifecycle endpoints (`POST /api/check-user`, `GET /api/auth/verification-status`, `DELETE /api/auth/delete-account`) per `BACKEND_SPEC.md`
- [ ] **WIRE-02**: Implement all operational endpoints called by the client: `/api/health`, `/api/transcribe` (multipart, `limitReached` at 200), `/api/reason`, `/api/agent/stream` (NDJSON, flush per line), `/api/agent/web-search`, `/api/streaming-usage`, `/api/usage`, `/api/stt-config`, `/api/note-recording-config`, `/api/streaming-token`, `/api/deepgram-streaming-token`, `/api/openai-realtime-token`, `/api/stripe/{checkout,portal,switch-plan,preview-switch}`, `/api/referrals/{stats,invite,invites}`
- [ ] **WIRE-03**: Honor the global error envelope `{ "error": "<string>" }` and HTTP 401 (not 200-with-error) on auth failure so `withSessionRefresh()` retry path triggers correctly
- [ ] **WIRE-04**: Accept `Authorization: Bearer <opaque>` and session cookies (both attached on main-process calls) interchangeably
- [ ] **WIRE-05**: Honor `set-auth-token` response header on Better-Auth-style endpoints to support transparent token rotation
- [ ] **WIRE-06**: Generic passthrough channel — any new `/api/<path>` proxied via `cloud-api-request` returns `{ error }` envelope correctly

#### OAuth + custom-protocol
- [ ] **AUTH-01**: Host `${AUTH_URL}/api/desktop-signin/{provider}` shim that initiates upstream IdP round-trip
- [ ] **AUTH-02**: Final redirect emits `${PROTOCOL}://?bearer_token=<token>` echoing the **exact** scheme received in `callbackURL` (production / `-dev` / `-staging` / arbitrary override)
- [ ] **AUTH-03**: Issue opaque bearer tokens long-lived enough to survive desktop relaunches, OR rotate via `set-auth-token`
- [ ] **AUTH-04**: Support email/password sign-in via Better Auth contract; on sign-up, expose verification status to the 5s polling client
- [ ] **AUTH-05**: Multi-tenant identity model — each user belongs to exactly one tenant; tokens carry tenant scope
- [ ] **AUTH-06**: Pluggable IdP providers (OIDC, SAML, Google, Microsoft, Apple, GitHub, email/password, magic link) — at least 2 in v1, others extensible

#### Default backend: LiteLLM Proxy + Speaches
- [ ] **LITELLM-01**: Embed LiteLLM Proxy as the default LLM/audio gateway (configured per `speaches-audio.md` requirements)
- [ ] **LITELLM-02**: Convert `speaches-audio.md` into a concrete LiteLLM configuration spec (`docs/litellm-config-spec.md`) covering models, virtual-key auth, pass-through endpoints (diarization), realtime WSS, and the multipart-passthrough patch
- [ ] **LITELLM-03**: Built-in support for the three Speaches audio routes (`/v1/audio/transcriptions`, `/v1/audio/diarization`, `WSS /v1/realtime`) with virtual-key forwarding
- [ ] **LITELLM-04**: Issue per-user virtual keys with budget/limits via LiteLLM key-generate API
- [ ] **LITELLM-05**: Quota enforcement — surface exhaustion at HTTP 200 with `limitReached: true` for `/api/transcribe`

#### Multi-provider abstraction
- [ ] **PROVIDER-01**: STT providers: LiteLLM/Speaches (default), AssemblyAI, Deepgram, OpenAI Whisper, Groq — selectable per-tenant via config
- [ ] **PROVIDER-02**: LLM providers: LiteLLM-routed (default), direct OpenAI, Anthropic, Gemini, Mistral, Bedrock, Azure OpenAI, Vertex — selectable per-tenant
- [ ] **PROVIDER-03**: Realtime providers: Speaches Realtime (default), OpenAI Realtime, AssemblyAI streaming, Deepgram streaming
- [ ] **PROVIDER-04**: Storage providers: S3-compatible (default MinIO for self-host, S3/GCS/Azure Blob for cloud)
- [ ] **PROVIDER-05**: Billing providers: Stripe (default, optional), null/disabled (for licensed enterprise installs)
- [ ] **PROVIDER-06**: Email providers: SMTP (default), SendGrid, SES, Postmark — for verification & referral invites
- [ ] **PROVIDER-07**: All provider selection driven by typed config (env + YAML) with hot-reload where safe

#### Multi-tenancy & data
- [ ] **DATA-01**: PostgreSQL 16+ schema with row-level tenant isolation
- [ ] **DATA-02**: Migrations system with forward-only versioning
- [ ] **DATA-03**: Per-tenant quota / plan / usage ledger (transcribe minutes, reason tokens, streaming minutes)
- [ ] **DATA-04**: Audit log for auth events, account deletion, key issuance, quota changes
- [ ] **DATA-05**: PII handling — at-rest encryption for tokens, optional PII redaction in transcripts (configurable)

#### Enterprise scale (1000 concurrent)
- [ ] **SCALE-01**: Stateless API tier — horizontally scalable, no in-memory session state
- [ ] **SCALE-02**: Connection pooling (PgBouncer or equivalent) sized for 1000 concurrent
- [ ] **SCALE-03**: Background job queue (transcription orchestration, webhook fanout, email delivery)
- [ ] **SCALE-04**: Rate limiting per-key, per-tenant, per-IP with redis-backed token bucket
- [ ] **SCALE-05**: Streaming endpoints (NDJSON, WSS) survive ingress timeouts up to 1h
- [ ] **SCALE-06**: Load test demonstrates 1000 concurrent active users (transcribe + reason + stream) at p95 < SLO

#### Observability
- [ ] **OBS-01**: OpenTelemetry tracing across API → LiteLLM → Speaches
- [ ] **OBS-02**: Prometheus metrics (RED + saturation) with Grafana dashboards shipped
- [ ] **OBS-03**: Structured logging (JSON) with correlation IDs end-to-end
- [ ] **OBS-04**: LiteLLM spend logs piped into the platform's usage ledger

#### Frontend (UI-SPEC only — UI itself out of v1 implementation scope)
- [ ] **UI-01**: Produce `UI-SPEC.md` for an admin/operator console: tenants, users, keys, quotas, providers, audit log, observability links, billing
- [ ] **UI-02**: Produce `UI-SPEC.md` for end-user self-service: profile, plan, usage, referrals, account deletion (mirror desktop-client surfaces where applicable)
- [ ] **UI-03**: UI-SPEC follows accessibility (WCAG 2.2 AA), responsive, and design-system standards; component inventory enumerated; user generates code from the spec

#### Deployment
- [ ] **DEPLOY-01**: `docker-compose.yml` for single-host self-host (API + Postgres + Redis + LiteLLM + Speaches + MinIO + nginx + observability stack)
- [ ] **DEPLOY-02**: Helm chart for Kubernetes (cloud-grade: HA Postgres operator, autoscaling, ingress, cert-manager hooks)
- [ ] **DEPLOY-03**: One-command bootstrap and one-command upgrade
- [ ] **DEPLOY-04**: Migration runner is safe to run during rolling deploy

#### OSS / docs (every requirement above ships with docs)
- [ ] **DOCS-01**: README with quickstart (compose path) — under 5 minutes to first authenticated `/api/transcribe`
- [ ] **DOCS-02**: `docs/architecture.md` — components, data flow, request lifecycle
- [ ] **DOCS-03**: `docs/operations.md` — deploy, upgrade, scale, backup, restore
- [ ] **DOCS-04**: `docs/providers.md` — how to swap LLM/STT/storage/auth/billing/email providers
- [ ] **DOCS-05**: `docs/litellm-config-spec.md` — derived from `speaches-audio.md`
- [ ] **DOCS-06**: `docs/wire-contract.md` — references `BACKEND_SPEC.md` + `OAUTH_SPEC.md` upstream
- [ ] **DOCS-07**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, OSS license headers
- [ ] **DOCS-08**: ADRs for every Key Decision in this document
- [ ] **DOCS-09**: All documentation, code comments, commit messages, and identifiers are in **English only** (project hard rule)

### Out of Scope (v1)

- **Reference desktop client modifications** — we are wire-compatible; the client is unchanged.
- **Third-party AI vendor SDKs called from the client (BYOK)** — OpenAI/Anthropic/etc. are direct from the desktop with user keys; the server has no role unless an org-key tenancy mode is added later.
- **Google Calendar OAuth** — desktop talks to Google directly with embedded OAuth Desktop client; server has no role.
- **The actual frontend implementation** — v1 ships UI-SPEC only; UI generation is the user's downstream task.
- **Hidden / undocumented OpenWhispr endpoints** — the wire surface is exactly what the current desktop binary sends.
- **Live runtime trace validation tooling** — defer to v2.
- **OpenAPI/JSON-Schema generation** — defer to v2.
- **SAML/SCIM provisioning, audit-log SIEM exports, FedRAMP-grade isolation** — enterprise-plus features for v2.

## Context

- **Upstream client repo**: `/Users/nick/openwhispr` — Electron desktop app, BYOK third-party AI, Better Auth client.
- **Authoritative wire spec**: `/Users/nick/openwhispr/docs/SELF_HOSTING.md` (walkthrough), `BACKEND_SPEC.md` (per-endpoint contract), `OAUTH_SPEC.md` (auth flows). 1556 lines total — this is the source of truth.
- **LiteLLM/Speaches reference**: `/Users/nick/openwhispr-server/speaches-audio.md` — production deployment at Alfaleasing on `aimodels.inner.alfaleasing.ru`. Three audio routes (Whisper transcription, pyannote diarization, Speaches Realtime WSS), one virtual key covers all. Includes a known LiteLLM v1.82.3 multipart-passthrough bug + backport patch.
- **Deployment target diversity**: operator may run docker-compose on one VM, or Helm on multi-AZ Kubernetes. Both must yield the same wire surface.
- **Multi-tenant by default** — even single-org installs use a single "default" tenant; this keeps the data model uniform.

## Constraints

- **Tech stack**: Open self-selection during research, but must be enterprise-mainstream (boring, well-staffed). Constraints: containerizable, multi-arch (amd64 + arm64), works without GPU on the API tier, Postgres-native.
- **Database**: PostgreSQL 16+ — non-negotiable.
- **Default LLM/audio backend**: LiteLLM Proxy + Speaches — non-negotiable as the default; alternatives are configurable.
- **Wire compatibility**: every endpoint in `BACKEND_SPEC.md` matches byte-for-byte JSON shape, status codes, error envelope, NDJSON streaming behavior. No deviations.
- **HTTPS only**: never plaintext HTTP on any externally reachable port.
- **Concurrency**: 1000 active concurrent users single installation, p95 latency budgets defined per-endpoint in research phase.
- **Documentation language**: **English only**, all artifacts (docs, code, comments, commits, identifiers, error messages where they are operator-facing). Hard project rule — no exceptions.
- **Open source**: every requirement ships with corresponding documentation; no closed/internal subsystems.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Wire-compatible with current desktop binary | Desktop client is the canonical "user" — anything else fragments the ecosystem | — Pending |
| Default backend = LiteLLM + Speaches | Production-proven stack (Alfaleasing); covers Whisper transcription, pyannote diarization, OpenAI-Realtime-spec WSS in one image | — Pending |
| Multi-provider abstraction first-class | Operators must be able to swap to their existing infra (their LLM gateway, their STT, their storage, their IdP) | — Pending |
| Postgres + Redis as the only required infra services | Boring, ubiquitous, operator-friendly; Redis used for rate-limit + queue + ephemeral session pieces | — Pending |
| UI-SPEC over UI-implementation in v1 | User generates the frontend from the spec; lets us focus enterprise effort on the contract surface | — Pending |
| Stack chosen by research, not pre-committed | Research phase will compare e.g. Node/Fastify vs Go vs Python/FastAPI against Better-Auth-server-side, multipart streaming, NDJSON flushing, and operator skillset | — Pending |
| All docs/code in English only | Mixed-language artifacts confuse contributors and tooling | — Pending |
| Open-source from day one | OSS-grade docs and licensing decisions are easier to make at start than retrofit | — Pending |

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
*Last updated: 2026-05-08 after initialization*
