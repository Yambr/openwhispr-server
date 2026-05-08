# Feature Research

**Domain:** Open-source, enterprise self-hosted AI backend (wire-compatible OpenWhispr cloud — auth + transcription + reasoning + agent streaming + billing) targeting 1000 concurrent users with LiteLLM Proxy + Speaches as the default AI plane.
**Researched:** 2026-05-08
**Confidence:** HIGH for wire-required features (sourced directly from `BACKEND_SPEC.md` / `OAUTH_SPEC.md` / `SELF_HOSTING.md` / `speaches-audio.md`); MEDIUM for OSS-self-host ecosystem norms (cross-referenced against widely-deployed projects in adjacent space — LiteLLM Proxy, Authentik, Zitadel, Keycloak, Supabase Self-Hosted, OpenWebUI, Langfuse, n8n, Plausible).

---

## Reading Conventions

Two orthogonal classifications attach to every feature row:

- **Wire-required vs Platform-level.** *Wire-required* means the upstream desktop client at `/Users/nick/openwhispr` will misbehave (or fail outright) without it; the contract is in `BACKEND_SPEC.md` / `OAUTH_SPEC.md` / `SELF_HOSTING.md`. *Platform-level* means the desktop client never observes it, but no operator will deploy a multi-tenant production server that lacks it (multi-tenancy, audit, observability, backups, admin console, etc.).
- **Complexity (XS / S / M / L / XL).** XS = ≤ 1 dev-day. S = 2-5 dev-days. M = 1-3 dev-weeks. L = 1-2 dev-months. XL = a quarter or more. Calibrated for a small (1-3 person) team building on top of an off-the-shelf web framework + Postgres.

---

## Feature Landscape

### Table Stakes (Operators Won't Deploy Without These)

These split into four sub-bands by where the requirement comes from. Anything labeled **wire** is non-negotiable to satisfy `BACKEND_SPEC.md`. Anything labeled **platform** is non-negotiable to satisfy enterprise self-host expectations as established by adjacent OSS projects (Supabase, Authentik, Langfuse, LiteLLM Proxy itself).

#### A. Wire-required (desktop client breaks without these)

| # | Feature | Why Required | Complexity | Source |
|---|---------|--------------|------------|--------|
| TS-W-01 | `POST /api/check-user` (pre-auth email existence probe) | Onboarding decides sign-in vs. sign-up branch from this; missing → all new users routed to sign-up incorrectly | XS | `BACKEND_SPEC.md` § `POST /api/check-user`; `SELF_HOSTING.md` § Auth lifecycle |
| TS-W-02 | `GET /api/auth/verification-status` (5s polling, cookie-auth) | Sign-up flow blocks on email-verification poll; client polls every 5000 ms — server MUST tolerate cadence and MUST return 401/400 (not 200-with-error) on session loss | XS | `BACKEND_SPEC.md` § `GET /api/auth/verification-status` |
| TS-W-03 | `DELETE /api/auth/delete-account` (cookie-auth, 2xx body ignored) | GDPR/CCPA + settings panel delete; client only checks `res.ok` | XS | `BACKEND_SPEC.md` § `DELETE /api/auth/delete-account` |
| TS-W-04 | OAuth shim `GET /api/desktop-signin/{provider}` initiating IdP round-trip | Whole social-sign-in flow funnels through this; desktop never embeds upstream client IDs | M | `OAUTH_SPEC.md` § OpenWhispr Cloud Sign-In (steps 3-6); `SELF_HOSTING.md` § OAuth Flow Walkthrough |
| TS-W-05 | Final redirect to `${PROTOCOL}://?bearer_token=<token>` echoing the **exact** scheme from `callbackURL` (production / `-dev` / `-staging` / arbitrary override) | Wrong scheme → OS dispatches the URL to the wrong app or nothing; this is the #1 integration trap for self-hosters | S | `OAUTH_SPEC.md` § Custom Protocol Reference; `BACKEND_SPEC.md` § Custom Protocol Redirect |
| TS-W-06 | Opaque bearer token long-lived OR rotation via `set-auth-token` response header | Token written to disk, reused across launches; no client-initiated `POST /token` refresh exists | S | `SELF_HOSTING.md` § Token storage / refresh; `OAUTH_SPEC.md` § Refresh trigger |
| TS-W-07 | HTTP 401 (not 200-with-error) on auth failure to trigger `withSessionRefresh()` retry-once-with-backoff | Renderer silently downgrades 200-with-error to "success with empty body" → infinite "verifying…" UX bug | XS | `BACKEND_SPEC.md` § Global Error Envelope row 401 |
| TS-W-08 | Global error envelope `{ "error": "<string>" }` (and `{ "error": { "message": ..., "code": ... } }` tolerated for `cloud-api-request`) | Client surfaces the string verbatim to the user; absent → user sees "API error: 502" instead of a localized message | XS | `BACKEND_SPEC.md` § Global Error Envelope |
| TS-W-09 | Accept `Authorization: Bearer <opaque>` AND session cookies interchangeably on every authenticated endpoint | Main process attaches both; renderer-direct calls send only cookies; rejecting either path breaks one or the other | S | `BACKEND_SPEC.md` § Conventions § Auth header |
| TS-W-10 | `POST /api/transcribe` multipart upload returning `{text, wordsUsed, wordsRemaining, plan, limitReached, sttProvider, sttModel, …}` with quota exhaustion at HTTP 200 + `limitReached: true` (NOT 4xx) | The single most common deviation that breaks integrators; client surfaces quota UI only on `limitReached: true`, never on 4xx | M | `BACKEND_SPEC.md` § `POST /api/transcribe`; `SELF_HOSTING.md` § Edge Cases |
| TS-W-11 | `POST /api/reason` returning `{text, model, provider, promptMode, matchType}` | Cloud LLM cleanup; the `openwhispr` inference provider in the desktop client | M | `BACKEND_SPEC.md` § `POST /api/reason` |
| TS-W-12 | `POST /api/agent/stream` NDJSON streaming, **flush per line**, no buffering | Agent overlay; buffered responses freeze the UI until stream end | M | `BACKEND_SPEC.md` § `POST /api/agent/stream`; `SELF_HOSTING.md` § Edge Cases (NDJSON) |
| TS-W-13 | `POST /api/agent/web-search` returning `{results: [{title, url, snippet}]}` | Agent web-search tool | S | `BACKEND_SPEC.md` § `POST /api/agent/web-search` |
| TS-W-14 | `POST /api/streaming-usage`, `GET /api/usage`, `GET /api/stt-config`, `GET /api/note-recording-config` | Settings UI quota display + STT config bootstrap | S | `BACKEND_SPEC.md` corresponding cards |
| TS-W-15 | `POST /api/streaming-token`, `POST /api/deepgram-streaming-token`, `POST /api/openai-realtime-token` (mints short-lived realtime tokens — server holds master keys) | Realtime streaming providers; `streams=2` for OpenAI realtime returns `clientSecrets[]` | M | `BACKEND_SPEC.md` § realtime token cards |
| TS-W-16 | Stripe lifecycle: `POST /api/stripe/{checkout,portal,switch-plan,preview-switch}` | Plan upgrade flow; if the platform supports billing at all, client expects all four | M | `BACKEND_SPEC.md` § Stripe cards |
| TS-W-17 | Referrals: `GET /api/referrals/stats`, `POST /api/referrals/invite`, `GET /api/referrals/invites` | Referral panel; throws on non-2xx (pre-`success`-envelope handler) | S | `BACKEND_SPEC.md` § referrals cards |
| TS-W-18 | `GET /api/health` 3-second timeout, body unread, only `res.ok` / `res.status` inspected | Pre-WebSocket fail-fast; missing → streaming code paths hang on connect | XS | `BACKEND_SPEC.md` § `GET /api/health` |
| TS-W-19 | Generic passthrough channel — any `/api/<path>` returns the `{error}` envelope correctly | `cloud-api-request` IPC proxies arbitrary endpoints; new endpoints can be exercised without dedicated handlers | XS | `BACKEND_SPEC.md` § Generic passthrough |
| TS-W-20 | HTTPS-only on every externally reachable port | Client never strips/rewrites scheme; plaintext HTTP unsupported | XS (config) | `SELF_HOSTING.md` § Transport |
| TS-W-21 | Email-verification-status NOT rate-limited under 5s/user cadence | 5000 ms `setInterval` while screen mounted; aggressive limiter → false-negative "session expired" | XS | `SELF_HOSTING.md` § Edge Cases |
| TS-W-22 | Streaming endpoints survive ingress timeouts up to 1 hour (NDJSON `/api/agent/stream`, WSS `/v1/realtime` upstream) | Speaches realtime ingress at Alfaleasing uses 3600s read/send timeouts | S (config) | `speaches-audio.md` § Realtime; `PROJECT.md` SCALE-05 |

#### B. Platform-level multi-tenancy & data (no operator deploys without these)

| # | Feature | Why Required | Complexity | Notes |
|---|---------|--------------|------------|-------|
| TS-P-01 | Multi-tenancy with row-level tenant isolation | Every enterprise self-host install eventually adds a second org; retrofitting tenant_id is an L-sized rewrite | M | Even single-org installs use a `default` tenant; uniform data model |
| TS-P-02 | Pluggable identity: OIDC, SAML (basic), Google, Microsoft, Apple, GitHub, email/password, magic link — at least 2 in v1, others extensible | OAUTH_SPEC.md only documents Google/Microsoft/Apple, but enterprise self-host operators require either (a) bring-your-own OIDC for org SSO, or (b) bundled IdP (Authentik / Zitadel / Keycloak) | L | Recommend: defer SSO portal to bundled IdP; expose generic OIDC connector as the platform primitive |
| TS-P-03 | Pluggable LLM provider: LiteLLM-routed default + direct OpenAI / Anthropic / Gemini / Mistral / Bedrock / Azure OpenAI / Vertex | Operators with existing LLM gateway contracts (e.g., Alfaleasing's LiteLLM at `aimodels.inner.alfaleasing.ru`) won't double-pay through a re-wrap | M | Per-tenant override critical (see DIFF-01) |
| TS-P-04 | Pluggable STT provider: LiteLLM/Speaches default + AssemblyAI / Deepgram / OpenAI Whisper / Groq | Whisper hosting is the most contentious cost-center decision; operators self-select | M | Realtime providers split: Speaches Realtime (default), OpenAI Realtime, AssemblyAI streaming, Deepgram streaming |
| TS-P-05 | Pluggable storage: S3-compatible (MinIO default for self-host; S3 / GCS / Azure Blob for cloud) | Audio files, exports, backups; cloud-vendor diversity requires abstraction | S | Single S3-compatible client + bucket-prefix tenancy |
| TS-P-06 | Pluggable email: SMTP default + SES / SendGrid / Postmark | Verification emails + referral invites; on-prem installs need SMTP-only; SaaS-style installs prefer transactional API | S | |
| TS-P-07 | Pluggable billing: Stripe (default, optional) + null/disabled | Licensed enterprise installs have site licenses, no Stripe; SaaS-flavored installs need full Stripe | S | Null adapter must implement all 4 Stripe endpoints with deterministic 200/`{disabled: true}` responses so wire-contract still holds |
| TS-P-08 | Per-tenant quotas, rate-limits, plans (transcribe minutes, reason tokens, streaming minutes) | Without this an abusive user takes down the install for everyone | M | Token bucket via Redis; tied to LiteLLM virtual-key budgets so the AI plane and the platform agree |
| TS-P-09 | Usage ledger tied to LiteLLM spend logs | Required to bill Stripe and to surface `wordsUsed/wordsRemaining` in `/api/usage` | M | LiteLLM's spend logs are the single source of truth on the AI plane; the platform mirrors+aggregates per tenant |
| TS-P-10 | Audit log: auth events, account deletion, key issuance, quota changes, provider config changes | Compliance review is the first question every enterprise security team asks before deploy | S | Append-only Postgres table; SIEM export deferred to v2 |
| TS-P-11 | Backup / restore tooling (Postgres + MinIO + LiteLLM config) | First disaster makes this a P0 retroactively; ship from day 1 | S | `pg_dump` / `pg_basebackup` + `mc mirror` recipes documented in `docs/operations.md` |
| TS-P-12 | Health / readiness / liveness probes (separate endpoints for K8s) | `/api/health` is wire-required for the desktop, but K8s wants `/healthz`, `/readyz`, `/livez` distinguishable; readiness MUST gate on Postgres + Redis + LiteLLM reachability | XS | |
| TS-P-13 | OpenTelemetry tracing (API → LiteLLM → Speaches), Prometheus metrics (RED + saturation), structured JSON logs with correlation IDs | "Why is it slow?" is unanswerable without traces in a multi-hop AI stack | M | LiteLLM's spend log piping into the platform's usage ledger satisfies OBS-04 |
| TS-P-14 | i18n: `en` + `ru` minimum for UI copy, email templates, notification text, end-user-visible error messages; `Accept-Language` negotiation on API responses | Hard project rule from PROJECT.md (I18N-01); source artifacts stay English-only (DOCS-09) | S | Provider-pluggable: built-in resources in repo, operator overlays without forking |
| TS-P-15 | Database migrations safe under rolling deploy (forward-only, two-phase: expand-then-contract) | One downtime upgrade and the operator's confidence in OSS self-host is gone | M | |
| TS-P-16 | Secrets management: env, file, Vault, Kubernetes secrets | Defaults of `OPENAI_API_KEY` env var are fine for compose; K8s deploys MUST integrate `Secret` mounts; high-end deploys MUST Vault | S | Single secret-resolver abstraction with backends |
| TS-P-17 | Connection pooling (PgBouncer or equivalent) sized for 1000 concurrent | Postgres can't take 1000 raw connections; PgBouncer transaction-mode standard | XS (config) | |
| TS-P-18 | Background job queue (transcription orchestration, webhook fanout, email delivery, usage roll-up) | NDJSON streams + multipart uploads need durable retry; SMTP must not block API; email-verification mail can't lose | M | Redis-backed (BullMQ / Celery / River / Asynq depending on stack) |
| TS-P-19 | Stateless API tier (no in-memory session state) | Required for horizontal autoscale to 1000 concurrent | S | Bearer tokens validated server-side; sessions in Postgres or Redis |
| TS-P-20 | Per-key, per-tenant, per-IP rate limiting (Redis token bucket) | Wire 401s aren't enough — abusive clients need 429s; verification-status cadence carve-out (TS-W-21) overrides | S | |

#### C. Operator-experience (admin / docs / deploy)

| # | Feature | Why Required | Complexity | Notes |
|---|---------|--------------|------------|-------|
| TS-O-01 | Admin console: manage tenants / users / API keys / quotas / providers / view audit log + observability links + billing | Every operator who deploys this asks "where do I click to add a tenant" within 10 minutes; if the answer is "edit YAML and restart" they leave | L (UI-SPEC only in v1; downstream user implements) | UI-SPEC.md is the v1 deliverable per PROJECT.md UI-01 |
| TS-O-02 | End-user self-service: profile / plan / usage / referrals / account-deletion mirroring desktop surfaces | Mirrors the desktop client's settings panel; users expect to manage their account in a browser | L (UI-SPEC only in v1) | UI-SPEC.md per UI-02 |
| TS-O-03 | One-command `docker-compose up` bootstrap → first authenticated `/api/transcribe` in < 5 minutes | Quickstart-time is the OSS-adoption metric; > 15 min and the project dies in obscurity | M | Bundles API + Postgres + Redis + LiteLLM + Speaches + MinIO + nginx + observability stack |
| TS-O-04 | Helm chart for Kubernetes (HA Postgres operator, autoscaling, ingress, cert-manager hooks) | Compose path is for evaluators; production self-host is K8s | L | |
| TS-O-05 | One-command upgrade (`docker compose pull && up -d` / `helm upgrade`) with safe rollback | Upgrade fear is the #1 reason OSS self-hosts go stale | M | Pairs with TS-P-15 (rolling-deploy-safe migrations) |
| TS-O-06 | Documentation suite: README quickstart, architecture, operations, providers, wire contract, ADRs (DOCS-01..09 from PROJECT.md) | Every requirement ships with docs — hard project rule | M | All docs/code in English only |

---

### Differentiators (Compete on These — v1 if Cheap, v1.5 Otherwise)

These are the features that distinguish a credible enterprise OSS AI backend from a hobby project. Most are cheap-but-thoughtful, not technically hard. They cluster around (1) flexibility per-tenant, (2) safety-by-default, and (3) operator-trust amplifiers.

| # | Feature | Value Proposition | Complexity | v1 / v1.5 | Notes |
|---|---------|-------------------|------------|-----------|-------|
| DIFF-01 | **Per-tenant provider override** — Tenant A uses LiteLLM, Tenant B uses Bedrock-direct, Tenant C uses Azure OpenAI; same wire surface, different upstream routes | Lets enterprise operators sell "your data stays in your AWS account" while running OpenWhispr Server centrally — table-stakes for multi-region MSPs but rarely shipped in OSS AI backends | M | v1 | Builds on TS-P-03/04; the abstraction has to exist for table stakes — the differentiator is making it tenant-scoped, not just install-scoped |
| DIFF-02 | **Org-key tenancy mode** — server holds the AI keys, end-users don't BYOK; vs. user-BYOK passthrough mode where users supply their own keys and the server only meters | The OpenWhispr desktop's BYOK model is user-friendly but org-hostile (every user pays a separate OpenAI bill); org-key mode flips it. Few OSS AI backends ship both modes | M | v1 | Surfaces as a tenant-config flag; routing logic differs only at the LiteLLM virtual-key issuance step |
| DIFF-03 | **Sandbox / test tenant** for operators — pre-seeded tenant with synthetic users, fixture audio, deterministic LLM responses (mock provider), so operators can exercise the wire surface without burning quota on a real AI provider | Cuts evaluation time from "set up an OpenAI key" (15 min, requires credit card) to "open the included tenant" (10 sec) — direct lever on adoption | S | v1 | Mock provider sits behind the same provider abstraction; just another adapter |
| DIFF-04 | **Cost dashboards per-tenant / per-user** (transcribe minutes × $/min, reason tokens × $/Mtoken, broken down by provider, plotted weekly) | LiteLLM has spend logs; the platform aggregates them into operator-readable numbers. The thing every Finance team asks for on day 2 of a deploy | M | v1.5 | Builds on TS-P-09 (usage ledger); admin-console UI work is the bulk |
| DIFF-05 | **PII redaction in transcripts** (configurable per tenant: phone numbers, emails, credit cards, SSNs, custom regex) — applied at ingress before persistence and before LLM forward | Healthcare / finance / EU operators can't deploy without it. Whisper transcripts contain everything the user said. | M | v1.5 | Pluggable redaction layer; default presets per locale (en + ru) |
| DIFF-06 | **Encrypted-at-rest tokens** (KEK / DEK envelope encryption — tenant-scoped DEKs wrapped by an install-scoped KEK held in Vault / KMS / file) | Standard in enterprise products; rare in OSS AI backends. Bearer tokens (TS-W-06), Stripe customer IDs, AI provider keys, OAuth refresh tokens — all want envelope encryption | M | v1 | The KEK abstraction also satisfies the secrets-management story (TS-P-16) |
| DIFF-07 | **Built-in dev mode** — runs without external IdPs, single-binary or `docker compose up`, email+password only, mock email provider that prints verification links to stdout | "I just want to see this work in 60 seconds without configuring Google OAuth" — the path that makes contributors actually try the code | S | v1 | Auto-disabled when `NODE_ENV=production` (or equivalent); blocks signup of any non-`@example.com` email when on |
| DIFF-08 | **Reproducible local dev environment** — `compose up` exits successfully (all healthchecks green) → first authenticated `/api/transcribe` succeeds in < 5 min on a stock laptop, no manual edits to .env required | The README quickstart promise (TS-O-03) — but elevated to a CI-tested invariant. Differentiator because most OSS AI backends silently regress quickstart | S | v1 | E2E test in CI: spin compose, hit `/api/transcribe`, assert 200 |
| DIFF-09 | **Per-tenant locale overrides** for emails / notifications / error strings — operator can ship a custom Russian welcome email without forking the repo | Builds on TS-P-14 (i18n); the differentiator is the override layer (per `I18N-02`) | S | v1 | Locale resource overrides via mounted file or DB row |
| DIFF-10 | **Bundled observability stack** — Grafana dashboards (RED + saturation + LiteLLM spend) shipped in-tree, auto-provisioned by compose / Helm | Operators don't have to build dashboards from scratch; first-week-after-deploy productivity multiplier | S | v1.5 | Pairs with TS-P-13 |
| DIFF-11 | **Gradual-rollout hooks for migrations** — long migrations (backfill tenant_id, recompute usage ledger) ship with `pg_repack`-style chunked-with-progress runners and resume-on-restart | Cuts upgrade fear (TS-O-05) by an order of magnitude on multi-million-row tables | M | v1.5 | Optional; only kicks in for large datasets |
| DIFF-12 | **Wire-contract conformance test suite** — runnable against any deployment, uses the actual desktop client's expected payloads and asserts the global error envelope, NDJSON flushing, `limitReached` quota signaling, custom-protocol scheme echo | Eliminates "does this self-host actually work with the desktop?" guesswork; lets contributors PR backend changes with confidence | M | v1 | Replaces the "live runtime trace validation" deferred from upstream |
| DIFF-13 | **Realtime token brokering for multi-stream** (`POST /api/openai-realtime-token` with `streams=2` returning `clientSecrets[]`) and parallel WSS-passthrough for Speaches Realtime | Wire-required (TS-W-15) but most reference backends only ship `streams=1`. Meeting feature breaks without it | S | v1 | Already in `BACKEND_SPEC.md`; explicit because it's commonly missed |
| DIFF-14 | **Multi-arch images (amd64 + arm64)** for every container in compose / Helm | Apple Silicon developers, AWS Graviton operators — without this you cut your dev audience in half | XS (CI matrix) | v1 | |
| DIFF-15 | **No-GPU API tier** — only Speaches needs CUDA; the API container runs on plain CPU, even at 1000 concurrent | Massive win for self-hosters who want to scale the API stateless tier without GPU cost | XS (architectural — already a constraint in PROJECT.md) | v1 | API tier never invokes a model directly; always proxies to LiteLLM |

---

### Anti-Features (Deliberately NOT Building)

These are the features that look like good ideas, are commonly requested by would-be contributors, and would corrupt the project's scope without delivering proportional value. Each row includes the alternative we *do* support so the rejection is constructive.

| # | Anti-Feature | Why Requested | Why Problematic | Alternative |
|---|--------------|---------------|-----------------|-------------|
| ANTI-01 | **Modifying the desktop client** to suit the server | "Just add an endpoint" / "just change the polling cadence" requests | Fragments the ecosystem — every server fork ends up needing a client fork. The desktop client is the canonical user; server adapts | Wire-compatible only; if the contract is wrong, fix it upstream in `/Users/nick/openwhispr` first, then mirror here |
| ANTI-02 | **Reimplementing third-party AI vendor SDKs** (OpenAI / Anthropic / Gemini / Mistral / Groq / AssemblyAI / Deepgram) inside the server | "Wouldn't it be cleaner to call OpenAI directly from Go?" | LiteLLM Proxy already does this. Maintaining N vendor SDK adapters is a full-time job; LiteLLM has 100+ contributors | LiteLLM Proxy is the AI-plane abstraction; we hold the wire contract + tenancy, LiteLLM holds the providers |
| ANTI-03 | **Google Calendar OAuth proxying** | "We have a server, we should handle GCal too" | Desktop talks to Google directly with embedded Desktop OAuth client (`OAUTH_SPEC.md` § Google Calendar). Tokens live client-side in SQLite; server has zero role in the wire contract | Document explicitly in `docs/wire-contract.md`: GCal is out-of-band |
| ANTI-04 | **Hidden / undocumented endpoints** (admin webhooks, internal APIs, Better Auth's full surface) | "Better Auth has 30 endpoints, shouldn't we expose them all?" | Only what the desktop client sends is contract; everything else is an attack surface and a maintenance burden. Wire surface is **client-driven** | Generic passthrough channel (TS-W-19) handles experimental endpoints; promotion to a dedicated handler requires a `BACKEND_SPEC.md` entry first |
| ANTI-05 | **Locales beyond `en` + `ru` in v1** | "We're an OSS project, we should support Spanish / Mandarin / etc." | Locale debt compounds: every new locale forks every email template, every error string, every UI copy block. Two locales is enough to validate the i18n architecture; everything else is community PRs in v1.x | i18n architecture (TS-P-14) supports operator overlays (DIFF-09) — operators can ship private locales without fork |
| ANTI-06 | **Frontend implementation in v1** (admin console, end-user portal) | "It's incomplete without a UI" | UI velocity dwarfs backend velocity; a half-baked UI in v1 freezes the design and consumes the team's bandwidth. UI-SPEC is the v1 deliverable per PROJECT.md UI-01/02 | UI-SPEC.md (component inventory, accessibility, design system) — the user generates the frontend code from it. Concrete UI ships v2 |
| ANTI-07 | **SAML / SCIM provisioning, audit-log SIEM exports, FedRAMP-grade isolation, customer-managed encryption keys (CMEK)** in v1 | Enterprise-plus checklist features | Each one is a quarter of work and only valuable to a small operator slice; better delivered in v2 once core deploys exist to inform the design | Document as v2 in `docs/roadmap.md`; the audit log table (TS-P-10) and KEK abstraction (DIFF-06) are the hooks we leave in place for them |
| ANTI-08 | **Custom IdP UI / self-hosted SSO portal** | "We need a login page!" | Authentik / Zitadel / Keycloak / Ory Kratos do this *much* better than we ever will. Building a custom one is a year of work to be 30% as good | Bundle one in compose (recommend Authentik); generic OIDC connector (TS-P-02) means any IdP works |
| ANTI-09 | **Live runtime trace validation tooling** (capture-and-diff a deployed cloud against the spec) | "How do I know this matches the real OpenWhispr cloud?" | Source is the contract per upstream `BACKEND_SPEC.md` § How to read this doc; runtime trace validation is a v2 workstream | Wire-contract conformance test suite (DIFF-12) — exercises the contract against your deployment, not against the OpenWhispr cloud |
| ANTI-10 | **OpenAPI / JSON-Schema generation** in v1 | "Spec should be machine-readable" | Markdown tables + JSON examples are the v1 deliverable per upstream `BACKEND_SPEC.md` § Out of Scope; OpenAPI generation is a v2 enhancement | Markdown wire spec is canonical; v2 may generate OpenAPI from the existing endpoint cards |
| ANTI-11 | **Reference desktop client modifications (build-time provider gates) on the server side** | "Could the server gate which OAuth providers are visible?" | Per upstream `OAUTH_SPEC.md` § Other Providers Found, the desktop already gates providers via `OPENWHISPR_OAUTH_<P>` build flags; server-side gating is duplicate truth | Server lists which providers it has configured; desktop respects its own build flags. Each side independent |
| ANTI-12 | **Global plaintext-HTTP development mode** | "HTTPS in dev is annoying" | Every plaintext-HTTP code path is a foot-gun that escapes into production. Desktop client never strips the URL scheme — it just won't talk to plaintext | mkcert-based local CA in compose for dev (in `docs/operations.md` quickstart); HTTPS everywhere is a hard rule |
| ANTI-13 | **Real-time admin metrics WebSocket push** | "It would be cool to see usage live in admin" | NDJSON / WSS adds infrastructure complexity (sticky sessions, ingress timeouts) for negligible operator value over a 30-second poll | Admin UI polls `/api/admin/metrics` at 30 s; Grafana dashboards (DIFF-10) handle real-time observation |
| ANTI-14 | **Custom server-side TTS / voice agents** | "We have audio infra already, why not?" | The desktop client doesn't ask for it; adding it is scope creep into a product we're not building | Out of scope; if it ever ships it's a separate companion service, not a wire-contract endpoint |
| ANTI-15 | **Webhook subscriptions for usage / billing events** in v1 | "Standard SaaS feature" | Every webhook system needs delivery retry, signing, dead-lettering, replay UI — easily a quarter of work; not a wire-contract requirement | Stripe webhooks are forwarded for billing only (subset of TS-W-16); generic platform webhooks deferred to v2 |

---

## Feature Dependencies

The dependency graph drives roadmap phase ordering. Anything below a feature must be built first or in the same phase.

```
TS-W-04 OAuth shim
  └── requires ── TS-P-02 Pluggable identity (OIDC / IdP abstraction)
                       └── requires ── TS-P-01 Multi-tenancy (tenant scope on user records)
                                              └── requires ── TS-P-15 Migrations infra

TS-W-05 Custom-protocol redirect (scheme echo)
  └── requires ── TS-W-04 OAuth shim
        └── requires ── TS-W-08 Global error envelope (consistent error path even pre-auth)

TS-W-06 Bearer token rotation (set-auth-token header)
  └── requires ── DIFF-06 Encrypted-at-rest tokens (or platform regrets retrofitting later)

TS-W-10 /api/transcribe
  ├── requires ── TS-P-04 Pluggable STT provider
  │       └── requires ── DIFF-01 Per-tenant provider override (or tenants share STT, painfully)
  ├── requires ── TS-P-08 Per-tenant quotas (limitReached signaling)
  │       └── requires ── TS-P-09 Usage ledger
  │               └── requires ── TS-P-13 Observability (LiteLLM spend log piping = OBS-04)
  ├── requires ── TS-P-05 Pluggable storage (audio chunks for retry / replay)
  └── requires ── TS-P-18 Background job queue (chunked uploads, retries)

TS-W-11 /api/reason
  └── requires ── TS-P-03 Pluggable LLM provider
        └── requires ── DIFF-01 Per-tenant provider override

TS-W-12 /api/agent/stream (NDJSON, flush per line)
  └── requires ── TS-W-11 /api/reason (LLM plumbing)
        └── requires ── TS-P-19 Stateless API tier (sticky / non-buffering ingress)
                └── requires ── TS-W-21 Streaming-survives-1h-ingress-timeout

TS-W-15 Realtime token endpoints
  ├── requires ── TS-P-16 Secrets management (master AssemblyAI / Deepgram / OpenAI keys)
  └── requires ── TS-P-08 Per-tenant quotas (mint policy)

TS-W-16 Stripe lifecycle (4 endpoints)
  └── requires ── TS-P-07 Pluggable billing (null adapter for license-only deploys)
        └── requires ── TS-P-09 Usage ledger (proration math)

TS-W-17 Referrals
  └── requires ── TS-P-06 Pluggable email (invite delivery)
        └── requires ── TS-P-18 Background job queue (delivery retry)

TS-O-01 Admin console (UI-SPEC v1)
  ├── requires ── TS-P-10 Audit log
  ├── requires ── TS-P-13 Observability (links to Grafana)
  ├── requires ── DIFF-04 Cost dashboards (lights up the most-asked screen)
  └── requires ── TS-W-04 OAuth shim (admin authn — recommend separate IdP role)

TS-O-02 End-user self-service (UI-SPEC v1)
  ├── requires ── TS-W-03 /api/auth/delete-account
  ├── requires ── TS-W-14 /api/usage
  ├── requires ── TS-W-16 Stripe lifecycle
  └── requires ── TS-W-17 Referrals

TS-O-03 Compose quickstart < 5 min
  ├── requires ── DIFF-07 Built-in dev mode
  ├── requires ── DIFF-08 Reproducible local dev (CI-enforced)
  └── requires ── TS-W-20 HTTPS-only (mkcert in dev)

TS-O-04 Helm chart
  ├── requires ── TS-P-12 Health/readiness/liveness (separate endpoints)
  ├── requires ── TS-P-15 Rolling-deploy-safe migrations
  └── requires ── TS-O-05 One-command upgrade

DIFF-12 Wire-contract conformance suite
  └── requires ── all of TS-W-01..TS-W-21 (it tests them)
```

### Dependency Notes

- **DIFF-01 (per-tenant provider override) is the load-bearing feature.** It pulls TS-P-03 + TS-P-04 + TS-P-05 + TS-P-07 forward as table-stakes-with-tenant-scope rather than install-scope. Building TS-P-* without per-tenant scope creates an L-sized rewrite when DIFF-01 lands later. Recommendation: design the abstraction tenant-scoped from day 1.
- **DIFF-06 (encrypted-at-rest tokens) and TS-P-16 (secrets management)** share an abstraction (KEK / KMS resolver). Build them together.
- **TS-W-09 (Bearer + cookie interchangeable)** has no upstream dependency but failing to design auth middleware to accept both up-front leads to a per-endpoint sprinkle of try-bearer-then-cookie that gets out of sync.
- **TS-P-18 (background job queue) is in the critical path of three wire-required endpoints** (TS-W-10 transcribe chunking, TS-W-12 agent stream cleanup, TS-W-17 referrals). Treat as P0 platform infra, not a "later" item.
- **DIFF-12 (conformance suite) inverts the dependency direction:** it is the test for everything else. Recommend writing it incrementally as each TS-W-* is implemented — turns conformance into a regression net rather than a final-phase milestone.
- **ANTI-08 (no custom IdP UI) eliminates a large subtree** that would otherwise hang off TS-P-02. Decision should be locked early; if relaxed, +XL of UI/UX work appears.

---

## MVP Definition

### Launch With (v1)

The minimum that lets a self-hoster (a) sign in via the desktop client end-to-end, (b) transcribe, (c) reason, (d) bill, and (e) operate the install over time. Anything outside this list is v1.5+.

#### Wire (mandatory — desktop breaks otherwise)
- [ ] TS-W-01..03 — Auth lifecycle (check-user, verification-status, delete-account)
- [ ] TS-W-04..06 — OAuth shim, custom-protocol redirect (all 3 channel variants), bearer rotation
- [ ] TS-W-07..09 — 401 semantics, error envelope, dual-auth (Bearer + cookie)
- [ ] TS-W-10..14 — Transcribe (with limitReached@200), reason, agent stream (NDJSON flushed), web-search, streaming-usage / usage / stt-config / note-recording-config
- [ ] TS-W-15 — Realtime tokens (3 providers, including streams=2)
- [ ] TS-W-16 — Stripe (4 endpoints; null adapter acceptable for non-billed installs)
- [ ] TS-W-17 — Referrals (3 endpoints)
- [ ] TS-W-18 — `/api/health` (3s timeout, body unread)
- [ ] TS-W-19 — Generic passthrough (`cloud-api-request` envelope)
- [ ] TS-W-20..21 — HTTPS-only, verification-cadence carve-out, 1h-ingress streaming

#### Platform (mandatory — no operator deploys without)
- [ ] TS-P-01 — Multi-tenancy (RLS or app-enforced; tenant_id everywhere from day 1)
- [ ] TS-P-02 — Pluggable identity (generic OIDC + email/password; bundled IdP recommended via compose)
- [ ] TS-P-03..07 — Pluggable LLM / STT / storage / email / billing
- [ ] TS-P-08..09 — Per-tenant quotas + usage ledger (LiteLLM spend log piping)
- [ ] TS-P-10..11 — Audit log + backup/restore tooling
- [ ] TS-P-12..13 — Probes + observability (OTel + Prom + JSON logs)
- [ ] TS-P-14 — i18n with en + ru
- [ ] TS-P-15..16 — Rolling-deploy-safe migrations + secrets management
- [ ] TS-P-17..20 — PgBouncer, job queue, stateless API, rate limiting

#### Operator experience (mandatory)
- [ ] TS-O-01..02 — Admin + end-user UI-SPECs (NOT implementations)
- [ ] TS-O-03..04 — Compose quickstart + Helm chart
- [ ] TS-O-05..06 — One-command upgrade + full docs suite

#### Differentiators that are cheap-now (v1)
- [ ] DIFF-01 — Per-tenant provider override
- [ ] DIFF-02 — Org-key tenancy mode (vs user-BYOK)
- [ ] DIFF-03 — Sandbox / test tenant with mock provider
- [ ] DIFF-06 — Encrypted-at-rest tokens (KEK/DEK)
- [ ] DIFF-07 — Built-in dev mode
- [ ] DIFF-08 — Reproducible local dev (CI-enforced)
- [ ] DIFF-09 — Per-tenant locale overrides
- [ ] DIFF-12 — Wire-contract conformance test suite
- [ ] DIFF-13 — Realtime multi-stream (already in TS-W-15)
- [ ] DIFF-14..15 — Multi-arch + no-GPU API tier

### Add After Validation (v1.5)

Triggered by first 3-5 real deployments — the gaps emerge from operator feedback.

- [ ] DIFF-04 — Cost dashboards per-tenant/per-user (operators ask within week 2)
- [ ] DIFF-05 — PII redaction in transcripts (healthcare/finance verticals demand it)
- [ ] DIFF-10 — Bundled Grafana dashboards (operators ship their own otherwise — duplicate work)
- [ ] DIFF-11 — Gradual-rollout migration runners (only matters at scale)
- [ ] Frontend implementation of admin console + end-user portal (graduating UI-SPEC → code)

### Future Consideration (v2+)

Defer until product-market fit and operator feedback inform the design.

- [ ] SAML / SCIM provisioning (ANTI-07 → graduates here)
- [ ] Audit-log SIEM exports
- [ ] CMEK / FedRAMP isolation
- [ ] OpenAPI / JSON-Schema generation
- [ ] Live runtime trace validation against the OpenWhispr cloud
- [ ] Webhook subscriptions for usage / billing events
- [ ] Locales beyond en + ru (community-PR-driven)

---

## Feature Prioritization Matrix

(Top 20 features by priority — not exhaustive; the full table-stakes list is implicitly P1.)

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TS-W-04 OAuth shim with channel-aware scheme echo | HIGH (gates all sign-in) | M | P1 |
| TS-W-10 `/api/transcribe` with `limitReached@200` | HIGH (core product) | M | P1 |
| TS-W-12 NDJSON streaming flushed-per-line | HIGH (agent UX) | M | P1 |
| TS-P-01 Multi-tenancy with row-level isolation | HIGH (every operator) | M | P1 |
| TS-P-08+09 Quotas + usage ledger tied to LiteLLM spend | HIGH (billing + abuse defense) | M | P1 |
| TS-P-13 OTel + Prom + structured logs | HIGH (debuggability at 1000-concurrent) | M | P1 |
| TS-O-03 Compose quickstart < 5 min | HIGH (adoption multiplier) | M | P1 |
| TS-O-04 Helm chart | HIGH (production deploy) | L | P1 |
| TS-W-15 Realtime token brokering (3 providers, streams=2) | HIGH (meeting feature) | M | P1 |
| DIFF-01 Per-tenant provider override | HIGH (enterprise sale) | M | P1 |
| DIFF-12 Wire-contract conformance test suite | HIGH (regression net) | M | P1 |
| TS-P-15 Rolling-deploy-safe migrations | MEDIUM (zero-downtime upgrade) | M | P1 |
| TS-P-18 Background job queue | MEDIUM (transcribe retry, email) | M | P1 |
| TS-P-14 i18n en + ru | MEDIUM (project rule) | S | P1 |
| DIFF-07 Built-in dev mode | HIGH (contributor adoption) | S | P1 |
| DIFF-06 Encrypted-at-rest tokens (KEK/DEK) | MEDIUM (enterprise checkbox) | M | P1 |
| DIFF-04 Cost dashboards | HIGH (operator week 2) | M | P2 |
| DIFF-05 PII redaction | HIGH (vertical-specific) | M | P2 |
| TS-O-01+02 Admin + end-user frontend implementations | MEDIUM (UI-SPEC suffices for v1) | XL | P2 |
| ANTI-07 SAML/SCIM/FedRAMP/SIEM | MEDIUM (enterprise-plus) | XL | P3 |

**Priority key:**
- P1: Must have for v1 launch
- P2: v1.5 — add after first deployments
- P3: v2+ — defer until validated

---

## Competitor / Adjacent-Project Feature Analysis

The OSS self-hosted AI backend space is small but instructive. None of these are direct competitors (each picks a different slice), but their feature decisions calibrate ours.

| Feature | LiteLLM Proxy | Langfuse | OpenWebUI | Supabase Self-Hosted | Authentik | **Our Approach** |
|---------|---------------|----------|-----------|----------------------|-----------|------------------|
| Multi-tenancy | Per-key budgets (key = tenant proxy) | First-class projects | Per-user only | First-class organizations | Tenants | First-class tenants with row-level isolation (TS-P-01) |
| Pluggable LLM | YES — 100+ providers | Provider-agnostic (records all) | Native + LiteLLM | N/A | N/A | Use LiteLLM as default; keep direct-provider escape hatch (TS-P-03) |
| Pluggable STT | Limited (pass-through) | N/A | Whisper local | N/A | N/A | First-class abstraction (TS-P-04) |
| Pluggable storage | N/A | S3-compatible | Local | First-class | N/A | S3-compatible default = MinIO (TS-P-05) |
| Pluggable identity | API keys + master key | OAuth + email | Email + LDAP + OAuth | OAuth + magic link + email | The product | Generic OIDC + bundled Authentik recommendation (TS-P-02 + ANTI-08) |
| Per-tenant provider override | No (per-key model whitelist) | N/A | No | No | N/A | YES (DIFF-01) — primary differentiator |
| Cost dashboards | Built-in spend logs | Per-trace cost | No | No | N/A | v1.5 (DIFF-04) using LiteLLM as source |
| PII redaction | Guardrails (post-call) | Optional | No | No | N/A | v1.5 (DIFF-05) — at ingress |
| Audit log | Spend logs only | Full trace | Limited | YES | YES | First-class table (TS-P-10) |
| Compose quickstart | < 2 min | < 3 min | < 5 min | ~ 10 min | ~ 5 min | < 5 min target (TS-O-03 + DIFF-08) |
| Helm chart | YES | YES | YES | YES | YES | YES (TS-O-04) |
| i18n | No | English only | YES (many) | English only | YES (many) | en + ru in v1 (TS-P-14); operator overlays (DIFF-09) |
| Custom IdP UI | No | No | YES (basic) | YES (full) | The product | NO — defer to bundled Authentik (ANTI-08) |
| Webhooks for usage events | YES | YES | No | YES | YES | Stripe-only in v1; general v2 (ANTI-15) |
| OpenAPI spec | YES (auto-gen) | YES | Limited | YES | YES | Markdown wire spec only in v1 (ANTI-10) |
| Wire-compatibility test suite | N/A | N/A | N/A | N/A | N/A | YES (DIFF-12) — unique to our context |

---

## Sources

- Upstream wire spec: `/Users/nick/openwhispr/docs/SELF_HOSTING.md` (sections: Required Endpoints, Authentication Contract, OAuth Flow Walkthrough, Custom Protocol Channel Variants, Edge Cases and Quirks, Minimum Viable Backend Checklist) — HIGH confidence
- Upstream wire spec: `/Users/nick/openwhispr/docs/BACKEND_SPEC.md` (every endpoint card cited inline; Global Error Envelope; Custom Protocol Redirect) — HIGH confidence
- Upstream OAuth spec: `/Users/nick/openwhispr/docs/OAUTH_SPEC.md` (sections: OpenWhispr Cloud Sign-In, Google Calendar, Other Providers Found, Custom Protocol Reference, Out of Scope) — HIGH confidence
- Real-deployment audio surface: `/Users/nick/openwhispr-server/speaches-audio.md` (Alfaleasing prod LiteLLM v1.82.3 + Speaches `master-cuda-12.6.3`; multipart-passthrough patch; 3600s ingress timeouts for realtime) — HIGH confidence
- Project brief: `/Users/nick/openwhispr-server/.planning/PROJECT.md` (requirement IDs WIRE-01..06, AUTH-01..06, LITELLM-01..05, PROVIDER-01..07, DATA-01..05, SCALE-01..06, OBS-01..04, UI-01..03, DEPLOY-01..04, DOCS-01..09, I18N-01..02; Out of Scope; Constraints) — HIGH confidence
- Adjacent OSS projects (LiteLLM Proxy, Langfuse, OpenWebUI, Supabase Self-Hosted, Authentik) — MEDIUM confidence (cross-referenced from public docs and prior deployment knowledge; not independently re-verified for this research)

---
*Feature research for: enterprise self-hosted AI backend (wire-compatible OpenWhispr cloud)*
*Researched: 2026-05-08*
