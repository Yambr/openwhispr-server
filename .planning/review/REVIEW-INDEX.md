# Code Review Index — pre-GitHub publication

Branch: main @ 13f0864
Date: 2026-05-17
Reviewers: 11 parallel `gsd-code-reviewer` agents
Scope: production source in `apps/**/src/**` + `packages/**/src/**`. Tests, tools, docs, compose, charts out of scope.

## Fix status (Phase 51)

**12/12 CRITICAL closed. ~24/39 HIGH closed.**

| CRITICAL | Fix commit |
|---|---|
| CR-1 BETTER_AUTH_SECRET boot | `6d82f3a` Plan 51-03 |
| CR-2 openai-realtime zod | `907150f` Plan 51-08 |
| CR-3 setup-admin auth | `2b3ad2e` Plan 51-01 |
| CR-4 session-token RSC→client leak | `747a195` Plan 51-04b |
| CR-5 CSP nonce | `e0f06f5` Plan 51-04c |
| CR-6 admin-guard fail-closed | `9f6f9e1` Plan 51-04a |
| CR-7 usage-rollup tenant-context | `57741e7` Plan 51-05 |
| CR-8 scheduler date freeze | `57741e7` Plan 51-05 |
| CR-9 DLQ silent loss | `57741e7` Plan 51-05 |
| CR-10 redactUrl collapse + JWT + hash | `9ee28d7` Plan 51-02 |
| CR-11 wire-schemas .max() + enums | `10b8c19` Plan 51-07 |
| CR-12 litellm error-drain timeout | `cc4cd4a` Plan 51-06 |

**HIGH closed** (23):
- worker (5): redact-nested + email-escape + audit-archive-SQL + retry-jitter + DLQ-aux (51-09 + 51-05)
- api-routes-rest (3): diarization smuggle + better-auth origin + desktop-signin decode (51-10)
- data (2): stale-fn-drop + TLS-by-default (51-14)
- wire-schemas (4): all enum/max (51-07)
- byok-guard (4): whitespace + sentinel-case + NODE_ENV-case + INGRESS-cascade (51-16)
- litellm-client (4): override-source + audio-leak + CR/LF (51-15) + dead-export @internal-tag (51-15b)
- small-pkgs (1): EmailSender dedup (51-17)
- web (1): observability javascript: vector (51-11)
- routes-conversations (2): notes-delete-all bypass + messages.content 256 KiB cap (51-12)
- api-core (2): token-rotation doc-truth (51-13) + console.warn bootstrap → pino (51-13b)
- redact MASTER_KEK + BETTER_AUTH_SECRET (51-09)

**HIGH remaining** (~15): web 5 (CSRF, locales, INTERNAL_API_URL dedup, list/search href, as-unknown-as cluster); routes-conversations 1 (LOCKER-04 sweep — multi-commit work); routes-transcriptions 5 (agent-stream AbortSignal forward, etc.); api-core 1 (as-unknown-as cluster); byok-guard 2 (bearer-in-query-value — partially covered by CR-10 fix; fetchAndParse redirect default); web 1 (as-unknown-as cluster).

## Aggregate counts

| Severity | Count |
|---|---|
| CRITICAL | 12 (closed) |
| HIGH     | 39 (~24 closed) |
| MEDIUM   | 50 (Plan 51-18 cleanup) |
| LOW      | 41 (Plan 51-18 cleanup) |

Spot-checked by orchestrator (Hard Rule 3 — trust but verify): byok CR-03, routes-rest CR-01, api-core CRIT-01, wire CR-01, worker C-3+C-3-usage, web CR-01. All confirmed against live code at HEAD.

## Per-package roll-up

| Package | C | H | M | L | Top risk |
|---|---|---|---|---|---|
| api-core                       | 1 | 3 | 11 | 9 | `BETTER_AUTH_SECRET` not validated at boot — sessions sign with `undefined` |
| api-routes-conversations       | 0 | 3 |  5 | 4 | LOCKER-04 debt — 19 routes lack `schema:` block |
| api-routes-transcriptions      | 1 | 6 |  4 | 4 | `tokens/openai-realtime.ts:79` — untyped `body.model` → paid-provider amplification |
| api-routes-rest                | 1 | 3 |  4 | 5 | `setup-admin.ts:152` missing `config.auth: false` → **first-run wizard wedged** |
| web                            | 3 | 6 |  7 | 6 | `account/page.tsx:27` — session token leaks RSC→client (`__NEXT_DATA__`) |
| worker                         | 3 | 5 |  4 | 3 | `usage-rollup-daily-tenant` DOA (GUC on client A, UPSERT on client B) |
| data                           | 0 | 3 |  5 | 6 | Stale SECURITY DEFINER `session_lookup_by_token` references dropped column |
| wire-schemas                   | 1 | 4 |  5 | 4 | `reason.ts` — `text.min(1)` without `.max()` → cost-multiplier DOS on LiteLLM |
| litellm-client                 | 1 | 4 |  4 | 3 | `chatCompletionsStream` `bodyTimeout:0` on error-drain → event-loop starvation |
| byok-guard + contract-tests    | 3 | 6 |  6 | 4 | **TWO `redactUrl`**; prod uses the weak `apps/api/src/lib/` copy; JWTs leak |
| small-pkgs (auth/email/i18n/observability) | 0 | 2 |  4 | 5 | `email-delivery.ts:47` duplicates `EmailSender` interface; redact policy split |

## Top three publication-blockers

1. **byok-guard/redact-url ≠ apps/api/src/lib/redact-url** — production catch-arms in `apps/api/src/index.ts:575/609/643` import the OLD masker that strips only `URL.password`. Every Better Auth session JWT, every ephemeral OpenAI/AssemblyAI/Deepgram token shape with `Bearer ey…` flows unmasked into logs. Even the "full sweep" byok-guard copy misses JWT shapes + `u.hash`. (byok CR-01/02/03)
2. **First-run admin wizard is broken** — `setup-admin.ts:152` lacks `config: { auth: false }` so the global `dualAuthHook` 401s every wizard-claim before any admin exists. e2e `@cjm-5.3` would fail under a real boot from clean state. (routes-rest CR-01)
3. **Worker scheduler subsystem is DOA**:
   - `usage-rollup-daily-tenant` throws `TenantContextMissingError` every invocation (GUC bound to client A, UPSERT via `deps.pool.query` → client B). (worker C-3)
   - `installSchedulers` freezes `date` payload at install time; every daily-rollup forever runs against install-boot day. (worker C-4)
   - `removeOnFail: { age: 7d }` + no DLQ → silent loss of `email-delivery` / `audit-archive` / `reconciliation-discrepancy` after `attempts:5`. (worker C-5)

---

## All CRITICAL findings

### CR-1 — `BETTER_AUTH_SECRET` never validated at boot
- **File:** `apps/api/src/auth.ts:325`
- **Report:** `.planning/review/api-core.md`
- **Evidence:** `secret: process.env.BETTER_AUTH_SECRET` passed verbatim. Better Auth 1.6.9 does not validate at construction.
- **Why it matters:** Missing env → sessions signed with `undefined`. BYOK guard + encryption-boot do not cover it.
- **Fix:** explicit `process.exit(78)` next to `validateEncryptionBoot()`.

### CR-2 — `tokens/openai-realtime.ts:79` — untyped body.model
- **File:** `apps/api/src/routes/tokens/openai-realtime.ts:79`
- **Report:** `.planning/review/api-routes-transcriptions.md`
- **Evidence:** `(req.body ?? {}) as RequestBody` — type assertion, not validation. `body.model` flows untyped to OpenAI POST. No length cap.
- **Why it matters:** Authed-user amplification primitive on paid-provider hop. Pair with missing zod `schema:` (LOCKER-04) for full bypass.
- **Fix:** zod schema for body; enum-allowlist `model`.

### CR-3 — First-run wizard claim is 401-wedged
- **File:** `apps/api/src/routes/setup-admin.ts:152`
- **Report:** `.planning/review/api-routes-rest.md`
- **Evidence:** `config: { rateLimit: ... }` — **no `auth: false`** unlike `setup-state.ts:75`. Global `dualAuthHook` 401s before any admin exists.
- **Why it matters:** First-run setup wedged → ship blocker for OSS quickstart.
- **Fix:** add `auth: false`, mirror Phase 35 CRIT-FIX-04 patch.

### CR-4 — Session token leaks RSC → client component
- **File:** `apps/web/src/app/(auth)/app/account/page.tsx:27`
- **Report:** `.planning/review/web.md`
- **Evidence:** `currentSessionToken = session.session.token` passed to `<AccountClient currentSessionToken={...}>`.
- **Why it matters:** Defeats HttpOnly cookie protection — bearer ends up in `__NEXT_DATA__` / JS heap.
- **Fix:** never read `.token` in RSC for client consumption; use server actions for token-bearing ops.

### CR-5 — Global CSP ships `'unsafe-inline'`
- **File:** `apps/web/next.config.ts:31`
- **Report:** `.planning/review/web.md`
- **Evidence:** `script-src 'self' 'unsafe-inline'` global on every route; per-request nonces "deferred."
- **Why it matters:** First-XSS-anywhere gets full JS execution.
- **Fix:** ship per-request nonce via Next.js middleware now.

### CR-6 — Admin role guard fails open on null session
- **File:** `apps/web/src/lib/admin-guard.ts:38`
- **Report:** `.planning/review/web.md`
- **Evidence:** `session === null` falls through to "allow" (relies on upstream Traefik). `getServerSession()` returns null on every error path.
- **Why it matters:** Forged/missing cookie bypasses role check; Traefik basicauth not mandatory in OSS quickstart.
- **Fix:** fail closed on null.

### CR-7 — `usage-rollup-daily-tenant` is DOA
- **File:** `apps/worker/src/jobs/usage-rollup-daily.ts:97-118`
- **Report:** `.planning/review/worker.md`
- **Evidence:** `withTenantContext` binds GUC on its own pool client; `deps.pool.query(...)` checks out a DIFFERENT client → runtime guard sees missing GUC → throws `TenantContextMissingError`.
- **Why it matters:** Every daily rollup fails.
- **Fix:** pass the client from `withTenantContext` callback instead of `deps.pool`.

### CR-8 — Schedulers freeze date at install time
- **File:** `apps/worker/src/scheduler.ts:53-77`
- **Report:** `.planning/review/worker.md`
- **Evidence:** `utcDateString(now)` evaluated once at `installSchedulers()` invocation; payload passed verbatim to `upsertJobScheduler`.
- **Why it matters:** Every daily rollup + reconciliation forever runs against the install-boot day.
- **Fix:** compute the date inside the handler from `job.timestamp`, not at install.

### CR-9 — No DLQ + `removeOnFail age:7d` → silent job loss
- **File:** `apps/worker/src/queues.ts:44-49`
- **Report:** `.planning/review/worker.md`
- **Evidence:** `attempts:5` + `removeOnFail: { age: 7 * 24 * 3600 }` — after 5 exhaustions the job is GC'd without operator notification.
- **Why it matters:** `email-delivery` / `audit-archive` / `reconciliation-discrepancy` losses produce no audit row.
- **Fix:** DLQ queue + `removeOnFail: false` (or `failed_jobs` audit table).

### CR-10 — `redactUrl` is two functions, prod uses the weak one
- **Files:**
  - `apps/api/src/lib/redact-url.ts:32` (weak — only `URL.password`)
  - `packages/byok-guard/src/redact-url.ts` (full sweep, claims source-of-truth)
  - `apps/api/src/index.ts:107` imports the weak one; lines 575/609/643 use it
- **Report:** `.planning/review/byok-guard-contract-tests.md`
- **Evidence:** `import { redactUrl } from "./lib/redact-url.js";` Even byok-guard's "full sweep" version misses `Bearer ey…` JWT shapes (its CR-01) and the URL hash fragment (its CR-02).
- **Why it matters:** Every Better Auth session JWT, OpenAI/AssemblyAI/Deepgram ephemeral bearer, OAuth2 implicit-flow `#access_token=…` leak into logs.
- **Fix:** delete `apps/api/src/lib/redact-url.ts`, redirect imports to `@openwhispr/byok-guard`, extend `BEARER_SHAPES` to JWT + add `u.hash` inspection.

### CR-11 — wire-schemas `ReasonRequest.text` has no `.max()`
- **File:** `packages/wire-schemas/src/reason.ts:7-15`
- **Report:** `.planning/review/wire-schemas.md`
- **Evidence:** `text: z.string().min(1)` — no upper bound. Forwarded verbatim to LiteLLM.
- **Why it matters:** Multi-MB prompt → cost-multiplier DOS. Same bug Phase 41.b fixed for `/api/agent/stream`, missed on `/api/reason`.
- **Fix:** add `.max(N)` matching agent-stream cap.

### CR-12 — `chatCompletionsStream` error-drain has no body timeout
- **File:** `packages/litellm-client/src/index.ts:341,354`
- **Report:** `.planning/review/litellm-client.md`
- **Evidence:** `bodyTimeout: 0` correct for SSE 2xx; same flag applied on the non-2xx path where `await res.body.text()` reads the error body.
- **Why it matters:** Slow-rolled upstream error → fastify handler hangs forever → dispatcher slot leak → event-loop starvation at 1000 VU.
- **Fix:** branch `bodyTimeout` by `res.statusCode`.

---

## All HIGH findings (one-liners, grouped by package)

**api-core (3):**
- `token-rotation.ts` header doc claims plaintext storage; body writes SHA-256 fp only (audit-risk).
- 15× `as unknown as` violates LOCKER-02; worst offender is the drizzle-adapter cast at `auth.ts:323`.
- `console.warn/error` at bootstrap bypasses pino → no trace correlation.

**api-routes-conversations (3):**
- All 19 routes in LOCKER-04 debt allowlist — no zod `schema:`.
- `notes/delete-all.ts` cap bypassable via tombstones (count filters `deleted_at IS NULL` but DELETE purges tombstones).
- `conversations/messages.ts` POST `content` has no `.max()` (metadata is capped at 4 KiB; `content` only bounded by global Fastify `bodyLimit`).

**api-routes-transcriptions (6):**
- LOCKER-04 missing `schema:` on `tokens/openai-realtime.ts`.
- `agent/stream.ts:200-227` AbortSignal not forwarded → client disconnect doesn't kill paid upstream stream.
- 4 more — see report.

**api-routes-rest (3):**
- `diarization.ts:464` — multipart filename + Content-Type interpolation against Speaches → request smuggling.
- `better-auth-handler.ts:45` — Better Auth origin from unvalidated `Host` header + localhost fallback.
- `desktop-signin.ts:72` — swallowed `decodeURIComponent` weakens scheme-allowlist.

**web (6):**
- signOut server-action lacks CSRF/Origin check.
- 8+ hardcoded English strings outside locales.
- `INTERNAL_API_URL` plaintext default duplicated across 7 files; no URL validation.
- `<a href={loki}>` unvalidated → javascript: vector.
- list/search hrefs use unvalidated `row.id`.
- 5× `as unknown as` in production → LOCKER-02.

**worker (5):**
- Retry backoff no jitter → thundering herd on upstream outage.
- Pino redact misses `err.response.config.headers.Authorization` → `Bearer sk-…` leaks on every upstream-401.
- `reconciliation-discrepancy` cross-pool work inside the HOF's tx (idempotency saves it from CRITICAL).
- Email HTML template renders without escape → future stored-XSS-in-email.
- `audit-archive` interpolates `AUDIT_ARCHIVE_BUCKET` into `psql -c` SQL → operator-env injection.

**data (3):**
- Stale SECURITY DEFINER `session_lookup_by_token(text)` references dropped column → 42703 on call. Needs `0023_drop_stale_session_lookup_by_token.sql`.
- `lookupSessionByPreviousToken` helper dead in prod; `apps/api/src/lib/token-rotation.ts:111-127` duplicates SQL.
- No TLS opt-in on `pg.Pool` — DATABASE_URL must include `?sslmode=require` or rows traverse plaintext.

**wire-schemas (4):**
- `ReasonRequest.{provider,promptMode,matchType,model}` unconstrained `z.string()` despite enum-shape per spec; server echoes verbatim into response.
- `DiarizationResponse` `.passthrough()` + unbounded `start/end` (accepts NaN/Infinity/negative).
- `DeleteAccountResponse = z.object({}).passthrough()` — accepts literally any object.
- `check-user.ts:11` + `verification-status.ts:7` — emails lack `.max()` on unauthenticated probe endpoints.

**litellm-client (4):**
- `audioTranscriptions` PassThrough leaks source `Readable` on mid-upload abort.
- `isOverride` reads `process.env.LITELLM_BASE_URL` not `config.baseUrl` (drift risk in corporate deploy).
- Caller header values not CR/LF-rejected.
- 5 exported symbols have zero non-test consumers (LOCKER-04 dead-export).

**byok-guard + contract-tests (6):**
- Whitespace-only env value passes guard.
- `=disabled` sentinel case-sensitive + trailing-space-fragile.
- `NODE_ENV=Production` (capital P) bypasses SMTP gate.
- Bearer shapes in query VALUES (not credential param names) survive redaction.
- `INGRESS_BASE_URL` has no cascade despite scope.
- `fetchAndParse` does not default `redirect: 'error'`.

**small-pkgs (2):**
- `apps/worker/src/jobs/email-delivery.ts:47-54` redeclares `EmailSender` instead of importing from `@openwhispr/email`.
- Two redact implementations (observability + byok-guard) with asymmetric coverage (observability misses `x-amz-*`; byok-guard misses provider env-var names + `MASTER_KEK`).

---

## Cross-cutting patterns

1. **Duplication of security-critical logic.** Three independent occurrences:
   - `redactUrl` × 2 (`apps/api/lib` vs `packages/byok-guard`) — CRITICAL drift.
   - `EmailSender` interface × 2 (apps/worker vs packages/email).
   - `REDACT_PATHS` × 2 (packages/observability vs packages/byok-guard) — coverage asymmetry.
2. **LOCKER-04 route discipline incomplete.** 19+ routes lack `schema:`; deferred to Phase 41 but ships to GitHub as the canonical pattern.
3. **Missing `.max()` on user-text inputs** across `reason.ts`, `conversations/messages.ts`, `check-user.ts`, `verification-status.ts` — fixed for `agent/stream.ts` but pattern not enforced repo-wide.
4. **`as unknown as` clusters** in api-core + web — 20+ occurrences, LOCKER-02 violation.
5. **Worker observability blind spot.** Pino `redact` omits nested HTTP-error fields (`err.response.config.headers.Authorization`) — every upstream-401 leaks bearer.

---

## Recommended fix order (publication-blocker first)

1. **byok CR-10 (CR-01/02/03 in byok report)** — collapse to one `redactUrl`, cover `Bearer ey…` + `u.hash`. *Single most leverage.*
2. **routes-rest CR-3 (CR-01 in routes-rest report)** — `setup-admin.ts` `config.auth: false`. *Unblocks first-run wizard.*
3. **web CR-4 (CR-01 in web report)** — stop reading `session.token` from RSC.
4. **api-core CR-1 (CRIT-01 in api-core report)** — `BETTER_AUTH_SECRET` boot validation.
5. **worker CR-7/CR-8/CR-9** — scheduler payload + tenant-context client + DLQ.
6. **wire CR-11** + transcriptions CR-2 — `.max()` + zod schema on `model`.
7. **litellm-client CR-12** — error-drain `bodyTimeout`.
8. **web CR-5/CR-6** — CSP nonce + admin-guard fail-closed.
9. **All HIGH** — in roll-up order; cluster by package to amortize context-switch.
10. **Dead-code purge** (data HI-02 + 5 litellm-client exports + email/auth/i18n stubs) — cheapest pass.

---

## E2E coverage notes (user question, answered out-of-band)

| Flow | Feature | Scenarios |
|---|---|---|
| Admin onboarding | `tests/e2e-cjm/features/admin-onboarding.feature` | `/admin` 200, basicauth 401, `/setup` flips setup_state pending→completed |
| User signup | `tests/e2e-cjm/features/signup-verify.feature` | signup→verify-email→signin, duplicate-email 422, short-password 4xx, ru-locale errors, zero-OIDC providers |
| Signin | `tests/e2e-cjm/features/signin.feature` | verified→200+cookie, unverified→4xx (resend signal) |

Adjacent coverage: `oidc-providers.feature`, `sso/keycloak-oidc.feature`, `password-reset.feature`, `session-refresh.feature`, `locale-switch.feature`.

**Caveat:** the `admin-onboarding.feature @cjm-5.3` scenario will fail in a clean boot once `setup-admin.ts` is fixed and the e2e harness re-runs — CR-3 (above) blocks it today.

---

## Links

- `.planning/review/api-core.md`
- `.planning/review/api-routes-conversations.md`
- `.planning/review/api-routes-rest.md`
- `.planning/review/api-routes-transcriptions.md`
- `.planning/review/web.md`
- `.planning/review/worker.md`
- `.planning/review/data.md`
- `.planning/review/wire-schemas.md`
- `.planning/review/litellm-client.md`
- `.planning/review/byok-guard-contract-tests.md`
- `.planning/review/small-pkgs.md`
