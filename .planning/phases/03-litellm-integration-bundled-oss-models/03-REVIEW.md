---
phase: 03-litellm-integration-bundled-oss-models
reviewed: 2026-05-10T00:00:00Z
depth: standard
files_reviewed: 56
files_reviewed_list:
  - apps/api/package.json
  - apps/api/src/__tests__/litellm-spike-request-id.test.ts
  - apps/api/src/__tests__/multipart-registered.test.ts
  - apps/api/src/index.ts
  - apps/api/src/lib/__tests__/idempotency-cache.test.ts
  - apps/api/src/lib/__tests__/pyannote-client.test.ts
  - apps/api/src/lib/idempotency-cache.ts
  - apps/api/src/lib/pyannote-client.ts
  - apps/api/src/lib/word-units.test.ts
  - apps/api/src/lib/word-units.ts
  - apps/api/src/routes/__tests__/diarization.test.ts
  - apps/api/src/routes/diarization.ts
  - apps/api/src/routes/index.test.ts
  - apps/api/src/routes/index.ts
  - apps/api/src/routes/realtime.test.ts
  - apps/api/src/routes/realtime.ts
  - apps/api/src/routes/reason.test.ts
  - apps/api/src/routes/reason.ts
  - apps/api/src/routes/test-only.test.ts
  - apps/api/src/routes/test-only.ts
  - apps/api/src/routes/transcribe.test.ts
  - apps/api/src/routes/transcribe.ts
  - apps/api/vitest.config.ts
  - apps/worker/Dockerfile
  - apps/worker/package.json
  - apps/worker/src/db/app-pool.test.ts
  - apps/worker/src/db/app-pool.ts
  - apps/worker/src/db/litellm-pool.test.ts
  - apps/worker/src/db/litellm-pool.ts
  - apps/worker/src/index.ts
  - apps/worker/src/jobs/ingest-litellm-spend.test.ts
  - apps/worker/src/jobs/ingest-litellm-spend.ts
  - apps/worker/src/lib/infer-kind.test.ts
  - apps/worker/src/lib/infer-kind.ts
  - apps/worker/tsconfig.json
  - apps/worker/tsup.config.ts
  - apps/worker/vitest.config.ts
  - compose/litellm/litellm_config.contract.yaml
  - compose/litellm/litellm_config.yaml
  - compose/postgres/initdb/01-litellm-database.sh
  - compose/traefik/dynamic.yml
  - docker-compose.yml
  - packages/contract-tests/package.json
  - packages/contract-tests/src/__tests__/schemas-phase-3.test.ts
  - packages/contract-tests/src/diarization.test.ts
  - packages/contract-tests/src/helpers/multipart.ts
  - packages/contract-tests/src/litellm-base-url-override.test.ts
  - packages/contract-tests/src/missing-key-503.test.ts
  - packages/contract-tests/src/realtime.test.ts
  - packages/contract-tests/src/reason.test.ts
  - packages/contract-tests/src/schemas.ts
  - packages/contract-tests/src/transcribe.test.ts
  - packages/data/src/__tests__/migrate-litellm-db.test.ts
  - packages/data/src/__tests__/usage-ledger-idempotency.test.ts
  - packages/data/src/migrate.ts
  - packages/data/vitest.config.ts
  - packages/litellm-client/src/index.ts
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-10
**Depth:** standard
**Files Reviewed:** 56
**Status:** issues_found

## Summary

Phase 03 ships the shared LiteLLM client, three LiteLLM-backed Fastify routes (`/api/transcribe`, `/api/reason`, `WSS /v1/realtime`), the pyannote-async sync-wrapper at `/v1/audio/diarization` (with Stripe-style idempotency cache), and the BullMQ spend-log ingest worker. Contract tests, docs, and compose wiring are present.

Overall the implementation is high-quality: Pitfall #8 (provider-key auth → 503 not 401) is consistently honored across all four routes, the WSS proxy correctly strips the desktop bearer before forwarding, idempotent ledger writes are wired with `ON CONFLICT (request_id) DO NOTHING`, and the worker's pgbouncer-host deny-list defense protects cross-DB reads.

One **Critical** issue blocks the phase as deployed: the production entrypoint in `apps/api/src/index.ts` never constructs a Valkey client or passes one to `buildApp`/`buildAllRoutes`, so the `/v1/audio/diarization` route is never registered in production. The route works in tests (which inject `redis` directly into `buildDiarizationRoutes`) and the `index.test.ts` smoke does not exercise `buildApp`'s production branch — so this defect slips through CI.

Five Warnings cluster around small but real correctness gaps (idempotency-cache TOCTOU on bind, lossy `bodyHash:"unknown"` rescue path, fallible scheme replace on uppercase URLs, missing `body` field check in classify). Info items are mostly hardening suggestions that do not affect contract.

## Critical Issues

### CR-01: `/v1/audio/diarization` is never registered in the production entrypoint (Valkey client never wired)

**File:** `apps/api/src/index.ts:140-266` (definition of `buildApp` and `BuildAppOptions`) and `apps/api/src/index.ts:269-323` (production bootstrap)

**Issue:**
- `BuildAppOptions` (lines 86–138) does not declare a `redis` field.
- `buildApp` (lines 248–254) calls `buildAllRoutes({ auth, db, mintBearer, ...litellm, ...litellmMasterKey })` with no `redis` argument.
- `buildAllRoutes` (`routes/index.ts:165`) registers `buildDiarizationRoutes` ONLY when `deps.redis` is truthy.
- The production bootstrap (lines 269–323) never imports `@redis/client` / `ioredis`, never connects to Valkey, never passes a `redis` instance to `buildApp`.

Net effect: every production `node dist/index.js` boot leaves `/v1/audio/diarization` unregistered. The centralized `notFoundHandler` will 404 every request. The diarization contract test (`packages/contract-tests/src/diarization.test.ts`) only exercises the route through the contract-test stack which sets `MOCK_DIARIZATION=true` — but even that path requires `deps.redis` to be supplied, which the compose stack does not currently arrange. This is the load-bearing defect of Plan 06.

The unit test `apps/api/src/routes/index.test.ts` does not cover the diarization registration branch (it only passes `litellm`/`litellmMasterKey`), and `apps/api/src/routes/__tests__/diarization.test.ts` builds a hand-crafted Fastify instance — neither catches the production wiring gap.

**Fix:**

In `apps/api/src/index.ts`:

```ts
// 1. Add to BuildAppOptions
import type { RedisLike } from "./lib/idempotency-cache.js";

export interface BuildAppOptions {
  // …existing fields…
  redis?: RedisLike;
  mockDiarization?: boolean;
}

// 2. Forward redis in buildApp -> buildAllRoutes
const routes = buildAllRoutes({
  auth: opts.auth,
  db: opts.db,
  mintBearer,
  ...(opts.litellm ? { litellm: opts.litellm } : {}),
  ...(opts.litellmMasterKey ? { litellmMasterKey: opts.litellmMasterKey } : {}),
  ...(opts.redis ? { redis: opts.redis } : {}),
  ...(opts.mockDiarization !== undefined ? { mockDiarization: opts.mockDiarization } : {}),
});

// 3. Production bootstrap — construct the Valkey client
import { createClient } from "@redis/client";

const valkeyUrl = process.env.VALKEY_URL
  ?? `redis://:${encodeURIComponent(process.env.VALKEY_PASSWORD ?? "")}@${process.env.VALKEY_HOST ?? "valkey"}:${process.env.VALKEY_PORT ?? "6379"}`;
const redis = createClient({ url: valkeyUrl });
await redis.connect();

const app = await buildApp({
  db,
  auth,
  ...(litellm ? { litellm } : {}),
  ...(litellmMasterKey ? { litellmMasterKey } : {}),
  redis: redis as unknown as RedisLike,
  ...(process.env.MOCK_DIARIZATION === "true" ? { mockDiarization: true } : {}),
});
```

Also add a regression test that asserts `/v1/audio/diarization` is in the route tree when `redis` is supplied to `buildApp`, and a contract-test profile assertion that the route returns 200 (mock mode) rather than 404 — the current contract test's `expect(res.status).toBe(200)` will surface this once `redis` is wired, but the existing prod stack has been silently 404'ing.

---

## Warnings

### WR-01: `idempotency-cache.bindJobId` rescue path drops `bodyHash`, breaking conflict detection on legitimate retries

**File:** `apps/api/src/lib/idempotency-cache.ts:104-136`

**Issue:** When the reservation has expired (or the JSON is corrupt) between `lookupOrReserve` and `bindJobId`, the rescue path writes:

```ts
const entry: CacheEntry = { bodyHash: "unknown", jobId, createdAt: Date.now() };
```

A subsequent request with the same `Idempotency-Key` will see `existing.bodyHash === "unknown"` and the comparison `existing.bodyHash !== bodyHash` will be true for ANY real body — surfacing a 409 conflict even on legitimate identical retries. Since this only fires after a 24h TTL expiry mid-job (impossible given POLL_CEILING_MS=5min) OR cache corruption, the impact is small but the Stripe-semantics contract is violated in the corrupt-cache branch.

**Fix:** Pass the original `bodyHash` through to `bindJobId`:

```ts
async bindJobId(key, jobId, bodyHash) {  // add parameter
  // …
  const entry: CacheEntry = { bodyHash, jobId, createdAt: Date.now() };  // use real hash
  // …
}
```

Update `diarization.ts:257` to pass `bodyHash`. The interface change is local — no contract impact.

### WR-02: `bindJobId` is non-atomic (GET + parse + SET) — concurrent binds can clobber each other

**File:** `apps/api/src/lib/idempotency-cache.ts:104-136`

**Issue:** `bindJobId` reads the entry via `redis.get`, mutates the object in JS, and writes it back via `redis.set ... KEEPTTL`. Two concurrent writers (e.g. the desktop double-clicks within the 1s in-flight retry window) can race: both read entry-with-jobId-null, both inject their own jobId, last-writer wins. The losing pyannote job becomes orphaned (no idem hit, billing-on-success-only mitigates cost but spend logs still appear).

**Fix:** Use a Lua script for atomic compare-and-set, or use `SETNX` of a separate `:jobid` subkey. Minimal fix:

```ts
// Rewrite bindJobId to use a Lua eval so read+merge+write is atomic.
// Or: store jobId under a sibling key `diar:idem:<key>:jobid` via SETNX.
```

In v1 the race window is narrow (only between submitDiarize success and bindJobId). Defer if cost is bounded but add an issue.

### WR-03: WSS `upstreamWs` scheme replace loses original case for `HTTPS://` baseUrls

**File:** `apps/api/src/routes/realtime.ts:77`

**Issue:** `upstreamHttp.replace(/^http(s?):/i, "ws$1:")` matches case-insensitively but the replacement string is lower-case `"ws"`, so `HTTPS://litellm:4000` becomes `wss://litellm:4000` (loses uppercase) — actually fine since the WS URL spec is lower-case. BUT the `$1` capture preserves the casing of the `s` only — `HTTPS:` matches `HTTP(S?):` case-insensitively and `$1` is `S`, so result is `wsS:` (note uppercase S), which is malformed. Most baseUrls are lower-case so this is theoretical, but the regex is sloppy.

**Fix:**
```ts
const upstreamWs = upstreamHttp.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
```
Or normalize to lower-case before replace. Add a test with `HTTP://` baseUrl.

### WR-04: `pyannote-client.classify` uses `body.slice(0, 200)` for `PyannoteBadRequestError.message` — the message is logged through `req.log.warn` without redaction; in `submitDiarize`/`createMediaInput` the body could echo a JSON error response from pyannote that contains a (truncated) account/key fragment

**File:** `apps/api/src/lib/pyannote-client.ts:131-145`

**Issue:** While transcribe/reason routes deliberately do NOT echo upstream bodies into the user-facing 502 envelope (good), the pyannote client constructs error `message` strings containing `body.slice(0,200)`. The diarization route logs `{status: err.status}` (good — no body) but the Error itself is rethrown by `mapPyannoteError` for `PyannoteBadRequestError` and `PyannoteUpstreamError`; callers may log `err.message` or surface it. The contract-test profile uses fake keys so no secret in the body, but in production a misconfigured PYANNOTE_API_KEY can return a 401 with `"Authorization header malformed"` etc — generally not secret, but the safer pattern is the same as the LitellmUpstreamError: keep the body on the Error instance for diagnostics, but never put it in `.message`.

**Fix:** Mirror `LitellmUpstreamError`'s pattern — store body on a separate `bodyText` field, default-message contains only status:

```ts
export class PyannoteBadRequestError extends Error {
  override name = "PyannoteBadRequestError";
  public readonly bodyText: string;
  constructor(public readonly status: number, bodyText: string) {
    super(`pyannote ${status}`);
    this.bodyText = bodyText;
  }
}
```

### WR-05: `apps/api/src/index.ts:204` — minimal-mode `tryPrev` synthesizes `email: ""` for the previous-token user, but downstream consumers may rely on a real email

**File:** `apps/api/src/index.ts:191-202`

**Issue:** When the AUTH-04 5-minute overlap admits a request via `tryPreviousToken`, the constructed user object hard-codes `email: ""`. Any downstream code that uses `req.user.email` (e.g. audit logs, ledger metadata) will see an empty string. `tryPreviousTokenLib` apparently returns only `userId, tenantId` — but the canonical `User` type per `dual-auth.ts` likely expects `email`. Not a phase-3 regression but worth double-checking against AUTH-04 contract tests when revisiting.

**Fix:** Have `tryPreviousTokenLib` return `email` from the join, or use `null`/optional rather than empty string to fail-loud on accidental consumption.

---

## Info

### IN-01: `inferKind` defaults to `reason_tokens` for unknown models — silent misclassification risk

**File:** `apps/worker/src/lib/infer-kind.ts:18-26`

**Issue:** Future LiteLLM model aliases (e.g. `nova-3` STT, `gemini-2.0-flash-thinking`) without `whisper`/`realtime` substrings will be classified as `reason_tokens` and `units` will be set to `total_tokens`. Mostly fine, but a minute-priced model misclassified as token-priced silently produces wrong ledger semantics.

**Fix:** Maintain an explicit allow-list mirroring `BUNDLED_MODEL_PROVIDER` in `litellm-client/index.ts`, log a `log.warn` on unknown alias.

### IN-02: `extractDuration` returns 0 silently when LiteLLM SpendLog metadata lacks `duration` — transcribe_minutes/realtime_minutes ledger rows can be 0-units

**File:** `apps/worker/src/jobs/ingest-litellm-spend.ts:198-205`

**Issue:** A whisper or realtime spend row missing `metadata.duration` results in `units = 0` written to `usage_ledger`. Combined with `ON CONFLICT DO NOTHING` and the api routes' inline ledger write (which uses upstream `duration` directly), the converging upsert behavior means whichever writer gets there first wins — could be the 0-units worker if the api route faulted between LiteLLM call and ledger insert.

**Fix:** Skip the row (log warn) when `duration` is required but missing, rather than inserting 0-units. Or use `ON CONFLICT (request_id) DO UPDATE SET units = GREATEST(usage_ledger.units, EXCLUDED.units)` to converge on the larger value.

### IN-03: `derivePresignedUri` falls back to `media://unknown` on URL parse failure — silently misroutes the diarize submit

**File:** `apps/api/src/lib/pyannote-client.ts:147-162`

**Issue:** If pyannote's presigned URL is malformed or the path has zero segments, `deriveMediaUri` returns `media://unknown`. The subsequent `submitDiarize` sends `{url: "media://unknown"}` and pyannote returns 4xx (mapped to 502). Operator sees a confusing 502 instead of a clear "presigned URL parse failed". Cheap to upgrade.

**Fix:** Throw `PyannoteUpstreamError(0, "presigned URL parse failed")` instead of returning an unknown URI.

### IN-04: `apps/api/src/routes/realtime.ts:97-99` — `request.user?.id ?? "anonymous"` defensively defaults to literal string `"anonymous"`; the preHandler already guarantees `req.user.id` is set, so this fallback is dead code that obscures intent

**File:** `apps/api/src/routes/realtime.ts:96-111`

**Issue:** `rewriteRequestHeaders` runs after `preHandler`, which throws AuthError when `req.user` is missing. The `?? "anonymous"` fallback is unreachable in normal control flow; if it ever fires, it would tag spend logs with `openwhispr_user_id: "anonymous"` — silently breaking attribution. Better to fail-fast.

**Fix:**
```ts
const userId = (request as unknown as { user?: { id?: string } }).user?.id;
if (!userId) {
  throw new Error("rewriteRequestHeaders invoked without authenticated user — preHandler invariant broken");
}
```

---

_Reviewed: 2026-05-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
