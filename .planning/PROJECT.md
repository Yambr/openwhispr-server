# OpenWhispr Server

## Engineering Discipline (Constitutional, NON-NEGOTIABLE)

These rules apply to EVERY phase, every plan, every commit. Violations block phase completion. The gsd-verifier agent enforces them.

1. **Strict TDD** — RED → GREEN → REFACTOR. Tests precede production code on EVERY phase, including decimal/insertion phases (X.Y). Each fix lands with its tests in the SAME atomic commit. No exceptions, no "yolo mode", no "small fix" carve-outs.

2. **Per-phase coverage floor ≥ 90/90/90/90** (lines / branches / functions / statements) on all new/modified code. Applies to every package and every phase. A phase MAY NOT close — verifier MUST report `gaps_found` — when any new/modified file is < 90% on any axis.

3. **E2E is mandatory, not optional.** Every phase that touches a user-visible route, wire surface, or operator-facing artifact MUST ship at least one e2e test that boots the real `docker compose` stack (or hermetic mock-LiteLLM profile when the upstream is a paid SaaS provider) and round-trips the route. E2E tests live in `tests/e2e/` and run via `make e2e-test` (gated on `E2E=1` env). Phase verification MUST execute the e2e suite, not just unit tests, before reporting `passed`.

4. **No mocks of internal logic.** Mocks are allowed ONLY at process/network boundaries (HTTP clients to third-party SaaS, OS time, filesystem). Mocking a function the route under test calls is forbidden. If an integration is hard to test, write a real testcontainer/integration test, not a mock. The `vi.mock` of project-internal modules in route tests is a TDD anti-pattern and will be flagged by code review.

5. **Real services in tests.** `packages/data` and any DB-touching code MUST run testcontainer integration tests against real Postgres + PgBouncer + Valkey. Local Docker MUST be running before phase verification claims a phase passes. CI MUST run testcontainers in matrix; a phase that ships testcontainer-skipped tests because Docker is unavailable does NOT pass verification.

6. **GitHub Actions** is the only sanctioned CI; workflows in `.github/workflows/` from the first commit of phase 0. CI MUST run unit + integration + contract + e2e on every PR. E2E secrets gate only the live-provider matrix; the wire-shape matrix (against hermetic mock-LiteLLM) MUST always run.

7. **Verification gate.** The gsd-verifier agent MUST execute `make e2e-test` (or its hermetic equivalent) and parse `pnpm -r test --coverage` JSON output. A phase passes only when ALL of: (a) every must_have observable truth is verified against the live codebase; (b) coverage ≥ 90/90/90/90 on the diff; (c) e2e suite is green; (d) no testcontainer-skipped tests due to missing Docker. Anything else is `gaps_found`.

8. **Maximum test automation, no human QA.** Coverage spans unit, integration (real services via testcontainers), e2e (live compose stack), contract (against `BACKEND_SPEC.md`), load (1000 concurrent), security (SAST + deps + container + secrets + license), migration safety, i18n completeness, RLS-isolation property tests.

9. **No environment short-cuts.** `--no-verify` is permitted only when (a) the orchestrator runs in parallel-worktree mode and (b) the post-wave hook validation will run hooks once the wave merges back. NEVER for individual developer commits. NEVER for skipping a failing test or coverage check.

10. **Audit trail.** Every phase MUST ship: PLAN.md, SUMMARY.md, REVIEW.md (code-review agent), VERIFICATION.md (verifier agent), and a coverage delta report (`<phase>-COVERAGE.md`) showing per-file before/after on the four axes. Missing any of these → `gaps_found`.

## What This Is

An open-source, enterprise-grade, self-hosted backend for the OpenWhispr Electron desktop client, implementing the wire surface defined by the upstream `SELF_HOSTING.md` / `BACKEND_SPEC.md` / `OAUTH_SPEC.md` (1556 lines of authoritative spec). It bundles a default **LiteLLM Proxy** wired to **open-source AI models** (Whisper for transcription, pyannote for diarization, faster-whisper / Speaches-compatible image for realtime) so a fresh `git clone && docker compose up` works out of the box for OSS users, while corporate operators override `LITELLM_BASE_URL` / `LITELLM_VIRTUAL_KEY` to point at their existing internal LiteLLM Proxy (e.g. the one described in `speaches-audio.md`) without any code changes — LiteLLM is itself the abstraction layer.

It is built to enterprise standards for **1000 concurrent active users** in one installation: HA Postgres with row-level multi-tenancy, horizontal autoscaling, BullMQ workers, anti-abuse rate limiting, full observability, and reproducible deploys via docker-compose (single-host self-host) and Helm (Kubernetes cloud).

## Core Value

**A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.** Every other goal (multi-tenancy, observability, OSS docs, UI-SPEC) exists to serve this one outcome.

## Requirements

### Validated

(None yet — ship to validate)

### Active

#### Wire compatibility (per upstream `BACKEND_SPEC.md`)

The corporate-internal v1 install does not exercise Stripe / referrals / billing, so those endpoints are deferred to v2 — the upstream spec itself classifies them as "Operational / quota endpoints (recommended)" with stub-as-503 explicitly acceptable for first-launch testing.

##### Auth lifecycle (must implement)
- [ ] **WIRE-01**: `POST /api/check-user` — pre-auth, returns `{exists}` at 200; non-2xx routes desktop to sign-up branch
- [ ] **WIRE-02**: `GET /api/auth/verification-status?email=...` — cookie-auth, 5s polling cadence carve-out from rate limiter, 200+`{verified:bool}`, 4xx surfaces "session expired"
- [ ] **WIRE-03**: `DELETE /api/auth/delete-account` — cookie-auth, 2xx clears local token+cookie+session

##### Operational (v1 must implement)
- [ ] **WIRE-04**: `GET /api/health` — 3s timeout, body unread, only `res.ok`/`res.status` inspected
- [x] **WIRE-05**: `POST /api/transcribe` — multipart audio; returns `{text, wordsUsed, wordsRemaining, plan, limitReached, sttProvider, sttModel, ...}`; quota math runs but `limitReached` always returns `false` in v1 (no enforcement) — schema is preserved for desktop compatibility
- [x] **WIRE-06**: `POST /api/reason` — cloud LLM via LiteLLM; returns `{text, model, provider, promptMode, matchType}`
- [x] **WIRE-07**: `POST /api/agent/stream` — `application/x-ndjson`, **flush per line**, no buffering anywhere in the chain (validated Phase 4: e2e first-line 8.27ms < 500ms; D-05 buffering negative-control trio GREEN)
- [ ] **WIRE-08**: `POST /api/agent/web-search` — server-side search tool for the agent
- [ ] **WIRE-09**: `POST /api/streaming-usage` — accept-and-record streaming session usage
- [ ] **WIRE-10**: `GET /api/usage` — observed usage stats; v1 always reports unlimited plan
- [ ] **WIRE-11**: `GET /api/stt-config` — server-side STT provider/model selection per tenant/user
- [ ] **WIRE-12**: `GET /api/note-recording-config` — note-recording configuration
- [x] **WIRE-13**: `POST /api/streaming-token` — mints AssemblyAI streaming token from server-held key (only if AssemblyAI configured; otherwise 503) (validated Phase 4)
- [x] **WIRE-14**: `POST /api/deepgram-streaming-token` — Deepgram streaming token (gated same way) (validated Phase 4)
- [x] **WIRE-15**: `POST /api/openai-realtime-token` — OpenAI Realtime token, parallel-mint streams=2 returns clientSecrets[] (validated Phase 4)
- [ ] **WIRE-16**: Generic passthrough channel `cloud-api-request` — any `/api/<path>` proxied with global error envelope

##### Wire conventions (apply to every endpoint)
- [ ] **WIRE-17**: Honor global error envelope `{ "error": "<human-readable string>" }` for every non-2xx
- [ ] **WIRE-18**: Return HTTP **401** (not 200-with-error) on invalid/expired tokens — `withSessionRefresh()` retry path depends on this
- [ ] **WIRE-19**: Accept `Authorization: Bearer <opaque>` AND session cookies on every authenticated endpoint (main process attaches both; renderer-direct endpoints rely on cookie alone)
- [ ] **WIRE-20**: HTTPS-only on every externally reachable port

#### Authentication & OAuth
- [ ] **AUTH-01**: Host `${AUTH_URL}/api/desktop-signin/{provider}` shim that initiates upstream IdP round-trip
- [ ] **AUTH-02**: Final OAuth redirect emits `${PROTOCOL}://?bearer_token=<token>` echoing the **exact** scheme received in the `callbackURL` query parameter (production / `openwhispr-dev` / `openwhispr-staging` / arbitrary override)
- [ ] **AUTH-03**: Issue opaque bearer tokens (≥30 days), with rotation via `set-auth-token` response header on Better-Auth-style endpoints; new and old tokens overlap ≥5 minutes
- [ ] **AUTH-04**: Email/password sign-in via Better Auth — first-class, works without any external IdP configured
- [ ] **AUTH-05**: OIDC pluggable adapter via Better Auth's OAuth-Provider plugin — covers Google Workspace / Azure AD / Okta / generic OIDC with one configuration block per provider
- [ ] **AUTH-06**: `x-openwhispr-source: desktop` header is preserved/observable for feature flagging
- [ ] **AUTH-07**: Open IdP scope — IdP is the gatekeeper; no server-side allowlist. Once signed in, the user is automatically a corporate user (no plan/tier distinctions in v1)

#### Multi-tenancy & Data
- [ ] **DATA-01**: PostgreSQL 17+ schema with row-level security; `app.tenant_id` GUC set via `SET LOCAL` inside every request transaction (PgBouncer transaction-mode safe)
- [ ] **DATA-02**: Forward-only Drizzle migrations; CI verifies forward apply + rollback on real Postgres on every change to `migrations/`
- [x] **DATA-03**: Usage ledger (transcribe minutes, reason tokens, streaming minutes); idempotent on `request_id`; **observability only — no enforcement** in v1
- [ ] **DATA-04**: Audit log for auth events, account deletion, key issuance, provider config changes, admin actions
- [ ] **DATA-05**: At-rest encryption for sensitive columns (bearer tokens, LiteLLM virtual keys, third-party API keys) via KEK/DEK pattern; KEK from env / Vault / KMS adapter
- [ ] **DATA-06**: Tenants table — single "default" tenant created on first migration; multi-tenant model retained for future per-org installs but enterprise installs run on the default tenant
- [ ] **DATA-07**: Backup-and-restore tooling — `make backup` produces an encrypted dump; `make restore` is one-command; both run in CI

#### Default backend: bundled LiteLLM with open-source models
- [x] **LITELLM-01**: Bundle LiteLLM Proxy ≥ v1.83.7-stable in the default `docker-compose.yml` (multipart-passthrough fix native — no patches shipped)
- [x] **LITELLM-02**: Default LiteLLM config wires to **open-source models** out of the box: Whisper (`Systran/faster-whisper-large-v3` or equivalent) for transcriptions, pyannote (`pyannote/speaker-diarization-3.1`) for diarization (HF token required at first run), Speaches-compatible open image for `WSS /v1/realtime`
- [x] **LITELLM-03**: Implement support for the three audio routes the desktop calls via LiteLLM: `POST /v1/audio/transcriptions` (Whisper), `POST /v1/audio/diarization` (pyannote pass-through), `WSS /v1/realtime` (realtime mode); 3600s ingress read/send timeouts on the realtime route
- [x] **LITELLM-04**: Mint per-user LiteLLM virtual keys via the LiteLLM `/key/generate` API (alias `user-<userId>` for traceability; **no per-user budget caps in v1** — corporate users are unlimited)
- [x] **LITELLM-05**: Override path documented: corporate operators set `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` (or admin master key for minting) to point at their existing internal LiteLLM Proxy (the shape described in `speaches-audio.md`) and the bundled LiteLLM container is disabled — same wire surface either way because LiteLLM is the abstraction
- [x] **LITELLM-06**: Convert `speaches-audio.md` into `docs/litellm-target-spec.md` — describes both the bundled-default LiteLLM config and the corporate-override LiteLLM config (model definitions, virtual-key auth, `pass_through_endpoints` for diarization, realtime mode, ingress timeouts)
- [x] **LITELLM-07**: Ingest LiteLLM spend logs into the platform usage ledger as observability; pass-through endpoints (diarization) are not metered by LiteLLM natively — surface only what LiteLLM gives us, no nginx-log scraping in v1

#### Provider abstraction (lightweight)
- [x] **PROVIDER-01**: All STT/LLM/Realtime providers route through the configured **single LiteLLM endpoint** (bundled or operator-supplied). LiteLLM is the abstraction; we do not implement a parallel multi-LLM provider layer
- [ ] **PROVIDER-02**: Storage provider interface: S3-compatible default (MinIO bundled in compose; any S3 / GCS / Azure Blob via env)
- [ ] **PROVIDER-03**: Identity provider interface: Better Auth's OAuth-Provider plugin handles OIDC; email+password is built-in; SAML deferred to v2
- [ ] **PROVIDER-04**: Email provider interface: SMTP only in v1 (verification + admin notifications)

#### Enterprise scale (1000 concurrent active users)
- [ ] **SCALE-01**: API tier fully stateless; sessions in Postgres; cache state in Redis/Valkey
- [ ] **SCALE-02**: PgBouncer transaction-mode in front of Postgres; sized for 1000 concurrent (server-pool 100 × 4 instances)
- [ ] **SCALE-03**: BullMQ on Redis/Valkey for background jobs (audit-log fanout, email delivery, usage rollups, virtual-key rotation)
- [ ] **SCALE-04**: Anti-abuse rate limiting per-user, per-IP via Redis/Valkey token-bucket (NOT quota — observability ledger has no limits in v1); polling carve-out for `/api/auth/verification-status`
- [x] **SCALE-05**: Streaming endpoints (NDJSON, WSS) survive ingress timeouts up to 1h; nginx `proxy_buffering off` + `X-Accel-Buffering: no`; per-line `res.flush()` in NDJSON (validated Phase 4 hermetic: dedicated Traefik :8443 entrypoint with idleTimeout 3600s, 5-min soak p95 14ms, 0 ingress closes; 65-min live arm gated to nightly cron — surfaced via 04-HUMAN-UAT.md)
- [ ] **SCALE-06**: Load test (k6) demonstrates 1000 concurrent active users (mixed transcribe + reason + stream + WSS) at p95 SLO; runs nightly in CI against an ephemeral environment
- [ ] **SCALE-07**: File-descriptor limits raised to 65535 on API + ingress containers; documented sizing matrix per topology

#### Observability
- [ ] **OBS-01**: OpenTelemetry SDK auto-instrumentation for Fastify, undici, pg, ioredis; spans cover API → LiteLLM end-to-end with correlation IDs
- [ ] **OBS-02**: Prometheus metrics exposed via OTel Collector; default Grafana dashboards shipped for RED + saturation, per-tenant usage, LiteLLM spend
- [ ] **OBS-03**: Structured JSON logging to Loki via OTel Collector; bearer tokens scrubbed; correlation IDs propagated; English-only log keys
- [ ] **OBS-04**: LiteLLM spend logs piped into the platform usage ledger; reconciled against per-request ledger entries; discrepancy alerts
- [ ] **OBS-05**: Liveness, readiness, and startup probes — readiness fails when Postgres / Redis / LiteLLM unhealthy

#### Frontend (UI-SPEC only — implementation in v2)
- [ ] **UI-SPEC-01**: `UI-SPEC.md` for **Operator/Admin Console**: tenants list, tenant detail (members, IdP config, LiteLLM endpoint config, observed usage), users list, virtual-key management, audit log, observability deep-links
- [ ] **UI-SPEC-02**: `UI-SPEC.md` for **End-User Self-Service**: profile, observed usage breakdown, account deletion (mirroring desktop-client surface)
- [ ] **UI-SPEC-03**: UI-SPEC targets Next.js 15 + React 19 + Tailwind 4 + shadcn/ui v2 + TanStack Query 5; follows accessibility (WCAG 2.2 AA), responsive, light + dark theme; component inventory enumerated; user generates Claude Design from spec, then implements downstream

#### Deployment
- [ ] **DEPLOY-01**: `docker-compose.yml` for single-host self-host: API + Postgres 17 + PgBouncer + Redis/Valkey + bundled LiteLLM + bundled open-source AI models (Whisper / pyannote / faster-whisper) + MinIO + Traefik + OTel Collector + Grafana + Loki + Tempo + Mimir
- [ ] **DEPLOY-02**: Helm chart for Kubernetes: HA Postgres via CloudNativePG 1.29, Traefik 3 ingress (NOT ingress-nginx — retired Mar 2026), HPA, cert-manager hooks, OTel-Collector DaemonSet, GPU node-selector for the bundled AI workers (with documented option to disable bundled AI and point at corporate LiteLLM)
- [ ] **DEPLOY-03**: One-command bootstrap (`make up` or `helm install`); one-command upgrade with safe rollback; refuse to start on default secrets
- [ ] **DEPLOY-04**: Migrations run as a pre-deploy job; safe under rolling deploy; backwards-compatible across one minor version
- [ ] **DEPLOY-05**: First-launch SLO — operator goes from `git clone` to first authenticated `/api/transcribe` against the bundled LiteLLM in **< 5 minutes**; CI test enforces this

#### Engineering discipline (constitutional)
- [ ] **TDD-01**: Strict TDD — tests precede production code on EVERY phase including decimal/insertion phases (X.Y); Yolo-mode does NOT exempt; tests land in the SAME atomic commit as production code; PR template enforces a "tests first" checklist
- [ ] **TDD-01b**: Per-phase coverage floor ≥ 90% on all new/modified code in that phase (above project-wide TEST-COV-01 floor); applies equally to integer and decimal phases; a phase shipping < 90% on its diff REQUIRES a gap-closure phase BEFORE the next phase starts
- [ ] **TDD-02**: Test layers: unit + integration (real Postgres / Redis via testcontainers; LiteLLM mocked at HTTP level via msw or Wiremock — we do not run real LiteLLM in CI) + e2e + contract + load + security + migration + i18n + RLS-property
- [ ] **CI-01**: GitHub Actions CI from day one; workflows in `.github/workflows/`; GitHub-hosted runners (self-hosted only for GPU jobs in v2 if needed)
- [ ] **CI-02**: CI matrix on every PR: lint + typecheck + unit + integration + e2e + contract + license-scan + secrets-scan (gitleaks) + dep-scan (Trivy + Dependabot) + SAST (CodeQL) + container-scan
- [ ] **CI-03**: Branch protection on `main` blocks merge unless required checks are green
- [ ] **CONTRACT-01**: Wire-contract conformance test suite asserts the server matches `BACKEND_SPEC.md` byte-for-byte (status codes, JSON shapes, headers, NDJSON line behavior, channel-scheme echo, `set-auth-token` rotation); runs against any deployed instance via `make contract-test BACKEND_URL=...`
- [ ] **TEST-COV-01**: Coverage gate ≥ 85% lines / ≥ 80% branches on the API tier (excluding generated code); enforced in CI
- [ ] **TEST-MUTATION-01**: Mutation testing (Stryker) on critical modules: auth, multi-tenancy enforcement, virtual-key minting
- [ ] **TEST-LOAD-01**: k6 nightly load test asserts 1000 concurrent at p95 SLO; CI fails on regression
- [ ] **TEST-MIGRATION-01**: Migration tests verify forward apply + rollback on real Postgres in CI on every `migrations/` change
- [ ] **TEST-I18N-01**: i18n completeness test fails CI when a key exists in `en` but is missing in `ru` (or vice versa)
- [ ] **TEST-RLS-01**: RLS property tests assert no cross-tenant read or write paths exist; random tenant pairs, every queryable model
- [ ] **DEVEX-01**: One-command local dev (`make dev`) brings up the full stack with seeded data; `make test` runs the full suite; tested in CI

#### Internationalization
- [ ] **I18N-01**: Runtime user/operator-facing strings (UI copy, email templates, notification text, end-user error messages) use i18next + i18next-icu; **minimum locales: `en` (default), `ru`**; CLDR pluralization (Russian one/few/many handled correctly); `Accept-Language` negotiation for API responses
- [ ] **I18N-02**: Locale resources are operator-overridable via mounted volume / config map without forking

#### OSS / documentation
- [ ] **DOCS-01**: `README.md` with quickstart (compose path) — under 5 minutes to first authenticated `/api/transcribe`
- [ ] **DOCS-02**: `docs/architecture.md` — component decomposition, request lifecycle for the three hot paths, mermaid diagrams
- [ ] **DOCS-03**: `docs/operations.md` — deploy, upgrade, scale, backup, restore, troubleshoot
- [ ] **DOCS-04**: `docs/litellm-target-spec.md` — bundled-default LiteLLM config + corporate-override LiteLLM config (derived from `speaches-audio.md`)
- [ ] **DOCS-05**: `docs/wire-contract.md` — references upstream `BACKEND_SPEC.md` + `OAUTH_SPEC.md`; documents which endpoints are deferred to v2 (Stripe / referrals)
- [ ] **DOCS-06**: `docs/auth.md` — how to plug in OIDC providers; how to configure email+password; channel-scheme handling
- [ ] **DOCS-07**: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, OSS LICENSE (Apache-2.0 default), license headers
- [ ] **DOCS-08**: ADRs for every Key Decision in this document
- [ ] **DOCS-09**: All source artifacts (docs, code, comments, commit messages, identifiers, log keys) in **English only** — hard rule

### Out of Scope (v1 — deferred to v2)

- **Stripe / billing / plans** — `POST /api/stripe/{checkout,portal,switch-plan,preview-switch}`. Upstream spec marks these as "Operational / quota endpoints (recommended)" with stub-as-503 acceptable. Corporate-internal v1 has no need.
- **Referrals** — `GET /api/referrals/stats`, `POST /api/referrals/invite`, `GET /api/referrals/invites`. Same classification as Stripe.
- **Per-user quota enforcement / `limitReached: true` returns** — schema preserved (always `false`); enforcement is v2 work.
- **Custom multi-LLM provider abstraction layer beyond LiteLLM** — LiteLLM is itself the abstraction; reimplementing is yak-shaving.
- **SAML 2.0 / SCIM provisioning** — OIDC covers Google Workspace / Azure AD / Okta in v1.
- **Magic-link / passwordless email** — defer to v2.
- **BYOK third-party AI keys called from the desktop directly** — server has no role; if operator wants direct providers, they configure them in their LiteLLM.
- **Google Calendar OAuth** — desktop talks to Google directly with embedded Desktop OAuth client.
- **Hidden / undocumented OpenWhispr endpoints** — wire surface is exactly what the upstream spec enumerates.
- **The actual frontend implementation** — v1 ships UI-SPEC only.
- **Live runtime trace validation tooling** — replaced by the conformance test suite.
- **OpenAPI / JSON-Schema generation** — defer to v2.
- **Reference desktop client modifications** — we are wire-compatible by design.
- **Locales beyond `en` + `ru` in v1** — establish framework first, expand later.
- **Plaintext HTTP** — desktop never strips the URL scheme.

## Context

- **Upstream client repo**: `/Users/nick/openwhispr` — Electron desktop app with BYOK third-party AI and Better Auth client.
- **Authoritative wire spec**: `/Users/nick/openwhispr/docs/SELF_HOSTING.md`, `BACKEND_SPEC.md`, `OAUTH_SPEC.md` (1556 lines). v1 implements the auth lifecycle + operational endpoints; defers the recommended-but-not-required Stripe/referrals to v2.
- **LiteLLM target reference**: `/Users/nick/openwhispr-server/speaches-audio.md` — describes a real corporate LiteLLM deployment (Alfaleasing's `aimodels.inner.alfaleasing.ru`). Three audio routes (Whisper, pyannote pass-through, Speaches Realtime), one virtual key. We connect to such a deployment via env override; the OSS quickstart runs an equivalent topology with open-source models.
- **Deployment paths**: docker-compose on a single VM (OSS quickstart, includes bundled LiteLLM) or Helm on K8s (cloud, optionally points at external LiteLLM).
- **Multi-tenant data model**: even single-org installs use a single "default" tenant; keeps the data model uniform and unlocks future per-org installs without rewrite.

## Constraints

- **Tech stack (server)**: Node.js 24 LTS + Fastify 5 + TypeScript + Better Auth + Drizzle + Postgres 17 + PgBouncer + Redis/Valkey + BullMQ — boring, well-staffed, multi-arch (amd64+arm64).
- **Tech stack (frontend)**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui v2 — UI-SPEC target only in v1.
- **Database**: PostgreSQL 17+ — non-negotiable.
- **AI plane**: bundled LiteLLM ≥ v1.83.7-stable in default compose with open-source models; corporate operators env-override to point at their internal LiteLLM.
- **Wire compatibility**: every endpoint we serve matches `BACKEND_SPEC.md` byte-for-byte (JSON shapes, status codes, error envelope, NDJSON streaming, channel-scheme echo, `set-auth-token` rotation).
- **HTTPS only**: never plaintext HTTP on any externally reachable port.
- **Concurrency**: 1000 active concurrent users single installation, p95 latency budgets validated by load test.
- **Source-artifact language**: **English only** for docs, code, comments, commit messages, identifiers, log keys — hard rule.
- **Runtime localization**: `en` + `ru` minimum from day one for UI copy, emails, end-user error messages.
- **Engineering discipline (constitutional)**:
  - **Strict TDD** — tests precede production code on EVERY phase, including decimal/insertion phases (X.Y). Yolo-mode does NOT exempt from TDD. Each fix lands with its tests in the SAME atomic commit.
  - **Per-phase coverage floor ≥ 90%** on all new/modified code in that phase (above the project-wide 85/80/80/85 vitest floor). Applies equally to integer phases and decimal/insertion phases. A phase that ships < 90% on its diff REQUIRES a gap-closure phase BEFORE the next phase starts.
  - **GitHub Actions** is the only sanctioned CI; workflows in `.github/workflows/` from the first commit of phase 0.
  - **Maximum test automation** — no human QA; coverage spans unit, integration (real services via testcontainers), e2e, contract (against `BACKEND_SPEC.md`), load (1000 concurrent), security (SAST + deps + container + secrets + license), migration safety, i18n completeness, RLS-isolation property tests.
- **Open source**: every requirement ships with corresponding documentation; no closed/internal subsystems.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Wire-compatible with upstream `BACKEND_SPEC.md` | Desktop client is the canonical "user"; deviations break it transparently | — Pending |
| v1 implements auth lifecycle + operational endpoints; defers Stripe/referrals to v2 | Upstream spec itself classifies them as "recommended" with stub-as-503 acceptable; corporate-internal install has no use | — Pending |
| Bundle LiteLLM ≥1.83.7 with open-source models in default compose; allow env override to corporate LiteLLM | OSS quickstart works out of the box; corporate operators get one-flag override path; LiteLLM is itself the abstraction | — Pending |
| Usage ledger is observability-only (no enforcement / `limitReached` always false) in v1 | Corporate users are unlimited; ledger still drives ops/finance dashboards | — Pending |
| Single-LiteLLM-endpoint provider model — no parallel multi-LLM abstraction | LiteLLM solves this; reimplementing is yak-shaving | — Pending |
| UI-SPEC over UI-implementation in v1 | User generates Claude Design from spec; implementation in v2 | — Pending |
| Stack: Node 24 + Fastify 5 + Better Auth + Drizzle + Postgres 17 + PgBouncer + Valkey + BullMQ | Better Auth wire shape already matches the desktop; Fastify 5 NDJSON line-flush + WSS proxy + Better Auth integration are first-class; Drizzle works with PgBouncer transaction-mode where Prisma struggles | — Pending |
| Multi-tenancy retained, single "default" tenant in v1 | Cheap to keep; gives per-org install path without rewrite | — Pending |
| Email+password is first-class, not a hidden dev mode | Corporate fallback access; no reason to hide it | — Pending |
| OIDC pluggable via Better Auth OAuth-Provider plugin | Covers Google Workspace / Azure AD / Okta / generic OIDC | — Pending |
| Open IdP scope (no server-side allowlist) | The IdP is the gatekeeper; duplicating the allowlist makes config hard | — Pending |
| All docs/code in English only | Mixed-language artifacts confuse contributors and tooling | — Pending |
| Open-source from day one | OSS-grade docs and licensing decisions easier upfront than retrofit | — Pending |
| Strict TDD constitutional | No QA testers; correctness must be CI-gated; TDD keeps the contract test suite honest | — Pending |
| GitHub Actions as the only CI | Operator audience already uses GitHub; reproducible on hosted runners | — Pending |
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
*Last updated: 2026-05-11 after Phase 4 (Streaming + Realtime) — WIRE-07/13/14/15, SCALE-05 validated. NDJSON first-line via e2e: 8.27ms (budget 500ms). Hermetic Traefik :8443 5-min soak: 0 ingress closes, p95 14ms (budget 1000ms). 65-min live OpenAI Realtime soak gated to nightly cron + tag (never on PR) — surfaced via 04-HUMAN-UAT.md.*

*Last updated: 2026-05-10 after Phase 3 (LiteLLM Integration + Bundled OSS Models) — WIRE-05/06, LITELLM-01..07, PROVIDER-01, DATA-03 validated. Two user-ratified overrides: LITELLM-02 cloud-provider pivot (memory `feedback_no_bundled_local_models`); LITELLM-04 per-user attribution via OpenAI `user` body parameter (D-03) instead of `/key/generate`.*
