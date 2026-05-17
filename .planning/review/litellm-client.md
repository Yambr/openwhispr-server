# Review: litellm-client
Branch: main @ 13f0864
Files reviewed: 5

- `packages/litellm-client/src/index.ts` (453 LOC)
- `packages/litellm-client/src/config.ts` (57 LOC)
- `packages/litellm-client/src/errors.ts` (92 LOC)
- `packages/litellm-client/src/model-aliases.ts` (73 LOC)
- `packages/litellm-client/src/model-aliases-yaml-test-seam.ts` (79 LOC)

Plus inspection of `litellm-aliases.generated.json` and cross-codebase consumers in `apps/api/src/routes/{transcribe,reason,realtime,agent/stream}.ts`, `apps/api/src/lib/ssrf-dispatcher.ts`, `apps/api/src/index.ts`.

## Summary
- CRITICAL: 1 / HIGH: 3 / MEDIUM: 4 / LOW: 3
- Top 3 production risks:
  1. **Streaming non-2xx error path can stall the event loop indefinitely** — `chatCompletionsStream` sets `bodyTimeout: 0` and on a 4xx/5xx response calls `await res.body.text()` with no timeout. A slow-rolled or never-completed error body from a hung upstream blocks the route handler forever. Under 1000 concurrent users this is a fast path to event-loop starvation.
  2. **`audioTranscriptions` multipart prefix-injection leaks the caller's `Readable` on the error path** — `through.destroy(err)` is wired for source-error but the destination (PassThrough → undici) failing does not destroy `args.body`. Half-streamed audio uploads from disconnected clients accumulate file descriptors / memory until GC.
  3. **`isOverride` is computed once from `process.env.LITELLM_BASE_URL`** while the actual `baseUrl` comes from `config.baseUrl`. The two sources can disagree (dotenv load order, test injection, future worker/CLI consumers) — producing spurious `MissingProviderKeyError` 503s in corporate deployments.

## Findings

### [CRITICAL] `chatCompletionsStream` error-drain has no body timeout — slow-loris stall vector

`packages/litellm-client/src/index.ts:341-356`

```ts
bodyTimeout: req.bodyTimeout ?? 0,   // line 341 — 0 == no timeout
…
if (res.statusCode >= 400) {
  const bodyText = await res.body.text();   // line 354 — unbounded
  throw new LitellmUpstreamError(res.statusCode, bodyText);
}
```

For the 2xx streaming path, `bodyTimeout: 0` is correct (long-lived SSE). But the SAME `bodyTimeout: 0` applies on the non-2xx path immediately below, where we call `body.text()` to populate the error message. Headers arrive, statusCode is 502/504/429, body is slow-rolled or never closes → `await body.text()` never resolves. The fastify request handler hangs, holds an open socket back to the desktop client, holds the dispatcher connection slot, holds the SSRF agent slot. Repeated under load this exhausts undici's connection pool and stalls the fastify event loop.

Fix options:
- Read the error body with a bounded race: `Promise.race([res.body.text(), setTimeout(5_000).then(() => '<truncated>')])` and `res.body.destroy()` on timeout.
- Or emit `LitellmUpstreamError(status, "")` without reading the body on streaming failures, accepting loss of diagnostic detail for the safety guarantee.

### [HIGH] `audioTranscriptions` PassThrough wiring leaks source `Readable` on destination errors

`packages/litellm-client/src/index.ts:390-394`

```ts
const through = new PassThrough();
through.write(prefix);
args.body.on("error", (err) => through.destroy(err));
args.body.pipe(through);
body = through;
```

Two issues:
1. `args.body.pipe(through)` propagates source → dest, but there is NO reverse wiring. When undici aborts the request mid-upload (client disconnect, timeout, SSRF reject), `through` is destroyed but `args.body` keeps reading from its source until GC. Per-failed-upload fd / memory leak.
2. `through.write(prefix)` ignores the return value (backpressure). PassThrough absorbs ~200 bytes synchronously so this is fine today, but a defensive write should respect backpressure.

Fix with `stream/promises.pipeline`:
```ts
import { pipeline } from "node:stream/promises";
const through = new PassThrough();
through.write(prefix);
pipeline(args.body, through).catch(() => { /* errors surface via undici */ });
```

### [HIGH] `isOverride` detection drifts from `baseUrl` source-of-truth (false-positive 503s)

`packages/litellm-client/src/index.ts:233`

```ts
const isOverride = opts.isOverride ?? Boolean(process.env.LITELLM_BASE_URL);
```

`isOverride` encodes "corporate deployment — skip the bundled-default provider-key precheck", but it is computed from `process.env.LITELLM_BASE_URL` while the `baseUrl` the client uses comes from `config.baseUrl` (loaded by `loadLitellmConfigFromEnv`). Drift paths:

1. **Test injection mismatch.** A test that constructs `config.baseUrl = "https://corp.example/litellm"` without also setting `process.env.LITELLM_BASE_URL` gets `isOverride = false` and triggers bundled-default provider-key prechecks against a corporate config. `opts.isOverride` is the escape hatch but isn't default.
2. **dotenv / bootstrap race.** If `buildLitellmClient` is imported before any env-loading step runs, `process.env.LITELLM_BASE_URL` is undefined at first call. Today's apps/api ordering is fine; future workers/CLIs may trip it.
3. **Logical coupling.** The precheck question is "does my baseUrl point at our bundled defaults?" — answer it from `config`, not env.

Fix:
```ts
const isOverride = opts.isOverride ?? (config.baseUrl !== DEFAULT_LITELLM_BASE_URL);
```

Bonus: this removes the only `process.env` read in the runtime path, cleaning the LOCKER-01 posture.

### [HIGH] Header values forwarded from caller-supplied strings without CR/LF rejection

`packages/litellm-client/src/index.ts:253-260, 402, 416`

```ts
function authHeaders(userId: string, requestId: string): Record<string, string> {
  return {
    authorization: `Bearer ${config.masterKey}`,
    "x-litellm-end-user-id": userId,                    // raw caller value
    "x-litellm-spend-logs-metadata": JSON.stringify({
      openwhispr_request_id: requestId,                 // JSON-escaped, safe
    }),
  };
}
…
"content-type": args.contentType,                       // raw caller value
```

`userId` and `args.contentType` are forwarded verbatim. Undici DOES reject `\r` / `\n` / `\x00` in header values (throws `INVALID_HEADER_TOKEN`), but that throw is unwrapped here and bubbles as a generic 500 instead of a 400, hiding the root cause. Defense-in-depth:

- Validate (or strip) CR/LF in `userId` and `args.contentType` at the client boundary; throw a typed `LitellmUpstreamError(400, "invalid header character")` instead of an undici stack.
- Today `userId = req.user.id` (UUID from Better Auth) so live exploitation is blocked, but this package is being PUBLISHED — a future consumer with looser ID validation would silently lose the gate.

`requestId` is JSON-stringified inside `x-litellm-spend-logs-metadata`, so injection through that field is blocked by `JSON.stringify`'s escaping.

### [HIGH] Five exported symbols have zero non-test consumers (debut publish locks in API surface)

`packages/litellm-client/src/index.ts:93-100, 108-109, 177`

```ts
export const BUNDLED_MODEL_PROVIDER = …      // imported only by this package's tests
export const PROVIDER_ENV_VAR = …            // imported only by this package's tests
export const DEFAULT_HEADERS_TIMEOUT_MS = …  // no consumers anywhere
export const DEFAULT_BODY_TIMEOUT_MS = …     // no consumers anywhere
export const DEFAULT_STT_MODEL = …           // no consumers anywhere
```

Confirmed by grep across `apps/**` and `packages/**` excluding `packages/litellm-client/src/` — the first two only appear in this package's own `tests/unit/index.test.ts`, the last three have no importers at all.

Why HIGH and not MEDIUM: this is the package's debut on a public GitHub remote. Every exported symbol becomes API contract that we either maintain forever or break in a 1.x bump. LOCKER-04 invariant 14 explicitly forbids exported symbols with no non-test importers.

Fix: de-export to internal `const`s, OR add a README documenting these as part of the stable public surface intentionally.

### [MEDIUM] `audioTranscriptions` injects `model` form field even when caller already supplied one

`packages/litellm-client/src/index.ts:381-395`

The client unconditionally prepends a `name="model"` multipart part regardless of whether `args.body` already contains a `model` field. If a future caller (none today) includes their own `model` part, the proxy receives two — LiteLLM's `data.get("model")` returns the first, so the client's injected value wins and the caller's is silently ignored. Tighten the contract:

- Either document "the client owns the `model` form field — do not include it in `args.body`",
- Or detect and reject a duplicate at the client boundary.

### [MEDIUM] Module-load fallback in `deriveBundledModelProviderMap` masks build/codegen failures

`packages/litellm-client/src/index.ts:78-92`

```ts
function deriveBundledModelProviderMap(): Record<string, keyof LitellmProviderKeys> {
  try {
    return loadBundledModelProviders() as Record<string, keyof LitellmProviderKeys>;
  } catch {
    return {
      "qwen3.6-plus": "openrouter",
      "gemini-3-flash": "openrouter",
      "gpt-4o-mini": "openrouter",
      "whisper-large-v3": "groq",
    };
  }
}
```

The codegen JSON is committed and always present, so this catch is unreachable in production — but if it WERE reached (corrupted dist, mis-bundled output, a future runtime swap to yaml), the static map silently disagrees with the canonical yaml. The contract advertises "any model added to the yaml is automatically picked up" — the fallback breaks that contract silently.

The comment at line 76 argues a 503 from a wrong-provider precheck is preferable to a boot crash. Disagree: a boot crash with a stack pointing at the missing JSON is operator-actionable; a spurious 503 at request time looks like an upstream provider problem and routes ops in the wrong direction. Drop the try/catch; let import fail loudly.

### [MEDIUM] `LITELLM_BASE_URL` accepted from env with zero validation

`packages/litellm-client/src/config.ts:39-42`

```ts
const baseUrl =
  env.LITELLM_BASE_URL && env.LITELLM_BASE_URL.length > 0
    ? env.LITELLM_BASE_URL
    : DEFAULT_LITELLM_BASE_URL;
```

No URL parse, no scheme restriction, no userinfo check. A misconfigured operator could set `LITELLM_BASE_URL=file:///etc/passwd`, `LITELLM_BASE_URL=javascript:alert(1)`, or `LITELLM_BASE_URL=https://attacker.example@litellm:4000` (userinfo smuggling). The SSRF dispatcher would presumably reject `file://` at wire time, but the client emits no error at config load — the failure surfaces as an opaque undici parse error at the first request.

The `realtime` route also derives `ws://` from `baseUrl` via a regex scheme swap (`apps/api/src/routes/realtime.ts:75`). If baseUrl carries a path, userinfo, or an unexpected scheme, the swap silently misbehaves.

Fix at config load:
```ts
const parsed = new URL(baseUrl);            // throws on invalid
if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("LITELLM_BASE_URL scheme must be http or https");
if (parsed.username || parsed.password) throw new Error("LITELLM_BASE_URL must not contain userinfo");
```

### [MEDIUM] `MissingProviderKeyError` message embeds caller-supplied `model` without truncation/escaping

`packages/litellm-client/src/errors.ts:49`

```ts
super(`${envVar} is not configured. Set it in .env to enable model "${model}" via LiteLLM.`);
```

`model` is caller-supplied (a `req.model` field from a route request body). Two concerns:

1. **No length cap.** A caller could send a multi-MB `model` value and the entire string would land in pino logs. Apply the same 200-char cap that `LitellmUpstreamError` uses.
2. **No structural escape.** Low-likelihood downstream rendering surfaces (Grafana log panel rendered as markdown, a future ops UI) could be misled by control chars. Today Grafana renders as text — currently safe.

### [LOW] `parseMultipartBoundary` regex is RFC-loose

`packages/litellm-client/src/index.ts:225`

```ts
const match = contentType.match(/boundary=("?)([^";]+)\1/i);
```

RFC 2046 §5.1.1 boundary chars are `0-9 A-Z a-z '()+_,-./:=?` + space. The regex accepts any char except `"` and `;` — broader than the RFC. Incoming headers come from undici (which validates) so this is fine in practice, noting only.

### [LOW] `extras` spread before structured fields is fragile contract

`packages/litellm-client/src/index.ts:278-283, 323-330`

```ts
const body = JSON.stringify({
  ...req.extras,
  model,
  messages: req.messages,
  user: req.userId,
});
```

`model`, `messages`, `user` are placed AFTER `...req.extras`, so they override any same-keyed extras values. Today this is the intent ("structured fields win"). But the contract is implicit and reorder-fragile. A future caller passing `user: "other-tenant"` in `extras` would have it silently overridden — fine — but if someone reorders the spread the cross-tenant attribution leak appears. Strip the known keys from extras explicitly:
```ts
const { model: _m, messages: _ms, user: _u, stream: _s, stream_options: _so, ...restExtras } = req.extras ?? {};
```

Same in `chatCompletionsStream`. Today the merge happens to work because `stream_options: mergedStreamOptions` comes after `...req.extras`, but explicit destructuring documents the precedence at the point of use.

### [LOW] Comment fallback list in `deriveBundledModelProviderMap` is hand-maintained

`packages/litellm-client/src/index.ts:86-90`

The 4-entry static fallback is hand-maintained against the yaml. If kept (see MEDIUM finding above), it should be auto-generated alongside the JSON, otherwise it drifts.

## Dead code

- `BUNDLED_MODEL_PROVIDER` export — referenced only in this package's own tests. Internal `const` suffices.
- `PROVIDER_ENV_VAR` export — same.
- `DEFAULT_HEADERS_TIMEOUT_MS`, `DEFAULT_BODY_TIMEOUT_MS` exports — no consumers anywhere.
- `DEFAULT_STT_MODEL` export — no consumers anywhere.
- `deriveBundledModelProviderMap`'s catch-fallback static map — unreachable at runtime because the codegen JSON is committed and bundled.

## Suppressed warnings

None. No `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `as any`, or `as unknown as` in any reviewed file. Good.

(`reqOpts as Parameters<typeof doRequest>[1]` casts appear 4× in index.ts. These are structural casts of `Record<string, unknown>` → undici's options type, not type suppressions.)

## Notes

**Cross-cutting concerns flagged for follow-up, NOT in this package's scope:**

1. **`apps/api/src/lib/dep-check.ts:83`** issues an ad-hoc `request(\`${deps.litellmUrl}/health\`, ...)` directly rather than going through `buildLitellmClient`. SSRF dispatcher is still installed globally so wire-level SSRF is enforced, but the client's `assertSsrfInstalled` defense-in-depth check is skipped. Health-check endpoint, not on the hot path; minor.

2. **Realtime WSS path** (`apps/api/src/routes/realtime.ts:75-127`) derives `ws://` from `client.baseUrl` via a regex scheme swap. The litellm-client itself doesn't expose a `wsUpstream` helper — every WSS consumer must re-derive. Consider exposing `derivewsUrl(baseUrl: string): string` as part of the package's public surface so each consumer doesn't reinvent the regex (especially relevant once baseUrl validation lands — see MEDIUM finding above).

3. **No retry / backoff anywhere in the client.** Every method is single-shot — 429s and transient 5xxs bubble straight up as `LitellmUpstreamError(502)`. The review checklist explicitly mentions "exponential backoff with jitter on 429/5xx"; there is no implementation. This may be intentional (let route handlers decide) but is undocumented. ARCHITECTURAL: decide whether retry belongs HERE, in the calling routes, or not at all, and write the decision into the package README before publish.

4. **AbortController support exists** via `signal?: AbortSignal` forwarded to undici per call. There is no helper for "abort all in-flight requests on shutdown" — for graceful drain during a deployment this would matter. Add to package readme as a known limitation.

5. **`audioTranscriptions` model field ownership**: today the client owns `model` via `?model=` query + injected multipart part. Document this PROMINENTLY for OSS consumers — calling code must NOT add their own `model` field to the multipart body, or it will be silently ignored.

6. **License header**: every reviewed file carries `// SPDX-License-Identifier: FSL-1.1-ALv2`. Good for OSS publish.

7. **`opts.request` test seam**: documented and gated behind a clear "tests inject this" comment. Acceptable design for a thin abstraction; preferable to vi.mock-style module replacement.

8. **`process.env` reads**: one in `config.ts:33` (correct — config layer per LOCKER-01) and one in `index.ts:233` (the `isOverride` smell, flagged HIGH above). No `NODE_ENV` branches anywhere. LOCKER-01 clean.

9. **Pino redaction posture**: `LitellmUpstreamError` correctly truncates `bodyText` at construction, marks it non-enumerable, and overrides `toJSON()`. LOCKER-05 posture is correct in advance of Phase 37 BLOCKING flip. `Authorization: Bearer <masterKey>` is never composed into any error message — verified.

10. **Hardcode posture**: `DEFAULT_LITELLM_BASE_URL = "http://litellm:4000"` is the docker-compose service name, intentional and documented. No `localhost`, no `sk-` literals, no UUID literals in src/. LOCKER-03 clean.

11. **TODO/FIXME/HACK scan**: zero hits across all five reviewed files.

12. **Disabled tests scan**: zero `.skip/.only/.todo` in `packages/litellm-client/tests/`.
