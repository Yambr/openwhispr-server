# Review: api-core
Branch: main @ 13f0864
Files reviewed: 35 (apps/api/src + 1 entrypoint script)

## Summary
- CRITICAL: 1 / HIGH: 3 / MEDIUM: 11 / LOW: 9
- Top 3 production risks:
  1. **`BETTER_AUTH_SECRET` is never validated at boot.** A missing env silently passes `secret: undefined` into Better Auth — sessions sign with an empty key while the rest of the stack boots happily. The byok-guard + encryption-boot gate that precede it do NOT cover this. (CRIT-01)
  2. **`recordPreviousToken` stores PLAINTEXT bearer fingerprint AND comments contradict themselves.** Header comment at `apps/api/src/lib/token-rotation.ts:1-9` says "Phase 02.12 dropped the bytea hash storage in favor of … plain-text bearer" — but body at L58-67 actually writes ONLY `previous_token_fp = sha256(oldToken)`. The header doc is stale and the equally-stale comment in `apps/api/src/index.ts:454-457` claims "store the old bearer plain-text (no hashing)". Operators reading the doc will reach the wrong threat-model conclusion. (HIGH-01)
  3. **`as unknown as` casts proliferate across `index.ts` / `auth.ts` despite LOCKER-02 in CLAUDE.md.** 15 occurrences in scope; LOCKER-02 says `as unknown as` is REFUSED in production code (allowlist exists but the boot path is the worst place for it). The Better Auth instance/database/db casts in particular bypass type-system protection on the most security-sensitive surfaces. (HIGH-02)

## Findings

### [CRITICAL] BETTER_AUTH_SECRET is never validated at boot — undefined-secret session signing
- File: `apps/api/src/auth.ts:325`
- Category: security
- Evidence:
  ```ts
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.AUTH_URL ?? "http://localhost:3000",
  ```
  And the buildApp doc at L193-195 says:
  ```ts
  // @throws if BETTER_AUTH_SECRET validation fails inside Better Auth (we
  // deliberately do not pre-validate; let Better Auth's own check
  // emit the canonical error).
  ```
- Why it matters: Better Auth 1.6.9 does NOT throw at construction time when `secret` is undefined — verified by the comment itself "we deliberately do not pre-validate". The `assertBYOKConfig()` and `validateEncryptionBoot()` boot gates in `apps/api/src/index.ts:65-82` enforce BYOK + KEK but neither covers Better Auth's signing secret. The `apps/api/scripts/check-default-secrets.ts` entrypoint script is a separate layer that only catches DENY-LIST literals, not bare undefined. Net result: an operator who omits `BETTER_AUTH_SECRET` boots a server whose session signatures are derived from an empty/undefined key — every signed cookie / state cookie / verification token is forgeable.
- Fix: add an explicit assertion at `buildAuth()` top (and ideally at `index.ts` boot, next to `validateEncryptionBoot()`) that refuses boot when `BETTER_AUTH_SECRET` is empty, with an `EX_CONFIG` exit. Same posture as `MASTER_KEK`:
  ```ts
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    process.stderr.write("BETTER_AUTH_SECRET is unset or too short (>=32 bytes required)\n");
    process.exit(78); // EX_CONFIG
  }
  ```

### [HIGH] Documentation lies about storage of previous_token — plaintext-claim contradicted by code
- File: `apps/api/src/lib/token-rotation.ts:1-9`, `apps/api/src/lib/token-rotation.ts:42-67`, `apps/api/src/index.ts:454-457`
- Category: security (documentation-induced threat-model error) / workaround
- Evidence:
  Header (token-rotation.ts L1-9):
  ```ts
  // Phase 02.12 — adopt Better Auth v1.6.9's plain-text session.token model.
  // Phase 02 Plan 01's hashToken (SHA-256) helper + bytea storage are removed
  // in favor of plain-text bearer storage on `sessions.token` and
  // `sessions.previous_token`. The AUTH-04 5-minute overlap CONTRACT
  ...
  // only the storage representation flipped from bytea to text.
  ```
  Body (L47-67) actually does:
  ```ts
  // The plaintext `oldToken` is NOT persisted because the route hooks
  // never need to read it back …
  const { createHash } = await import("node:crypto");
  const fp = createHash("sha256").update(oldToken, "utf8").digest();
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(
      sql`UPDATE sessions
          SET previous_token_fp = ${fp},
              previous_token_expires_at = now() + interval '5 minutes'
          WHERE id = ${sessionId}::uuid`,
    );
  });
  ```
  And `index.ts:454-457`:
  ```ts
  // Phase 02.12 — store the old bearer plain-text (no hashing).
  ```
- Why it matters: Pre-publication readers (auditors, OSS contributors, security researchers) reading the header will conclude `sessions.previous_token` is plaintext at rest, and either (a) waste time scoping a non-existent vuln, or (b) discount a real one because the doc told them it's plaintext anyway. The header was last touched when Phase 33 flipped to fingerprint storage but somebody forgot to invert the prose.
- Fix: rewrite the header to describe the current fingerprint-only storage. Delete or correct the "store the old bearer plain-text" comment in `index.ts`. While here, audit the `dynamic import("node:crypto")` inside `recordPreviousToken` / `tryPreviousToken` (L58, L120) — needless (no circular constraint, no test-only seam); switch to a top-level static import.

### [HIGH] `as unknown as` casts ubiquitous on the auth + DB seams (LOCKER-02 sensitive surface)
- File: `apps/api/src/index.ts:296,305,333,368,404,580,635,670`, `apps/api/src/auth.ts:323,570`, `apps/api/src/error-handler.ts:226`, `apps/api/src/i18n/init.ts:152-153`
- Category: suppressed-warning / workaround
- Evidence (sampler):
  ```ts
  // index.ts:580
  const auth = buildAuth(...) as unknown as AuthLike;

  // index.ts:670
  valkey: redis as unknown as import("ioredis").Redis,

  // auth.ts:570
  }) as unknown as AuthInstance;

  // auth.ts:323
  )) as unknown as ReturnType<typeof drizzleAdapter>;
  ```
- Why it matters: CLAUDE.md DISCIPLINE rule 12 says `as unknown as` is REFUSED in production code, with an allowlist for pre-existing debt. These casts paper over real type-system fidelity loss on the most security-sensitive seams: the Better Auth adapter wrapper, the ioredis vs RedisLike narrowing, and the cross-package `AuthLike` boundary. Any refactor that breaks the structural assumption fails silently at runtime instead of at typecheck. The drizzle-adapter cast (auth.ts:323) is particularly load-bearing — it's where the envelope-encryption lens is glued onto the Better Auth IO surface; a drift there means tokens silently land plaintext.
- Fix: each call site can be narrowed without the double-cast:
  - `auth.ts:323` — declare a proper `DBAdapter` parameter type instead of `(o: unknown)`.
  - `index.ts:580` — `AuthLike` and the Better Auth return are structurally compatible; expose a narrowed type from `auth.ts` and import it.
  - `index.ts:670` — `dep-check.ts` should accept the structural `{ ping(): Promise<unknown> }` interface, not `ioredis.Redis`.
  - `i18n/init.ts:152-153` — declare a request augmentation in `types/fastify.d.ts` (`req.i18n`, `req.language`) so the cast goes away entirely.

### [HIGH] Bootstrap-time `console.warn`/`console.error` outside structured logger swallow operator signal
- File: `apps/api/src/bootstrap.ts:26-37`, `apps/api/src/index.ts:572-577, 606-611, 640-645, 648-651, 709-710`
- Category: workaround / observability
- Evidence:
  ```ts
  // bootstrap.ts:26
  // biome-ignore lint/suspicious/noConsole: bootstrap-time structured event; pino unavailable here
  console.warn(JSON.stringify({ level: "warn", event: "security.ssrf_blocked", ... }));
  ```
  But the SSRF dispatcher's `onBlock` fires AT REQUEST TIME, long after pino is up — not "bootstrap-time" — and the api `index.ts` already constructs a sync pino at L69 for the BYOK fatal. The hand-rolled `JSON.stringify` lines are missing the canonical `request_id`, `trace_id`, `span_id` correlation keys that OTel's PinoInstrumentation injects (otel-bootstrap.ts D-T3). Loki ingestion will receive these as plain stdout and operators chasing a Grafana SSRF alert will not be able to link them back to the offending tenant/request.
- Why it matters: `security.ssrf_blocked` is an OWASP-grade detection signal. If it can't be joined back to a request/trace in Loki+Tempo, the audit row written elsewhere is the only durable record. Same applies to bootstrap startup logs that hide failure modes (LiteLLM unavailable, Valkey unavailable) behind `console.warn` — these never reach the production logging pipeline cleanly.
- Fix: instantiate the sync pino instance once at module top (next to the BYOK pino) and route all `console.warn`/`console.error` calls through it. The biome-ignore lines should be deleted with the calls. The SSRF dispatcher should accept an injected logger via `installGlobalSSRF()`.

### [MEDIUM] `AUTH_URL ?? "http://localhost:3000"` — hardcoded localhost fallback in production code
- File: `apps/api/src/auth.ts:326`
- Category: hardcode
- Evidence:
  ```ts
  baseURL: process.env.AUTH_URL ?? "http://localhost:3000",
  ```
- Why it matters: LOCKER-03 forbids hardcoded `localhost`/`:3000` outside tests/compose/docs/tools. This sits in the boot-critical auth construction. If `AUTH_URL` is unset in production, every cookie domain calc, CSRF origin check, and OAuth redirect computes against `http://localhost:3000` — silently broken auth instead of a loud refuse-boot.
- Fix: refuse boot when `AUTH_URL` is unset, the same posture as `MASTER_KEK`/`BETTER_AUTH_SECRET`. Move the fallback into `.env.example` for OSS quickstart.

### [MEDIUM] `LITELLM_BASE_URL ?? "http://litellm:4000"` — magic compose service name + port in runtime
- File: `apps/api/src/index.ts:664`
- Category: hardcode
- Evidence:
  ```ts
  const litellmBaseUrl = process.env.LITELLM_BASE_URL ?? "http://litellm:4000";
  ```
- Why it matters: ":4000" is on LOCKER-03's hardcoded-port deny list outside tests/compose. The fallback is reachable in any container without that env set, which silently directs `/readyz`'s LiteLLM probe at whatever happens to resolve `litellm` on the docker network — easy false-green/false-red.
- Fix: refuse boot when `LITELLM_BASE_URL` is unset; document the value in `.env.example` instead of in code.

### [MEDIUM] `client-id-upsert.ts` uses `sql.raw(...)` with caller-supplied table/column names
- File: `apps/api/src/lib/client-id-upsert.ts:76-156`
- Category: security (defense in depth)
- Evidence:
  ```ts
  const tbl = quoteIdent(params.table);
  const cidCol = quoteIdent(params.clientIdColumn);
  ...
  const insert = sql.raw(`INSERT INTO ${tbl} (${colList}) VALUES `);
  ```
  `quoteIdent` validates against `/^[a-z_][a-z0-9_]*$/`, but the function comment claims "no untrusted column names" while exposing a public API that any future caller can pass a runtime value into.
- Why it matters: today's callers pass literal table+column names, so this is "belt and braces" as the doc says. But the existence of `sql.raw` carrying parameter-shaped values broadens the audit surface. Pre-publication is the moment to either tighten the signature (accept a discriminated-union of `'notes' | 'folders' | …`) or lock the strict allow-pattern AND assert it never widens.
- Fix: replace `params.table` + `params.clientIdColumn` strings with a `ResourceFamily` enum mapped to literal SQL fragments inside this module. Drop `sql.raw` entirely in favor of `sql.identifier()`.

### [MEDIUM] `parseListQuery` uses `parseInt(String(limitRaw), 10)` — accepts `"50abc"` → 50
- File: `apps/api/src/lib/keyset-pagination.ts:52-70`
- Category: bug
- Evidence:
  ```ts
  const parsed = parseInt(String(limitRaw), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    limit = Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);
  }
  ```
- Why it matters: `parseInt("50abc")` returns `50`. The doc says callers shipping nonsense like `"all"` flow back to default 50, which is fine — but `"99999XXX"` silently clamps to 200 instead of falling back to the default. This is mostly cosmetic but inconsistent with the "treat as default" contract for non-numeric values.
- Fix: use `Number(limitRaw)` + `Number.isFinite` check, which rejects mixed strings.

### [MEDIUM] `i18n/init.ts` writes `req.i18n` / `req.language` via `as unknown as` instead of declaring augmentation
- File: `apps/api/src/i18n/init.ts:150-158`
- Category: workaround / suppression
- Evidence:
  ```ts
  app.addHook("preHandler", (req, reply, done) => {
    handler(req.raw, reply.raw, () => {
      const raw = req.raw as unknown as { i18n?: unknown; language?: string };
      const r = req as unknown as { i18n?: unknown; language?: string };
      if (raw.i18n !== undefined) r.i18n = raw.i18n;
      ...
  ```
- Why it matters: `types/fastify.d.ts` was created exactly for this kind of ambient augmentation (the file's docblock says so). `req.i18n` and `req.language` are read by `error-handler.ts` and by every i18n-aware route — they belong in the ambient declaration alongside `req.user`/`req.tenant`.
- Fix: add `i18n?: i18n.i18n` and `language?: string` to the `FastifyRequest` augmentation in `types/fastify.d.ts`; drop both casts.

### [MEDIUM] `dual-auth.ts` declares its own `FastifyRequest` augmentation duplicating `types/fastify.d.ts`
- File: `apps/api/src/middleware/dual-auth.ts:84-107`, `apps/api/src/types/fastify.d.ts:44-72`
- Category: code-quality / drift risk
- Evidence: two `declare module "fastify"` blocks describe overlapping `user?`, `tenant?` shapes. The `types/fastify.d.ts` header explicitly acknowledges the duplication.
- Why it matters: relying on TS to merge duplicate `declare module` blocks works only as long as the shapes stay strictly compatible. The two files have already drifted once (`user.tenantId` type narrows differently — `string | null | undefined` here vs `string | null` in dual-auth). One source of truth is cheaper than periodic drift audits.
- Fix: delete the inline augmentation from `dual-auth.ts` (it predates the dedicated `.d.ts` file). Add `sessionId?: string` to the ambient file.

### [MEDIUM] `requestLog` plugin binds `openwhisprSource: null` on every request when header is absent
- File: `apps/api/src/plugins/request-log.ts:42-47`
- Category: code-quality / log-volume
- Evidence:
  ```ts
  app.addHook("onRequest", async (req) => {
    const raw = req.headers["x-openwhispr-source"];
    const source = typeof raw === "string" ? raw : null;
    req.log = req.log.child({ openwhisprSource: source });
  });
  ```
- Why it matters: assigning `null` for `openwhisprSource` writes a `null`-keyed bind on every single request even when the header isn't present. In pino this lands as `{"openwhisprSource":null,...}` on every log line for the entire request — large log volume bloat at 1000 concurrent users SLO. Standard fix: skip the child when source is absent.
- Fix:
  ```ts
  if (source) req.log = req.log.child({ openwhisprSource: source });
  ```

### [MEDIUM] `errors.ts` `pickCodeAndMessage` ambiguous two-arg API masks programmer error
- File: `apps/api/src/errors.ts:45-54, 60-65`
- Category: code-quality / API surface
- Evidence:
  ```ts
  function pickCodeAndMessage(defaultCode, arg1?, arg2?) {
    if (arg1 !== undefined && arg2 !== undefined) {
      return { code: arg1, message: arg2 };
    }
    return { code: defaultCode, message: arg1 ?? "" };
  }
  ```
- Why it matters: this means `new AuthError("UNAUTHORIZED")` (a programmer thinking they're passing a code) silently produces `code="AUTH_ERROR"`, `message="UNAUTHORIZED"`. The two-arg form is ergonomically indistinguishable from the legacy one-arg form. The i18n contract relies on stable codes — silent code-defaulting masks miswired error sites.
- Fix: take a single options object: `new AuthError({ code, message })` for the typed form, retain the bare-string for legacy. Or, less invasive: assert `arg1` matches `/^[A-Z_]+$/` when arg2 is undefined and warn / refuse in dev.

### [MEDIUM] `ENCRYPTED_COLUMNS_MAP` includes `account.password` without explicit doc that it carries the HASH, not plaintext
- File: `apps/api/src/auth.ts:107-140`
- Category: security / documentation
- Evidence:
  ```ts
  password: { sidecarPrefix: "password" },
  ```
  Comment at L116-117 says "password has no expiry semantic" — true, but `password` here is a CREDENTIAL value flowing through the lens. The comment at L101-105 also says: "users.password_hash is NOT in this map: empirical grep confirms no application code writes it" — but `account.password` IS in the map, suggesting Better Auth's email/password flow writes the credential through the adapter under `account.password`.
- Why it matters: pre-publication readers can't tell from the comments whether `account.password` carries the Argon2/bcrypt hash or a plaintext credential. If it's plaintext, the lens is the only thing preventing at-rest plaintext password storage. If it's a hash, encrypting it through KEK is double-protection with operational cost (KEK rotation must also rotate hash entries). Resolve ambiguity before publication.
- Fix: explicit comment clarifying that `account.password` carries the scrypt/bcrypt hash from Better Auth's emailAndPassword adapter (cite the Better Auth source line that proves it). If actually plaintext: escalate to CRITICAL.

### [MEDIUM] OIDC discovery cache has unbounded growth + no negative-cache TTL + unbounded response body
- File: `apps/api/src/lib/mint-bearer.ts:118-145`
- Category: code-quality / DoS
- Evidence:
  ```ts
  const discoveryCache = new Map<string, OidcDiscoveryDoc>();
  ...
  async function discoverOidc(issuerUrl: string) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`mint bearer: discovery ${res.status} (issuer=${issuer})`);
    }
    const doc = (await res.json()) as OidcDiscoveryDoc;
    discoveryCache.set(issuer, doc);
    return doc;
  }
  ```
- Why it matters: (a) issuer URL is read from env at request time — only a small set in practice, but the code reads env per call so a runtime env rotation would silently pile new entries in. (b) Failed discoveries are NOT cached at all — every callback request hits the IdP again if discovery flapped. An IdP returning intermittent 5xx means every desktop callback re-tries discovery, amplifying load. (c) `await res.json()` is unbounded — a malicious/misconfigured IdP serving a 100 MB JSON would OOM the process.
- Fix: bound the response body (`AbortController` + read-size cap), add a negative-cache TTL (e.g. 30s on 5xx), and replace the Map with an LRU to cap memory.

### [MEDIUM] `pyannote-client` `MissingPyannoteKeyError.message` carries operator instructions that could leak to clients
- File: `apps/api/src/lib/pyannote-client.ts:31-38`
- Category: code-quality / wire-contract
- Evidence:
  ```ts
  constructor() {
    super(
      "PYANNOTE_API_KEY is not configured. Set it in .env to enable diarization, ...",
    );
  }
  ```
- Why it matters: the error-handler maps unmapped errors to "Internal server error" — but if a future hand-off wires this class to ServiceUnavailable, the operator-actionable string would surface to the desktop client. WIRE-17 says non-2xx bodies must match the canonical envelope and SHOULD NOT leak operator-actionable internals to clients. Keep the long string in `err.cause` or a separate `operatorHint` property; the user-facing message should be generic.
- Fix: split into `message: "diarization unavailable"` + a separate `operatorHint` string read by the route handler when constructing the log line.

### [LOW] `bootstrap.ts` `defaultOnBlock` writes via `console.warn(JSON.stringify(...))`
- File: `apps/api/src/bootstrap.ts:25-37`
- Category: observability
- Evidence: hand-rolled JSON line; no trace/span correlation; no timestamp.
- Why it matters: see HIGH-04 above. Lower severity because this duplicates the durable audit row written by `index.ts:onError`. Still operator-confusing under load.
- Fix: covered by HIGH-04 remediation.

### [LOW] `lib/audit.ts` `assertEnglishOnly` only scans string leaves
- File: `apps/api/src/lib/audit.ts:243-263`
- Category: code-quality
- Evidence: only string leaves are scanned; numbers/booleans/Symbols pass.
- Why it matters: low — the per-action zod schemas are strict and reject unknown keys/types, so non-string Cyrillic-carrying values can't actually reach the INSERT in practice. The guard's docstring is the concern.
- Fix: tighten the docstring to say "scans string leaves of plain objects/arrays; other JSON-incompatible types are caught by the per-action zod schema".

### [LOW] `findSSRFBlockedError` silently swallows cause-chain depth-cap exceeded
- File: `apps/api/src/error-handler.ts:88-99`
- Category: code-quality
- Evidence: `MAX_CAUSE_DEPTH = 8`; depth-walk returns `null` without a log when the cap is hit.
- Why it matters: an SSRF block hidden behind a 9-deep cause chain would silently surface as a generic 500 instead of 502. Unlikely in practice (undici only wraps twice) but worth a `req.log.warn` when the cap is hit.
- Fix: emit a warn log when reaching the depth cap.

### [LOW] `lib/idempotency-cache.ts` legacy `existing.jobId` fallback path is unobservable
- File: `apps/api/src/lib/idempotency-cache.ts:108-117`
- Category: code-quality
- Evidence:
  ```ts
  const siblingJobId = await redis.get(k + JOBID_SUFFIX);
  const jobId = siblingJobId ?? existing.jobId;
  ```
- Why it matters: the legacy `existing.jobId` fallback is intentional (24h migration window) but is documented only in a comment. After 24h of deploy uptime, all live entries carry the sibling key; until then both paths run. There's no log line announcing "fallback path taken for entry X" so an operator can't tell whether the migration is complete.
- Fix: add a one-line log when the legacy `existing.jobId` branch is taken; remove the legacy branch after one rollout cycle.

### [LOW] `cookieDomainConfig()` throws deep in `buildAuth()` call chain instead of refuse-boot
- File: `apps/api/src/auth.ts:519`, `apps/api/src/lib/cookie-domain.ts:68-83`
- Category: code-quality
- Evidence: `cookieDomainConfig()` throws when AUTH_URL/OPENWHISPR_API_URL share no parent. Called from inside `buildAuth({...})` which is invoked at boot.
- Why it matters: the throw is in a deep call chain; the BYOK + encryption-boot gates are short-circuit-style with explicit `process.exit(EX_CONFIG)`. A throw here surfaces as an unhandled rejection inside `listen()` and goes through the generic `console.error(err); process.exit(1)` path in `index.ts:708-711` — operator gets a stack trace, not an actionable one-liner.
- Fix: move this validation to the top of `index.ts` alongside `validateEncryptionBoot()` so the operator gets `EX_CONFIG (78)` + a single stderr line.

### [LOW] `plugins/rate-limit.ts` uses `biome-ignore noExplicitAny` three times for `redis: any`
- File: `apps/api/src/plugins/rate-limit.ts:60, 103, 158`
- Category: suppressed-warning
- Evidence: three identical suppressions for "opaque redis client surface".
- Why it matters: every redis-handler in this codebase reaches for `RedisLike` (idempotency-cache.ts:48-55) — that minimal interface would type these without `any`.
- Fix: pull in the existing `RedisLike` interface (or a richer `RedisLikeWithCounters` superset) and drop all three biome-ignores.

### [LOW] `lib/redact-url.ts` duplicates `packages/byok-guard/redact-url.ts`
- File: `apps/api/src/lib/redact-url.ts:32-42`
- Category: code-quality / duplication
- Evidence: very small utility that the project already centralizes in `packages/byok-guard/redact-url.ts`. The api copy is identical in spirit. The bootstrap-time use case here is "redact URL before any package import" — but the bootstrap paths in index.ts where this is used are AFTER `byok-guard` has been imported.
- Why it matters: two copies of a credential-redaction utility is exactly the pattern CLAUDE.md flags ("Logic duplicating shared packages"). One bug fix has to land in two places.
- Fix: re-export from `@openwhispr/byok-guard` (or `@openwhispr/observability`); delete the local copy.

### [LOW] `lib/default-tenant.ts` `_resetDefaultTenantCacheForTesting()` reachable from production bundle
- File: `apps/api/src/lib/default-tenant.ts:36-40`
- Category: code-quality
- Evidence: prefix `_` is a convention; nothing prevents production callers from invoking it. The whole module compiles into the production bundle.
- Why it matters: a misconfigured route handler invoking this would reset cached tenant resolution mid-request; not realistic but a hardening opportunity.
- Fix: ship the reset hook from a separate `default-tenant.testing.ts` module that production never imports, and let tsup tree-shake it. NODE_ENV branches inside the module would violate LOCKER-01.

### [LOW] `lib/scheme-allowlist.ts` reads `OPENWHISPR_PROTOCOL` on every call
- File: `apps/api/src/lib/scheme-allowlist.ts:77-85`
- Category: code-quality
- Evidence:
  ```ts
  const override = process.env.OPENWHISPR_PROTOCOL?.trim();
  if (override && override.length > 0) {
    for (const s of override.split(",").map((x) => x.trim()).filter(Boolean)) {
      allowed.add(s);
    }
  }
  ```
- Why it matters: validateScheme runs on hot path (desktop-signin). Env re-read + string parse on every call. Not a bug, just unnecessary work.
- Fix: parse once at module load into a frozen `Set`.

### [LOW] `lib/audit.ts` `hexUuid` regex is more permissive than RFC4122
- File: `apps/api/src/lib/audit.ts:93-94`
- Category: code-quality
- Evidence: explicit deviation from strict RFC4122 (uses `[0-9a-f]{8}-…` pattern). Documented in source comments, but multiple validators across the codebase will now diverge.
- Why it matters: documented and intentional; flagging only so reviewers note the deliberate divergence.
- Fix: none today; track via comments + `DEFAULT_TENANT_ID` allowlist.

## Dead code
- None confirmed. Every exported symbol has at least one production caller (verified via grep across `apps/`+`packages/` excluding tests):
  - `softDeletePredicate` is only test-imported in scope — but `withSoftDelete()` from same module IS used by routes. The unused helper is justified by the symmetric API doc. Treat as **LOW** "exported for completeness".
  - `__test`, `__testing__`, `__resetOidcDiscoveryCacheForTests`, `_resetDefaultTenantCacheForTesting`, `fallbackLog` are test-only escape hatches with underscore prefixes; not dead.
  - `redactPaths` is a legacy back-compat alias of `REDACT_PATHS` — could be removed eventually but is currently consumed by `apps/api/tests/unit/plugins/request-log.test.ts`.

## Suppressed warnings
- 15 × `as unknown as` in scope (see HIGH-02). None carry an `issue-NNNN` reference; LOCKER-02 allowlist behavior implied but no inline justification.
- 8 × `biome-ignore lint/suspicious/noConsole` in `bootstrap.ts` + `index.ts` for legitimate boot-time console writes — should be replaced with sync pino (HIGH-04).
- 3 × `biome-ignore lint/suspicious/noExplicitAny` in `plugins/rate-limit.ts` for `redis: any` — replaceable with the in-repo `RedisLike`.
- 0 × `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` in scope.
- 0 × `eslint-disable` in scope.

## Notes
- `apps/api/src/placeholder.ts` listed in the review scope does NOT exist — no file at that path; tree confirms it's not in the repo. Recording as **out-of-scope** per the request instructions.
- `apps/api/scripts/check-default-secrets.ts` IS pulled in by the container ENTRYPOINT before `node dist/index.js` (header comment confirms) — this is part of the boot trust chain. Brief skim showed it uses `readFileSync` with a `containerDenyPath` literal `/app/tools/bootstrap/default-secrets.txt` which is the Dockerfile-mapped path; OK. Full audit deferred.
- The constitutional `LOCKER-01` (no NODE_ENV outside bootstrap files) audit: only valid call sites observed (`auth.ts:520` cookie config — bootstrap-adjacent, allowed; `index.ts:506` debug-fetch gate — bootstrap, allowed; `ssrf-dispatcher.ts:163` — accepts injected `nodeEnv` for tests with `process.env.NODE_ENV` fallback, defensible). PASS — no LOCKER-01 violation in scope.
- The `withTenant(...)`-bound emit pattern is consistently applied (audit.ts, token-rotation.ts, settings-resolver.ts, client-id-upsert.ts) — RLS isolation discipline holds at this layer.
- Rate-limit plugin's `errorResponseBuilder` returns an Error with `__rateLimited: true` sentinel that nothing currently reads (3 references in scope, all writers, zero readers). Cosmetic dead-flag — could be removed. Borderline LOW; not promoting.
- No `child_process.spawn` / `execSync` / `exec` in api-core scope. LOCKER-06 clean.
- No `setTimeout(..., 0)` or similar sync-via-timer workarounds in scope.
- No `eval` / `Function(...)` / dynamic `require()` outside the boot path's legitimate `await import("...")` lazy-loads.
- No raw SQL via template strings with user input — every `sql.raw` call site uses caller-controlled but allow-listed identifiers (client-id-upsert.ts) or constant fragments. The Drizzle `sql\`...\`` template tag is used everywhere with bound parameters.
- No hardcoded credential shapes (`sk-…`, `Bearer ey…`, `AIza`, `AKIA`) in scope. CLEAN.
- No `TODO` / `FIXME` / `HACK` / `XXX` / `TEMP` markers in scope. Comments are dense but disciplined.
