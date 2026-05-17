# Review: api-routes-rest
Branch: main @ 13f0864

Files reviewed: 28

In-scope (per orchestrator carve-out — excludes conversations/, folders/, notes/, transcriptions/, tokens/, v1/keys/, agent/):

1. `apps/api/src/routes/auth-callback.ts`
2. `apps/api/src/routes/auth-providers.ts`
3. `apps/api/src/routes/better-auth-handler.ts`
4. `apps/api/src/routes/capabilities.ts`
5. `apps/api/src/routes/check-user.ts`
6. `apps/api/src/routes/delete-account.ts`
7. `apps/api/src/routes/desktop-signin.ts`
8. `apps/api/src/routes/diarization.ts`
9. `apps/api/src/routes/index.ts`
10. `apps/api/src/routes/locale.ts`
11. `apps/api/src/routes/note-recording-config.ts`
12. `apps/api/src/routes/probes.ts`
13. `apps/api/src/routes/realtime.ts`
14. `apps/api/src/routes/reason.ts`
15. `apps/api/src/routes/setup-admin.ts`
16. `apps/api/src/routes/setup-state.ts`
17. `apps/api/src/routes/streaming-usage.ts`
18. `apps/api/src/routes/stt-config.ts`
19. `apps/api/src/routes/test-only.ts`
20. `apps/api/src/routes/transcribe.ts`
21. `apps/api/src/routes/usage.ts`
22. `apps/api/src/routes/verification-status.ts`
23. `apps/api/src/routes/__test/fetch.ts`
24. `apps/api/src/routes/__tests__/setup.ts` (test harness)
25. `apps/api/scripts/check-default-secrets.ts`
26. `apps/api/scripts/check-default-secrets.test.ts`
27. `apps/api/scripts/fd-probe.sh`
28. `apps/api/scripts/fd-probe.test.sh`

## Summary
- CRITICAL: 1 / HIGH: 3 / MEDIUM: 4 / LOW: 5
- Top 3 production risks:
  1. **`POST /api/setup/admin` is unreachable in production** — missing `config.auth: false`. The global `dualAuthHook` will 401 every wizard-claim request because no admin exists yet. This wedges first-run setup completely. Sister route `/api/setup-state` got the Phase-35 CRIT-FIX-04 patch; setup-admin did NOT.
  2. **Speaches diarization branch is vulnerable to multipart smuggling** — `filename="${fileName}"` is interpolated without escaping at `diarization.ts:464`. A multipart filename containing CRLF or quote characters can inject extra form fields into the body sent to Speaches, enabling request smuggling against the trusted internal upstream.
  3. **Public capability endpoint surfaces an ETag derived from raw secret values** — `capabilities.ts:envHash()` mixes raw `LITELLM_MASTER_KEY` / `OPENAI_API_KEY` / `OIDC_CLIENT_SECRET` values into a SHA-256 truncated to 16 hex chars. The 64-bit truncation makes preimage recovery impractical, but the deterministic-per-env hash leaks a "did the operator's master key change?" side channel to every authenticated caller.

## Findings

### [CRITICAL] CR-01 — `/api/setup/admin` is dead-on-arrival in production: missing `config.auth: false`

**File:** `apps/api/src/routes/setup-admin.ts:146-152`

```ts
app.route({
  method: "POST",
  url: "/api/setup/admin",
  // T-12.03-02 — anti-spam floor; 5/min/IP.
  config: { rateLimit: { max: 5, timeWindow: "1 minute" } },   // ← MISSING auth: false
  handler: async (req, reply) => { ... }
});
```

The global `dualAuthHook` (`apps/api/src/middleware/dual-auth.ts:136`) only opts a route out when `req.routeOptions?.config?.auth === false`. Without that flag the hook throws `AuthError("unauthorized")` for every anonymous request. The first-run wizard is, by definition, anonymous (no admin user exists yet), so every legitimate POST to `/api/setup/admin` returns 401 instead of bootstrapping.

The sister route `/api/setup-state` was patched in Phase 35 / CR-2 (CRIT-FIX-04) — see the comment block at `setup-state.ts:71-74` explicitly calling out this same class of bug. `/api/auth/providers` (`auth-providers.ts:79-86`) carries the same comment. `setup-admin.ts` was the third member of that triad and was skipped.

Either:
- the route is currently 401 in production (regressed); OR
- there is a separate boot-time wiring path that pre-fills `req.user` before `dualAuthHook`, in which case the wizard is effectively unauthenticated by accident — also bad.

**Fix:**
```ts
config: { auth: false, rateLimit: { max: 5, timeWindow: "1 minute" } },
```
and add a regression test that POSTs `/api/setup/admin` through a Fastify instance with `dualAuthHook` installed (no session) and asserts the response is the wizard claim response, not 401.

### [HIGH] HR-01 — Multipart filename injection in Speaches diarization branch

**File:** `apps/api/src/routes/diarization.ts:449-469`

```ts
const fileName = filePart.filename || "audio.wav";
// ...
const head = Buffer.from(
  `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
    `${SPEACHES_DIARIZATION_MODEL}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +  // ← interpolated raw
    `Content-Type: ${fileMime}${CRLF}${CRLF}`,
  "utf8",
);
```

`filePart.filename` is attacker-controlled (multipart upload). It is interpolated into the outgoing multipart envelope **without any sanitization**:
- Embedded `"` characters terminate the `filename=` attribute and allow injecting additional `Content-Disposition` header fields.
- Embedded CRLF allows injecting a fresh part header (or terminating the part early and starting a smuggled one) before the file body.
- An attacker can append a second form field that Speaches accepts (e.g., a different `model` value), or close the part and pre-seed boundary collisions.

`fileMime` (line 448) is also interpolated unsanitized into a header value — same class of injection (Content-Type with CRLF injects arbitrary headers).

This is an authenticated route (`req.user`/`req.tenant` are checked at line 401-403) so the attack requires a logged-in user, but Speaches is a trusted internal upstream and an internal request-smuggling primitive is dangerous in its own right.

**Fix:** Either (a) build the body with `FormData` so encoding is library-managed:
```ts
const fd = new FormData();
fd.set("model", SPEACHES_DIARIZATION_MODEL);
fd.set("file", new Blob([fileBuffer], { type: fileMime }), fileName);
const upstream = await fetchImpl(`${baseUrl}/v1/audio/diarization`, { method: "POST", body: fd });
```
or (b) sanitize per RFC 7578 §4.2 — reject `\r`, `\n`, `"` in filename, constrain MIME to `[A-Za-z0-9!#$&^_.+/-]+`.

### [HIGH] HR-02 — `/api/auth/*` reconstructs origin URL from attacker-controlled Host header

**File:** `apps/api/src/routes/better-auth-handler.ts:45-51`

```ts
function buildRequestUrl(req: FastifyRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host = (req.headers.host as string | undefined) ?? "localhost";
  return `${proto}://${host}${req.url}`;
}
```

The resulting URL is handed to Better Auth's universal handler (`handler(webReq)` at line 216). Better Auth uses the Origin/Host of the incoming Web Request to enforce `trustedOrigins`, cookie scoping, and CSRF protection. With Fastify's `trustProxy: true` (verified in `apps/api/src/index.ts:238`) the `x-forwarded-proto` is honored — but the `host` header is taken raw from `req.headers.host` with NO allowlist.

If the Fastify edge sits behind any deployment posture where the upstream doesn't normalize the Host header (some load balancers, misconfigured Traefik routers, direct exposure on a port), an attacker can send `Host: evil.com` and Better Auth will see Origin `https://evil.com`. If Better Auth's `trustedOrigins` is wildcarded or includes evil.com (operator bug), CSRF tokens / cookie issuance proceed under the wrong origin.

Additionally `?? "localhost"` is a hardcoded fallback (LOCKER-03 territory; allowlisted on the closely-related line 49 with `# issue-31-debt-hardcode-localhost`, but the literal still ships) — a request with NO Host header (HTTP/1.0 + bad client) ends up authenticating against `http://localhost/...` which Better Auth's default trustedOrigins includes.

**Fix:** Read the canonical host from a deployment-pinned env (`PUBLIC_API_HOST` / `AUTH_URL`) rather than the request header, and refuse to forward to Better Auth when `host` does not match an allowlist. Stop falling back to `localhost`.

### [HIGH] HR-03 — `extractEmbeddedProtocol` swallows decode errors and returns raw payload

**File:** `apps/api/src/routes/desktop-signin.ts:72-80`

```ts
function extractEmbeddedProtocol(rawCb: string): string | undefined {
  const m = /[?&]protocol=([^&]+)/.exec(rawCb);
  if (!m || !m[1]) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];                                        // ← silent fallback to raw, undecoded value
  }
}
```

The regex captures up to the next `&`, but `+` (the form-encoded space) is NOT replaced before `decodeURIComponent`, and on `URIError` the function falls back to the raw match. The returned scheme then flows into `validateScheme(proto)` at line 110, but the allowlist is the only gate — an obviously-malformed value should be rejected, not used.

The **silent fallback on decode failure** narrows the auditor's ability to reason about what `validateScheme` actually sees: e.g. `protocol=%XX` (invalid percent-escape) flows through as the literal `%XX` rather than being rejected at the parse layer. Today's `validateScheme` allowlist appears to catch this, but the safety relies on parser+allowlist defense-in-depth that this function silently weakens.

**Fix:** On `decodeURIComponent` throw, return `undefined` (reject), do not echo the raw value. Better: use `new URL(rawCb).searchParams.get("protocol")` which handles encoding properly.

### [MEDIUM] MR-01 — Setup-admin "already completed" branch leaks the admin email to unauthenticated callers

**File:** `apps/api/src/routes/setup-admin.ts:186-194`

```ts
if (claimRowCount === 0) {
  const adminRes = await ownerPool.query<AdminLookupRow>(
    `SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
  );
  const existingEmail = adminRes.rows[0]?.email;
  return reply.code(200).send({ admin: { email: existingEmail }, alreadyCompleted: true });
}
```

Once setup is completed, any unauthenticated POST to `/api/setup/admin` (rate-limited 5/min/IP — and once CR-01 above is fixed, this becomes a public endpoint) receives the bootstrap admin's email address. This is a soft enumeration: a competitor who suspects which user runs operations can confirm by hitting any deployed instance.

**Fix:** Return `{ alreadyCompleted: true }` only; drop the `admin.email` field on this branch.

### [MEDIUM] MR-02 — `capabilities.ts` envHash mixes raw secret values into the ETag

**File:** `apps/api/src/routes/capabilities.ts:100-116`

```ts
function envHash(env: NodeJS.ProcessEnv): string {
  const keys = [
    "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET",
    "OPENWHISPR_DISABLE_EMAIL_VERIFICATION", "SMTP_HOST",
    "LITELLM_MASTER_KEY", "OPENAI_API_KEY",
  ];
  const composite = keys.map((k) => `${k}=${env[k] ?? ""}`).join("\n");
  return createHash("sha256").update(composite).digest("hex").slice(0, 16);
}
```

Raw `OPENAI_API_KEY` / `OIDC_CLIENT_SECRET` / `GOOGLE_CLIENT_SECRET` / `GITHUB_CLIENT_SECRET` / `LITELLM_MASTER_KEY` values are concatenated into the SHA-256 input. The 64-bit truncated digest is then surfaced to every authenticated caller as a `W/"…"` ETag. The truncation makes preimage recovery impractical (2^64 work), but the ETag is **deterministic** across requests for the same env — an attacker who can observe the ETag (any authenticated session) can detect a key-rotation event. Side channel for ops-state.

The `features` payload only depends on **presence** of the keys, not their values — `key !== ""`.

**Fix:** Use `Boolean(env[k]) ? "1" : "0"` for the secret-bearing entries when computing the hash. Issuer URLs / client IDs / SMTP_HOST are fine to keep raw; presence-bit is sufficient for the rest.

### [MEDIUM] MR-03 — `test-only.ts` Better-Auth rotation path silently swallows every error

**File:** `apps/api/src/routes/test-only.ts:176-199`

```ts
if (typeof auth.handler === "function") {
  try {
    // ... POST /api/auth/rotate-session
  } catch {
    // Better Auth has no rotation route — fall through to DB shortcut.
  }
}
```

The catch is empty (no logging) and masks every error class — including infrastructure failures (DB down, Better Auth handler crash, network blip in fetch dispatcher). Downstream contract tests then see the DB-shortcut path's behavior and an upstream regression in Better Auth's rotation seam stays invisible.

The URL is also constructed with `process.env.AUTH_URL ?? "http://localhost:3000"` — hardcoded localhost fallback (allowlisted as LOCKER-03 debt at `test-only.ts:181`, but still operationally smelly).

**Fix:** At minimum, `req.log.warn({ err }, "force-rotate: BA rotation seam threw; falling back to DB shortcut")`. Better: drop the `auth.handler` branch entirely — Better Auth has no `/api/auth/rotate-session` route (the comment at line 197 admits this), so the code path is dead-by-design.

### [MEDIUM] MR-04 — `auth-callback.ts` "expired" terminal branch is misleading

**File:** `apps/api/src/routes/auth-callback.ts:190-205`

```ts
if (probe.rows.length === 0) return { kind: "missing" };
const row = probe.rows[0];
if (!row) return { kind: "missing" };
const expiresAtMs = new Date(row.expires_at).getTime();
if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) return { kind: "expired" };
if (row.consumed_at) return { kind: "consumed" };
return { kind: "expired" };                              // ← misleading
```

The CAS-failed branch executes only when `consumed_at IS NOT NULL` OR `expires_at <= now()`. After both checks above, the final `return { kind: "expired" }` is reachable ONLY when `Number.isFinite(expiresAtMs)` is false — i.e., the row stored a non-parseable `expires_at`. In that case "expired" is misleading; the truthful answer is "invalid state row" (DB corruption).

Low impact (an "expired" response just makes the desktop re-initiate signin), but the labeling matters for operator debugging.

**Fix:** Log a structured warning + return `{ kind: "missing" }` (the most accurate user-facing label).

### [LOW] LR-01 — `setup-admin.ts` Accept-Language parser hard-codes the supported-language set

**File:** `apps/api/src/routes/setup-admin.ts:328-335`

The `pickLocale` helper hard-codes `en`/`ru` rather than reading from i18n init (`apps/api/src/i18n/init.ts` declares `supportedLngs`). When Phase 15+ expands the list, this file silently keeps falling through to `en`. Cold-path drift risk; harmless today.

**Fix:** Import the `supportedLngs` list from the i18n module.

### [LOW] LR-02 — `diarization.ts` boundary uses `Math.random()` rather than `crypto.randomUUID()`

**File:** `apps/api/src/routes/diarization.ts:455-457`

```ts
const boundary = `----owsp-speaches-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;
```

`Math.random()` is non-crypto; if HR-01 above is fixed the boundary only needs to avoid collision with the file payload, but `crypto.randomUUID()` (cheap) removes the question entirely.

### [LOW] LR-03 — `delete-account.ts` cookie-clearing list duplicates Better Auth's `cookiePrefix`

**File:** `apps/api/src/routes/delete-account.ts:62-77`

Hard-codes `openwhispr.session_token` / `openwhispr.session_data`. If an operator ever overrides `cookiePrefix` in `auth.ts`, cookie clearing silently breaks. The mitigation comment block at lines 32-48 is long; the actual code never reads `auth.options.cookiePrefix`.

**Fix:** Read the prefix from the constructed Better Auth instance and compose the names dynamically.

### [LOW] LR-04 — `reason.ts` `MODEL_PROVIDER` table will lie under corporate-LiteLLM override

**File:** `apps/api/src/routes/reason.ts:74-78, 149`

The static table maps three bundled-default models to `openrouter`. Operators who override `LITELLM_BASE_URL` to a corporate proxy can route the same alias to AWS Bedrock / Azure / on-prem vLLM — the response then mis-attributes the provider as `openrouter`. The fallback `"litellm"` only fires for unknown aliases.

**Fix:** Document this as a known limitation, or surface the `provider` field LiteLLM already returns in `x-litellm-cache-hit` / spend metadata.

### [LOW] LR-05 — `__tests__/setup.ts` test harness interpolates passwords into raw DDL

**File:** `apps/api/src/routes/__tests__/setup.ts:99-104`

```ts
await superPool.query(
  `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPw}'`,
);
```

Values are test constants (`"owner-pw-test"`) so this is not exploitable, but the pattern primes future drift. Postgres DDL doesn't accept `$1` placeholders for role passwords, but the literal can be quoted via `format()` server-side; safer to constrain the constants to `[A-Za-z0-9-]+` at the call site.

## Dead code

LOCKER-04 dead-export findings under `tools/lint-prod-readiness.allowlist.txt` are tracked for Phase 38 (`@openwhispr/auth` retirement) and Phase 41 (per-route schema bulkfix). The following exports in scope are currently un-imported outside their declaring file:

- `apps/api/src/routes/probes.ts:48` `resetStartupComplete` — test-only helper exported from production module.
- `apps/api/src/routes/probes.ts:52` `isStartupComplete` — same posture.
- `apps/api/src/routes/locale.ts:52` `resolveLocale` — exported "for unit testing"; no production caller.
- `apps/api/src/routes/locale.ts:65` `LocaleDeps` — empty-record type alias.
- `apps/api/src/routes/setup-state.ts:33` `SetupStatus`, `:35` `SetupStateResponse` — re-declared in `capabilities.ts:53` rather than imported.
- `apps/api/src/routes/setup-admin.ts:65-89` — three types (`SetupAdminSignUpResult`, `SetupAdminSignUpCall`, `SetupAdminRenameTenant`) exported but only consumed within this file.
- `apps/api/src/routes/realtime.ts:53` `buildRewriteRequestHeaders`, `:87` `httpToWsScheme` — exported "for direct unit-testing"; no production caller outside the same file.
- `apps/api/src/routes/diarization.ts:64/68/71/128` — constants `POLL_INTERVAL_MS`, `POLL_CEILING_MS`, `DIARIZATION_MOUNT_PATH`, `SPEACHES_DIARIZATION_MODEL` exported but read only inside the file.

None are actively-broken; collectively they bloat the `@openwhispr/api` symbol graph and dilute LOCKER-04's invariant. Phase 38/41 are the consolidating tickets.

## Suppressed warnings

In-scope `as unknown as` casts (LOCKER-02 type-suppression):
- `apps/api/src/routes/better-auth-handler.ts:151` — i18n attached to FastifyRequest at runtime, narrowed with `as unknown as`. Justifiable (cross-package augmentation), but better declared via `declare module "fastify"` similar to `dual-auth.ts:84-107`.
- `apps/api/src/routes/locale.ts:53` — same i18n shape, same fix applies.
- `apps/api/src/routes/realtime.ts:160` — `req.user` cast; the `dual-auth.ts` augmentation already declares `req.user` on FastifyRequest, so this cast is redundant.
- `apps/api/src/routes/__tests__/setup.ts:256/279/315` — test harness bridges `NodePgDatabase` to the route plugin's `TransactionalDb<ExecutableTx>` interface. Test scope; documented per CLAUDE.md.

LOCKER-01 NODE_ENV branches: `apps/api/src/routes/index.ts:474`, `apps/api/src/routes/test-only.ts:128`, `apps/api/src/routes/__test/fetch.ts:60` all read `process.env.NODE_ENV` in non-bootstrap code. The first two are explicitly allowlisted with `# issue-31-debt-…`. The `__test/fetch.ts:60` read is NOT in the allowlist file but the path resolves under `**/__test/**` which the lint IGNORE glob skips — confirmed safe.

## Notes

- Five health-class routes (`/livez`, `/readyz`, `/startupz`, `/api/health`, `/__test/fetch`) legitimately carry `rateLimit: false`. All gated by `auth: false`. Confirmed against LOCKER-04 health-allowlist semantics.
- `transcribe.ts` streams `req.raw` to LiteLLM without buffering — correct for the 1000-concurrent SLO. `diarization.ts` buffers (bounded by `@fastify/multipart` limit 100MB) because the pyannote presigned upload needs Content-Length. Both decisions documented in their file headers.
- `verification-status.ts` and `delete-account.ts` correctly enforce cookie-only auth via `requireCookieOnly` preHandler — matches BACKEND_SPEC non-negotiable.
- `check-user.ts` documents the email-enumeration trade-off (D-09 / T-02-03-03) with rate-limit mitigation; not an actionable finding.
- `auth-callback.ts` and `desktop-signin.ts` correctly route 4xx/5xx via inline envelopes that match the centralized error handler's shape; no `reply.code(401)` short-circuits that would bypass the central path.
- `auth-providers.ts` and `setup-state.ts` got Phase-35 CR-2 / CRIT-FIX-04 patches adding `auth: false`. The matching fix for `setup-admin.ts` (CR-01 above) was missed.
- No `console.log`, no `eval`, no `child_process.spawn` with credential interpolation, no raw SQL with template-literal user input (all queries use drizzle `sql\`\`` parameterized templates or pg `$1` placeholders), no `dangerouslySetInnerHTML` (server-only), no exposed secrets in source — clean on those axes.
- `scripts/check-default-secrets.ts` correctly refuses to start the container when any REQUIRED_KEY is unset or deny-listed; the harness `check-default-secrets.test.ts` covers the four required cases.
- `scripts/fd-probe.sh` is byte-identical to `compose/traefik/fd-probe.sh` (test enforces via `diff -q`); the duplication-by-design comment at lines 3-7 is sound.
- TODO/FIXME/HACK/XXX/TEMP/WORKAROUND scan: ZERO hits across all 28 in-scope files.
- `.skip(` / `.only(` / `.todo(` scan: ZERO hits in test harness or test files in scope.
