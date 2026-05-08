# Roadmap: OpenWhispr Server

**Created:** 2026-05-08
**Granularity:** standard (12 phases)
**Core Value:** A drop-in OpenWhispr cloud backend that any organization can self-host on its own infrastructure with its own AI providers — without modifying the desktop client.

## Constitutional Rules (apply to every phase)

Every phase below MUST satisfy these constitutional rules in addition to its phase-specific success criteria. They are not repeated in each phase to avoid noise.

- **TDD discipline:** tests are written before the production code they exercise (TDD-01); every feature ships with unit + integration (testcontainers: real PG/Redis/LiteLLM/Speaches) + e2e + contract layers (TDD-02).
- **CI green-gate:** every PR runs lint + typecheck + unit + integration + e2e + contract + license-scan + secrets-scan + dep-scan + SAST + container-scan; branch protection on `main` blocks merge unless all required checks pass (CI-01..03).
- **Coverage gate:** ≥85% lines / ≥80% branches on the API tier, enforced in CI (TEST-COV-01).
- **English-only source artifacts:** docs, code, comments, commit messages, identifiers, log keys (DOCS-09).
- **Wire-contract conformance suite (CONTRACT-01) extends incrementally:** every wire-required endpoint added in Phases 2/3/4/6 lands with a contract test in the same PR; the suite is the regression net for the entire wire surface, not a final-phase milestone.
- **Locale framework wiring exists from Phase 2 onward:** ESLint forbids hard-coded user-facing string literals; full `en`+`ru` resource stabilization happens in Phase 11 but the framework is live earlier.

## Phases

- [ ] **Phase 0: Repo Bootstrap & Constitutional CI** — Monorepo scaffolding, GitHub Actions matrix, TDD/lint/coverage/security/license/secrets gates green on commit #1
- [ ] **Phase 1: Core Infrastructure & Multi-Tenant Data Foundation** — Compose stack (PG17+PgBouncer+Valkey+MinIO+LiteLLM+Speaches+Traefik+LGTM), RLS DDL with `SET LOCAL` discipline, RLS-introspection lint, no-default-secrets refuse-to-start
- [ ] **Phase 2: Auth + Wire-API Skeleton + Conformance Suite** — Better Auth lifecycle endpoints, OAuth shim with channel-scheme echo, opaque bearer + `set-auth-token` rotation, dual cookie/bearer auth, HTTP 401 contract, wire-conformance harness
- [ ] **Phase 3: LiteLLM + Speaches Default Backend (sync paths)** — `/api/transcribe` (multipart, `limitReached@200`) and `/api/reason` end-to-end via LiteLLM ≥1.83.7-stable + Speaches; per-user virtual-key minting; encrypted-at-rest secrets
- [ ] **Phase 4: Streaming & Realtime** — NDJSON `/api/agent/stream` line-flushed, `/api/agent/web-search`, three realtime token endpoints (with `streams=2`), WSS `/v1/realtime` 3600s ingress
- [ ] **Phase 5: Multi-Provider Abstraction (tenant-scoped)** — Typed provider interfaces (LLM/STT/Realtime/Storage/Email/IdP) with per-tenant override, hot-reload-safe config snapshots, mock provider for sandbox tenant
- [ ] **Phase 6: Quotas, Billing, Referrals** — `usage_ledger` with LiteLLM spend reconciliation, Stripe lifecycle (4 endpoints + null adapter), referrals (3 endpoints), usage/config wire endpoints
- [ ] **Phase 7: Observability, Ops Hardening, Background Workers** — End-to-end OTel traces, structured logs with bearer-scrubbing, audit log, BullMQ workers with tenant-context middleware, SSRF-safe HTTP client
- [ ] **Phase 8: Frontend UI-SPEC (admin + end-user)** — `UI-SPEC-admin.md` and `UI-SPEC-end-user.md` targeting Next.js 15 + shadcn/ui v2 + Tailwind 4, WCAG 2.2 AA, component inventory, design tokens
- [ ] **Phase 9: Load Test, Tuning & SLO Publication** — k6 1000-concurrent (transcribe+reason+stream+WSS) nightly in CI, FD/PgBouncer/Speaches sizing validated, per-endpoint p95 SLOs published only after this phase passes
- [ ] **Phase 10: Helm Chart & Cloud Deploy** — Helm chart with CNPG, Traefik 3, online-migration discipline (CONCURRENTLY/NOT VALID/VALIDATE), upgrade-matrix CI test, < 5 min first-launch SLO enforced
- [ ] **Phase 11: i18n Stabilization, Documentation & OSS Housekeeping** — `en`+`ru` resource files with ICU plurals, locale negotiation, full DOCS-01..09 deliverables, CONTRIBUTING/SECURITY/COC, ADRs for every Key Decision

## Phase Details

### Phase 0: Repo Bootstrap & Constitutional CI
**Goal**: A new contributor can clone the repo, run `make dev` and `make test`, and submit a PR that is gated by every constitutional check before any production code exists.
**Depends on**: Nothing (first phase).
**Requirements**: TDD-01, TDD-02, CI-01, CI-02, CI-03, TEST-COV-01, TEST-MUTATION-01, DEVEX-01, DOCS-09
**Success Criteria** (what must be TRUE):
  1. A new contributor can clone, run `make dev`, and have the full stack scaffold + test harness running in one command on a stock laptop.
  2. Every PR opened against `main` blocks merge until lint, typecheck, unit, integration (testcontainers), e2e, license-scan, secrets-scan, dep-scan, SAST, container-scan, and coverage (≥85% lines / ≥80% branches) gates all pass green.
  3. Mutation testing (Stryker) runs on the auth/quota/billing math modules placeholder and PR fails on score regression once those modules exist.
  4. An attempt to commit a non-English identifier, comment, or log key is caught by the English-only lint rule and blocks the commit.
  5. PR template enforces the "tests written before production code" checklist; reviewer cannot merge without affirming.
**Plans**: TBD
**UI hint**: no

### Phase 1: Core Infrastructure & Multi-Tenant Data Foundation
**Goal**: An operator can run `bootstrap.sh && docker compose up` and have a healthy, observable, multi-tenant Postgres + Redis + MinIO + LiteLLM + Speaches + Traefik stack with RLS enforced and no default secrets — before any wire endpoint exists.
**Depends on**: Phase 0
**Requirements**: DATA-01, DATA-02, DATA-06, SCALE-01, SCALE-02, OBS-05, TEST-MIGRATION-01, TEST-RLS-01, WIRE-22
**Success Criteria** (what must be TRUE):
  1. `docker compose up` brings every service to healthy state on a stock laptop, with HTTPS-only ingress (no plaintext HTTP port externally reachable) and bootstrap-generated unique secrets — refuses to start if any secret matches a known default.
  2. The "default" tenant exists in Postgres after first migration; every `tenant_id`-bearing table has RLS enabled and a policy referencing `current_setting('app.tenant_id')`, verified by an automated `pg_class`+`pg_policies` introspection lint that fails CI if any new tenant-scoped table omits a policy.
  3. A property-test suite (TEST-RLS-01) runs random tenant-pair queries against every queryable model and asserts zero cross-tenant reads or writes are possible from the application role.
  4. Drizzle migrations apply forward and roll back successfully on a real Postgres in CI on every change to `migrations/` (TEST-MIGRATION-01).
  5. Liveness, readiness, and startup probes are exposed on every service; readiness fails red when Postgres / Redis / LiteLLM / Speaches are unhealthy and recovers green when they come back.
  6. PgBouncer transaction-mode is fronting Postgres and a 100-interleaved-tenant integration test confirms `SET LOCAL app.tenant_id` does not leak across pooled connections.
**Plans**: TBD
**UI hint**: no

### Phase 2: Auth + Wire-API Skeleton + Conformance Suite
**Goal**: The unmodified OpenWhispr desktop client can complete sign-in (email/password and at least one OIDC provider), have its bearer token rotated transparently, and reach an authenticated stub of every wire endpoint — with a wire-conformance test suite that fails red on any contract drift.
**Depends on**: Phase 1
**Requirements**: WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-19, WIRE-20, WIRE-21, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, CONTRACT-01
**Success Criteria** (what must be TRUE):
  1. The unmodified desktop client signs in via email/password (dev mode, no external IdP configured) and via at least one OIDC provider (Google or generic), receives an opaque bearer token via `<scheme>://?bearer_token=<token>` echoing the exact `callbackURL` `protocol=` query param across the production / `-dev` / `-staging` / arbitrary-override matrix, and stays signed in across desktop relaunches for ≥30 days.
  2. Every authenticated endpoint accepts both `Authorization: Bearer <opaque>` and session cookies interchangeably; an invalid/expired token returns HTTP 401 (never 200-with-error) so the desktop's `withSessionRefresh()` retry path triggers correctly.
  3. The `set-auth-token` response header rotates tokens with ≥60s overlap (5 min preferred); a concurrent-request rotation contract test confirms no in-flight requests cascade to 401 during rotation.
  4. The 5-second `/api/auth/verification-status` polling cadence is permitted by the rate limiter via an explicit carve-out (no false-negative "session expired"); cookie auth on the three pre-auth endpoints works in both single-host and split-host topologies.
  5. The wire-conformance test suite (CONTRACT-01) is runnable via `make contract-test BACKEND_URL=...` and asserts byte-for-byte: status codes, JSON shapes, the global `{error}` envelope, and the multi-channel redirect matrix on every endpoint implemented in Phase 2.
**Plans**: TBD
**UI hint**: no

### Phase 3: LiteLLM + Speaches Default Backend (sync paths)
**Goal**: A signed-in desktop user can submit audio to `/api/transcribe` and a prompt to `/api/reason` and receive correct responses through LiteLLM ≥1.83.7-stable to Speaches Whisper / a routed LLM, with quota enforcement returning HTTP 200 + `limitReached:true` (never 4xx) and per-user virtual-key budgets honored.
**Depends on**: Phase 2
**Requirements**: LITELLM-01, LITELLM-02, LITELLM-03, LITELLM-04, LITELLM-05, WIRE-05, WIRE-06, DATA-03, DATA-05
**Success Criteria** (what must be TRUE):
  1. `POST /api/transcribe` accepts a multipart audio upload, streams it through LiteLLM (no backport patch — v1.83.7+ native fix) to Speaches Whisper, and returns the BACKEND_SPEC.md JSON shape `{text, wordsUsed, wordsRemaining, plan, limitReached, sttProvider, sttModel, ...}` end-to-end against a real Speaches container in CI.
  2. A zero-quota tenant E2E test confirms `/api/transcribe` returns HTTP 200 with `limitReached:true` (never 4xx), without making the upstream LiteLLM call (verified by the absence of a corresponding spend-log row).
  3. `POST /api/reason` returns the BACKEND_SPEC.md shape `{text, model, provider, promptMode, matchType}` end-to-end with the per-user LiteLLM virtual key (minted via `/key/generate` with budget + model-allowlist), and the master key is never exposed in any user-facing request path.
  4. `docs/litellm-config-spec.md` exists, derived from `speaches-audio.md`, covering models, virtual-key auth, pass-through diarization, realtime mode, and ingress 3600s timeouts; the LiteLLM container in compose loads this config without error.
  5. Bearer tokens, OAuth refresh tokens, and provider API keys are encrypted at rest via a KEK/DEK envelope; the KEK source is pluggable (env / file / Vault / KMS adapter) and rotation of a tenant's virtual key on config change is verified by a contract test.
  6. `usage_ledger` rows are written idempotently keyed on `request_id`; a retry of the same request does not double-count.
**Plans**: TBD
**UI hint**: no

### Phase 4: Streaming & Realtime
**Goal**: A signed-in desktop user can hold a 65-minute WSS realtime session and observe NDJSON agent-stream tokens flushed per line within 500ms first-line latency through the full ingress chain, with no buffering anywhere.
**Depends on**: Phase 3
**Requirements**: WIRE-07, WIRE-08, WIRE-13, WIRE-14, WIRE-15, SCALE-05
**Success Criteria** (what must be TRUE):
  1. `POST /api/agent/stream` returns `Content-Type: application/x-ndjson` with `X-Accel-Buffering: no`, flushes every line via explicit `reply.raw.flush()`, and the first-line-latency contract test through the full Traefik chain measures < 500ms wall-clock.
  2. WSS `/v1/realtime` Option A (desktop ↔ LiteLLM-fronted Speaches) holds a 65-minute synthetic session without ingress timeout; `proxy_read_timeout`/`proxy_send_timeout` are 3600s on every WSS-bearing route and verified in a smoke test.
  3. `POST /api/openai-realtime-token` mints `clientSecrets[]` of length 2 when `streams=2` is requested; `POST /api/streaming-token` (AssemblyAI) and `POST /api/deepgram-streaming-token` mint short-lived tokens from server-held master keys with budget caps applied.
  4. `POST /api/agent/web-search` returns `{results: [{title, url, snippet}]}` end-to-end through a real provider (or stubbed via the mock-provider lane in CI).
  5. A per-event compatibility matrix between Speaches Realtime and the OpenAI Realtime spec is captured in `docs/realtime-compatibility.md` and exercised by an integration test that replays a representative desktop session.
  6. The wire-conformance suite (CONTRACT-01) is extended in this phase to cover NDJSON line-flush behavior, WSS upgrade headers, and realtime token shapes.
**Plans**: TBD
**UI hint**: no

### Phase 5: Multi-Provider Abstraction (tenant-scoped)
**Goal**: An operator can configure tenant A to use LiteLLM/Speaches and tenant B to use Bedrock-direct LLM + Deepgram STT in the same installation, and config changes hot-reload safely without affecting in-flight requests.
**Depends on**: Phase 4
**Requirements**: PROVIDER-01, PROVIDER-02, PROVIDER-03, PROVIDER-04, PROVIDER-06, PROVIDER-07, PROVIDER-08, WIRE-11, WIRE-12
**Success Criteria** (what must be TRUE):
  1. Typed `LLMProvider` / `STTProvider` / `RealtimeProvider` / `StorageProvider` / `EmailProvider` / `IdPProvider` interfaces exist in a `providers/` package; bundled adapters cover: LLM (LiteLLM, OpenAI, Anthropic, Gemini, Mistral, Bedrock, Azure OpenAI, Vertex), STT (LiteLLM/Speaches, AssemblyAI, Deepgram, OpenAI Whisper, Groq), Realtime (Speaches, OpenAI, AssemblyAI, Deepgram), Storage (S3, MinIO, GCS, Azure Blob), Email (SMTP, SendGrid, SES, Postmark), IdP (Google, generic OIDC, email+password) with at least one of each tested end-to-end against a real or recorded backend.
  2. Per-tenant provider override (DIFF-01) is verified: a two-tenant integration test with tenant A on LiteLLM and tenant B on a different LLM adapter shows correct routing per request, with tenant identification driving every dispatch decision.
  3. `GET /api/stt-config` and `GET /api/note-recording-config` return tenant-correct values resolved from the per-tenant config snapshot.
  4. Provider config changes propagate via Postgres LISTEN/NOTIFY with hot-reload-safe versioned snapshots — in-flight requests pinned to their config snapshot do not see the change mid-flight; new requests see the new config within 1s.
  5. A `mock` provider implementation exists for every interface, used by the sandbox tenant (DIFF-03) for deterministic E2E tests with no real upstream calls and no quota burn.
  6. An operator-supplied `tenant.allowed_providers` allow-list is enforced at the provider-selection layer and an attempt to dispatch to a non-allowed provider returns a structured error and writes an audit log row.
**Plans**: TBD
**UI hint**: no

### Phase 6: Quotas, Billing, Referrals
**Goal**: A self-hoster can run with billing-disabled (null adapter) or with Stripe enabled; either way, per-tenant quotas, usage display, plan upgrades, and referral invites all work end-to-end through the wire contract.
**Depends on**: Phase 5
**Requirements**: WIRE-09, WIRE-10, WIRE-16, WIRE-17, WIRE-18, PROVIDER-05
**Success Criteria** (what must be TRUE):
  1. `POST /api/streaming-usage`, `GET /api/usage` return canonical per-tenant per-cycle counts (transcribe minutes, reason tokens, streaming minutes); a daily reconciliation BullMQ job alerts on drift between the platform `usage_ledger` and LiteLLM spend logs.
  2. With Stripe configured, all four `/api/stripe/{checkout,portal,switch-plan,preview-switch}` endpoints work end-to-end (tested against Stripe test mode in CI), including signed webhook ingestion at the worker tier with idempotency on subscription events.
  3. With the null billing adapter (license-only installs), all four `/api/stripe/*` endpoints return deterministic 200 responses with `{disabled: true}`-class payloads so the desktop wire contract still holds and the desktop UI degrades gracefully.
  4. `GET /api/referrals/stats`, `POST /api/referrals/invite`, `GET /api/referrals/invites` work end-to-end; invites are sent via the configured email provider through the BullMQ worker queue with delivery retry and an audit log row per send.
  5. The generic passthrough channel (`cloud-api-request`) returns the global `{error}` envelope correctly for any unhandled `/api/<path>`, verified by a randomized fuzzer in the contract suite.
  6. The wire-conformance suite (CONTRACT-01) is extended to cover all Stripe + referrals + usage endpoints, completing the regression net for the entire wire surface.
**Plans**: TBD
**UI hint**: no

### Phase 7: Observability, Ops Hardening & Background Workers
**Goal**: An operator can debug a slow-request claim end-to-end via correlation-ID-linked OTel traces (API → LiteLLM → Speaches), see audit log rows for every security-relevant event, and rely on background workers that re-establish full tenant context per job.
**Depends on**: Phase 6
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, DATA-04, DATA-07, SCALE-03, SCALE-04
**Success Criteria** (what must be TRUE):
  1. An end-to-end OTel trace links the desktop request id through API → LiteLLM → Speaches; opening the trace in Grafana Tempo shows every span with correlation IDs and the full hot-path latency breakdown.
  2. Structured JSON logs flow to Loki with bearer/cookie/secret scrubbing — a sentinel-token integration test confirms `Authorization`, `Cookie`, `set-auth-token`, and any `*token*`/`*secret*`/`*password*`/`*key*` header or field is never written to logs.
  3. Audit log rows are written for: auth events, account deletion, key issuance, quota changes, plan changes, provider config changes, and cross-tenant attempts (token tenant ≠ subdomain/header tenant → 403 + audit row).
  4. BullMQ workers run on the same image with a queue entrypoint; a CI introspection gate confirms every job handler runs through tenant-context middleware that re-establishes the DB `app.tenant_id` GUC + log MDC + OTel context before invoking the handler.
  5. Rate limiting (per-user, per-tenant, per-IP via Redis token bucket) is verified to fail-OPEN on Redis death (better UX than blocking everyone); the verification-polling carve-out for `/api/auth/verification-status` is asserted by a 10-minute polling test.
  6. All server-side outbound HTTP calls (webhooks, OIDC discovery, federated callbacks) pass through an SSRF-safe HTTP client that blocks private-IP ranges and defends against DNS rebinding.
  7. `make backup` produces an encrypted dump and `make restore` recovers it; both run successfully in CI on every change to backup tooling.
**Plans**: TBD
**UI hint**: no

### Phase 8: Frontend UI-SPEC (admin + end-user)
**Goal**: An operator or a contributor can read the UI-SPEC documents and generate a Next.js 15 + shadcn/ui v2 + Tailwind 4 implementation that satisfies every operator and end-user surface, without ambiguity about layout, accessibility, or component choice.
**Depends on**: Phase 2 (auth surface stable enough to spec authentication flows). Can run in parallel with Phases 5-7.
**Requirements**: UI-SPEC-01, UI-SPEC-02, UI-SPEC-03
**Success Criteria** (what must be TRUE):
  1. `UI-SPEC-admin.md` exists and covers every operator surface: tenants list, tenant detail (members, providers, quotas), users list, key management, audit log, observability deep-links, billing config, provider config, dev mode — with screen-by-screen layout, component inventory enumerated against shadcn/ui v2 component names, and explicit user flows.
  2. `UI-SPEC-end-user.md` exists and covers profile, plan, usage breakdown, referrals (stats / invite / invites), and account deletion — mirroring the desktop client's settings panel surfaces where applicable.
  3. Both specs satisfy WCAG 2.2 AA (keyboard nav, color contrast, ARIA), responsive breakpoints (mobile + tablet + desktop), light + dark theme, with design tokens documented; locale negotiation chain (en/ru) is explicit.
  4. A reviewer can pick any single screen from either spec and identify the exact shadcn/ui components, Tailwind 4 design tokens, and i18n keys required to implement it without further clarification from the spec author.
**Plans**: TBD
**UI hint**: yes

### Phase 9: Load Test, Tuning & SLO Publication
**Goal**: An operator can trust that the published per-endpoint p95 SLOs in the operator-facing SLA are real, validated under a 1000-concurrent k6 load test mixing transcribe + reason + agent stream + WSS realtime — and the test runs nightly in CI to catch regressions.
**Depends on**: Phase 7 (full wire surface + observability needed to measure)
**Requirements**: SCALE-06, SCALE-07, TEST-LOAD-01
**Success Criteria** (what must be TRUE):
  1. A k6 scenario simulating 1000 concurrent active users with a representative mix (200 NDJSON agent streams + 100 WSS realtime + 700 sync transcribe/reason at 50 RPS) runs nightly in CI against an ephemeral environment and asserts the published per-endpoint p95 SLOs.
  2. Per-endpoint p95 SLO budgets are committed to `docs/operations.md` only after this phase's load test passes — not before.
  3. PgBouncer pool depth, Redis ops/s headroom, Speaches GPU concurrency, ingress `worker_connections`, and `ulimit -n` (raised to 65535 on API + ingress containers) are tuned and documented in a sizing matrix per topology (SCALE-07).
  4. A load-test regression in CI fails the nightly run and pages the on-call channel; the regression must be diagnosed and fixed (not papered over) before the next merge to `main`.
  5. A 65-minute synthetic WSS smoke test is part of the nightly suite and confirms ingress timeouts hold up over the full hour.
**Plans**: TBD
**UI hint**: no

### Phase 10: Helm Chart & Cloud Deploy
**Goal**: An operator can `helm install` on a stock Kubernetes cluster and reach an authenticated `/api/transcribe` in under 5 minutes; subsequent `helm upgrade` runs apply migrations safely under rolling deploy with no data loss across one minor version.
**Depends on**: Phase 9 (compose tuned and load-validated before porting to K8s)
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-04, DEPLOY-05
**Success Criteria** (what must be TRUE):
  1. A single Helm chart with subcharts deploys API + workers + Postgres (via CloudNativePG 1.29 with PG 17 image override) + Valkey + LiteLLM + Speaches (with GPU node-selector) + MinIO + Traefik 3 (NOT ingress-nginx) + cert-manager + OTel Collector + Tempo + Loki + Mimir + Grafana on a stock K8s cluster with a single `helm install --values` command.
  2. A first-launch CI test asserts the operator-experience SLO: `git clone` → `helm install` → first authenticated `/api/transcribe` call succeeds in under 5 minutes (DEPLOY-05).
  3. Migrations run as a pre-deploy job and are safe under rolling deploy across one minor version: an upgrade-matrix CI test installs version N-1, populates representative tenant data, runs `helm upgrade` to N, and asserts health + data integrity + zero downtime; `squawk` or `pgroll` lints block PRs that introduce blocking-lock migration patterns (CREATE INDEX must use CONCURRENTLY, ADD CONSTRAINT must use NOT VALID + VALIDATE).
  4. The same `docker-compose.yml` from Phase 1 still works for single-host self-host (DEPLOY-01) and produces the same wire surface as the Helm path; a contract-test sweep confirms parity.
  5. HPA scales API and worker tiers on CPU + queue depth; Speaches uses node-selector + tolerations for GPU pods; cert-manager issues TLS certificates via Let's Encrypt for any externally reachable hostname.
**Plans**: TBD
**UI hint**: no

### Phase 11: i18n Stabilization, Documentation & OSS Housekeeping
**Goal**: A new operator anywhere in the world can read English or Russian docs, install per the README in under 5 minutes, and contribute a documented locale override or new feature with full ADR + CONTRIBUTING guidance.
**Depends on**: Phase 10 (stable surface to document and translate)
**Requirements**: I18N-01, I18N-02, TEST-I18N-01, DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05, DOCS-06, DOCS-07, DOCS-08
**Success Criteria** (what must be TRUE):
  1. All user-facing surfaces (UI copy in UI-SPEC, email templates including subject lines, notification text, end-user-visible error messages) have complete `en` and `ru` resource files; ICU MessageFormat handles Russian one/few/many/other plural forms correctly with snapshot tests at boundary cases (1, 2, 5, 21, 22).
  2. CI gate (TEST-I18N-01) fails red when any `t("key")` exists in `en` but is missing in `ru` (or vice versa); ESLint rule forbids hard-coded user-facing string literals.
  3. Operators can layer locale overrides via a mounted volume / config map without forking the repo (I18N-02), demonstrated by an integration test that ships a custom Russian welcome email and verifies it is sent in place of the bundled default.
  4. `Accept-Language` negotiation drives end-user-visible error message localization on API responses; `Intl.DateTimeFormat` and `Intl.NumberFormat` are locale-aware throughout.
  5. The full DOCS-01..09 suite is published: `README.md` with under-5-minute compose quickstart; `docs/architecture.md` with mermaid diagrams of the three hot paths; `docs/operations.md` with deploy/upgrade/scale/backup/restore/troubleshoot; `docs/providers.md` with per-tenant provider swap recipes; `docs/litellm-config-spec.md`; `docs/wire-contract.md` cross-linking the conformance suite; `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, OSS LICENSE (Apache-2.0 default) with license headers; one ADR per row in PROJECT.md § Key Decisions.
  6. A first-time contributor can clone, read CONTRIBUTING.md, and submit a passing PR end-to-end without any out-of-band guidance from a maintainer.
**Plans**: TBD
**UI hint**: no

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Repo Bootstrap & Constitutional CI | 0/0 | Not started | - |
| 1. Core Infrastructure & Multi-Tenant Data Foundation | 0/0 | Not started | - |
| 2. Auth + Wire-API Skeleton + Conformance Suite | 0/0 | Not started | - |
| 3. LiteLLM + Speaches Default Backend (sync paths) | 0/0 | Not started | - |
| 4. Streaming & Realtime | 0/0 | Not started | - |
| 5. Multi-Provider Abstraction (tenant-scoped) | 0/0 | Not started | - |
| 6. Quotas, Billing, Referrals | 0/0 | Not started | - |
| 7. Observability, Ops Hardening & Background Workers | 0/0 | Not started | - |
| 8. Frontend UI-SPEC (admin + end-user) | 0/0 | Not started | - |
| 9. Load Test, Tuning & SLO Publication | 0/0 | Not started | - |
| 10. Helm Chart & Cloud Deploy | 0/0 | Not started | - |
| 11. i18n Stabilization, Documentation & OSS Housekeeping | 0/0 | Not started | - |

## Coverage Validation

All 93 v1 requirements are mapped to exactly one phase. No orphans. No duplicates. (Note: REQUIREMENTS.md preamble cites "78 requirements" — actual line-item count after definition is 93; the 78 figure pre-dated the constitutional/test-discipline expansion. All 93 are covered below.)

| Phase | Requirements Mapped | Count |
|-------|---------------------|-------|
| 0 | TDD-01, TDD-02, CI-01, CI-02, CI-03, TEST-COV-01, TEST-MUTATION-01, DEVEX-01, DOCS-09 | 9 |
| 1 | DATA-01, DATA-02, DATA-06, SCALE-01, SCALE-02, OBS-05, TEST-MIGRATION-01, TEST-RLS-01, WIRE-22 | 9 |
| 2 | WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-19, WIRE-20, WIRE-21, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, CONTRACT-01 | 15 |
| 3 | WIRE-05, WIRE-06, LITELLM-01, LITELLM-02, LITELLM-03, LITELLM-04, LITELLM-05, DATA-03, DATA-05 | 9 |
| 4 | WIRE-07, WIRE-08, WIRE-13, WIRE-14, WIRE-15, SCALE-05 | 6 |
| 5 | WIRE-11, WIRE-12, PROVIDER-01, PROVIDER-02, PROVIDER-03, PROVIDER-04, PROVIDER-06, PROVIDER-07, PROVIDER-08 | 9 |
| 6 | WIRE-09, WIRE-10, WIRE-16, WIRE-17, WIRE-18, PROVIDER-05 | 6 |
| 7 | OBS-01, OBS-02, OBS-03, OBS-04, DATA-04, DATA-07, SCALE-03, SCALE-04 | 8 |
| 8 | UI-SPEC-01, UI-SPEC-02, UI-SPEC-03 | 3 |
| 9 | SCALE-06, SCALE-07, TEST-LOAD-01 | 3 |
| 10 | DEPLOY-01, DEPLOY-02, DEPLOY-04, DEPLOY-05 | 4 |
| 11 | I18N-01, I18N-02, TEST-I18N-01, DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05, DOCS-06, DOCS-07, DOCS-08 | 11 |
| **Total** | | **92** |

Note: DEPLOY-03 ("One-command bootstrap; one-command upgrade; refuse to start on default secrets") is split-mapped: the **bootstrap + refuse-to-start-on-default-secrets** behavior is delivered in Phase 1 (where the compose stack and bootstrap.sh first exist); the **one-command upgrade** behavior is delivered in Phase 10 (Helm). For traceability the requirement is listed as Phase 1 primary with a Phase 10 extension. With DEPLOY-03 counted: **93/93 mapped, 0 orphans**.

---
*Roadmap created: 2026-05-08*
