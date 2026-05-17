# Phase 51 — Pre-OSS Review Fixes

**Status:** PLANNED
**Branch base:** main @ 13f0864
**Trigger:** `.planning/review/REVIEW-INDEX.md` (12 CRITICAL, 39 HIGH from 11-agent parallel review pre-publication)
**Goal:** Repository passes its own constitutional gates on a clean boot, with zero CRITICAL and zero HIGH findings remaining from the pre-publication review. After this phase the repository is publishable to GitHub.

## Constitutional discipline (CLAUDE.md, NON-NEGOTIABLE)

Every plan in this phase follows strict TDD: **RED → GREEN → REFACTOR**.
- Each fix ships with its test(s) in the same atomic commit.
- Per-phase coverage floor ≥ 90% on lines/branches/functions/statements for new/modified code.
- E2E mandatory for every plan touching a user-visible route, wire surface, or operator-facing artifact.
- No mocks of internal logic — mocks only at process/network boundaries.
- Hard Rule 1 honored: do NOT touch production SQL/code only to make a test pass.
- Hard Rule 3 honored: orchestrator verifies each plan's commits independently before marking GREEN.
- Hard Rule 4 honored: no `--no-verify` bypass on gitleaks hooks.

## Verification gate (phase-exit condition)

Phase 51 closes only when:
1. **Aggregate test gate** — `pnpm test` (full root, all projects) returns exit 0. Zero file-level failures, zero test-level failures.
2. **Coverage gate** — `pnpm test --coverage` reports ≥ 90/90/90/90 on the diff introduced by this phase.
3. **E2E gate** — `make e2e-test` (full Playwright + CJM Cucumber suite against real docker compose stack) returns exit 0 on a clean boot. The two critical regressions seeded by review findings are explicitly re-verified:
   - **`@cjm-5.3`** (admin-onboarding wizard claim) GREEN after Plan 51-01.
   - **`@cjm-1.1` + `@cjm-2.1`** (signup→verify→signin round-trip + verified-signin) GREEN end-to-end after Plan 51-03 + 51-05.
4. **Lockers green** — `pnpm exec tools/lint-prod-readiness.ts` + `lint-no-suppressions.ts` + `lint-secret-shape-in-error.ts` + `lint-no-plaintext-secret-columns.ts` + `lint-no-hardcode.ts` + `lint-no-env-branches.ts` all pass. No new allowlist entries unless documented in a DECISIONS.md addendum.
5. **Review-index re-check** — orchestrator re-runs the spot-check for every CRITICAL/HIGH from REVIEW-INDEX.md and confirms the cited file:line either no longer exists or the issue is mitigated. Append `FIX-VERIFIED: <commit>` line under each finding in REVIEW-INDEX.md.

## Plan inventory

Plans grouped into 5 waves by dependency + risk. Inside a wave, plans run sequentially (single-author work, no parallel agents in this phase — every plan touches security-critical surface and must be reviewed individually).

| Plan | Title | Wave | Severity | Maps to |
|---|---|---|---|---|
| 51-01 | Setup-admin auth gate | 1 | CRITICAL | CR-3 |
| 51-02 | `redactUrl` collapse + JWT + hash | 1 | CRITICAL | CR-10 |
| 51-03 | Better-Auth secret + bootstrap validation | 1 | CRITICAL | CR-1 |
| 51-04 | Web session-token + admin-guard + CSP nonce | 2 | CRITICAL ×3 | CR-4, CR-5, CR-6 |
| 51-05 | Worker schedulers + tenant-context + DLQ | 2 | CRITICAL ×3 | CR-7, CR-8, CR-9 |
| 51-06 | LiteLLM client error-drain timeout | 2 | CRITICAL | CR-12 |
| 51-07 | Wire-schemas `.max()` + enum hardening | 2 | CRITICAL + HIGH | CR-11 + 4× HIGH |
| 51-08 | OpenAI-realtime token route zod | 2 | CRITICAL | CR-2 |
| 51-09 | Worker observability + redact-nested | 3 | HIGH ×3 | worker HIGH cluster |
| 51-10 | API-routes-rest auth/origin/multipart | 3 | HIGH ×3 | routes-rest HIGH |
| 51-11 | Web hardening — CSRF + locales + `INTERNAL_API_URL` | 3 | HIGH ×6 | web HIGH cluster |
| 51-12 | LOCKER-04 route schema sweep (19 routes) | 4 | HIGH | conversations HIGH-1 + transcriptions HIGH |
| 51-13 | API-core suppressions + token-rotation doc | 4 | HIGH ×3 | api-core HIGH cluster |
| 51-14 | Data — drop stale fn + TLS opt-in + dead helper | 4 | HIGH ×3 | data HIGH cluster |
| 51-15 | LiteLLM-client header CRLF + readable leak + override-source | 4 | HIGH ×4 | litellm-client HIGH cluster |
| 51-16 | BYOK guard hardening (whitespace, sentinels, cascade) | 4 | HIGH ×6 | byok HIGH cluster |
| 51-17 | Small-pkgs duplication (`EmailSender`, redact paths, MASTER_KEK) | 4 | HIGH ×2 | small-pkgs HIGH |
| 51-18 | Dead-code purge + REVIEW-INDEX `FIX-VERIFIED` annotation | 5 | LOW | cleanup |
| 51-19 | Full e2e re-run + coverage gate + phase-close | 5 | gate | verification |

---

## Wave 1 — publication-blocker hot-path (sequential)

### Plan 51-01 — Setup-admin auth gate

**Maps to:** REVIEW-INDEX.md CR-3 (api-routes-rest CR-01).

**Goal:** First-run admin wizard claim succeeds in a clean boot.

**RED:**
- Add `tests/e2e/setup-admin-wizard.spec.ts` that boots a fresh compose stack with `setup_state='pending'`, POSTs to `/api/setup-admin` with no session cookie, asserts 200 + `setup_state` flips to `completed` + a session cookie is set. Test MUST FAIL on main.
- Add `apps/api/tests/integration/routes/setup-admin-auth.test.ts` that asserts the route declaration includes `config.auth: false`.

**GREEN:**
- `apps/api/src/routes/setup-admin.ts:152` — add `auth: false` to `config`, mirroring `setup-state.ts:75`.

**REFACTOR:**
- Extract a `Phase35CritFix04Routes` const that lists all setup-related public routes; have `setup-admin`, `setup-state`, `auth-providers` reference it; add a unit test ensuring the const matches reality. Prevents next reviewer from spotting the same miss in a sister route added later.

**E2E:**
- `tests/e2e-cjm/features/admin-onboarding.feature` `@cjm-5.3` — already exists, must GREEN after fix.

**Commit boundary:** single atomic commit.

---

### Plan 51-02 — `redactUrl` collapse + JWT + hash

**Maps to:** CR-10 (byok-guard CR-01 + CR-02 + CR-03).

**Goal:** Exactly one `redactUrl` implementation in the codebase, and it masks JWT shapes (`Bearer ey…`, `eyJ…` in path/query) + URL hash fragment.

**RED:**
- Extend `packages/byok-guard/tests/redact-url.test.ts` with:
  - `"https://api.example.com/v1/eyJhbGciOiJIUzI1NiJ9.payload.sig" → masked`
  - `"https://oauth.example.com/cb#access_token=ey..."` → mask hash.
  - `"redactUrl is referenced by 1 production importer"` — grep test ensuring `apps/api/src/lib/redact-url.ts` is gone.
  - `"apps/api/src/index.ts uses @openwhispr/byok-guard.redactUrl"` — import-source assertion.

**GREEN:**
- Extend `BEARER_SHAPES` in `packages/byok-guard/src/redact-url.ts` with JWT pattern: `/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g`.
- Add `if (u.hash) { u.hash = "#<redacted>" }` (or per-param mask if hash has `&`-separated key/value).
- Delete `apps/api/src/lib/redact-url.ts`.
- Update `apps/api/src/index.ts:107` import to `import { redactUrl } from "@openwhispr/byok-guard";`.
- Re-export from `packages/byok-guard/src/index.ts` if not already.

**REFACTOR:**
- Add a property-test (`fast-check`) that for any string containing a JWT shape, output never contains the original JWT verbatim.

**Verification:** `grep -rn "redactUrl" apps/ packages/ --include="*.ts" --exclude="*.test.ts" | grep -v "from \"@openwhispr/byok-guard\""` returns 0 lines.

---

### Plan 51-03 — Better-Auth secret + bootstrap validation

**Maps to:** CR-1 (api-core CRIT-01).

**Goal:** Boot fails fast (exit 78) when `BETTER_AUTH_SECRET` missing/short.

**RED:**
- Add `apps/api/tests/integration/bootstrap-better-auth-secret.test.ts` that spawns `node dist/index.js` with unset `BETTER_AUTH_SECRET` and asserts exit code 78 + stderr line matches `/BETTER_AUTH_SECRET.+required/`.

**GREEN:**
- Add `validateBetterAuthSecret()` function in `apps/api/src/auth.ts` (or in `bootstrap.ts` next to `validateEncryptionBoot()`): require `BETTER_AUTH_SECRET` to be present, base64url-decode to ≥ 32 bytes.
- Call from `bootstrap.ts` before `buildBetterAuth()`.
- Update `packages/byok-guard` to add `BETTER_AUTH_SECRET` to the always-required env row (parity with `MASTER_KEK`).

**REFACTOR:**
- Document in `docs/security.md` §12 alongside KEK provisioning recipes.

---

## Wave 2 — system-critical (sequential)

### Plan 51-04 — Web session-token + admin-guard + CSP nonce

**Maps to:** CR-4, CR-5, CR-6.

**Goal:** Better-Auth session token never leaves the server; admin role guard fails closed; production CSP ships per-request nonce.

**RED:**
- `apps/web/tests/integration/account-page-no-token-leak.test.ts`:
  - Render `app/(auth)/app/account/page.tsx` server-side, serialize the `__NEXT_DATA__` flight payload, assert it does NOT contain the substring `session.token` value or any `Bearer ey…` shape.
- `apps/web/tests/unit/lib/admin-guard.test.ts`:
  - `null` session → forbidden (no fall-through to Traefik).
  - Thrown session-fetch error → forbidden.
- `apps/web/tests/integration/csp-nonce.test.ts`:
  - GET `/` → `Content-Security-Policy` header includes `script-src 'self' 'nonce-<value>'` and NOT `'unsafe-inline'`.
  - Each request has a fresh nonce.

**GREEN:**
- `apps/web/src/app/(auth)/app/account/page.tsx:27`: remove `currentSessionToken` prop; if `AccountClient` needs a per-session "this is the current one" hint, derive from cookie name match or pass `sessionId` only (PII-free).
- `apps/web/src/lib/admin-guard.ts:38`: change `if (session === null) return /* allow */` to fail-closed.
- `apps/web/next.config.ts:31` + `apps/web/src/middleware.ts`: generate per-request nonce, inject into CSP header, pass via `headers()` for Server Components to read; drop `'unsafe-inline'`.

**REFACTOR:**
- Audit every other RSC for `.token` reads via `grep -rn "session\\.session\\.token\\|session\\.token" apps/web/src --include="*.tsx" --include="*.ts"`.

**E2E:**
- `tests/e2e-cjm/features/admin-onboarding.feature` `@cjm-5.1` + `@cjm-5.2` — still GREEN.
- Add a new `@cjm-5.4` scenario: load `/app/account`, inspect HTML/JSON of the page, fail if any string in body matches `Bearer ey…` or the cookie token value.

---

### Plan 51-05 — Worker schedulers + tenant-context + DLQ

**Maps to:** CR-7, CR-8, CR-9.

**Goal:** Daily-rollup, reconciliation, audit-archive jobs run correctly on a real schedule; failed jobs land in a DLQ; tenant-context is honored by the actual UPSERT statement.

**RED:**
- `apps/worker/tests/integration/usage-rollup-runs-against-real-pg.test.ts`:
  - Boot testcontainers PG, set up `tenant_id=X`, insert one ledger row, enqueue the rollup job via BullMQ, await completion, assert the `usage_rollup_daily` row exists for the correct tenant. MUST FAIL on main with `TenantContextMissingError`.
- `apps/worker/tests/unit/scheduler-date-rotation.test.ts`:
  - Mock clock at `T0`, call `installSchedulers()`, advance clock by 24h, fire scheduler, assert the payload `date` is `T0+24h`, not `T0`.
- `apps/worker/tests/integration/dlq-on-attempts-exhausted.test.ts`:
  - Enqueue a job that always throws, set `attempts:2`, await exhaustion, assert a row appears in `failed_jobs` audit table with the full error payload.

**GREEN:**
- `apps/worker/src/jobs/usage-rollup-daily.ts:97-118`: refactor `withTenantContext` to expose the bound client to the callback. Pass that client to the UPSERT.
- `apps/worker/src/scheduler.ts:53-77`: stop materializing `date` at install; compute it inside the handler from `job.timestamp` / `new Date()`.
- `apps/worker/src/queues.ts:44-49`: remove `removeOnFail: { age: ... }`; add a `failed_jobs` table migration + a per-queue `onFailed` listener that writes there; alert via metric counter.

**REFACTOR:**
- Add `apps/worker/src/lib/with-tenant-context.ts` exposed-client signature `withTenantContext<T>(schema, pool, async (data, client) => …)` so the pattern is unmistakable.

**E2E:**
- `tests/e2e/audit-log-write.test.ts` — already exists, must still GREEN.
- New: `tests/e2e/daily-rollup-runs.test.ts` — set tenant fixture, enqueue ledger, fire scheduler, assert rollup row.

---

### Plan 51-06 — LiteLLM client error-drain timeout

**Maps to:** CR-12.

**Goal:** `chatCompletionsStream` error path has a bounded body-read.

**RED:**
- `packages/litellm-client/tests/error-drain-timeout.test.ts`:
  - Mock-LiteLLM returns 500 + a body stream that yields one byte then hangs indefinitely.
  - Assert `chatCompletionsStream` rejects within 10s with a `LitellmUpstreamError`, not hang.

**GREEN:**
- `packages/litellm-client/src/index.ts:341,354`: branch the request init by code path. SSE 2xx keeps `bodyTimeout: 0`; non-2xx error-drain gets `bodyTimeout: 10_000` (or const).

**REFACTOR:**
- Extract a `STREAM_BODY_TIMEOUT_MS = 0` + `ERROR_DRAIN_TIMEOUT_MS = 10_000` const block at top.

---

### Plan 51-07 — Wire-schemas `.max()` + enum hardening

**Maps to:** CR-11 + 4× HIGH from wire-schemas report.

**Goal:** No unbounded `z.string()` user-input field in the wire surface; enum-shaped fields enforce enums.

**RED:**
- `packages/wire-schemas/tests/reason.test.ts`:
  - `text` length > `MAX_REASON_TEXT` → parse error.
  - `provider`, `promptMode`, `matchType`, `model` non-enum value → parse error.
- `packages/wire-schemas/tests/diarization.test.ts`:
  - `start = NaN` / `Infinity` / negative → parse error.
  - `.passthrough()` removed: an extra key → parse error.
- `packages/wire-schemas/tests/check-user.test.ts` + `verification-status.test.ts`:
  - email > 254 bytes → parse error.
- `packages/wire-schemas/tests/delete-account.test.ts`:
  - extra key in body → parse error.

**GREEN:**
- `reason.ts`: `text: z.string().min(1).max(MAX_REASON_TEXT)`; enum each of provider/promptMode/matchType against the spec values.
- `diarization.ts`: drop `.passthrough()`; `start/end: z.number().finite().nonnegative()`.
- `check-user.ts` + `verification-status.ts`: `email: z.string().email().max(254)`.
- `delete-account.ts`: `z.object({}).strict()`.

**REFACTOR:**
- Add a `tools/lint-no-passthrough-on-user-input.ts` linter that scans wire-schemas for `.passthrough()` on user-input schemas (allowlist response-only schemas).

---

### Plan 51-08 — OpenAI-realtime token route zod

**Maps to:** CR-2.

**Goal:** `/api/v1/tokens/openai-realtime` has a fastify-zod schema; `model` is enum-allowlisted.

**RED:**
- `apps/api/tests/integration/routes/openai-realtime-token.test.ts`:
  - POST with `model: "../etc/passwd"` → 400.
  - POST with `model: "a".repeat(10_000)` → 400.
  - POST with no body → 400 (not type-asserted undefined).

**GREEN:**
- Add `packages/wire-schemas/src/openai-realtime-token.ts` with strict zod schema (model: enum of known realtime models).
- `apps/api/src/routes/tokens/openai-realtime.ts:79`: wire `schema: { body: OpenAiRealtimeTokenRequest }`; remove the cast.

**REFACTOR:**
- Validate `body.streams` cap stays inside zod, drop the manual `≤2` check downstream.

---

## Wave 3 — high-severity hardening (sequential)

### Plan 51-09 — Worker observability + redact-nested

**Maps to:** worker HIGH cluster — pino redact misses `err.response.config.headers.Authorization`; retry no jitter; email template no escape; audit-archive SQL interpolation.

**RED:**
- `apps/worker/tests/unit/logging/redact-nested-error.test.ts`:
  - Construct `err = { response: { config: { headers: { Authorization: "Bearer sk-12345" } } } }`, log via worker's `childLog`, capture stdout, assert no `sk-12345` substring.
- `apps/worker/tests/unit/queue/retry-jitter.test.ts`:
  - Compute backoff for `attempt=3` 1000 times, assert variance > 0 (jitter present).
- `apps/worker/tests/unit/i18n/template-escape.test.ts`:
  - Render template with `name = "<script>alert(1)</script>"`, assert output contains `&lt;script&gt;`.
- `apps/worker/tests/unit/jobs/audit-archive-no-sql-interpolation.test.ts`:
  - Set `AUDIT_ARCHIVE_BUCKET="; DROP TABLE audit_log;"`, run the job, assert it rejects at validation time (not via `psql -c`).

**GREEN:**
- `apps/worker/src/lib/pino-config.ts` (or wherever redact is configured): extend `redact.paths` to include `err.response.config.headers.Authorization`, `err.response.headers.Authorization`, `err.config.headers.Authorization`. Add wildcard `*.headers.authorization` case-insensitive.
- `apps/worker/src/queues.ts` retry: `backoff: { type: "exponential", delay: 1000, jitter: 1 }` (BullMQ supports `jitter` factor) or replace with custom handler.
- `apps/worker/src/i18n/template-renderer.ts:128-133`: escape HTML on interpolation. Use `escape-html` or hand-roll.
- `apps/worker/src/jobs/audit-archive.ts`: validate `AUDIT_ARCHIVE_BUCKET` against `/^[a-z0-9.\-]{3,63}$/` at boot; bind via argv to mc/psql, never template-literal.

**REFACTOR:**
- Add `apps/worker/src/lib/redact-paths.ts` exporting the canonical path list, shared with `apps/api`.

---

### Plan 51-10 — API-routes-rest auth/origin/multipart

**Maps to:** routes-rest HIGH (3).

**Goal:** Diarization upstream not smugglable; better-auth origin validated; desktop-signin scheme allowlist robust.

**RED:**
- `apps/api/tests/integration/routes/diarization-smuggle.test.ts`:
  - Multipart upload with filename `"a\r\nContent-Length: 0\r\n\r\nGET /admin HTTP/1.1\r\n"` → 400 (filename validation rejects CR/LF) or sanitized before forwarded.
- `apps/api/tests/integration/routes/better-auth-handler-origin.test.ts`:
  - Request with `Host: evil.example.com` → 400 (or override to canonical via env-config), not used as Better Auth origin.
- `apps/api/tests/unit/routes/desktop-signin-uri-decode.test.ts`:
  - `decodeURIComponent` throws on malformed → 400, not passed through.

**GREEN:**
- `apps/api/src/routes/diarization.ts:464`: validate `filename` + `Content-Type` against `/^[A-Za-z0-9._\- ]+$/` and `/^[a-z]+\/[a-z0-9.+\-]+$/` respectively before forwarding to Speaches.
- `apps/api/src/routes/better-auth-handler.ts:45-51`: use `INGRESS_BASE_URL` env (must be set per BYOK guard) as the canonical origin; refuse to fall back to `Host` header.
- `apps/api/src/routes/desktop-signin.ts:72-80`: try-catch around `decodeURIComponent`, on throw return 400.

---

### Plan 51-11 — Web hardening (CSRF + locales + INTERNAL_API_URL + javascript: + as unknown as)

**Maps to:** web HIGH (6).

**RED:**
- `apps/web/tests/integration/sign-out-csrf.test.ts`:
  - POST sign-out with `Origin: https://evil.example.com` → 403.
- `apps/web/tests/unit/locale-parity.test.ts`:
  - Walk every `.tsx` in `apps/web/src/`, parse string literals in JSX text + attributes that look like user-visible copy, assert each has an `en` + `ru` locale key. Allowlist known acceptable bare strings (icons-only buttons).
- `apps/web/tests/integration/external-link-allowlist.test.ts`:
  - `<a href="javascript:alert(1)">` rendered from `NEXT_PUBLIC_LOKI_BASE_URL` → either refuse to render or strip; assert `href` starts with `https://` or relative.
- `tools/lint-no-suppressions.test.ts` — add 5 web file paths to the FAIL fixtures and ensure the locker BLOCKs them.

**GREEN:**
- Sign-out server-action: check `headers().get('origin') === appOrigin`.
- Lift hardcoded strings into `apps/web/src/locales/{en,ru}/*.json`.
- Centralize `INTERNAL_API_URL` resolution in `apps/web/src/lib/internal-api-url.ts` with URL validation; replace 7 callsites.
- `<a href={loki}>`: validate `URL.parse(loki).protocol` ∈ `{"https:", "http:"}` before render; else 404.
- Replace 5× `as unknown as` with proper typing (introduce `satisfies` patterns or zod-parse boundary).

---

### Wave 4 — locker debt + dead code (sequential)

### Plan 51-12 — LOCKER-04 route schema sweep

**Maps to:** routes-conversations HIGH-1 (19 routes) + routes-transcriptions HIGH (5 routes) + routes-rest HIGH.

**Goal:** Every Fastify route in scope declares `schema:` against a zod schema from `packages/wire-schemas`; LOCKER-04 allowlist for `schema-debt` shrinks to zero.

**RED:**
- `tools/lint-prod-readiness.test.ts` — extend the FAIL fixtures to include each of the 24 routes in this scope and assert the locker BLOCKs them; the GREEN fixture asserts they now PASS once schemas are wired.
- For each route, add a contract test: POST canonical payload → 200; POST extra-key payload → 400; POST missing-required → 400. (These can be parameterized across the 24 routes.)

**GREEN:**
- Author 24 zod schemas in `packages/wire-schemas/src/` (one per route family).
- Wire each route's `schema: { body|querystring|params: <Schema> }`.
- Remove the 24 allowlist entries from `tools/lint-prod-readiness.allowlist.json` (or wherever LOCKER-04 debt is tracked).
- Flip LOCKER-04 to BLOCKING in `tools/lint-prod-readiness.ts` (was deferred to Phase 41; we close it here).

**REFACTOR:**
- Document each new schema in `docs/wire-contracts-phase-3.md`.

---

### Plan 51-13 — API-core suppressions + token-rotation doc

**Maps to:** api-core HIGH (3).

**RED:**
- `tools/lint-no-suppressions.test.ts` — extend FAIL fixtures with the 15 `as unknown as` lines from `apps/api/src/{index,auth,error-handler,i18n/init}.ts`; assert locker BLOCKs.
- `apps/api/tests/unit/lib/token-rotation-doc.test.ts` — grep `token-rotation.ts` for the "plaintext bearer" header phrase; FAIL if present.

**GREEN:**
- Replace 15× `as unknown as` with explicit typing.
- Rewrite header comment in `apps/api/src/lib/token-rotation.ts` + parity-fix in `apps/api/src/index.ts:454-457` to reflect SHA-256 fingerprint reality.
- Pipe `bootstrap.ts:26` + 6× `index.ts` `console.warn|error` through pino with proper trace correlation.

---

### Plan 51-14 — Data drop stale fn + TLS + dead helper

**Maps to:** data HIGH (3).

**RED:**
- `packages/data/tests/integration/migrations/0023-drop-stale-session-lookup.test.ts`:
  - Pre-state: `session_lookup_by_token` exists in PG (it does on main). Apply migration 0023, assert function gone.
- `packages/data/tests/integration/pool-tls.test.ts`:
  - Boot pool against a TLS-only PG (testcontainer with `hostssl` only), assert connection succeeds.
- `packages/data/tests/integration/lookup-by-previous-token-dead-code.test.ts`:
  - Grep for `lookupSessionByPreviousToken` usage across `apps/**/src`; FAIL if 0 (means dead) AND code path duplicated in `token-rotation.ts:111-127`.

**GREEN:**
- New migration `packages/data/migrations/0023_drop_stale_session_lookup_by_token.sql`.
- `packages/data/src/client.ts` + `migrate.ts` + `backfill-encrypt-credentials.ts`: opt into TLS by default; require `?sslmode=require` unless `DATABASE_URL` contains `sslmode=disable` (operator opt-out).
- Either bring `lookupSessionByPreviousToken` to a single source by deleting the dup SQL in `apps/api/src/lib/token-rotation.ts:111-127` and importing the helper, OR delete the helper.

---

### Plan 51-15 — LiteLLM-client header CRLF + readable leak + override-source

**Maps to:** litellm-client HIGH (4).

**RED:**
- `packages/litellm-client/tests/header-crlf.test.ts`:
  - Caller passes header value `"x\r\nX-Injected: yes"` → throws `HeaderInjectionError` at client level, not at undici wire.
- `packages/litellm-client/tests/audio-transcriptions-abort-cleanup.test.ts`:
  - Mock-LiteLLM aborts mid-upload, assert the source `Readable` is destroyed (fd-count flat across N invocations).
- `packages/litellm-client/tests/override-source.test.ts`:
  - Build client with `config.baseUrl = "http://corp-litellm:4000"` while `process.env.LITELLM_BASE_URL` is `http://api:3000`; assert `isOverride` reflects `config.baseUrl`.
- `packages/litellm-client/tests/dead-exports.test.ts`:
  - Grep for each of `BUNDLED_MODEL_PROVIDER`, `PROVIDER_ENV_VAR`, `DEFAULT_HEADERS_TIMEOUT_MS`, `DEFAULT_BODY_TIMEOUT_MS`, `DEFAULT_STT_MODEL`; FAIL if 0 non-test importers.

**GREEN:**
- Header value validation: reject CR/LF before passing to undici; throw `HeaderInjectionError`.
- `audioTranscriptions` PassThrough: wire `dest.on('error', () => source.destroy())` AND `dest.on('close', () => source.destroy())`.
- `isOverride`: compute from `config.baseUrl !== DEFAULT_LITELLM_BASE_URL`.
- Either de-export the 5 unused symbols OR add real importers (preferred: de-export, mark `internal`).

---

### Plan 51-16 — BYOK guard hardening

**Maps to:** byok-guard HIGH (6).

**RED:**
- `packages/byok-guard/tests/env-validation-edge-cases.test.ts`:
  - Whitespace-only env value → reject.
  - `=disabled` with trailing space / `=Disabled` capital → accepted.
  - `NODE_ENV=Production` → SMTP gate fires same as `production`.
- `packages/byok-guard/tests/redact-bearer-in-query-value.test.ts`:
  - `?next=Bearer ey…` → masked.
- `packages/byok-guard/tests/ingress-cascade.test.ts`:
  - Setting `INGRESS_BASE_URL` requires `INGRESS_TLS_CERT_PATH` (or whatever the documented cascade is); set one without the other → boot fails.
- `packages/byok-guard/tests/fetch-and-parse-redirect.test.ts`:
  - Caller does not pass `redirect:'error'`, the helper defaults to it.

**GREEN:**
- Trim env values before validation; reject whitespace-only.
- Case-insensitive sentinel match.
- Case-insensitive `NODE_ENV` compare (or normalize to lowercase before compare).
- Bearer-in-query-value detection: pattern-match against value, not just key name.
- Add `INGRESS_BASE_URL` cascade row to the guard table.
- Default `redirect: 'error'` in `fetchAndParse`.

---

### Plan 51-17 — Small-pkgs duplication

**Maps to:** small-pkgs HIGH (2) + small-pkgs MEDIUM-2 (`MASTER_KEK` redact gap).

**RED:**
- `apps/worker/tests/unit/jobs/email-delivery-uses-shared-interface.test.ts`:
  - AST-grep `email-delivery.ts` for `interface EmailSender`; FAIL if found.
- `packages/observability/tests/redact-master-kek.test.ts`:
  - Log `{ env: { MASTER_KEK: "secret-value" } }`; assert no `secret-value` in output.

**GREEN:**
- `apps/worker/src/jobs/email-delivery.ts:47-54`: `import type { EmailSender } from "@openwhispr/email";`.
- `packages/observability/src/redact.ts`: extend `REDACT_PATHS` with `MASTER_KEK`, `BETTER_AUTH_SECRET`, all `*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD` env names. Add `x-amz-*` headers, `x-api-key`, `x-auth-token`.
- Same extension in `packages/byok-guard/src/redact-url.ts` parity table.
- Add property-test: redact-policy parity between `observability` and `byok-guard`.

---

## Wave 5 — cleanup + close

### Plan 51-18 — Dead-code purge + REVIEW-INDEX annotation

**Maps to:** scattered LOW + bookkeeping.

- Delete `packages/auth/src/**` + `packages/i18n/src/index.ts` stubs (per small-pkgs MEDIUM): no Stryker config exists, the `isPlaceholder()` justifications are stale.
- Delete `apps/worker/src/can-run-docker.ts` (worker MEDIUM).
- Annotate `REVIEW-INDEX.md` — for each CRITICAL + HIGH, append `FIX-VERIFIED: <commit-sha>`.

---

### Plan 51-19 — Full e2e re-run + coverage gate + phase-close

**Goal:** Phase exit criteria met.

- `make e2e-test` — full CJM + Playwright e2e suite on a clean compose boot.
- `pnpm test --coverage` — assert ≥ 90/90/90/90 on diff.
- All lockers BLOCKING (no `--warn-only`).
- Update `.planning/STATE.md`, `.planning/ROADMAP.md`.
- Final orchestrator spot-check: re-grep every CR-N / HI-N file:line cited in REVIEW-INDEX.md — must either be gone or mitigated.

---

## Risks & open questions

1. **Plan 51-04 CR-4 fix may break legitimate use** — the desktop-app sign-in flow appears to need the bearer to authenticate native channels (CLAUDE.md mentions `set-auth-token` rotation). Verify with `tests/e2e-cjm/features/signin.feature` `@cjm-2.*` and `desktop-signin.steps.ts`. If desktop genuinely needs the bearer, the fix is a separate token (PAK/desktop-token), not the session token.
2. **Plan 51-05 CR-7 — `withTenantContext` signature change is API-breaking** for every existing call site. Audit and migrate in the same commit.
3. **Plan 51-12 (LOCKER-04 flip)** — 24 routes × zod schemas + contract tests is the single largest plan. Consider further sub-splitting if it exceeds reasonable review-PR size, but keep the schema-flip atomic to prevent regression windows.
4. **Test fail on main** — `migrations/__tests__/0014-audit-log-partition.test.ts (6 tests | 1 failed)` already on main. Not in review scope; investigate as Plan 51-00 (pre-wave) — a green baseline is required before we can claim "fixes are GREEN."

## Out of scope (carry to a later phase)

- LOCKER-05 (Error-shape) and LOCKER-06 (shell-credential-interpolation) BLOCKING flips remain on their existing schedule (Phase 37 / 36.a).
- `packages/contract-tests` duplicated fixtures in `tests/e2e/sign-in.ts` and `apps/web/tests/e2e/fixtures/auth.ts` — separate hygiene plan; doesn't ship to users.
- LOCKER-PLAINTEXT-COLS is already BLOCKING and clean per data review — no change.
- v2.3 deferred items in `.planning/deferred-items.md` are untouched.
