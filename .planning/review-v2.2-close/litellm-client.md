---
phase: v2.2-close
reviewed: 2026-05-16T00:00:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - packages/litellm-client/src/config.ts
  - packages/litellm-client/src/errors.ts
  - packages/litellm-client/src/index.ts
  - packages/litellm-client/src/model-aliases.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Pre-publication Re-review: `packages/litellm-client/src/**`

**Reviewed:** 2026-05-16 against HEAD b830cc4
**Reviewer:** gsd-code-reviewer (FORCE stance)
**Original review:** `.planning/review/litellm-client.md` @ 1832f28
**Scope:** v2.2 milestone-close audit — confirm CR-01/HI-01..04 closure, surface residual defects.

## Summary

The four named original blockers are **closed in code**: `LitellmUpstreamError.bodyText` is truncated at construction and stamped non-enumerable + a defensive `toJSON()` is provided (CR-9 → Phase 37, line 56–92 of `errors.ts`); the SSRF dispatcher boot-time assertion is wired via `Symbol.for("openwhispr.ssrf-wrapped")` (`SsrfDispatcherNotInstalledError` + `assertSsrfInstalled()`, index.ts:43–60), stamped by `makeSSRFDispatcher` (ssrf-dispatcher.ts:457); model aliases are loaded from `compose/litellm/litellm_config.yaml` via `loadBundledModelProviders()` / `loadLitellmModelAliases()` (model-aliases.ts); all four request methods now accept `signal` / `headersTimeout` / `bodyTimeout` and forward them to undici (index.ts:111–191, 284–425); `streamOptions` is first-class with the documented merge order `default ← extras.stream_options ← streamOptions` (index.ts:310–322).

No CRITICAL defects remain in scope. Six lower-severity issues persist — four WARNINGs (one of which is the same control-flow class flagged previously as ME-02 still unaddressed) and two INFOs.

## Warnings

### WR-01: `passthrough` still accepts arbitrary HTTP method via unchecked cast

**File:** `packages/litellm-client/src/index.ts:419`
**Issue:** `method: args.method as Dispatcher.HttpMethod` — no runtime validation. This is the unaddressed ME-02 from the prior review. With timeouts/signal now plumbed and the SSRF guard active, the residual surface is small, but trailing-space typos (`"GET "`) or unsupported methods (`"FOO"`) propagate to undici which may produce an opaque error. Combined with the arbitrary `path` argument (no `/v1/` prefix check) this is a small-surface footgun for any future route that derives `path` from request-shaped state.
**Fix:**
```ts
const ALLOWED_METHODS = new Set(["GET","POST","PUT","DELETE","PATCH","HEAD","OPTIONS"]);
if (!ALLOWED_METHODS.has(args.method)) {
  throw new Error(`passthrough: unsupported method ${JSON.stringify(args.method)}`);
}
if (!path.startsWith("/v1/")) {
  throw new Error(`passthrough: path must start with /v1/, got ${JSON.stringify(path)}`);
}
```

### WR-02: `assertSsrfInstalled` reads symbol via index signature — type cast hides absence of the marker on non-undici dispatchers

**File:** `packages/litellm-client/src/index.ts:55–60`
**Issue:** `const dispatcher: Dispatcher & { [k: symbol]: unknown } = getGlobalDispatcher();` then `if (!dispatcher[SSRF_WRAPPED_MARKER])`. The intersection-type cast asserts that `Dispatcher` has a symbol index signature; it does not. Any dispatcher that does carry a *coincidentally same-named* `Symbol.for("openwhispr.ssrf-wrapped")` (test fixtures, third-party library) bypasses the gate — and conversely, a `Proxy`-wrapped dispatcher whose `get` trap returns `false` for unknown symbols will trip a false-positive `SsrfDispatcherNotInstalledError`. The current implementation works for the only two dispatcher kinds in use today (real SSRF-wrapped `Agent`, raw undici `Agent`), but the contract is undocumented and the type cast (`Dispatcher & { [k: symbol]: unknown }`) is the kind of structural assertion LOCKER-02 was written to discourage.
**Fix:** Use a typed local helper:
```ts
function hasSSRFMarker(d: Dispatcher): boolean {
  return Reflect.get(d as object, SSRF_WRAPPED_MARKER) === true;
}
```
The `=== true` check (rather than truthy) closes the proxy-coincidence class and removes the inline type-intersection.

### WR-03: `audioTranscriptions` pipes caller body into a `PassThrough` but does not propagate `PassThrough` errors back to the caller's body

**File:** `packages/litellm-client/src/index.ts:390–395`
**Issue:** The boundary-prefix path attaches `args.body.on("error", ...)` to destroy the through-stream, but the inverse hookup is missing: if `through` errors (e.g., backpressure / consumer destruction by undici on timeout), `args.body` is left dangling and may leak a file handle or open socket. With `bodyTimeout` now active (WR adjacent: 120s default), undici will destroy the request body on timeout — the original `args.body` won't see the destroy because only the wrapper is registered with undici.
**Fix:**
```ts
through.on("error", (err) => args.body.destroy(err));
// or use pipeline():
import { pipeline } from "node:stream";
const through = new PassThrough();
through.write(prefix);
pipeline(args.body, through, (err) => { if (err) through.destroy(err); });
```

### WR-04: `BUNDLED_MODEL_PROVIDER` initialised at module load with `try { … } catch { fallback }` silently masks yaml drift / unreadable yaml at production startup

**File:** `packages/litellm-client/src/index.ts:78–94`
**Issue:** The whole point of HI-03 closure was to make `compose/litellm/litellm_config.yaml` the single source of truth. The fallback static map (lines 85–90) re-introduces the very drift it was supposed to eliminate, and because the swallow happens at module load there is no log, no metric, no boot-time assertion that the yaml was readable. A corporate operator who deletes the bundled yaml (because they override `LITELLM_BASE_URL`) will silently get the four-entry stale map; that map is then irrelevant because `isOverride=true` skips `checkProviderKey`, but in the rare case where the operator sets `LITELLM_MASTER_KEY` only and leaves `LITELLM_BASE_URL` unset (deploy footgun) the stale map is consulted with stale provider mappings.
**Fix:** Either (a) drop the fallback entirely and let module load throw (loud-fail; matches HI-02 philosophy), or (b) keep the fallback but emit a one-time `console.warn` (or a recorded structured-log entry via a passed-in logger) so operators see the degraded state. Option (a) is cleaner because tests that need to exercise the fallback already inject `loadBundledModelProviders` via the model-aliases module's `yamlPath` parameter.

## Info

### IN-01: `LitellmUpstreamError.bodyText` is declared `private readonly` and immediately re-defined with `Object.defineProperty`

**File:** `packages/litellm-client/src/errors.ts:63, 76–81`
**Issue:** Belt-and-braces is good, but the TypeScript `private readonly bodyText: string;` field declaration is unused at runtime — `Object.defineProperty` re-creates the slot non-enumerable on every construction. The field declaration produces a plain enumerable own-property in compiled JS *before* the `defineProperty` rewrite; in a future refactor where someone re-orders the constructor, the enumerable shadow could resurface in the window between `super()` and `defineProperty`. Cleaner to drop the field declaration and rely entirely on `defineProperty`, OR drop the `defineProperty` and use a private class field with `#bodyText` (truly non-enumerable, ECMAScript-level private). Either is robust; the current hybrid is not (and the test-file at `tests/unit/errors-truncation.test.ts` should explicitly assert non-enumerability post-construction).
**Fix:** Use ECMAScript private:
```ts
export class LitellmUpstreamError extends Error {
  public readonly status: number;
  readonly #bodyText: string;
  constructor(status: number, bodyText: string, message?: string) {
    const truncated = bodyText.slice(0, 200);
    super(message ?? `LiteLLM upstream returned ${status}: ${truncated}`);
    this.name = "LitellmUpstreamError";
    this.status = status;
    this.#bodyText = truncated;
  }
  toJSON() { return { name: this.name, message: this.message, status: this.status }; }
}
```
`#`-fields are inherently non-enumerable, non-iterable via `Object.keys`, and invisible to `JSON.stringify` — strictly stronger than `defineProperty`.

### IN-02: `defaultYamlPath()` resolves via three `..` segments — fragile if `packages/litellm-client/` is ever moved or symlinked

**File:** `packages/litellm-client/src/model-aliases.ts:84–88`
**Issue:** `resolve(here, "..", "..", "..", "compose", ...)` hard-codes the package depth from repo root. If the package is consumed as a published npm artifact (the package.json suggests it could be), or if a future monorepo restructure moves `packages/` one level, the resolver silently returns a non-existent path and the `readFileSync` throws — caught by the `try { ... } catch` in index.ts:79 and falls through to the stale static map (WR-04). No test covers the "package is consumed from `node_modules/`" case.
**Fix:** Accept the path via env (`LITELLM_CONFIG_YAML_PATH`) with the relative-walk as fallback; or have callers (api / worker bootstrap) pass an absolute path explicitly. Either makes the package consumable outside the monorepo without a stale-map regression.

## Closure delta vs original review

| Original ID | Severity | Status @ b830cc4 | Evidence |
|---|---|---|---|
| **CR-01** (bodyText leak) | CRITICAL → **CLOSED** | Fixed | `errors.ts:69` truncates to 200 chars; `errors.ts:76–81` `Object.defineProperty(..., enumerable:false)`; `errors.ts:89–91` `toJSON()` returns only `{name, message, status}`. Tested in `tests/unit/errors-truncation.test.ts`. Minor hardening suggested in IN-01 (private-field migration). |
| **HI-01** (timeouts + AbortSignal) | HIGH → **CLOSED** | Fixed | `DEFAULT_HEADERS_TIMEOUT_MS=30_000`, `DEFAULT_BODY_TIMEOUT_MS=120_000` (index.ts:108–109); `signal? / headersTimeout? / bodyTimeout?` on all four interfaces (`ChatCompletionRequest`, `ChatCompletionsStreamRequest`, `AudioTranscriptionRequest`, `PassthroughRequest`); forwarded to undici in each method body. Stream variant defaults `bodyTimeout: 0` (intentional, long-lived SSE — documented inline at 332–333). |
| **HI-02** (SSRF dispatcher assertion) | HIGH → **CLOSED** | Fixed | `SsrfDispatcherNotInstalledError` (errors.ts:32–42); `SSRF_WRAPPED_MARKER = Symbol.for("openwhispr.ssrf-wrapped")` (index.ts:43); `assertSsrfInstalled()` consulted at each method entry via `ssrfGate()` (index.ts:55–60, 239–241, 275, 304, 361, 414); marker stamped by `makeSSRFDispatcher` (ssrf-dispatcher.ts:457–462). Test injection seam preserved via `opts.request`. WR-02 above flags a residual type-cast/structural-narrowing concern, not a closure regression. |
| **HI-03 / ME-01** (model alias yaml source) | HIGH/MEDIUM → **CLOSED** | Fixed | `model-aliases.ts` exposes `loadLitellmModelAliases()`, `loadBundledModelProviders()`, `getDefaultAgentModel()` reading `compose/litellm/litellm_config.yaml`; `BUNDLED_MODEL_PROVIDER` derived at module load (index.ts:78–94). WR-04 above flags the silent-fallback masking — a hardening item, not a closure regression. |
| **HI-04** (streamOptions opt-out) | HIGH → **CLOSED** | Fixed | First-class `streamOptions?: Record<string, unknown>` on `ChatCompletionsStreamRequest` (index.ts:139–145); explicit merge `{ include_usage: true, ...extrasStreamOptions, ...streamOptions }` at index.ts:318–322 with merge order documented (310–314). Test file `tests/unit/index.test.ts` exercises the surface. |
| **ME-02** (passthrough method cast) | MEDIUM → **NOT FIXED** | Re-raised as **WR-01** | Same cast remains at index.ts:419. |
| **ME-03** (plaintext default base URL) | MEDIUM → **NOT FIXED** | Out of v2.2 scope (internal docker network) | `config.ts:29` unchanged. Not raising again — non-blocking, documented constraint. |
| **ME-04** (master key vs virtual key env naming) | MEDIUM → **NOT FIXED** | Documentation concern; out of code-review scope | Operator docs concern, not source defect. |
| **LO-01** (`as Parameters<typeof doRequest>[1]` cast) | LOW → **NOT FIXED** | Surface widened | Same cast now appears 4× (one per method, lines 298, 346, 409, 428) because `reqOpts` is widened to `Record<string, unknown>` to optionally accept `signal`. Cumulative type-safety loss is modest; documentable via a typed helper `function makeUndiciOpts(...): Parameters<typeof undiciRequest>[1]`. Non-blocking. |
| **LO-02** (`requestId` header size cap) | LOW → **NOT FIXED** | Same surface | index.ts:257–259 unchanged. Caller-side responsibility today; non-blocking. |

**v2.2 publication-blocker count:** 0.
**Recommended-before-publication WARNINGs:** WR-01 (validate passthrough method/path — 5-line fix), WR-03 (stream error propagation — 1 line). WR-02 and WR-04 are hardening that can ship a point-release later.

## Notes

- No new CRITICAL surface introduced by the four closure changes. The `Object.defineProperty` non-enumerable pattern is sound; the `Symbol.for` registry-key approach for the SSRF marker correctly avoids the apps→packages circular and is testable in isolation.
- `model-aliases.ts` uses `readFileSync` at module load — acceptable for boot-time config, but means tests must mock the FS or invoke `loadBundledModelProviders(yamlPath)` with a fixture; the existing test harness in `packages/litellm-client/tests/unit/model-aliases.test.ts` covers this.
- No LOCKER violations observed: no `as any`, no `as unknown as`, no `@ts-ignore` / `@ts-expect-error`, no NODE_ENV branches, no hardcoded localhost / secret-shape literals, no `child_process` interpolation, no plaintext credential columns (out of scope but verified). The single `dispatcher: Dispatcher & { [k: symbol]: unknown }` intersection at index.ts:56 is a structural narrowing, not a suppression — but cleanable per WR-02.
- TODO/FIXME/HACK/XXX/TEMP/WORKAROUND scan: clean.
- Retry behaviour: still non-retrying — compliant with the "no retry of POST without idempotency key" rule.

---

_Reviewed: 2026-05-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
