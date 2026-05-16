# Review: api-routes-rest

Branch: main @ 1832f28
Scope: apps/api/src/routes/*.ts (top-level only) + non-claimed subdirs + apps/api/scripts/**

Files in scope:
- apps/api/src/routes/index.ts
- apps/api/src/routes/auth-callback.ts
- apps/api/src/routes/auth-providers.ts
- apps/api/src/routes/better-auth-handler.ts
- apps/api/src/routes/capabilities.ts
- apps/api/src/routes/check-user.ts
- apps/api/src/routes/delete-account.ts
- apps/api/src/routes/desktop-signin.ts
- apps/api/src/routes/diarization.ts
- apps/api/src/routes/locale.ts
- apps/api/src/routes/note-recording-config.ts
- apps/api/src/routes/probes.ts
- apps/api/src/routes/realtime.ts
- apps/api/src/routes/reason.ts
- apps/api/src/routes/setup-admin.ts
- apps/api/src/routes/setup-state.ts
- apps/api/src/routes/streaming-usage.ts
- apps/api/src/routes/stt-config.ts
- apps/api/src/routes/test-only.ts
- apps/api/src/routes/transcribe.ts
- apps/api/src/routes/usage.ts
- apps/api/src/routes/verification-status.ts
- apps/api/scripts/check-default-secrets.ts
- apps/api/scripts/check-default-secrets.test.ts
- apps/api/scripts/fd-probe.sh
- apps/api/scripts/fd-probe.test.sh
- v1/ subdir: only `keys/` exists, which is explicitly excluded from this reviewer's scope

## Summary
- Files reviewed: 26
- Findings: CRITICAL=3 HIGH=3 MEDIUM=5 LOW=2
- Top 3 production risks:
  1. **Public bootstrap endpoints will 401 in production.** `/api/locale`, `/api/auth/providers`, and `/api/setup-state` are documented as public/unauthenticated but none set `config.auth = false`. The global `dualAuthHook` (registered in `apps/api/src/index.ts:420`) only opts a route out when `req.routeOptions?.config?.auth === false` is explicitly set (`apps/api/src/middleware/dual-auth.ts:136`). Result: anonymous clients (the wizard, the desktop pre-sign-in pivot, the i18n probe) hit 401 instead of the intended 200/304. Unit tests build a bare Fastify without the global hook so they false-pass.
  2. **`better-auth-handler` collapses multiple `Set-Cookie` headers into one.** The bridge that adapts Better Auth's `Response` back to Fastify uses `webRes.headers.forEach((value, key) => reply.header(key, value))`. WHATWG `Headers.forEach` concatenates same-named entries with `, ` — so the two cookies Better Auth emits at sign-in (`openwhispr.session_token` and `openwhispr.session_data`) are merged into a single malformed `set-cookie` header. Browsers/jars then store only the first (or neither), silently breaking session establishment. The fix is `webRes.headers.getSetCookie()`.
  3. **`setup-admin` has no compensating action if `UPDATE users SET role='admin'` fails.** Step 2 atomically flips `setup_state` → `completed` and step 3 creates the user via `signUpEmail`. If the unscoped `ownerPool.query` for `role='admin'` (step 4) then fails (transient pool error / network blip), the response 500s, `setup_state` stays `completed`, the user exists without admin role, and every subsequent POST hits the `alreadyCompleted: true` short-circuit (`apps/api/src/routes/setup-admin.ts:194`) returning `admin: { email: undefined }` because the `WHERE role='admin'` lookup finds nothing. The instance is now unrecoverably stuck.

## Findings

### [CRITICAL] Public endpoints missing `config.auth = false` — `/api/locale`, `/api/auth/providers`, `/api/setup-state`
- File: `apps/api/src/routes/locale.ts:69-82`, `apps/api/src/routes/auth-providers.ts:73-102`, `apps/api/src/routes/setup-state.ts:62-77`
- Category: auth / wire-contract breakage
- Evidence (locale.ts):
  ```ts
  // Public — no auth guard, no DB access, no env reads.
  app.route({
    method: "GET",
    url: "/api/locale",
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => { ... },
  });
  ```
  Evidence (gate logic, dual-auth.ts:136):
  ```ts
  if (req.routeOptions?.config?.auth === false) return;
  ```
- Why it matters: `dualAuthHook` is registered globally as `onRequest` (`apps/api/src/index.ts:420`). Routes lacking `config.auth: false` go through the bearer/cookie check and emit 401 on anonymous traffic. The wizard's `/setup` RSC page (Plan 12-03) fetches `/api/setup-state` and `/api/auth/providers` BEFORE any admin exists; the Phase 15 `@cjm-traefik-host-split` Gherkin oracle hits `/api/locale` without auth. Compare with `check-user.ts:38-41`, `desktop-signin.ts:79`, `auth-callback.ts:105`, `probes.ts:85-123` — all set `auth: false` explicitly. The "public" routes do not. Unit tests for these three files register only the route plugin (no global dual-auth hook), so they false-pass — see `apps/api/tests/unit/routes/__tests__/auth-providers.test.ts:25-28`.
- Fix: add `auth: false` to each route's `config`:
  ```ts
  config: { auth: false, rateLimit: { max: 60, timeWindow: "1 minute" } }
  ```

### [CRITICAL] `better-auth-handler` corrupts multi-value `Set-Cookie` via `Headers.forEach`
- File: `apps/api/src/routes/better-auth-handler.ts:179-182`
- Category: auth / session establishment
- Evidence:
  ```ts
  reply.status(webRes.status);
  webRes.headers.forEach((value: string, key: string) => {
    reply.header(key, value);
  });
  ```
- Why it matters: WHATWG `Headers.forEach` concatenates multiple same-named values with `, `. Better Auth's cookie cache (auth.ts `session.cookieCache.enabled`) emits TWO cookies on sign-in: `openwhispr.session_token` AND `openwhispr.session_data` (the latter is the encoded session payload, referenced in `delete-account.ts:62-77`). Combining them produces one `set-cookie: openwhispr.session_token=...; ..., openwhispr.session_data=...; ...` line. RFC 6265 forbids comma-separated cookies; tough-cookie and browsers parse the first only (or reject). The file header comment claims "Web Headers may have multiple Set-Cookie values; iterate so each one is appended individually" — but the iterator does NOT yield them individually. Use `getSetCookie()`.
- Fix:
  ```ts
  reply.status(webRes.status);
  // Set-Cookie may appear multiple times; iterate via getSetCookie which
  // returns each value as a separate string. All other headers via forEach.
  for (const cookie of webRes.headers.getSetCookie()) {
    reply.header("set-cookie", cookie);
  }
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    reply.header(key, value);
  });
  ```

### [CRITICAL] `setup-admin` step-4 role flip has no rollback / retry — instance becomes wedged on transient failure
- File: `apps/api/src/routes/setup-admin.ts:174-236`
- Category: bootstrap correctness / data integrity
- Evidence:
  ```ts
  // 2. Atomic claim of setup_state.
  await db.transaction(async (tx) => { ... });
  if (claimRowCount === 0) { /* alreadyCompleted short-circuit */ }
  // 3. Create admin via Better Auth signUpEmail (own connection).
  const signUpResult = await signUpEmail({...});
  if (signUpResult.error || !signUpResult.data) {
    // Compensating: setup_state -> pending
    ...
  }
  // 4. Flip role server-side. NO try/catch around this.
  await ownerPool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [
    signUpResult.data.user.id,
  ]);
  ```
- Why it matters: if step 4 throws (pool exhausted, network blip, statement timeout) the response 500s while `setup_state.status='completed'` and a non-admin user row exists. The next POST hits `claimRowCount === 0` at line 186 and runs `SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1` (line 191) — which returns zero rows, so the response is `{ admin: { email: undefined }, alreadyCompleted: true }`. The wizard considers setup done; no admin exists; the instance is wedged with no automated recovery. Same risk applies if the request is aborted by Traefik between step 3 and step 4.
- Fix: wrap step 4 in a try/catch that, on failure, (a) issues the same compensating `UPDATE setup_state SET status='pending', completed_at=NULL` and (b) deletes the half-created user, returning 503 ADMIN_CREATE_FAILED. Alternatively run step 4 BEFORE the status claim is durable (drizzle adapter limits forbid wrapping signUpEmail in a tx, but a post-success retry-loop with bounded attempts is acceptable per RESEARCH §3).

### [HIGH] `transcribe.ts` hard-codes `sttProvider: 'groq'` + `sttModel: 'whisper-large-v3'` regardless of upstream
- File: `apps/api/src/routes/transcribe.ts:61-62, 138-149`
- Category: corporate-LiteLLM override correctness / wire contract
- Evidence:
  ```ts
  const STT_PROVIDER = "groq";
  const STT_MODEL = "whisper-large-v3";
  ...
  sttProvider: STT_PROVIDER,
  sttModel: STT_MODEL,
  ```
- Why it matters: CLAUDE.md states corporate operators override `LITELLM_BASE_URL` to their internal LiteLLM with a different model graph. The desktop receives misleading provider/model attribution. The same `upstreamJson.model` echo done in `reason.ts:145` is the correct pattern. The pattern leaks the bundled-OSS default into the wire surface and contradicts the file's own header (line 12 mentions Plan 03 sharing).
- Fix: prefer `upstreamJson.model`/Whisper response fields where available; otherwise read the resolved STT model from `tenant_settings`/`user_settings` (already exposed by `/api/stt-config`); fall back to the hardcoded constant only as a last resort.

### [HIGH] `verification-status` case-sensitive email lookup; `check-user` uses `lower(email)` — verification poll false-negatives
- File: `apps/api/src/routes/verification-status.ts:61` vs `apps/api/src/routes/check-user.ts:60`
- Category: bug / cross-route inconsistency
- Evidence:
  ```ts
  // verification-status.ts:61
  sql`SELECT email_verified_at FROM users WHERE email = ${query.email} LIMIT 1`
  // check-user.ts:60
  sql`SELECT 1 FROM users WHERE lower(email) = lower(${body.email}) LIMIT 1`
  ```
- Why it matters: Better Auth migration 0004 (per check-user comment) added a functional unique index `users_tenant_email_lower_unique` on `lower(email)`. If a user signs up with `Foo@Bar.com` (Better Auth lowercases on persist, but cookies/URL params may not), the polling desktop submits `foo@bar.com` and gets `verified: false` forever. Even if today's signup path always lowercases on insert, the query is fragile and inconsistent with the rest of the codebase.
- Fix:
  ```ts
  sql`SELECT email_verified_at FROM users WHERE lower(email) = lower(${query.email}) LIMIT 1`
  ```

### [HIGH] `streaming-usage` logs up to 1000 chars of user transcript text — PII leak via structured logs
- File: `apps/api/src/routes/streaming-usage.ts:79-103`
- Category: privacy / PII handling
- Evidence:
  ```ts
  const previewCap = body.sendLogs ? 1000 : 200;
  const text_preview = text.slice(0, previewCap);
  req.log.info({ ..., text_preview, ... }, "streaming-usage");
  ```
- Why it matters: file header says "D-13 / T-05-08 PII mitigation" — the SHA-256+length is the mitigation, but the route ALSO logs `text_preview` (200-1000 chars of the transcript) at info level. Logs flow through OTel Collector → Loki (per CLAUDE.md stack), which in any larger deployment is shared with other services. The "user opted-in via sendLogs" gate is honored, but 200 chars are logged unconditionally. That's enough to capture sensitive snippets (passwords spoken aloud, medical/legal content). The default cap should be 0 (no preview), with the 200/1000 modes flipped behind operator config not client request flag.
- Fix: stop logging `text_preview` unconditionally; gate the entire field behind a server-side env (`OPENWHISPR_LOG_TRANSCRIPT_PREVIEW=200|1000`), default 0. Keep SHA-256 + length, which are the actual D-13 mitigation.

### [MEDIUM] Diarization multipart re-wrapper interpolates `filename` from request without CRLF/quote sanitization
- File: `apps/api/src/routes/diarization.ts:449, 463-464`
- Category: HTTP header injection
- Evidence:
  ```ts
  const fileName = filePart.filename || "audio.wav";
  ...
  `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
  ```
- Why it matters: `@fastify/multipart` exposes the parsed multipart filename as `filePart.filename`. busboy strips `\r\n` from inside header values during parsing, so a direct attack is blunted, but an embedded `"` in the filename produces an invalid Content-Disposition. The current code also can't carry non-ASCII filenames correctly (should use RFC 5987 `filename*=`). A malformed envelope produces a confusing 502 from Speaches rather than a clean 400. Low exploit surface but easy to harden.
- Fix: sanitize/percent-encode:
  ```ts
  const safeName = fileName.replace(/["\r\n]/g, "_");
  ```
  And/or use `FormData` + `Blob` (Node 18+ has them) so the runtime handles boundary + encoding rules.

### [MEDIUM] `setup-admin` returns non-canonical error envelope on validation failure
- File: `apps/api/src/routes/setup-admin.ts:158-167, 222-230`
- Category: wire-contract inconsistency
- Evidence:
  ```ts
  return reply.code(400).send({
    error: {
      code: "INVALID_BODY",
      message: parseResult.error.message,
      requestId: req.id,
    },
  });
  ```
- Why it matters: every other route in scope throws `ValidationError`/`AuthError`/`ServiceUnavailable` so the centralized `setErrorHandler` emits the canonical `{ error: string }` envelope. This route returns `{ error: { code, message, requestId } }` — a different shape that contract tests against `ErrorEnvelope` will reject. Also leaks `parseResult.error.message`, which includes the full Zod issue tree (PII risk if email/password content is echoed back). `signUpResult.error?.message` is similarly echoed verbatim on line 226 — Better Auth error messages can include the email value.
- Fix: route through `ValidationError("INVALID_BODY", ...)` or whatever the canonical shape is; emit a generic message on the wire and put the full Zod issue tree on `req.log.warn` only.

### [MEDIUM] Hardcoded fallback host/scheme in `better-auth-handler` could break cookie domain matching
- File: `apps/api/src/routes/better-auth-handler.ts:45-51`
- Category: hardcode / multi-tenant correctness
- Evidence:
  ```ts
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host = (req.headers.host as string | undefined) ?? "localhost";
  return `${proto}://${host}${req.url}`;
  ```
- Why it matters: in any production deploy Traefik strips/sets `x-forwarded-proto`. If a misconfigured reverse-proxy doesn't set it, this falls back to `http` → Better Auth sees a non-secure request → `trustedOrigins` check may reject, or cookies are emitted without `__Secure-` prefix. CLAUDE.md states "HTTPS only: never plaintext HTTP on any externally reachable port." The fallback should refuse rather than guess.
- Fix: read from `req.protocol` (Fastify's already-resolved value honoring `trustProxy`); refuse to default to `http` when `NODE_ENV === 'production'`.

### [MEDIUM] `desktop-signin` does not validate `OIDC_ISSUER_URL` shape — open-redirect via misconfigured env
- File: `apps/api/src/routes/desktop-signin.ts:138-152`
- Category: security / open redirect
- Evidence:
  ```ts
  const trimmedIssuer = oidc.issuerUrl.replace(/\/+$/, "");
  const authorizeBase = process.env.OIDC_AUTHORIZE_URL ?? `${trimmedIssuer}/authorize`;
  const idpUrl = new URL(authorizeBase);
  ...
  return reply.redirect(idpUrl.toString(), 302);
  ```
- Why it matters: a misconfigured `OIDC_AUTHORIZE_URL` env (operator typo, or a hostile operator escalation via env) becomes a 302 redirect target. The validateScheme/scheme allowlist defends against the desktop's callback scheme but not against the IdP authorize URL. Since this is operator-controlled env it's not directly user-exploitable, but the same env could land in a `.env` template a self-host operator copies blindly. Validate it's HTTPS at boot.
- Fix: validate at module load: `if (process.env.OIDC_AUTHORIZE_URL && !process.env.OIDC_AUTHORIZE_URL.startsWith("https://")) throw new Error(...)`.

### [MEDIUM] `auth-callback` redirect kind `expired` reached through an unreachable fall-through branch
- File: `apps/api/src/routes/auth-callback.ts:170-177`
- Category: dead-code / logic
- Evidence:
  ```ts
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
    return { kind: "expired" as const };
  }
  if (row.consumed_at) {
    return { kind: "consumed" as const };
  }
  return { kind: "expired" as const };
  ```
- Why it matters: the trailing `return { kind: "expired" }` fires when the row exists, has no `consumed_at`, AND `expiresAtMs` is non-finite (NaN). That's actually a parse failure of `row.expires_at`, not an expiration. Returning "expired" hides a real DB-layer bug behind a misleading envelope. Should throw / log.
- Fix:
  ```ts
  // Defensive: row.expires_at unparseable -> log + treat as missing.
  req.log.warn({ stateId, raw: row.expires_at }, "oauth_state.expires_at unparseable");
  return { kind: "missing" as const };
  ```

### [LOW] `test-only` litellm-baseurl introspection seam echoes raw upstream URL
- File: `apps/api/src/routes/test-only.ts:142-146`
- Category: info-leak in test-only surface
- Evidence:
  ```ts
  app.get("/api/_test/litellm-baseurl", { config: { rateLimit: false } }, async () => {
    return { baseUrl: litellm.baseUrl };
  });
  ```
- Why it matters: gate is `OPENWHISPR_TEST_ROUTES === "true"` and is explicitly documented as production-NEVER. Acceptable but please add a runtime refusal when both `NODE_ENV === "production"` and the env var is set, so operator accidents are caught.
- Fix: log a `req.log.fatal` once at registration time when `NODE_ENV === "production" && OPENWHISPR_TEST_ROUTES === "true"`; or refuse to register.

### [LOW] `realtime.ts` `httpToWsScheme` doesn't reject non-http(s) input
- File: `apps/api/src/routes/realtime.ts:87-89`
- Category: defensive coding
- Evidence:
  ```ts
  export function httpToWsScheme(httpUrl: string): string {
    return httpUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  }
  ```
- Why it matters: header comment ("fail loud here") implies validation. Currently `tcp://litellm` passes through unchanged, no failure; only the underlying `ws` lib rejects it later with a less obvious error. Add an explicit invariant check.

## Dead code
- No dead/unreachable code blocks found in scope beyond the `auth-callback.ts:177` fall-through documented above as MEDIUM.
- All `build*Routes` factories in scope are imported and registered in `apps/api/src/routes/index.ts:201-489`.

## Suppressed warnings
- `apps/api/scripts/check-default-secrets.ts:30-35` — three lines of `biome-ignore` + `eslint-disable` for the CJS `__dirname` fallback. Justified (CJS bundle runtime concern), narrowly scoped, and the test file exercises both runtime modes. No action needed.
- No `as any` / `as unknown as` / `@ts-ignore` / `@ts-expect-error` found in the route files in scope. Several `as { rows: ... }` casts on `tx.execute(sql\`...\`)` results are necessary given the structural `TransactionalDb` interface and are not suppressions of real warnings.

## Disabled tests near scope
- None found. `tests/e2e-cjm/steps/locale.steps.ts:44-50` is tagged `@expected-red` rather than skipped — that's the documented Gherkin pattern for "step is implemented but the docker stack must be up".

## Notes
- `apps/api/scripts/check-default-secrets.ts` is well-built (defense-in-depth, names KEY not VALUE on stderr, deny-list path override). No issues.
- `apps/api/scripts/fd-probe.sh` deliberately duplicates `compose/traefik/fd-probe.sh` byte-for-byte and is enforced via `diff -q` in the test harness. Acceptable per documented constraint.
- `probes.ts` correctly sets `auth: false, rateLimit: false` on all four kubelet probes — model for how the locale/auth-providers/setup-state routes should be configured.
- `capabilities.ts` IS supposed to be authed (docstring "Auth: session required") and correctly omits `auth: false`. Not a bug, but document-it-explicitly would help (`config.auth: true` is also a Fastify-acceptable no-op).
- `index.ts` route registration order looks sound; `buildBetterAuthHandlerRoutes` is registered first (line 235) which is correct given dual-auth opts out via `config.auth = false` set inside the handler-factory.
- `delete-account.ts` `__Secure-` cookie clearing fix (Phase 02.21 / Residual B) is well-reasoned and the test coverage of 4 variants is the right shape.
- `diarization.ts` Speaches branch is otherwise clean — error mapping, retry-after, schema validation on response all present.
- The `realtime.ts` `?user=` injection (`req.raw.url` mutation after auth) correctly overrides any caller-supplied `?user=` per T-03-07-04.
