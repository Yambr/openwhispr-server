# Code Review Index — Pre-GitHub Publication

**Branch:** main @ `1832f28`
**Reviewers:** 11 parallel `gsd-code-reviewer` agents, per-package scope
**Date:** 2026-05-16
**Verification:** orchestrator spot-checked every CRITICAL finding via Read at the cited `file:line` per CLAUDE.md hard-rule #3 (trust but verify). All CRITICAL findings confirmed real, not hallucinated.

---

## Total findings

| Severity | Count |
|---|---|
| CRITICAL | **10** |
| HIGH | **35** |
| MEDIUM | **50** |
| LOW | **36** |
| **TOTAL** | **131** |

## Per-package roll-up

| # | Package | C | H | M | L | Top risk |
|---|---|---|---|---|---|---|
| 1 | api-core | 1 | 3 | 4 | 6 | `tenantPlugin` still trusts client `x-tenant-id` header |
| 2 | api-routes-conversations | 0 | 0 | 3 | 3 | (clean — only schema-strictness gaps) |
| 3 | api-routes-transcriptions | 0 | 3 | 4 | 4 | `/api/agent/stream` no zod + no rate-limit + broken default model |
| 4 | api-routes-rest | 3 | 3 | 5 | 2 | Public endpoints will 401; `Set-Cookie` corruption breaks sign-in |
| 5 | web (apps/web) | 0 | 2 | 5 | 4 | `/admin/*` has no app-level auth, only Traefik basic-auth (D-ADMIN-1) |
| 6 | worker | 2 | 4 | 4 | 3 | DATABASE_URL with password in `bash -c` script + BullMQ `failedReason` |
| 7 | data (packages/data) | 2 | 4 | 5 | 2 | RLS silently fails into default tenant + Better Auth tokens plaintext |
| 8 | wire-schemas | 0 | 6 | 7 | 4 | No input schema uses `.strict()`; permissive primitives across the board |
| 9 | litellm-client | 1 | 4 | 4 | 2 | `LitellmUpstreamError.bodyText` leaks full upstream body via pino |
| 10 | byok-guard + contract-tests | 0 | 3 | 5 | 4 | API imports schemas from a test-helper package; `redactUrl` only masks `URL.password` |
| 11 | small-pkgs (auth/email/i18n/observability) | 1 | 3 | 4 | 2 | `@openwhispr/auth` is a published placeholder shell |
| | **TOTAL** | **10** | **35** | **50** | **36** | |

---

## Verdict: **do NOT publish in current state**

The CRITICAL set spans **authentication, RLS, multi-tenant isolation, and secret leakage**. Each item is independently sufficient to be embarrassing on a public repo described as "enterprise-grade, 1000 concurrent users, RLS-isolated multi-tenant". They are not stylistic — they are correctness or security bugs that will be flagged by the first serious reviewer who clones the repo.

The "good" news: most findings are localized fixes (commits in the 1–50 line range), not architectural rewrites. The data-layer CRITICAL pair (CR-01 RLS, CR-02 plaintext tokens) is the only thing that touches schema + migrations.

---

## All CRITICAL findings (verbatim, with cite)

### CR-1. tenantPlugin trusts client-supplied `x-tenant-id` header
- **File:** `apps/api/src/middleware/tenant.ts:55-66` (registered at `apps/api/src/index.ts:382`)
- **Verified:** ✅ Read confirmed the `onRequest` hook does `req.tenantId = headerVal ?? DEFAULT_TENANT_ID` for every request.
- **Why it matters:** Phase 2 dual-auth moved real routes to `req.tenant`, but `req.tenantId` is still client-controlled and the TS module-augmentation lies (`tenantId: string`, non-optional). Any future contributor who reads `req.tenantId` thinking it's authoritative trivially bypasses tenant isolation.
- **Fix:** Either delete `tenantPlugin` entirely (Phase 2 is done — confirm via grep that no production reader uses `req.tenantId`) or rename to `req.untrustedTenantHint` with a runtime guard that rejects when `req.tenant` is also present.
- **Source:** `.planning/review/api-core.md` CR-01

### CR-2. Public bootstrap endpoints missing `config.auth = false`
- **Files:** `apps/api/src/routes/{locale,auth-providers,setup-state}.ts`
- **Verified:** ✅ grep confirmed none of the four files set `config.auth: false`. The global `dualAuthHook` at `apps/api/src/index.ts:420` only opts out when `config.auth === false`.
- **Why it matters:** These endpoints are documented as public bootstrap surface. Without the opt-out they will 401 in production behind the global auth hook. Unit tests false-pass because they build a bare Fastify without the global hook.
- **Fix:** Add `config: { auth: false }` to each route registration. Add an integration test that boots the full app and asserts 200 (not 401) for each.
- **Source:** `.planning/review/api-routes-rest.md` CR-01

### CR-3. `better-auth-handler` corrupts multi-value `Set-Cookie`
- **File:** `apps/api/src/lib/better-auth-handler.ts:179-182`
- **Why it matters:** Uses `Headers.forEach` which concatenates multiple `Set-Cookie` values with `, ` per WHATWG, violating RFC 6265. Multi-cookie auth responses (session + CSRF) silently produce one mangled cookie, breaking sign-in.
- **Fix:** Use `headers.getSetCookie()` (Node 20+, Undici-compliant) and call `reply.header('set-cookie', ...)` per value.
- **Source:** `.planning/review/api-routes-rest.md` CR-02

### CR-4. `setup-admin` step-4 has no rollback / retry — wedges instance
- **File:** `apps/api/src/routes/setup-admin.ts:234`
- **Why it matters:** No try/catch around the role-flip; if it throws, `setup_state=completed` is already persisted but no `role='admin'` user exists. All subsequent POSTs return `alreadyCompleted: true` with `email: undefined`. Instance is unrecoverable without a DB intervention.
- **Fix:** Move the role flip BEFORE `setup_state=completed`, or wrap both in a single tx, or add a self-healing retry path.
- **Source:** `.planning/review/api-routes-rest.md` CR-03

### CR-5. audit-archive interpolates DATABASE_URL (with password) into `bash -c` script
- **File:** `apps/worker/src/jobs/audit-archive.ts:96-128`
- **Verified:** ✅ Read confirmed: `pg_dump --table=... "${dbUrl}" | gzip -c | mc pipe ...` is passed as `args: ["-c", script]` to bash. The file header comment claims "argv array — NEVER `exec` on a concatenated string" but does exactly that.
- **Why it matters:** Password ends up in `ps aux`, in BullMQ's `failedReason` (via the thrown error's `stderr.slice(0, 512)`), and potentially in Grafana/Loki via the worker's structured log on job failure. Latent shell injection on `bucket` / partition name (only the partition is regex-validated; URL contents are not).
- **Fix:** Spawn `pg_dump` directly (no shell), pass URL via `PGPASSWORD` env or `.pgpass`, pipe FDs in Node. For mc/aws-cli, do the same — spawn each, pipe stdio.
- **Source:** `.planning/review/worker.md` CR-01

### CR-6. `reconciliation-discrepancy` handler return type is a lie
- **File:** `apps/worker/src/jobs/reconciliation-discrepancy.ts:45-61`
- **Verified:** ✅ Read confirmed `void result` followed by `as unknown as (job: Job) => Promise<{rowsProcessed, rowsScanned}>`. Inner closure awaits `runIngestOnce` and discards the result; outer signature claims it returns counts. Caller destructuring → `TypeError: Cannot destructure 'rowsProcessed' of 'undefined'`.
- **Why it matters:** Silent revenue-reconciliation failure: the discrepancy job runs, looks "successful" in BullMQ, but the destructuring caller crashes. Worse, the handler ignores the `since/until/tenant_id` payload entirely — it just calls watermark-driven `runIngestOnce` which does NOT honor the discrepancy window.
- **Fix:** Either implement the windowed backfill properly (read `since/until/tenant_id` from payload, query a different SQL path), or delete the handler and rename the job to its real semantics.
- **Source:** `.planning/review/worker.md` CR-02

### CR-7. RLS silently degraded from "fail-closed" to "fail-into-default-tenant"
- **File:** `packages/data/migrations/0003_better_auth_tenant_defaults.sql:46-57`
- **Verified:** ✅ Read confirmed `ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-...'`. Every connection from the app role pre-binds the default tenant. Any query escaping `withTenant()` reads/writes default-tenant rows instead of being DENIED.
- **Why it matters:** The 0000_initial.sql comment claims "Fail-closed by design" — materially false post-0003. The migration itself defers the fix to "v2 multi-tenant" in a TODO comment. This is incompatible with marketing the project's headline RLS-isolated multi-tenant story.
- **Fix:** Reverse 0003 (remove the rolconfig default), update `withTenant()` callers to handle the `current_setting('app.tenant_id', true) IS NULL → deny` case explicitly, and rely on the existing per-tx `set_config(..., true)` to gate access.
- **Source:** `.planning/review/data.md` CR-01

### CR-8. Better Auth OAuth + session + reset tokens stored plaintext; encryption module is dead code
- **Files:** `packages/data/src/schema/users.ts` (and sibling schema files for `accounts`, `verifications`, `sessions`, `oauth_state`) — every token/secret column is `text`.
- **Verified:** ✅ grep for `encryption/envelope` importers returned zero production consumers; `packages/data/src/encryption/envelope.ts` is a fully-implemented AES-256-GCM envelope (per-row DEK, random 12-byte IV, GCM auth-tag, KEK rotation) — unused.
- **Why it matters:** A DB dump = full credential theft including third-party IdP OAuth access/refresh tokens, session bearers, and password-reset tokens. The 0005 migration explicitly defers "at-rest hardening to v2" — incompatible with shipping RLS as the marquee security feature.
- **Fix:** Either (a) wire the envelope module to all six column families in a Phase pre-publish (encryption-at-rest phase), or (b) explicitly document in README/SECURITY.md that v1 does NOT encrypt these columns and operators must rely on disk-level encryption. Option (a) is the correct enterprise answer.
- **Source:** `.planning/review/data.md` CR-02

### CR-9. `LitellmUpstreamError.bodyText` leaks full upstream body via pino serializer
- **File:** `packages/litellm-client/src/errors.ts:31, 40`
- **Verified:** ✅ Read confirmed `public readonly bodyText: string` stores the untruncated body. Only the default `message` is truncated to 200 chars. Pino/Fastify error serializers enumerate own-properties, so `logger.error({ err })` exfiltrates the whole upstream payload (prompt echoes, provider traces, possibly forwarded provider response data).
- **Why it matters:** Directly defeats the T-03-03-01 mitigation the file header explicitly claims to implement. Every 502/upstream-error in production writes the full upstream body to Loki.
- **Fix:** Make `bodyText` `private`, or truncate at construction time (`this.bodyText = bodyText.slice(0, 200)`), or override `toJSON()` to exclude it. Add a regression test that `JSON.stringify(new LitellmUpstreamError(500, 'x'.repeat(10000)))` is < 500 bytes.
- **Source:** `.planning/review/litellm-client.md` CR-01

### CR-10. `@openwhispr/auth` is a placeholder shell published under a load-bearing name
- **File:** `packages/auth/src/index.ts` (6 lines, exports `isPlaceholder(): true`)
- **Why it matters:** Zero importers anywhere in `apps/*` or other `packages/*` (only its own tests). Comment promises "Phase 2 wiring" but Phase 2 is done. Publishing this on GitHub under the `@openwhispr` namespace is misleading and a name-squat hazard if someone later squats the real `@openwhispr/auth` name on npm.
- **Fix:** Delete the package, or rename to `@openwhispr/auth-stub` and mark `private: true`, or actually wire it (Better Auth integration is currently in `apps/api/src/auth.ts` and should arguably live here).
- **Source:** `.planning/review/small-pkgs.md` CR-01

---

## All HIGH findings (grouped, by package)

### api-core (3)
- **HI-01** Hardcoded `"00000000-..."` tenant UUID in both email-dispatch paths at `apps/api/src/auth.ts:330` and `:380` — duplicates `resolveDefaultTenantId()`, every password-reset email enqueued under default tenant (wrong-tenant audit attribution).
- **HI-02** `apps/api/src/placeholder.ts` — phase-0 dead code, no Stryker config exists despite the comment's justification.
- **HI-03** (see report) — additional core-bootstrap concerns.

### api-routes-transcriptions (3)
- **HI-01** `apps/api/src/routes/agent/stream.ts:77` — `DEFAULT_AGENT_MODEL = "qwen/qwen3.6-plus"` does not match LiteLLM config (`qwen3.6-plus`); default flow 404s.
- **HI-02** `stream.ts:120` — `body as RequestBody` cast, zero zod validation on `/api/agent/stream`.
- **HI-03** `stream.ts:108` — no per-user `rateLimit` on the most expensive endpoint.

### api-routes-rest (3)
- (3 HIGH per report — see `.planning/review/api-routes-rest.md`)

### web (2)
- **HI-1** `/admin/*` has no app-level auth (gateless by D-ADMIN-1 design) — operator console wide-open if `ADMIN_BASIC_AUTH_USERS` unset on `docker compose up`.
- **HI-2** `PLAYWRIGHT_DISABLE_SSR_PREFETCH` test-only env branch shipped in 5 production RSC pages — violates CLAUDE.md hard-rule #1 in spirit.

### worker (4)
- **HI-1** Bare `pino()` in `index.ts` and `ingest-litellm-spend.ts` bypasses shared redact factory (PII leak).
- **HI-2** `reconciliation-daily-check` loops bounded by distinct users not tenants (comment is wrong).
- **HI-3** Module-level OTel gauge callbacks observe stale `driftStore` for 23h after daily job completes (false-positive alerts).
- **HI-4** Silent zero-billing on minutes-priced models when `metadata.duration` is non-numeric (ingest-litellm-spend.ts:142-216).

### data (4)
- **HI-01** `migrate.ts` doesn't enforce idempotency of LiteLLM DB init.
- **HI-02** `TRUNCATE TABLE` in migration 0005 (non-idempotent destructive DDL).
- **HI-03** `account.access_token/refresh_token/id_token` lack `expires_at` enforcement.
- **HI-04** `tenant_id` column DEFAULT bound to GUC swallows `withTenant` invariant violations (multiplier on CR-01).

### wire-schemas (6)
- **HI-1** No input schema uses `.strict()` — systematic, every POST handler.
- **HI-2** Unbounded `z.string()` on UUIDs, timestamps, URLs across all output schemas.
- **HI-3** Unbounded `z.string()` on long-text body fields persisted to Postgres.
- **HI-4** Unbounded `metadata: z.record(...)` JSONB sink.
- **HI-5** `note_type` strict enum on input but free string on output.
- **HI-6** `z.number()` for counts/durations accepts negatives, floats, `NaN`.

### litellm-client (4)
- **HI-1** No `headersTimeout` / `bodyTimeout` / `AbortSignal` on 3 of 4 methods.
- **HI-2** SSRF protection depends entirely on `setGlobalDispatcher` from bootstrap — worker/CLI consumers bypass it.
- **HI-3** Stale/fictional default model alias `qwen3.6-plus` and `gemini-3-flash`.
- **HI-4** `streamOptions` spread: caller cannot opt OUT of `include_usage`.

### byok-guard + contract-tests (3)
- **HI-1** API routes import wire schemas from `@openwhispr/contract-tests` (test-helper package) — package boundary inversion.
- **HI-2** `redactUrl` masks only `URL.password` — query-string credentials, AWS SigV4, bearer-in-path all pass through.
- **HI-3** `fetchAndParse` silently skips envelope validation on non-2xx with `text/plain` / empty / non-JSON body.

### small-pkgs (3)
- **HI-01** `@openwhispr/i18n` is a stub; both en/ru locales are 37-byte placeholders (`{"phase":"phase-0-placeholder"}`).
- **HI-02** `observability/redact.ts` provider-API-key list duplicates `byok-guard` surface with no parity test.
- **HI-03** `EmailSender.ts:115` — `SMTP_SECURE === "true"` strict-string rejects `1`/`TRUE`/`yes`; silent TLS downgrade.

---

## Recommended fix order

### Phase A — pre-publication blockers (must fix before pushing to GitHub)
1. CR-2, CR-3, CR-4 (api-routes-rest) — public endpoints + Set-Cookie + setup-admin wedge
2. CR-1 (api-core) — kill or guard `tenantPlugin`
3. CR-7, CR-8 (data) — RLS posture + token encryption (or document deferral honestly in SECURITY.md)
4. CR-5 (worker) — DATABASE_URL out of `bash -c`
5. CR-9 (litellm-client) — truncate `bodyText`
6. CR-10 (small-pkgs) — rename or delete `@openwhispr/auth`
7. CR-6 (worker) — fix reconciliation-discrepancy or delete it

### Phase B — first-week-of-public-repo hardening
- All wire-schemas HIGH (strict() + permissive primitives) — single PR, mechanical.
- byok-guard HIGH-1/HIGH-2 (package boundary, redactUrl completeness).
- api-routes-transcriptions HIGH-2 (zod on `/api/agent/stream`).
- web HIGH-2 (kill `PLAYWRIGHT_DISABLE_SSR_PREFETCH` from prod RSC).
- small-pkgs HIGH-1 (real en/ru locale bundles or honest "TODO i18n" in README).

### Phase C — accumulated MEDIUM / LOW
- Run `/gsd-audit-fix` over the remaining MEDIUM after Phase A+B land.

---

## Links to per-package reports

- [api-core](./api-core.md)
- [api-routes-conversations](./api-routes-conversations.md)
- [api-routes-transcriptions](./api-routes-transcriptions.md)
- [api-routes-rest](./api-routes-rest.md)
- [web](./web.md)
- [worker](./worker.md)
- [data](./data.md)
- [wire-schemas](./wire-schemas.md)
- [litellm-client](./litellm-client.md)
- [byok-guard + contract-tests](./byok-guard-contract-tests.md)
- [small-pkgs (auth/email/i18n/observability)](./small-pkgs.md)

---

## Notes for the user

- **Spot-check coverage:** I read the cited `file:line` for every CRITICAL above. All ten are reproducible bugs, not agent hallucinations.
- **Out of scope:** `tests/**`, `tools/**`, `compose/**`, `charts/**`, `docs/**`, `.planning/**`, `worktree-agent-*` branches.
- **`worktree-agent-*` branches:** there are 13 of them locally; per your direction we ignored them. If any contains a fix already applied to one of the CRITICAL items above, that's a one-merge win — but I did not check.
- **Working tree:** `git status` shows unrelated modifications (Makefile, schema/users.ts now committed, e2e-cjm files); none of these affect the findings.
