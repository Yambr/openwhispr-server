# Pitfalls Research

**Domain:** Wire-compatible self-hosted backend for an Electron desktop client (auth + transcription + LLM reasoning + agent streaming + billing), enterprise self-hosted, multi-tenant, 1000 concurrent users, LiteLLM Proxy + Speaches default
**Researched:** 2026-05-08
**Confidence:** HIGH for upstream-spec-derived items (cross-referenced to `BACKEND_SPEC.md`, `OAUTH_SPEC.md`, `SELF_HOSTING.md`); HIGH for LiteLLM/Speaches items (cited from `speaches-audio.md` and the linked PR); MEDIUM for general distributed-systems traps (industry-standard knowledge).

> **How to read this file.** Pitfalls are organized by domain (wire contract → OAuth → multi-tenancy → LiteLLM → Speaches → streaming → token storage → Postgres → operator UX → i18n → OSS → security). Each pitfall lists: what goes wrong, why, prevention (concrete: test/lint/runtime check/design rule), warning signs, the phase that should address it, and — where applicable — the upstream spec section that defines the contract.
>
> The single highest-risk class of pitfall in this project is **wire-contract drift**. Every other category is recoverable; wire drift breaks every desktop client transparently and silently.

---

## Critical Pitfalls

### Pitfall 1: Returning HTTP 200 with `{error: "..."}` instead of HTTP 401 on auth failure

**What goes wrong:**
The desktop client's `withSessionRefresh()` wrapper (`src/lib/auth.ts:142-169`) keys on the **HTTP 401 status code** to trigger its retry-once-with-backoff path (up to 6 attempts within the 60s grace period). If the server returns 200-with-error-body, the client treats the call as success, parses the JSON, and surfaces a confusing "API error" to the user with no retry. Recovery is user-visible logout in environments where the session is intermittently flapping (load-balanced restarts, blue/green deploys, token rotation).

**Why it happens:**
Server frameworks default to "wrap errors in 200 + payload" when the route uses a generic JSON-response middleware. Engineers conflate "the call ran fine, but the user is unauthorized" with "the call succeeded."

**How to avoid:**
- **Design rule:** Auth middleware MUST short-circuit with HTTP 401 (and the global error envelope `{"error": "<string>"}`) for any unauthenticated/expired token. No exceptions.
- **Contract test (Phase 2):** For every authenticated endpoint, send a request with `Authorization: Bearer invalid` and assert the response is `401`, JSON, with `error` field present.
- **Lint rule (Phase 2):** Forbid returning `200` from any handler reachable via authenticated routes when `req.user` is null. Add a generic test that scans all auth-required endpoints.
- **Runtime check (Phase 5/Observability):** Log + alert any auth-required endpoint emitting `200` with `error` in body — this is always a bug.

**Warning signs:**
- Users reporting "I keep getting signed out" or "the app keeps showing errors after I sign in" without a clean 401 in server logs.
- Logs show `200` responses on `/api/transcribe`/`/api/reason` immediately after a token rotation.

**Phase to address:** Phase 2 (Wire-contract scaffold) — auth middleware MUST be the first thing built; contract tests in Phase 2 acceptance criteria.

**Upstream cross-ref:** `BACKEND_SPEC.md` § Global Error Envelope row "401"; `SELF_HOSTING.md` § Authentication Contract → Token refresh / 401 handling; `PROJECT.md` WIRE-03.

---

### Pitfall 2: Returning 4xx for `/api/transcribe` quota exhaustion instead of `200 { limitReached: true }`

**What goes wrong:**
The client's `interpretTranscribeResponse()` (`src/helpers/ipcHandlers.js:3441-3454`) reads `limitReached` only from a 200 response. A 4xx (e.g., 402 Payment Required, 429) is parsed by the global error path and surfaced as a generic API error — the user gets "Something went wrong" rather than the localized quota-exhaustion UI with upgrade CTA.

**Why it happens:**
- "Quota exceeded" feels like an error, so engineers reach for 402/429.
- LiteLLM's own `key budget exceeded` returns 4xx — wrapping that response naively forwards the wrong status to the client.

**How to avoid:**
- **Design rule:** `/api/transcribe` (and `/api/streaming-usage`) responses for quota are **always** 200 + `limitReached: true` + `wordsRemaining: 0` + the rest of the metadata envelope. The transcription itself MAY be empty string.
- **Contract test (Phase 2):** Synthesize a tenant with quota = 0; POST audio; assert status 200, `limitReached === true`, body shape matches spec.
- **Mapping layer:** When the LiteLLM passthrough returns 4xx for budget, the API tier MUST translate to 200 + `limitReached`. This is a known transformation point.

**Warning signs:**
- Users on the free plan report "transcription stopped working" rather than "you've hit your free quota — upgrade".
- Server logs show 402/429 from LiteLLM but the transcribe endpoint returns 4xx to the client.

**Phase to address:** Phase 3 (Transcription/quota integration). Phase 2 stubs the endpoint as 200; Phase 3 wires real quota and MUST keep the contract.

**Upstream cross-ref:** `BACKEND_SPEC.md` § `POST /api/transcribe` "Error deviations"; `SELF_HOSTING.md` § Edge Cases "/api/transcribe quota exhaustion at HTTP 200".

---

### Pitfall 3: NDJSON buffering on `/api/agent/stream` (response not flushed per line)

**What goes wrong:**
The client's stream parser (`src/helpers/ipcHandlers.js:5697-5710`) emits `cloud-agent-stream-chunk` IPC messages **per `\n`-delimited JSON line received**. If the server (or any reverse proxy in the path: nginx, ingress-nginx, ALB, CDN) buffers the response, the user sees no streaming output — the entire response arrives in one IPC message at the end of the LLM completion. The agent feels frozen and the UX promise of "streaming chat" is dead.

**Why it happens:**
- Default Node/Fastify behavior with `application/json` is to buffer.
- nginx default `proxy_buffering on` and `gzip on` for the streaming MIME type both buffer.
- ingress-nginx requires explicit `nginx.ingress.kubernetes.io/proxy-buffering: "off"` on the streaming route.
- HTTP/2 implementations sometimes batch DATA frames.

**How to avoid:**
- **Server side:** Use `application/x-ndjson` Content-Type. Disable response compression on this route. Call `response.flush()` (or framework equivalent) after every line. In Node, `res.write(line + "\n"); res.flush?.();` or use a streaming framework primitive.
- **Reverse proxy:** Per-route nginx config: `proxy_buffering off; proxy_cache off; gzip off; chunked_transfer_encoding on;`. ingress-nginx annotation: `nginx.ingress.kubernetes.io/proxy-buffering: "off"`.
- **Contract test (Phase 4):** Spawn the server, POST to `/api/agent/stream`, assert that the **first JSON line** arrives at the client within ≤ 500ms of the upstream LLM emitting its first token (use a mock LLM that emits known-cadence chunks). If the first line arrives within `≤ 500ms` of the **final** chunk, buffering is on.
- **Runtime canary (Phase 5):** Continuously emit a synthetic stream and assert inter-line latency is bounded.

**Warning signs:**
- All NDJSON lines arrive at the same wall-clock time in client logs.
- `Transfer-Encoding: chunked` missing from response headers.
- nginx access log shows full response body length on the same log line as request start (no streaming).

**Phase to address:** Phase 4 (Streaming endpoints) — must be tested end-to-end through the full ingress chain, not just the app server.

**Upstream cross-ref:** `BACKEND_SPEC.md` § `POST /api/agent/stream`; `SELF_HOSTING.md` § Edge Cases "Server-streamed NDJSON".

---

### Pitfall 4: Hard-coding `openwhispr://` scheme in the OAuth final redirect

**What goes wrong:**
The desktop is **channel-scoped**: production registers `openwhispr://`, dev registers `openwhispr-dev://`, staging registers `openwhispr-staging://`, and arbitrary builds may override via `VITE_OPENWHISPR_PROTOCOL`. The auth shim receives the active scheme in the `callbackURL` query param of the OAuth-initiation request. If the server hard-codes `openwhispr://` instead of echoing the received scheme, dev/staging/custom builds receive the redirect — and the OS dispatches it to the wrong app (production, if installed) or to nothing (silent black hole). The user sits on a blank browser page; the sign-in flow never completes.

**Why it happens:**
- Dev work is done against a single channel; the channel-scoping isn't exercised until a second channel is installed.
- Templating the redirect URL with a hard-coded string is the path of least resistance.

**How to avoid:**
- **Design rule:** Parse `callbackURL` query param on the OAuth-initiation request. Extract `protocol={scheme}`. Validate the scheme matches an allow-list pattern (`/^openwhispr(-[a-z]+)?$/` plus configured overrides). Echo it back in the final 302 target. Never hard-code.
- **Contract test (Phase 2/4):** Initiate OAuth with `callbackURL=...&protocol=openwhispr-staging`, assert final 302 `Location: openwhispr-staging://?bearer_token=...`. Repeat for `openwhispr`, `openwhispr-dev`, and a custom override (e.g. `mycorp-whispr`).
- **Allow-list:** Reject unknown schemes with a 400 to prevent open-redirect vectors (`callbackURL=javascript:...`).

**Warning signs:**
- Bug reports from dev/staging users: "I clicked Sign in, the browser opened, I authorized, and nothing happened."
- Server logs show successful OAuth completion but no subsequent authenticated request from the desktop binary.

**Phase to address:** Phase 2 (Auth shim) — multi-channel matrix is in the Phase 2 acceptance test plan.

**Upstream cross-ref:** `OAUTH_SPEC.md` § Conventions → "Channel variants"; `OAUTH_SPEC.md` § Custom Protocol Reference; `SELF_HOSTING.md` § Custom Protocol Channel Variants; `PROJECT.md` AUTH-02.

---

### Pitfall 5: Cookie jar host-scoping confusion (auth host vs API host)

**What goes wrong:**
Electron's session cookie jar is queried for both `${OPENWHISPR_API_URL}` and `${AUTH_URL}`. If the auth shim (e.g., `auth.example.com`) and the API base (`api.example.com`) are on different subdomains, cookies set with `Domain=.example.com` work for both, but cookies set with `Domain=auth.example.com` only attach to auth-host requests. The three pre-auth endpoints (`/api/check-user`, `/api/auth/verification-status`, `DELETE /api/auth/delete-account`) call from the renderer with `credentials: "include"` and rely **only on the cookie jar** — not the bearer header. If your sign-in flow sets cookies on `auth.example.com` only, then `/api/auth/verification-status` (on `api.example.com`) receives no cookie and 401s, breaking email-verification onboarding.

**Why it happens:**
- Single-host installs (everything on one domain) hide this bug.
- Multi-host self-host installers (recommended for HA) trip on it.
- `SameSite=Lax` and `Secure` flags interact subtly with cross-host XHR.

**How to avoid:**
- **Design rule:** Set the auth session cookie with `Domain=<eTLD+1>` (e.g., `Domain=.example.com`, `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`) when auth and API are co-tenant subdomains. For the single-host case, omit `Domain`.
- **Alternative design:** Make `/api/check-user`, `/api/auth/verification-status`, `DELETE /api/auth/delete-account` accept the bearer header as well as the cookie. The desktop client only sends the cookie on these three, but accepting the bearer is forward-compatible and operator-friendly.
- **Contract test (Phase 2):** Spin up the deploy with auth host ≠ API host; sign in; immediately call `/api/auth/verification-status?email=...` and assert 200.
- **Operator doc (Phase 7):** `SELF_HOSTING.md` chapter must explicitly address single-host vs split-host cookie scoping.

**Warning signs:**
- Email verification step never advances (5s polling returns 401).
- "Delete Account" button silently fails post-sign-in.

**Phase to address:** Phase 2 (Auth contract). Reverify in Phase 7 (Deploy) when split-host topology is exercised.

**Upstream cross-ref:** `BACKEND_SPEC.md` § Conventions "Auth header — fallback"; `SELF_HOSTING.md` § Edge Cases "Cookie jar is auth-host scoped".

---

### Pitfall 6: OAuth `state` cookie disappears when user opens link via embedded webview

**What goes wrong:**
Better Auth's OAuth round-trip uses a `state` cookie set on the auth host during step 1 (browser nav to `/api/desktop-signin/{provider}`). On the IdP callback, the auth server reads the cookie to verify the round-trip. The desktop **MUST** open the sign-in URL in the OS default browser — but if a user (or a misconfigured embedded webview, e.g., an Outlook desktop preview) opens the URL in an isolated cookie jar, step 1 sets the cookie in jar A and step 4 (callback) reads it from jar B → **state mismatch → 4xx**, sign-in fails.

The desktop client uses `shell.openExternal()` which delegates to the OS — but a misconfigured Linux desktop or a sandboxed environment can still steal the URL and open it in a webview.

**Why it happens:**
- Default URL handlers on Linux (xdg-open) sometimes go to apps other than the user's primary browser.
- Some corporate device-management tools intercept URLs into managed-browser sandboxes.
- Engineers test only on their own dev machine where it always works.

**How to avoid:**
- **Server-side defense:** On state-mismatch failure, redirect to an HTML error page (not a 4xx JSON) that **explains** "We couldn't sign you in — please make sure your default browser is set" with a "try again" button. Don't black-hole the user.
- **Client side (out of scope for this server, but document):** Document this in `docs/operations.md` for support staff.
- **Telemetry (Phase 5):** Track state-mismatch errors as a distinct error code — sustained rates indicate widespread default-browser misconfiguration.

**Warning signs:**
- Spike in `oauth_state_mismatch` errors correlated with a specific platform (Linux, corporate Windows).
- Users report "Sign-in says invalid" on first attempt.

**Phase to address:** Phase 2 (Auth) — error-handling redirect; Phase 5 (Observability) — error-rate metric.

**Upstream cross-ref:** `OAUTH_SPEC.md` § Conventions "Browser vs. webview".

---

### Pitfall 7: macOS `open-url` vs Windows/Linux `second-instance` argv parsing

**What goes wrong:**
On macOS the protocol URL fires `app.on("open-url", ...)`. On Windows/Linux a **new app instance is spawned** with the URL on `process.argv`; the existing instance must intercept via `app.on("second-instance", ...)` and parse `commandLine` to extract the URL.

This is a desktop-side concern, but it has a **server-side implication**: the client cannot ack receipt of the deep link to the server, and on Windows the URL parsing is sometimes lossy (URL fragments after `#`, percent-encoding of `+`). If your bearer token is passed via the URL (`?bearer_token=...`) and contains characters that some Windows URL handlers mangle (`+`, `=`, `/`), the desktop receives a corrupted token and silently fails authentication on the next API call.

**Why it happens:**
- Tokens are commonly URL-safe-base64 (`-`, `_`) but legacy tokens use standard base64 (`+`, `/`, `=`).
- Server engineers test on macOS; Windows/Linux argv parsing is exercised only post-release.

**How to avoid:**
- **Design rule:** Bearer tokens emitted via the protocol redirect MUST be URL-safe-base64 or hex. **No `+`, `/`, `=`** in tokens that travel via the custom-protocol URL. Document this constraint in `BACKEND_SPEC.md` extension and enforce in the token-issuance code.
- **Contract test (Phase 2):** The token emission path generates a token, verifies the regex `^[A-Za-z0-9_-]+$` (or hex), and fails the build if violated.
- **Server-side fingerprint:** Include a short HMAC suffix on the token; the server's auth middleware re-verifies on receipt and returns a specific error code for "token corrupted in transit" so the desktop can show a useful error.

**Warning signs:**
- Windows users report "I sign in but nothing happens" — server logs show no authenticated request, or one with a 401.
- Server logs show 401s from tokens that decode to garbage.

**Phase to address:** Phase 2 (Auth — token format).

**Upstream cross-ref:** `OAUTH_SPEC.md` § Conventions "Deep-link reception"; `OAUTH_SPEC.md` § OpenWhispr Cloud Sign-In step 7.

---

### Pitfall 8: `set-auth-token` race with concurrent in-flight requests during token rotation

**What goes wrong:**
When the server emits `set-auth-token: <new>` on a Better Auth response, the client persists the new token via `auth-set-token` IPC. But the desktop fires multiple cloud requests concurrently (e.g., `/api/usage` + `/api/stt-config` + `/api/transcribe` on app boot). If request R1 returns first with `set-auth-token: T2`, requests R2 and R3 are mid-flight using `T1`. On the server, T1 may already be revoked (if rotation is "use once" or the rotation window is tight) → R2/R3 401 → `withSessionRefresh()` retries. If the retry happens **after** the 60s grace window (e.g., after a long-idle wake), the user is logged out.

**Why it happens:**
- Engineers default to "rotate aggressively for security" and revoke the old token immediately on issue of a new one.
- Race-condition testing is rarely done.

**How to avoid:**
- **Design rule:** Tokens MUST overlap. When emitting `set-auth-token: T2`, accept BOTH T1 and T2 for at least 60 seconds (the client's grace period) — ideally 5 minutes. Do NOT revoke T1 immediately.
- **Implementation:** Maintain a token-version chain per session; the latest N versions (≥ 2, with TTL ≥ 60s after rotation) are valid.
- **Avoid rotating on every request:** Rotate only on auth-client calls (Better Auth-specific endpoints), not on every `/api/...` call. This bounds the rotation rate.
- **Contract test (Phase 2):** Issue T1, rotate to T2, immediately fire 5 concurrent requests with T1, assert all succeed within the overlap window.

**Warning signs:**
- Spike in 401s correlated with `set-auth-token` issuance.
- Users report "I keep getting signed out" during heavy use.

**Phase to address:** Phase 2 (Auth — token rotation policy must be a documented Key Decision).

**Upstream cross-ref:** `BACKEND_SPEC.md` § Conventions "Token persistence" → `auth-set-token`; `SELF_HOSTING.md` § Token refresh / 401 handling.

---

### Pitfall 9: Refresh window outside the 60-second `withSessionRefresh()` grace period

**What goes wrong:**
The client's `withSessionRefresh()` only retries 401s if the failure occurred **within 60 seconds of last sign-in**. Outside that window, a single 401 is final — `AUTH_EXPIRED` is surfaced and the user is signed out. If the server's session lifetime is shorter than realistic user-active sessions, OR if scheduled rotation lands users outside the grace window, a 401 = user-visible logout with no recovery.

**Why it happens:**
- Engineers set token TTL to "1 day" thinking that's plenty, not realizing the 60s grace window means rotations matter, not the absolute TTL.
- Daily rotation at midnight UTC catches users mid-session.

**How to avoid:**
- **Design rule:** Tokens are **long-lived** (≥ 30 days, ideally rolling). Sessions in the database have an "absolute" lifetime separate from the token; if rotation is needed, emit `set-auth-token` (which extends life transparently) rather than expiring the bearer.
- **No scheduled batch revocation.** Revocation MUST be event-driven (logout, account deletion, security incident) — never timed.
- **Contract test (Phase 2):** Sign in; sleep 65 seconds; fire `/api/usage`; assert success. Then test the explicit revocation path.

**Warning signs:**
- Daily logout spikes at fixed UTC times.
- Users report "I have to sign in again every morning."

**Phase to address:** Phase 2 (Auth lifecycle) — session-lifetime policy is a Key Decision.

**Upstream cross-ref:** `BACKEND_SPEC.md` § Global Error Envelope row "401" (60s `GRACE_PERIOD_MS`); `PROJECT.md` AUTH-03.

---

### Pitfall 10: Forgotten Row-Level Security policy on a new tenant-scoped table → cross-tenant leak

**What goes wrong:**
The data model uses Postgres RLS to enforce tenant isolation: every tenant-scoped query is filtered by `tenant_id = current_setting('app.tenant_id')::uuid`. Adding a new table without a corresponding RLS policy means queries from tenant A return rows belonging to tenant B. **This is a data-breach-grade bug** that escapes review easily because the table works in dev (where there is one tenant) and only leaks under multi-tenant load.

**Why it happens:**
- Migrations rarely require coupled policy migrations.
- Engineers mentally model "FOREIGN KEY tenant_id" as enforcement; it isn't.
- Tests run against a single tenant.

**How to avoid:**
- **Design rule:** Every table with a `tenant_id` column MUST have RLS enabled and a default-deny policy. The convention is enforced by a migration linter, not by reviewer attention.
- **Lint/CI rule (Phase 3):** A test introspects `pg_class` + `pg_policies` and asserts: for every table with a `tenant_id` column, `relrowsecurity = true` AND there exists at least one `cmd='ALL'` (or per-cmd) policy that references `current_setting('app.tenant_id')`. Fails CI if a table is missing.
- **Default-deny for the application role:** The app's Postgres role MUST be `NOLOGIN BYPASSRLS=false`. RLS is unbypassable by app code.
- **Property test (Phase 3/6):** A randomized fuzzer creates two tenants with overlapping ID-space data; runs every tenant-scoped query as tenant A; asserts no row from tenant B is ever returned.
- **Code review checklist:** PR template has a "did this PR add a table or column? does it have an RLS policy?" gate.

**Warning signs:**
- A migration adds `CREATE TABLE` without `ENABLE ROW LEVEL SECURITY` in the same file.
- Test count for the table is unusually low.
- Single-tenant integration tests pass but multi-tenant don't exist.

**Phase to address:** Phase 3 (Multi-tenancy) — RLS-policy linter is part of the Phase 3 acceptance criteria.

**Upstream cross-ref:** `PROJECT.md` DATA-01, AUTH-05.

---

### Pitfall 11: `SET app.tenant_id` not propagated through PgBouncer transaction-pooling mode

**What goes wrong:**
PgBouncer in `pool_mode = transaction` (the default for high-throughput pooling) returns the connection to the pool **after every transaction**. Session-level state — including `SET app.tenant_id = '<uuid>'` — is lost. The next query from a different tenant on the same physical connection sees the stale `app.tenant_id`, and RLS policies evaluate against the wrong tenant. **Cross-tenant leak across the pooler.**

**Why it happens:**
- Engineers test with direct Postgres connections (where session state persists).
- PgBouncer is added late in the cycle for connection-pool sizing.
- Session-pooling mode (which preserves `SET`) is rejected because it limits concurrency.

**How to avoid:**
- **Design rule:** Use **per-transaction** `SET LOCAL app.tenant_id = '<uuid>'` (NOT plain `SET`) **within every transaction**. `SET LOCAL` is scoped to the transaction and works correctly under transaction pooling.
- **Code structure:** Wrap every request in a Postgres transaction. The first statement in the transaction is `SET LOCAL app.tenant_id = $1`. The framework's request middleware enforces this — there is no "raw query" code path.
- **Lint rule (Phase 3):** Static analysis forbids any DB-call site that doesn't go through the tenant-scoped transaction wrapper.
- **Contract test (Phase 3):** With PgBouncer running in `transaction` mode, fire 100 interleaved queries from tenants A and B against a known-shared connection; assert RLS returns the correct rows for each query.
- **Alternative:** Use `pool_mode = session` for the API tier; pool size sized to `max_connections / N_workers`. Less efficient but simpler.

**Warning signs:**
- RLS works in dev (no PgBouncer) but fails in staging (PgBouncer).
- `SHOW app.tenant_id` randomly returns wrong tenant in queries.

**Phase to address:** Phase 3 (Multi-tenancy) co-developed with Phase 6 (Scale/PgBouncer integration). The `SET LOCAL` discipline must be in place from day 1 of multi-tenancy work.

**Upstream cross-ref:** `PROJECT.md` SCALE-02, DATA-01.

---

### Pitfall 12: Background-job context loses tenant scope

**What goes wrong:**
A user submits a transcription. The API enqueues a job with `{ tenant_id, user_id, audio_ref }`. The worker dequeues the job and runs the transcription pipeline — but if the worker doesn't re-establish the tenant scope (`SET LOCAL app.tenant_id`, attach the tenant to the OpenTelemetry context, attach to logs), it queries the database without RLS scoping (or with the wrong scoping), violates the tenant-isolation invariant, and writes the result with a missing or incorrect `tenant_id`.

**Why it happens:**
- Job systems use process-wide context. The HTTP handler's request-local context doesn't follow the job into the worker.
- Engineers think of "tenant scope" as a request-time concern.

**How to avoid:**
- **Design rule:** Every job payload MUST include `tenant_id`. The job runner's `run()` wrapper MUST re-establish the full tenant context (DB session var, log MDC, OTel context) before invoking job code. This is a framework primitive, not a per-job concern.
- **Lint/test rule (Phase 5):** Job-handler discovery iterates all registered handlers; asserts each handler is wrapped by the tenant-context middleware. Handlers that bypass it fail CI.
- **Property test (Phase 5):** Enqueue 100 jobs across 10 tenants in random order; assert each job's writes land with the correct `tenant_id`.

**Warning signs:**
- Audit log entries with `tenant_id = NULL`.
- Transcription results showing up under the wrong user.

**Phase to address:** Phase 5 (Background jobs).

**Upstream cross-ref:** `PROJECT.md` SCALE-03, DATA-04.

---

### Pitfall 13: Cache key collisions across tenants (Redis namespace)

**What goes wrong:**
Caching `quota:user_id` instead of `quota:tenant_id:user_id` means user 42 in tenant A and user 42 in tenant B share a cache slot — quota state of one bleeds into the other. Same applies to rate-limit buckets, user-config caches, virtual-key caches.

**Why it happens:**
- Engineers default to natural keys without considering multi-tenancy.
- Single-tenant testing never surfaces this.

**How to avoid:**
- **Design rule:** Every Redis/cache key MUST be prefixed with `tenant:<uuid>:` (or `t:<uuid>:`). The cache wrapper enforces this — there is no "raw Redis" code path.
- **Lint rule (Phase 3):** Forbid direct Redis calls outside the cache wrapper. The wrapper takes `tenant_id` as a required argument.
- **Test:** Set `quota:42` in tenant A; read in tenant B; assert miss.

**Warning signs:**
- Quota numbers "jump" inexplicably between users.
- Rate-limit hits without proportional traffic.

**Phase to address:** Phase 3 (Multi-tenancy) and Phase 6 (Rate-limit + cache layer).

**Upstream cross-ref:** `PROJECT.md` SCALE-04.

---

### Pitfall 14: LiteLLM v1.82.3 multipart pass-through 500 bug

**What goes wrong:**
LiteLLM v1.82.3 ships a regression where pass-through endpoints (used for `/v1/audio/diarization` because pyannote isn't a native LiteLLM model) crash with 500 `text/plain` before reaching the route handler. Specifically, a `custom_body: Optional[dict]` parameter in the FastAPI signature interacts badly with multipart parsing, and a `not _parsed_body` guard in the multipart branch short-circuits incorrectly. Diarization 100% broken; transcription unaffected.

**Why it happens:**
Documented in `speaches-audio.md` § Известные баги. Fixed upstream in v1.83.7-stable via [BerriAI/litellm#25464](https://github.com/BerriAI/litellm/pull/25464). The fix is backported to a local patch (`patches/fix_passthrough_multipart.py`).

**How to avoid:**
- **Design rule:** Pin LiteLLM to a version `>= 1.83.7` (the version with PR #25464 merged), OR maintain the local patch and apply it at container build time.
- **Container build (Phase 4 deploy):** The LiteLLM image used by the docker-compose default stack is built from a fixed tag with the patch applied; never `:latest`.
- **Contract test (Phase 4):** End-to-end test that uploads a known audio file to `/v1/audio/diarization` via the LiteLLM proxy; asserts 200 + valid speaker segments. Runs on every CI build.
- **Upgrade discipline:** When bumping LiteLLM, the upgrade PR MUST run the diarization E2E test green before merge.

**Warning signs:**
- `/api/transcribe` works but any diarization-using feature fails with 500.
- LiteLLM logs show `text/plain` errors before route dispatch.

**Phase to address:** Phase 4 (LiteLLM/Speaches integration). The pinned-version + patch is part of the Phase 4 deliverable.

**Upstream cross-ref:** `speaches-audio.md` § Известные баги; `PROJECT.md` LITELLM-02; PR [BerriAI/litellm#25464](https://github.com/BerriAI/litellm/pull/25464).

---

### Pitfall 15: LiteLLM does not meter pass-through endpoints

**What goes wrong:**
LiteLLM's spend-logs (the canonical usage source for billing) only cover **native** (registered-model) requests. Pass-through endpoints — diarization being the primary one in this stack — are forwarded to the upstream and the auth check happens, but **no spend record is written**. If billing relies solely on LiteLLM spend-logs, diarization is free-for-all from a quota perspective. Operators on metered plans burn money silently.

**Why it happens:**
Documented behavior in `speaches-audio.md`: "Учёт расходов LiteLLM по pass-through не ведёт — запросы попадают в spend logs только через guardrails post-call (ПДН-аудит) и nginx access log."

**How to avoid:**
- **Design rule:** The platform's usage ledger has TWO authoritative sources: (1) LiteLLM spend-logs for native models, (2) **nginx access logs + post-call guardrails** for pass-through endpoints. Both feed a unified `usage_ledger` table.
- **Implementation:** A log-shipping pipeline (vector / fluent-bit) parses nginx access logs for pass-through routes (`/v1/audio/diarization`) and enriches with virtual-key → tenant mapping, then writes to `usage_ledger`. Time-series correlation with the request-id.
- **Reconciliation job (Phase 5):** Daily job that compares LiteLLM spend-logs + access-log-derived ledger entries against `usage_ledger`; alerts on drift.
- **Contract test (Phase 4):** Run a diarization request; assert a `usage_ledger` row appears with the right tenant within 60 seconds.

**Warning signs:**
- Diarization requests in nginx logs without corresponding `usage_ledger` rows.
- Tenants exceeding their plan with no quota enforcement.

**Phase to address:** Phase 4 (LiteLLM/Speaches integration) co-developed with Phase 5 (Observability + usage ledger).

**Upstream cross-ref:** `speaches-audio.md` § Диаризация; `PROJECT.md` LITELLM-05, OBS-04.

---

### Pitfall 16: Ingress < 1h read/send timeouts kill WSS realtime sessions

**What goes wrong:**
Speaches Realtime over WSS holds open a WebSocket for the duration of a transcription session — easily 10–60 minutes for a meeting note. The default nginx-ingress `proxy-read-timeout: 60s` and `proxy-send-timeout: 60s` cause the proxy to drop the connection after one minute of read silence (which is normal during user-quiet periods in a transcription session). Client experiences mid-meeting disconnects; the desktop's reconnection logic tries to recover but loses partial transcription state.

**Why it happens:**
- nginx defaults are tuned for short HTTP requests.
- Engineers test WSS in dev where there is no ingress.

**How to avoid:**
- **Design rule:** WebSocket routes (`/v1/realtime`, any future streaming WSS) MUST have ingress timeouts set to ≥ 3600s (1 hour) for both read and send.
- **Helm/Kustomize (Phase 7):** The shipped chart sets per-route annotations:
  - `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"`
  - `nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"`
  - `nginx.ingress.kubernetes.io/proxy-buffering: "off"`
- **docker-compose nginx:** `proxy_read_timeout 3600; proxy_send_timeout 3600;` on the WSS location block.
- **Smoke test (Phase 7):** A long-running WSS test session emits a heartbeat every 30s and runs for 65+ minutes; asserts no mid-session disconnects.

**Warning signs:**
- Users report meeting transcriptions cut off after exactly N minutes (where N = the proxy timeout).
- Server logs show `connection reset` on WSS sockets at predictable intervals.

**Phase to address:** Phase 4 (Realtime endpoint) and Phase 7 (Deploy/ingress).

**Upstream cross-ref:** `speaches-audio.md` § Realtime; `PROJECT.md` SCALE-05.

---

### Pitfall 17: Speaches GPU model loading time on cold start

**What goes wrong:**
Whisper-large-v3-russian and pyannote diarization models load into GPU memory on first use. Cold-start can take 30–90 seconds. If the API tier's `/api/transcribe` request hits a freshly-scaled-up Speaches replica before model load is complete, the request either times out (typical 30s gateway timeout) or returns 503 — and the desktop client's user sees "transcription failed" with no recovery.

**Why it happens:**
- Kubernetes HPA scales Speaches up under load; the new pod accepts traffic before the readiness probe weighted by model-load is green.
- docker-compose restarts after host reboot: same problem, single-replica.

**How to avoid:**
- **Design rule:** Speaches readiness probe MUST verify the actual models are loaded (warm-up POST against `/v1/audio/transcriptions` with a 1-second canary clip, expected 200 within Xs). Pod is `NotReady` until the canary succeeds.
- **Pre-warm on deploy:** The deploy pipeline issues a transcription + diarization warm-up against each new replica before it joins the pool.
- **Operator UX:** docker-compose `healthcheck:` for the speaches service uses the model-warm probe.
- **Documentation (Phase 7):** Document expected first-launch warm-up time; surface it in the README quickstart so operators know to wait ~60s before first transcribe.

**Warning signs:**
- First transcribe after deploy fails with 503.
- HPA scale-up events correlate with failed transcribe requests.

**Phase to address:** Phase 4 (Speaches integration) for the readiness probe; Phase 7 (Deploy) for the warm-up step.

**Upstream cross-ref:** `speaches-audio.md` § headers; `PROJECT.md` LITELLM-03.

---

### Pitfall 18: Whisper Russian/English alias model misconfiguration

**What goes wrong:**
The Speaches deploy registers `examplecorp/whisper-large-v3-russian` (default Russian) and `examplecorp/whisper-large-v3-english` (alias to the same model with `language=en` hardcoded). If the alias is missing or misconfigured, English audio is transcribed by the Russian-tuned model with prompt-bias terms that don't apply, producing garbage. Reverse: Russian audio sent without `language=ru` falls into language auto-detect, which on a Russian-tuned model is often wrong.

**Why it happens:**
LiteLLM model config is a YAML, easy to typo. The single backend Whisper model is exposed as two virtual models — the alias indirection is non-obvious.

**How to avoid:**
- **Config validation (Phase 4):** A startup check verifies all expected model names resolve and respond to a known-cadence canary clip with expected text.
- **Locale-driven model selection:** The platform decides the model from the request's `language` parameter (defaulting per-tenant). Document the supported language → model map in `docs/litellm-config-spec.md`.
- **Contract test (Phase 4):** Submit Russian and English audio fixtures; assert correct language detection in the response.

**Warning signs:**
- `language: "ru"` in `/api/transcribe` responses for English audio.
- Russian users reporting garbled transcripts.

**Phase to address:** Phase 4 (LiteLLM/Speaches config).

**Upstream cross-ref:** `speaches-audio.md` § Транскрипции / Модели; `PROJECT.md` LITELLM-02.

---

### Pitfall 19: Diarization is separate from transcription — client must stitch by timestamp

**What goes wrong:**
`POST /v1/audio/diarization` returns `{ duration, segments: [{start, end, speaker}] }` — no text. `POST /v1/audio/transcriptions` returns text and (sometimes) per-word timestamps — no speaker labels. There is **no combined endpoint**. If your `/api/transcribe` wraps only one of these, the speaker-labeled output users expect ("Alice: hello / Bob: hi") is impossible.

**Why it happens:**
Documented in `speaches-audio.md` § Связка с транскрипцией. Engineers expect a "diarized transcription" call and don't read the docs.

**How to avoid:**
- **Design rule:** The platform-level `/api/transcribe` (when diarization is requested) does the stitching server-side: (1) call diarization → segments; (2) call transcription with word timestamps; (3) align words to segments by timestamp; (4) return a unified `{ text, segments: [{speaker, start, end, text}] }` shape.
- **Document the stitching algorithm** in `docs/litellm-config-spec.md` — it's a non-obvious post-processing step.
- **Contract test (Phase 4):** Submit a known multi-speaker audio fixture; assert the stitched output has the expected speakers and approximate timing.

**Warning signs:**
- Tickets like "diarization works but the text is missing" or vice versa.

**Phase to address:** Phase 4 (Audio pipeline).

**Upstream cross-ref:** `speaches-audio.md` § Связка с транскрипцией.

---

### Pitfall 20: Speaches Realtime "OpenAI Realtime spec compatibility" — verify event-by-event

**What goes wrong:**
Speaches **claims** OpenAI Realtime API compatibility, but the OpenAI spec is large (`session.created`, `session.update`, `input_audio_buffer.append`, `input_audio_buffer.commit`, `response.create`, `response.audio.delta`, `response.audio_transcript.delta`, `response.done`, function-call events, etc.). Subtle differences — event field names, event ordering, error codes — break clients written against the OpenAI reference. The desktop client uses OpenAI Realtime via `wss://api.openai.com/v1/realtime` directly (`src/helpers/openaiRealtimeStreaming.js:54`); if the platform wants to substitute Speaches transparently for that flow, every event the desktop emits or consumes must work byte-equivalent.

**Why it happens:**
"Compatible" in OSS-speak ranges from "drop-in identical" to "we implemented the obvious 80%". Without verification, you don't know which.

**How to avoid:**
- **Verification matrix (Phase 4):** For every event the desktop client sends or receives over its OpenAI Realtime client, write a contract test that runs against Speaches and asserts equivalence. Document the matrix in `docs/litellm-config-spec.md`.
- **Capture-replay tooling:** Capture a real desktop ↔ OpenAI Realtime session; replay the client side against Speaches; diff event flows.
- **Document deviations:** If Speaches deviates on any event, document it; either patch Speaches, work around server-side, or document a feature gap.

**Warning signs:**
- Desktop realtime sessions disconnect immediately after the first `session.update`.
- Specific event types missing from server output.

**Phase to address:** Phase 4 (Realtime).

**Upstream cross-ref:** `speaches-audio.md` § Realtime; `BACKEND_SPEC.md` § Third-Party API Inventory "OpenAI Realtime"; `PROJECT.md` PROVIDER-03.

---

### Pitfall 21: File-descriptor exhaustion at 1000 concurrent WSS+NDJSON

**What goes wrong:**
Each WSS connection holds 2 file descriptors (client socket + upstream socket), each NDJSON stream holds 2, plus DB pool, Redis pool, log files, etc. At 1000 concurrent users with a mix of streaming sessions, the API tier easily exceeds Linux's default `ulimit -n 1024`. New connections fail with `EMFILE` — but the failure mode is "the API tier silently rejects one in N requests" rather than crashing, which is harder to diagnose.

**Why it happens:**
- Default container ulimits.
- systemd unit defaults sometimes override ulimit even when host is fine.

**How to avoid:**
- **Design rule:** Container `ulimits.nofile` set to ≥ 65536. Documented in compose and Helm.
- **Runtime check (Phase 5):** A startup probe asserts `getrlimit(RLIMIT_NOFILE)` ≥ threshold; refuses to start otherwise (visible failure ≫ silent EMFILE).
- **Metric (Phase 5):** Export `process.open_fds` to Prometheus; alert at 80% of limit.
- **Load test (Phase 6):** SCALE-06 acceptance includes 1000 concurrent active streams; verifies no FD exhaustion.

**Warning signs:**
- Prometheus shows `process_open_fds` rising linearly with traffic and capping near `process_max_fds`.
- Sporadic 502/`EMFILE` in logs.

**Phase to address:** Phase 6 (Scale) — load test; Phase 7 (Deploy) — ulimits.

**Upstream cross-ref:** `PROJECT.md` SCALE-06.

---

### Pitfall 22: Reverse-proxy buffering on streaming routes (general case)

**What goes wrong:**
Same root cause as Pitfall 3 (NDJSON buffering) but generalized: **any** streaming route (NDJSON, SSE, WSS, chunked-response transcription progress) is at risk from the full reverse-proxy chain (CDN → ingress → app-tier nginx → app server). Each layer has its own buffering knobs; one missed config = streaming dead.

**How to avoid:**
- **Design rule:** Catalogue every streaming route in `docs/architecture.md` and tag each with required proxy config. Treat streaming routes as a first-class infrastructure concern.
- **Per-route ingress config (Phase 7):**
  - `nginx.ingress.kubernetes.io/proxy-buffering: "off"`
  - `nginx.ingress.kubernetes.io/proxy-request-buffering: "off"`
  - `nginx.ingress.kubernetes.io/proxy-http-version: "1.1"`
- **CDN bypass:** If a CDN is in front (Cloudflare, etc.), exempt streaming paths from caching/buffering or bypass entirely.
- **Smoke test (Phase 7):** Deploy-time smoke test asserts streaming latency through the full chain.

**Phase to address:** Phase 4 (per-route requirements) and Phase 7 (deploy chain).

**Upstream cross-ref:** `BACKEND_SPEC.md` § `POST /api/agent/stream`.

---

### Pitfall 23: Backpressure on slow clients during NDJSON streaming

**What goes wrong:**
A slow desktop client (poor network, busy CPU, suspended laptop) cannot drain the NDJSON stream as fast as the server emits. If the server doesn't apply backpressure, it buffers in TCP-send-buffer + app-side queue → memory growth → OOM under 1000 concurrent slow clients. Conversely, if the server uses unbounded `Transform` streams, the same OOM via a different vector.

**How to avoid:**
- **Design rule:** Use the framework's native backpressure primitive. In Node: respect `res.write()`'s return value; pause the upstream LLM stream when it returns false; resume on `drain`. In Go: write through a context-aware `http.Flusher` and propagate cancellation.
- **Memory cap per stream:** Enforce a per-stream max-buffered-bytes (e.g., 1 MB); if exceeded, terminate the stream with a clear error code.
- **Load test (Phase 6):** Simulate 100 slow clients (1 KB/s receive rate) alongside 900 normal clients; assert API-tier memory stays bounded.

**Warning signs:**
- API-tier RSS climbing under load proportional to active streams.
- OOMKills under high streaming load.

**Phase to address:** Phase 6 (Scale).

**Upstream cross-ref:** `PROJECT.md` SCALE-06.

---

### Pitfall 24: Postgres connection exhaustion without PgBouncer

**What goes wrong:**
Postgres `max_connections` defaults to 100 (or ~200 on managed services). At 1000 concurrent users, even a 10:1 multiplexing ratio (each user holds a connection for 100ms per request) needs careful sizing. Without PgBouncer, the API tier opens connections per request → exhausts Postgres → 5xx storm.

**How to avoid:**
- **Design rule:** PgBouncer (or pgcat) sits between API tier and Postgres in **transaction-pool mode**. Sized at: `pool_size × N_API_pods ≤ 0.8 × max_connections`.
- **Default pool sizing:** Per-pod app pool = 10–20; PgBouncer pool size = 50–100; Postgres `max_connections` = 200–400.
- **`SET LOCAL` discipline (Pitfall 11):** Co-required.
- **Load test (Phase 6):** Verify pool stability at peak.

**Phase to address:** Phase 6 (Scale).

**Upstream cross-ref:** `PROJECT.md` SCALE-02.

---

### Pitfall 25: VACUUM bloat on the usage-ledger table (high-write)

**What goes wrong:**
The `usage_ledger` table receives a write per `/api/transcribe`, `/api/reason`, `/api/agent/stream`, `/api/streaming-usage` — at 1000 concurrent users this is ≥ 100 rows/s. UPDATEs (e.g., aggregating per-day quotas) generate dead tuples. Without aggressive autovacuum tuning, the table bloats, indexes slow down, and queries that should be O(log N) become O(N).

**How to avoid:**
- **Design rule:** `usage_ledger` is **append-only**. No UPDATEs. Aggregation is a separate `usage_aggregates` table written by a periodic rollup job.
- **Partition by day:** The ledger is range-partitioned by day; old partitions are detached and archived monthly. Bloat doesn't accumulate.
- **Tune autovacuum** per-table: `autovacuum_vacuum_scale_factor=0.05, autovacuum_vacuum_cost_limit=2000` for the ledger.
- **Monitor (Phase 5):** Prometheus exporter for `pg_stat_user_tables.n_dead_tup` per critical table.

**Phase to address:** Phase 3 (data model — partition design); Phase 6 (autovacuum tuning).

**Upstream cross-ref:** `PROJECT.md` DATA-03.

---

### Pitfall 26: Migrations that lock under load (missing CONCURRENTLY / NOT VALID)

**What goes wrong:**
A migration that adds an index without `CONCURRENTLY`, or a foreign key without `NOT VALID` + later `VALIDATE CONSTRAINT`, takes an `ACCESS EXCLUSIVE` lock on the table — at 1000 concurrent users this stalls the entire API tier for the duration of the lock (seconds to minutes for large tables). Rolling deploys that try to apply the migration mid-roll cascade-fail.

**How to avoid:**
- **Design rule:** All schema migrations follow the **online-migration protocol**:
  - Indexes: `CREATE INDEX CONCURRENTLY` (does not lock).
  - Foreign keys: `ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT` in a separate migration.
  - Column adds: nullable + default-via-update-in-batches, never `ADD COLUMN ... NOT NULL DEFAULT 'foo'` on a large table.
  - Column drops: ghost-deprecate first; drop in a later release.
- **Lint rule (Phase 3):** Migration linter (e.g., `squawk`, `pgroll`) blocks PRs that contain blocking patterns.
- **Migration runner (DEPLOY-04):** Times each migration; refuses to run any that historically take > N seconds without explicit override. Logs lock acquisition.
- **CI test (Phase 7):** Run migration against a representative-sized dataset; assert lock time bounded.

**Phase to address:** Phase 3 (migrations baseline) and Phase 7 (deploy safety).

**Upstream cross-ref:** `PROJECT.md` DATA-02, DEPLOY-04.

---

### Pitfall 27: Default secrets in compose start-up (operators run with `password=changeme`)

**What goes wrong:**
The shipped `docker-compose.yml` has placeholder secrets (`POSTGRES_PASSWORD=changeme`, `LITELLM_MASTER_KEY=sk-1234`). Operators in a hurry skip the rotation step. Production deploy with default secrets = trivial root compromise of every install. The "openwhispr-self-host instances exposed" Shodan dork becomes a real thing.

**How to avoid:**
- **Design rule:** Compose ships with **no default secrets**. The first-launch script (`./bootstrap.sh` or equivalent) generates random secrets if not present. Refuse to start if any required secret matches a known-default value.
- **Runtime check (Phase 7):** API tier startup verifies secret entropy (e.g., min 32 bytes random); refuses to start with hard-coded defaults.
- **Operator UX:** README quickstart is `git clone && ./bootstrap.sh && docker compose up` — bootstrap generates secrets, prints `.env.example` → `.env` flow.
- **Lint:** Pre-commit hook scans for known-default secrets in committed configs.

**Phase to address:** Phase 7 (Deploy/operator UX).

**Upstream cross-ref:** `PROJECT.md` DEPLOY-01, DEPLOY-03; SECURITY discussion.

---

### Pitfall 28: HTTPS-only enforcement vs operator running locally over HTTP

**What goes wrong:**
The desktop client refuses plaintext HTTP (`SELF_HOSTING.md` § Transport: "HTTPS only. The client never strips or rewrites the URL scheme"). An operator running `docker-compose up` on `http://localhost:8000` for first-launch testing **cannot** point the desktop at it — sign-in fails before the first request, the operator gives up, the project gets a "doesn't work" GitHub issue.

**How to avoid:**
- **Design rule:** The shipped compose includes a **self-signed-or-mkcert TLS terminator** (Caddy or nginx) on `https://localhost`. Bootstrap generates a local CA and emits the cert path; the README documents how to trust the cert OS-side.
- **Alternative:** Bootstrap suggests Tailscale Funnel / ngrok / cloudflared for external HTTPS.
- **Documentation (Phase 7):** README's first-launch path is "first successful authenticated transcribe in < 5 minutes" (DOCS-01) — TLS friction is the #1 risk to that target.
- **Server-side:** The server's HSTS / cookie-Secure policy is configurable (off in dev, on in prod) but defaults to "on" with a documented dev override.

**Phase to address:** Phase 7 (Deploy) and Phase 8 (OSS docs).

**Upstream cross-ref:** `SELF_HOSTING.md` § Transport; `PROJECT.md` DOCS-01.

---

### Pitfall 29: First-launch friction > 5 minutes

**What goes wrong:**
DOCS-01 promises "under 5 minutes to first authenticated transcribe." Anything that breaks that promise — long Speaches model download (multiple GB), TLS friction (Pitfall 28), schema migration with first-run seeds, env-variable hunting — shrinks adoption to zero.

**How to avoid:**
- **Design rule:** First-launch budget is **5 minutes** end-to-end. Treat as a hard SLO. Phase 7 has a stopwatch test.
- **Optimizations:**
  - Speaches default model: `whisper-tiny` or `whisper-small` for first-run; document upgrade to `large-v3` post-install.
  - Lazy model download with progress UX in compose logs.
  - One-command bootstrap.
  - Ship a desktop-config-tarball that pre-fills `OPENWHISPR_API_URL` and the local CA.
- **CI smoke (Phase 7):** A clean-VM CI runner runs the README quickstart commands; asserts `/api/transcribe` returns 200 within 5 minutes.

**Warning signs:**
- GitHub issues titled "compose up never finishes."
- Twitter/HN threads complaining about setup.

**Phase to address:** Phase 7 (Deploy).

**Upstream cross-ref:** `PROJECT.md` DOCS-01.

---

### Pitfall 30: Upgrade path breaks on minor version bumps

**What goes wrong:**
Operators running `docker compose pull && up` between releases hit a migration that requires a manual step (e.g., a column drop that can't be done online) — the new API container crashes on startup, the old container is gone, downtime begins, the operator has no rollback path.

**How to avoid:**
- **Design rule:** **Backward-compatible migrations only between adjacent minor versions.** A minor bump (1.2 → 1.3) MUST run safely against 1.2's data with no operator action. Breaking changes are major bumps and require a documented migration playbook.
- **Two-phase deploy (DEPLOY-04):** Phase A — schema migration (additive only, online). Phase B — code rollout. Phase C — schema cleanup (removed in next minor).
- **Compatibility matrix:** `docs/operations.md` documents which minor versions are upgrade-safe.
- **CI test (Phase 7):** "upgrade matrix" test installs version N-1, populates data, upgrades to version N, asserts API health and data integrity.

**Phase to address:** Phase 7 (Deploy) and Phase 8 (release process).

**Upstream cross-ref:** `PROJECT.md` DEPLOY-03, DEPLOY-04.

---

### Pitfall 31: Hard-coded English strings missed during refactor

**What goes wrong:**
I18N-01 requires `en` + `ru` from day 1. Engineers refactoring an existing English-only path forget to wrap a new string in the i18n helper; the string ships hard-coded; Russian-locale users see a single English string in an otherwise-Russian UI/email.

**How to avoid:**
- **Lint rule (Phase 8):** ESLint / staticcheck rule that forbids string literals in user-facing surfaces (response error messages, email templates, notification text). Any literal must be wrapped in `t("key", ...)`. Whitelist exceptions for log strings (English-only per project rule).
- **Resource-key audit (Phase 8):** CI step asserts every `t("key")` call has a corresponding entry in BOTH `en` and `ru` locale files.
- **Code review:** PR template includes "did you add user-facing copy? does it have a translation key in both locales?"

**Phase to address:** Phase 8 (i18n integration).

**Upstream cross-ref:** `PROJECT.md` I18N-01.

---

### Pitfall 32: Pluralization rules differ between `en` and `ru` (CLDR)

**What goes wrong:**
English has 2 plural forms (one / other). Russian has **4** (one, few, many, other). Naive `if (n === 1) "1 word" else "${n} words"` works in English; in Russian "1 слово / 2 слова / 5 слов / 1.5 слова" requires CLDR plural rules. Wire up a pluralizer that doesn't know Russian → wrong forms shipped to all RU users.

**How to avoid:**
- **Design rule:** Use a CLDR-aware i18n library (FormatJS / ICU MessageFormat / Fluent). Forbid manual `n === 1` checks for plural forms.
- **Lint:** Forbid string concatenation with numbers in user-facing copy; require `messageFormat({ count })`.
- **Tests:** Snapshot tests for each pluralizable string in each locale at boundary cases (0, 1, 2, 5, 1.5).

**Phase to address:** Phase 8 (i18n).

**Upstream cross-ref:** `PROJECT.md` I18N-01.

---

### Pitfall 33: Date/time/number formatting lookups

**What goes wrong:**
"December 1, 2026" vs "1 декабря 2026 г." — different month names, different separators, different orderings. Hard-coded `new Date().toLocaleString("en-US")` everywhere = no Russian formatting. Same for numbers (`1,000.00` vs `1 000,00`).

**How to avoid:**
- Locale-aware formatters (`Intl.DateTimeFormat`, `Intl.NumberFormat`) keyed by the request's negotiated locale.
- Forbid `toLocaleString()` without an explicit locale argument.
- Document the locale-negotiation chain (Accept-Language → user preference → tenant default → system default).

**Phase to address:** Phase 8 (i18n).

**Upstream cross-ref:** `PROJECT.md` I18N-01.

---

### Pitfall 34: Email subject lines as locale-aware

**What goes wrong:**
Verification emails, referral invites, billing notifications. Subject lines are easy to forget — they live in email-template config files separate from in-app strings. A Russian user gets a Russian email body but English subject "Verify your OpenWhispr account."

**How to avoid:**
- **Design rule:** Email subject lines are **first-class translatable strings** alongside body content. The email-rendering pipeline takes locale and renders subject + body together.
- **Audit:** CI asserts every email template has both subject and body keys in both locales.

**Phase to address:** Phase 8 (i18n + email integration).

**Upstream cross-ref:** `PROJECT.md` I18N-01, PROVIDER-06.

---

### Pitfall 35: License compatibility — GPL leakage

**What goes wrong:**
The project ships under a permissive license (Apache 2.0 / MIT). A dependency added casually is GPL or AGPL → the entire project becomes copyleft → operators forking for commercial use have legal exposure → no enterprise adoption. Common offenders: ffmpeg (LGPL with exceptions but careful), some Postgres clients, some realtime audio libs.

**How to avoid:**
- **License scanner in CI (Phase 8):** `licensee` / `fossa` / `pip-licenses` / `license-checker` runs on every PR. Forbid GPL/AGPL/SSPL family in production dependencies. Allow LGPL with link-only justification.
- **License allow-list:** Maintained in `docs/licensing.md`. Adding a new dependency in a forbidden license fails CI.
- **Dual-license workaround:** Sometimes upstreams offer a commercial license; document the path.

**Phase to address:** Phase 8 (OSS readiness).

**Upstream cross-ref:** `PROJECT.md` DOCS-07.

---

### Pitfall 36: Telemetry default — opt-in only for OSS

**What goes wrong:**
The platform ships with telemetry that calls home "anonymously" by default. Self-hosters who didn't read the README discover this, post a HN thread titled "OpenWhispr-server phones home", project reputation tanks. Worse: if telemetry leaks tenant IDs or API surface metadata, it's also a privacy issue.

**How to avoid:**
- **Design rule:** Telemetry is **opt-in only**. Default `OPENWHISPR_TELEMETRY=disabled`. The README documents what is collected and why (only enable to share aggregate anonymized usage with the project).
- **Self-hosted operator visibility:** Operators can audit exactly what telemetry sends via a debug endpoint.
- **No PII / tenant identifiers** in any telemetry payload, ever.

**Phase to address:** Phase 5 (Observability) — clearly distinguish operator-internal observability (always on, scoped to operator) from project telemetry (opt-in).

**Upstream cross-ref:** `PROJECT.md` OBS-01..04.

---

### Pitfall 37: Branding/trademark concerns when forking the wire contract

**What goes wrong:**
The wire surface is `${OPENWHISPR_API_URL}/api/...` — if a fork ships a binary using the OpenWhispr name, the upstream may have trademark concerns. Conversely, if the project changes the wire path to be neutral, every desktop client must rebuild.

**How to avoid:**
- **Design rule:** Document explicitly: "this is a wire-compatible backend for the OpenWhispr desktop client; the desktop is the protocol owner." The server identifies itself as "Yambr Server" or similar in `User-Agent` / `Server` headers.
- **Trademark policy:** `docs/TRADEMARKS.md` clarifies what the project is and isn't.
- **No claim of OpenWhispr endorsement** in marketing copy.

**Phase to address:** Phase 8 (OSS readiness).

**Upstream cross-ref:** `PROJECT.md` Out of Scope.

---

### Pitfall 38: Multipart upload size limits / DoS

**What goes wrong:**
`/api/transcribe` accepts multipart audio. Without a size cap, a malicious client uploads 10 GB → API tier OOMs OR disk fills OR LiteLLM upstream OOMs. Even non-malicious: a user uploads a 4-hour meeting WAV → 1 GB → blows the 30s gateway timeout, fills the audio-temp dir, blocks other transcriptions.

**How to avoid:**
- **Design rule:** Per-request multipart size limit, **enforced at the ingress layer** (nginx `client_max_body_size`) AND at the app layer (framework body limit) AND at the LiteLLM layer. Three tiers because each can be bypassed individually.
- **Suggested limits:** 50 MB for `/api/transcribe` (~30 min of 16kHz audio at typical compression). Document the cap.
- **Streaming uploads (future):** For long files, support chunked upload (the desktop client already does `chunkedCloudTranscribe()` per `BACKEND_SPEC.md` § `/api/transcribe`).
- **Rate limit:** Per-tenant transcribe rate-limit prevents bulk-upload abuse even within size limit.

**Phase to address:** Phase 4 (Transcription) and Phase 6 (Rate limit).

**Upstream cross-ref:** `BACKEND_SPEC.md` § `POST /api/transcribe`; `PROJECT.md` SCALE-04.

---

### Pitfall 39: SSRF in operator-configured webhook URLs

**What goes wrong:**
The platform supports operator-configured webhooks (Stripe events, audit-log fanout, future). If the URL is fetched server-side without an allow-list / no-internal-IPs check, a malicious operator (or compromised admin UI) can point at `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (AWS IMDS) and exfiltrate cloud credentials.

**How to avoid:**
- **Design rule:** All outbound HTTP from server-side (webhooks, federated auth callbacks, OIDC discovery) MUST go through an SSRF-safe HTTP client that:
  - Resolves DNS first; rejects RFC1918, link-local, loopback, and AWS/GCP/Azure IMDS ranges.
  - Re-validates IP after resolution to defeat DNS rebinding.
  - Blocks redirects to private ranges.
- **Library:** Use a vetted SSRF-safe wrapper (e.g., `safecurl` for PHP-style, `private-ip` + custom resolver for Node, `ssrf-req-filter` patterns).
- **Test:** Try every IMDS/private IP variant and assert rejection.

**Phase to address:** Phase 5 (Observability/webhooks) and Phase 8 (Security review).

**Upstream cross-ref:** `PROJECT.md` PROVIDER-06 (email/webhooks).

---

### Pitfall 40: Bearer token leakage in logs

**What goes wrong:**
A naive `console.log(req.headers)` or a 4xx/5xx error path that dumps the full request emits `Authorization: Bearer <token>` to logs. Logs ship to operator's SIEM. Tokens are now exposed to anyone with log read. **Real-world:** GitHub Actions logs, Sentry/Datadog/Splunk integrations, on-prem ELK.

**How to avoid:**
- **Design rule:** Logging middleware MUST scrub `Authorization`, `Cookie`, `Set-Cookie`, `set-auth-token`, and any field matching `*token*`, `*secret*`, `*password*`, `*key*` (case-insensitive). Default-deny all unknown headers.
- **Test:** Generate a synthetic request with a known sentinel token; trigger an error path; grep the log output; assert sentinel is absent.
- **Lint:** Forbid `console.log(req)` / unstructured logging anywhere in production code.

**Phase to address:** Phase 5 (Observability).

**Upstream cross-ref:** `PROJECT.md` OBS-03.

---

### Pitfall 41: PII in transcripts crossing borders (data residency)

**What goes wrong:**
Tenant A has GDPR / Russian data-localization obligations. Their transcripts (verbatim user speech, often containing PII) get sent to a US-based LLM provider (LiteLLM-routed to OpenAI) for `/api/reason` cleanup. **Compliance violation.** Or: transcript audio is stored in the default S3 region (us-east-1) regardless of tenant region.

**How to avoid:**
- **Design rule:** Per-tenant **data-residency configuration**: which providers (LLM, STT, storage, email) are allowed for this tenant's data. Default tenant inherits operator default; restricted tenants pin to in-region providers.
- **Enforcement:** The provider-selection layer reads `tenant.allowed_providers` and refuses to route to disallowed providers. Audit-log every provider selection.
- **Storage:** Per-tenant S3 bucket / region.
- **Documentation:** `docs/compliance.md` covers GDPR, Russian localization (152-FZ), data-residency configuration.
- **Optional PII redaction (DATA-05):** Pre-LLM redaction layer for sensitive tenants.

**Phase to address:** Phase 3 (Multi-tenancy) and Phase 8 (Compliance docs).

**Upstream cross-ref:** `PROJECT.md` DATA-05, PROVIDER-01..06.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Returning 200-with-error instead of 401 to "avoid breaking the client" | Faster initial handler | **Never acceptable.** Breaks the entire `withSessionRefresh()` retry path. | Never |
| Hard-coding `openwhispr://` in OAuth redirect | Saves 5 minutes parsing `callbackURL` | Breaks all dev/staging builds; silent black-hole UX | Never |
| Single-tenant DB without RLS, "we'll add multi-tenancy later" | Faster Phase 2 | Cross-tenant leak risk on every new table; full schema retrofit | Never (this project requires multi-tenant from Phase 3 per `DATA-01`) |
| Raw Redis client calls without tenant prefix | Faster code | Cross-tenant cache leak | Never |
| Skipping PgBouncer for "we don't have 1000 users yet" | Saves a service in compose | Connection storm on first traffic spike; rewrite under pressure | OK in development compose only; required in production |
| Pinning LiteLLM to `:latest` | Auto-bug-fixes | Auto-regressions (e.g., Pitfall 14) | Never in production |
| Skipping NDJSON flush testing because "it works in curl" | Faster Phase 4 | Buffering bug only surfaces through ingress chain in production | Never |
| Default secrets in compose for "developer ergonomics" | Easier local dev | Production deploys with default secrets | Never (use `.env.example` + bootstrap script) |
| Caching `quota:user_id` without tenant prefix | Slightly shorter keys | Cross-tenant quota collision | Never |
| Hard-coding English copy "we'll i18n later" | Faster initial UI | Massive refactor to extract strings; missed strings ship to RU users | Never (project requires `en`+`ru` from Phase 1 per `I18N-01`) |
| Manual `n === 1 ? "word" : "words"` pluralization | Looks simple | Breaks Russian (4 plural forms) | Never |
| Telemetry on by default | More usage data for the project | OSS reputation hit | Never |
| Migrations without `CONCURRENTLY` / `NOT VALID` "because the table is small" | Faster migration | API freeze on first large-table prod migration | Acceptable for tables provably < 10k rows in production; lint enforced |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LiteLLM (native models) | Trusting `:latest` tag | Pin to known-good tag with PR #25464 fix |
| LiteLLM (pass-through endpoints) | Assuming spend is metered | Parse nginx access logs into usage ledger separately |
| Speaches (model loading) | Treating readiness as "process up" | Readiness probe runs a canary transcription |
| Speaches (Realtime spec) | "OpenAI-compatible" without verification | Per-event compatibility matrix vs. desktop's actual usage |
| PgBouncer (transaction mode) | Using `SET app.tenant_id` | Use `SET LOCAL app.tenant_id` inside an explicit transaction |
| Better Auth `set-auth-token` | Revoking old token on rotation | Maintain ≥ 2-version overlap, ≥ 60s, prefer 5 min |
| Stripe webhooks | Not verifying signature | Always verify `Stripe-Signature` header before trusting payload |
| Custom protocol redirect | Hard-coded scheme | Echo from `callbackURL` query param |
| nginx ingress for streaming | Default `proxy_buffering on` | Per-route `proxy_buffering off` annotations |
| nginx ingress for WSS | Default 60s read/send timeout | 3600s on WSS routes |
| Redis | Single-tenant key namespace | `tenant:<uuid>:` prefix, enforced at wrapper |
| Background jobs | Forgetting tenant context propagation | Job runner re-establishes `SET LOCAL`, log MDC, OTel before handler runs |
| Email providers | Subject not translatable | Subject is a first-class translatable key |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| FD exhaustion on streaming | Sporadic 502s, EMFILE in logs | `ulimits.nofile=65536`; startup probe verifies | ~500 concurrent streams on default `1024` |
| Postgres connection storm | 5xx cascade on traffic spikes | PgBouncer transaction-pool, `SET LOCAL` discipline | ~200 concurrent users without pooler |
| Usage-ledger bloat | Slow ledger queries, autovacuum lag | Append-only design, daily partitions, tuned autovacuum | ~1M rows/day on a single non-partitioned table |
| Locking migration mid-deploy | API tier stalls during deploy | `CONCURRENTLY` / `NOT VALID` discipline + lint | First large-table migration after launch |
| NDJSON buffering at proxy | All chunks arrive simultaneously | Per-route `proxy_buffering off` + flush in handler | Always; exposed under any reverse proxy |
| WSS proxy timeout | Mid-meeting disconnects at fixed N min | `proxy_read/send_timeout 3600s` | Any WSS session > default ingress timeout |
| Slow-client backpressure unbounded | API-tier RSS climbs with active streams | Respect `res.write` return; per-stream cap | ~100 slow clients on unbounded buffers |
| Speaches cold-start | First transcribe after deploy 503s | Warm-up canary in readiness probe | Every deploy/restart |
| Cache TTL too long | Stale quota / stale user state | Per-key TTL with explicit invalidation on write | Quota inflation under high write rate |
| LiteLLM virtual-key budget reset semantics | Operators expect midnight reset, get 24h-rolling | Document explicitly; surface in admin UI | First billing cycle |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Bearer in logs | Token theft via SIEM access | Logging middleware scrubs auth headers; sentinel test |
| Default secrets in compose | Trivial root compromise on every install | No defaults; bootstrap generates; refuse-to-start check |
| HTTP allowed in production | Token-in-flight interception | HTTPS-only with HSTS; configurable for dev only |
| SSRF via webhook config | Cloud-credential exfiltration via IMDS | SSRF-safe HTTP client with private-IP block + DNS rebinding defense |
| Multipart unbounded | OOM / disk DoS | Three-tier size cap (ingress / app / LiteLLM) |
| Cross-tenant via missing RLS | Data breach | RLS-default on every `tenant_id` table; CI lint |
| Cross-tenant via PgBouncer transaction-pool | Data breach | `SET LOCAL` in every transaction; lint |
| Cross-tenant via Redis | Cache state leak | `tenant:` prefix wrapper; no raw client calls |
| Token rotation race | User-visible logout | ≥ 60s overlap window; 5min preferred |
| URL-unsafe characters in bearer | Windows desktop sign-in fails | Token regex `[A-Za-z0-9_-]+`; verified at issuance |
| OAuth state mismatch black-hole | Sign-in dead-end | HTML error page with retry, not a JSON 4xx |
| Open-redirect in `callbackURL` | Phishing vector | Allow-list `^openwhispr(-[a-z]+)?$` + configured overrides |
| Stripe webhook unverified | Fraudulent state changes | Always verify signature |
| PII in cross-border LLM calls | GDPR / 152-FZ violation | Per-tenant data-residency config; provider allow-list |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Quota exhaustion as 4xx | "Something went wrong" instead of "upgrade your plan" | 200 + `limitReached: true` per spec |
| OAuth dead-end on state mismatch | Blank browser, no signal | HTML error page with retry CTA |
| Silent token rotation logout | "I keep getting signed out" | Overlap window + grace-period rotation |
| First-launch > 5 min | Operator gives up; GitHub issue | Optimize bootstrap; small default models; CI smoke |
| Missing localized email subject | Russian email body, English subject | Subject is a translatable string |
| Hard-coded English in error response | Russian users see English errors | All response `error` strings go through i18n |
| Streaming feels frozen | Users abandon agent feature | Per-route flush + proxy buffering off + canary |
| Mid-meeting WSS disconnect | Lost notes; user trust lost | 3600s ingress timeout |
| Wrong language model on transcribe | Garbled output | Locale-driven model selection; canary tests |
| Diarization without text | Confusing partial output | Server-side stitch into unified shape |
| Default-secret production deploy | Public security incident | Refuse-to-start check |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **OAuth redirect:** Echoes `callbackURL`'s `protocol=` query param? Verify with `openwhispr-dev` and `openwhispr-staging` builds, not just production.
- [ ] **`/api/transcribe`:** Returns 200 + `limitReached: true` on quota — verify with a quota-zero tenant, not just "happy path."
- [ ] **`/api/agent/stream`:** First NDJSON line lands at client < 500ms after upstream LLM emits first token — verify through full ingress chain.
- [ ] **Auth 401:** All authenticated endpoints return `401` (not 200) on invalid bearer — verify with a contract-test sweep across every endpoint.
- [ ] **RLS:** Every `tenant_id`-bearing table has `relrowsecurity = true` — verify via introspection, not by reviewer attention.
- [ ] **PgBouncer transaction-pool:** RLS works under PgBouncer transaction-pool, not just direct connections.
- [ ] **Token rotation:** Old token accepted for ≥ 60s after `set-auth-token` issuance — verify with concurrent in-flight requests.
- [ ] **Speaches readiness:** Probe waits for actual model load, not process up — verify with cold-start simulation.
- [ ] **LiteLLM diarization:** Pinned version includes PR #25464; CI E2E test green on every build.
- [ ] **WSS ingress:** 3600s read/send timeouts; verify with a 65-min synthetic session.
- [ ] **i18n coverage:** Every `t("key")` exists in BOTH `en` and `ru`; CI gate.
- [ ] **Pluralization:** Russian 4-form pluralization tested at boundary cases.
- [ ] **Cookies in split-host topology:** `/api/check-user`/`/api/auth/verification-status`/`DELETE /api/auth/delete-account` work when auth-host ≠ API-host.
- [ ] **Default secrets:** Compose refuses to start with default secrets; bootstrap generates fresh.
- [ ] **License scan:** No GPL/AGPL/SSPL in production deps; CI gate.
- [ ] **Telemetry:** Off by default; documented; auditable.
- [ ] **Cross-tenant property test:** Random multi-tenant fuzz returns no cross-tenant rows over 10k+ ops.
- [ ] **Background-job tenant context:** Every handler is wrapped by tenant-context middleware; CI introspection gate.
- [ ] **Migrations:** All migrations are online (`CONCURRENTLY` / `NOT VALID`); lint enforces.
- [ ] **First-launch < 5 min:** Clean-VM CI runs the README quickstart and asserts.
- [ ] **Bearer not in logs:** Sentinel-token log-scrub test passes.
- [ ] **SSRF-safe webhooks:** IMDS / RFC1918 / DNS-rebinding tests pass.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wire drift (200 vs 401, etc.) | LOW per fix; HIGH if discovered post-release | Patch + regression contract test; emit a server-side metric on the deviated path; backport |
| Channel-scheme hardcode | LOW | Patch redirect to echo `callbackURL`; deploy; affected dev/staging users retry |
| Cross-tenant RLS leak | **HIGH** | Immediately revoke session of affected tenants; audit log to identify exposure; data-protection notification per legal obligation; root-cause + lint addition |
| Cross-tenant cache leak | MEDIUM | Flush Redis on the affected key prefix; deploy fix; audit logs to identify exposure |
| LiteLLM v1.82.3 multipart bug | LOW | Pin to ≥ 1.83.7 or apply patch; redeploy |
| WSS disconnects after default timeout | LOW | Update ingress annotations to 3600s; rolling restart |
| FD exhaustion | MEDIUM | Increase `ulimits.nofile`; redeploy; investigate FD leak if recurring |
| Postgres connection storm | MEDIUM | Add/scale PgBouncer; tune pool sizes; increase `max_connections` |
| Migration lock during deploy | HIGH | Manual recovery: roll back app to last known-good version; rerun migration during low-traffic window with the online pattern |
| Token rotation race logout | LOW | Extend overlap window; deploy; affected users sign in once |
| Default-secrets production install | **HIGH** | Rotate every secret immediately (DB, LiteLLM master key, virtual keys, JWT secret); audit access during exposure window; notify operators |
| Bearer in logs | MEDIUM | Rotate all tokens during exposure window; deploy log-scrub fix; audit log access |
| PII data-residency violation | **HIGH** | Halt provider routing for affected tenant; legal notification; per-tenant residency-config retrofit |
| First-launch UX > 5 min | LOW (rep cost) | README iteration; smaller default models; CI smoke gate |
| Hard-coded English shipped | LOW | Add translation key; ship in next release |

---

## Pitfall-to-Phase Mapping

This is the canonical mapping for roadmap planning. Each pitfall maps to the phase that should prevent it; verification column says how to confirm prevention worked.

| # | Pitfall | Prevention Phase | Verification |
|---|---------|------------------|--------------|
| 1 | 200-vs-401 on auth failure | Phase 2 (Wire/Auth) | Contract test sweep across all endpoints |
| 2 | 4xx on quota exhaustion | Phase 3 (Quota integration) | Zero-quota tenant transcribe returns 200 |
| 3 | NDJSON buffering | Phase 4 (Streaming) + Phase 7 (Ingress) | First-line latency < 500ms through full chain |
| 4 | Hard-coded `openwhispr://` | Phase 2 (Auth shim) | Multi-channel redirect matrix test |
| 5 | Cookie host-scoping | Phase 2 (Auth) + Phase 7 (Deploy) | Split-host topology integration test |
| 6 | OAuth state cookie loss | Phase 2 (Auth) + Phase 5 (Observability) | Error-rate metric + HTML error page |
| 7 | macOS vs Win/Linux argv | Phase 2 (Token format) | URL-safe-base64 lint at issuance |
| 8 | `set-auth-token` race | Phase 2 (Token rotation) | Concurrent-request rotation test |
| 9 | Refresh window outside grace | Phase 2 (Session lifetime) | 65s-sleep + request test |
| 10 | Missing RLS on new table | Phase 3 (Multi-tenancy) | RLS-introspection CI lint |
| 11 | `SET app.tenant_id` under PgBouncer | Phase 3 + Phase 6 | RLS test under transaction-pool |
| 12 | Background-job tenant context loss | Phase 5 (Jobs) | Job-handler wrapper introspection |
| 13 | Cache key cross-tenant collisions | Phase 3 + Phase 6 | Wrapper-only Redis access; lint |
| 14 | LiteLLM v1.82.3 multipart bug | Phase 4 (LiteLLM) | Pinned version + diarization E2E test |
| 15 | LiteLLM pass-through unmetered | Phase 4 + Phase 5 | Daily reconciliation job |
| 16 | Ingress < 1h WSS timeouts | Phase 4 + Phase 7 | 65-min WSS smoke test |
| 17 | Speaches cold-start | Phase 4 + Phase 7 | Readiness probe runs canary |
| 18 | Whisper RU/EN alias misconfig | Phase 4 (Config) | Per-language canary tests |
| 19 | Diarization separate from transcription | Phase 4 (Audio pipeline) | Multi-speaker fixture E2E |
| 20 | Realtime spec compatibility | Phase 4 (Realtime) | Per-event compatibility matrix |
| 21 | FD exhaustion | Phase 6 (Scale) + Phase 7 (ulimits) | 1000-stream load test |
| 22 | Reverse-proxy buffering (general) | Phase 4 + Phase 7 | Per-route ingress smoke test |
| 23 | Slow-client backpressure | Phase 6 (Scale) | Slow-client load test |
| 24 | Postgres connection exhaustion | Phase 6 (Scale) | PgBouncer load test |
| 25 | Usage-ledger VACUUM bloat | Phase 3 (Schema) + Phase 6 (Tuning) | Append-only + partition design; bloat metric |
| 26 | Locking migrations | Phase 3 (Migrations) + Phase 7 (Deploy) | Migration linter (squawk/pgroll) |
| 27 | Default secrets | Phase 7 (Deploy) | Refuse-to-start startup check |
| 28 | HTTPS-only vs local HTTP | Phase 7 + Phase 8 (Docs) | First-launch CI smoke |
| 29 | First-launch > 5 min | Phase 7 (Deploy) | Clean-VM CI quickstart timer |
| 30 | Upgrade path breaks | Phase 7 + Phase 8 (Release) | Upgrade-matrix CI test |
| 31 | Hard-coded English strings | Phase 8 (i18n) | ESLint rule + per-key locale audit |
| 32 | Pluralization (CLDR) | Phase 8 (i18n) | Boundary-case snapshot tests |
| 33 | Date/number formatting | Phase 8 (i18n) | Lint forbids `toLocaleString()` without locale |
| 34 | Email subject not localized | Phase 8 (i18n + email) | Subject-key audit |
| 35 | License compatibility (GPL) | Phase 8 (OSS) | License-scanner CI gate |
| 36 | Telemetry default | Phase 5 (Observability) | Default-disabled config audit |
| 37 | Branding/trademark | Phase 8 (OSS) | TRADEMARKS.md + identity-header review |
| 38 | Multipart upload DoS | Phase 4 + Phase 6 | Three-tier size-cap test |
| 39 | SSRF in webhooks | Phase 5 + Phase 8 (Security) | IMDS / RFC1918 rejection test |
| 40 | Bearer in logs | Phase 5 (Observability) | Sentinel-token log scrub test |
| 41 | PII data-residency | Phase 3 + Phase 8 (Compliance) | Per-tenant provider allow-list |

---

## Phase Research-Depth Flags

Phases that — based on pitfall density and severity — should plan for additional research/spike work before implementation:

- **Phase 2 (Wire/Auth contract):** 9 critical pitfalls (1, 4, 5, 6, 7, 8, 9, plus contract baseline). HIGH research depth — needs a full contract-test harness as part of Phase 2 deliverables.
- **Phase 3 (Multi-tenancy + Schema):** 6 critical pitfalls (10, 11, 12, 13, 25, 41). HIGH research depth — RLS + PgBouncer interaction is a known footgun; needs a spike.
- **Phase 4 (LiteLLM/Speaches integration):** 8 critical pitfalls (3, 14, 15, 16, 17, 18, 19, 20). HIGH research depth — LiteLLM behavior is the most-cited risk class in `speaches-audio.md`.
- **Phase 6 (Scale):** 4 critical pitfalls (21, 23, 24, 25). MEDIUM-HIGH — load-test plan is non-trivial; needs realistic 1000-user simulation.
- **Phase 7 (Deploy):** 5 critical pitfalls (16, 22, 27, 28, 29, 30). MEDIUM — well-understood but operator UX SLO is tight.
- **Phase 5 (Observability + Jobs):** 4 critical pitfalls (12, 36, 39, 40). MEDIUM — standard patterns but cross-cutting.
- **Phase 8 (OSS readiness + i18n):** 7 pitfalls (31, 32, 33, 34, 35, 37, 41). MEDIUM — process discipline rather than design depth.

---

## Sources

- `BACKEND_SPEC.md` (`/Users/dev/openwhispr/docs/BACKEND_SPEC.md`) — § Conventions, § Global Error Envelope, § `POST /api/transcribe`, § `POST /api/agent/stream`, every per-endpoint card. Authoritative for wire-contract pitfalls 1–9.
- `OAUTH_SPEC.md` (`/Users/dev/openwhispr/docs/OAUTH_SPEC.md`) — § Conventions, § OpenWhispr Cloud Sign-In, § Custom Protocol Reference. Authoritative for OAuth pitfalls 4–9.
- `SELF_HOSTING.md` (`/Users/dev/openwhispr/docs/SELF_HOSTING.md`) — § Authentication Contract, § OAuth Flow Walkthrough, § Edge Cases and Quirks. Narrative cross-reference for pitfalls 1–9.
- `speaches-audio.md` (`/Users/dev/openwhispr-server/speaches-audio.md`) — § Транскрипции (alias config, pitfall 18), § Диаризация (separate-call pattern, pitfall 19; pass-through metering, pitfall 15), § Realtime (timeout requirements, pitfall 16; spec compatibility, pitfall 20), § Известные баги (LiteLLM v1.82.3 multipart bug, pitfall 14).
- [BerriAI/litellm#25464](https://github.com/BerriAI/litellm/pull/25464) — upstream fix for the multipart pass-through 500 bug (pitfall 14).
- `.planning/PROJECT.md` (`/Users/dev/openwhispr-server/.planning/PROJECT.md`) — Active requirements (WIRE-*, AUTH-*, LITELLM-*, DATA-*, SCALE-*, OBS-*, DEPLOY-*, DOCS-*, I18N-*) cited inline.
- General distributed-systems / Postgres / nginx-ingress operational knowledge for pitfalls 11, 21–26 (HIGH confidence: standard practice).
- CLDR pluralization rules (Unicode CLDR) for pitfall 32.

---
*Pitfalls research for: OpenWhispr Server (open-source, enterprise self-hosted, wire-compatible backend, 1000 concurrent users, LiteLLM Proxy + Speaches default)*
*Researched: 2026-05-08*
