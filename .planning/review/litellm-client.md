# Adversarial Code Review — packages/litellm-client/src/**

**Branch:** `main` (HEAD 6e43588)
**Scope:** `config.ts`, `errors.ts`, `index.ts` (~625 LoC in-scope).
**Out of scope:** tests, `.planning/`, `docs/`, generated `litellm-aliases.generated.json`, `model-aliases*.ts` (not in the user-supplied scope paths).
**Stance:** FORCE — bugs assumed present until disproved.

---

## Summary

The package is in **substantively good shape** for a pre-publication audit. The dominant secret-leak surface (`LitellmUpstreamError.bodyText`) is correctly truncated at construction, held as a non-enumerable own property, AND overridden via `toJSON()` — three independent layers all firing in the right direction. Multipart pass-through preserves the streaming invariant (no rebuffer of the audio payload). SSRF gate is enforced lazily per-call.

What I did **not** find: the multipart re-buffering bug, an untruncated upstream body in any error class, a master-key leaking through stringification of any in-package construct, an unsafe `eval` / shell, or any active TODO/FIXME/HACK in scope.

What I **did** find:
1. One **HIGH** path where `LitellmUpstreamError` truncation can be bypassed via the optional `message` constructor parameter — defence-in-depth gap, currently not triggered by in-package callers but exported as a public class.
2. One **HIGH** drift between scope expectations and implementation: `LITELLM_VIRTUAL_KEY` (corporate-override virtual key) is **never read** by this package. The corp-override env-pivot the spec describes is implemented by the operator setting `LITELLM_MASTER_KEY` to whatever value their internal proxy accepts. If `LITELLM_VIRTUAL_KEY` is meant to be a first-class env binding (per the project `CLAUDE.md` corporate-override narrative), this loader does not honor it.
3. One **HIGH** plain-HTTP default + no `https://` assertion on operator overrides.
4. One **MEDIUM** divergence between `chatCompletions`/`audioTranscriptions`/`passthrough` (which drain error bodies via the implicit undici `bodyTimeout`) and `chatCompletionsStream` (which drains via the explicit `drainWithTimeout` helper).
5. A cluster of `@internal` `export` symbols whose only legitimate consumers are this package's own tests — well-documented but a structural smell.

No CRITICAL findings.

---

## Findings

### HIGH

#### HI-1 — `LitellmUpstreamError` allows untruncated `message` via constructor override
**File:** `packages/litellm-client/src/errors.ts:68-85`

The constructor signature is `constructor(status: number, bodyText: string, message?: string)`. When `message` is supplied, line 73 uses it verbatim:

```ts
super(message ?? `LiteLLM upstream returned ${status}: ${truncated}`);
```

`bodyText` is still truncated (line 72) and pinned non-enumerable (lines 79-84), so the *property* is safe — but `Error.message` is enumerable and gets serialized by pino's default `err` serializer (the `toJSON()` override only emits `{name, message, status}`, which **includes the raw message**). The class is `export`ed from `index.ts:573-577`, so any future caller in another package can construct `new LitellmUpstreamError(500, rawBody, rawBody)` and exfiltrate the full upstream payload into Loki via `log.error({ err })`.

In-package callers (`ensureOk` line 378, the inline mapping at line 472) currently pass only `(status, bodyText)`, so the bug is **latent, not active**. But the class is part of the public surface and the LOCKER-05 contract is "truncate AT CONSTRUCTION" — the third parameter violates that contract.

**Severity HIGH** rather than CRITICAL because no in-tree caller triggers it today; flips to CRITICAL the moment any consumer passes a third arg containing upstream text.

#### HI-2 — `LITELLM_VIRTUAL_KEY` env binding is silently absent
**File:** `packages/litellm-client/src/config.ts:32-57`

The project-level narrative (CLAUDE.md and this review's scope brief) describes the corp-override pivot as: corporate operators override `LITELLM_BASE_URL` / `LITELLM_VIRTUAL_KEY` to point at their existing internal LiteLLM Proxy. This loader honors `LITELLM_BASE_URL` (line 39-42) but never reads `LITELLM_VIRTUAL_KEY`. The auth header is built unconditionally from `config.masterKey` (`index.ts:365`).

Either:
(a) the documentation is wrong and corp operators are expected to put their virtual key in `LITELLM_MASTER_KEY` (in which case the variable name is misleading and should be documented), or
(b) this loader is missing the `LITELLM_VIRTUAL_KEY` precedence rule (it should win over `LITELLM_MASTER_KEY` when the override path is taken).

Operationally, today operators **can** make it work by setting `LITELLM_MASTER_KEY=<their-virtual-key>`, but the contract is undocumented and the env name diverges from the spec.

**Severity HIGH** because misconfigured corp operators get 401-from-upstream → desktop logout (Pitfall #8 the package is explicitly trying to prevent).

#### HI-3 — Plain HTTP default for `DEFAULT_LITELLM_BASE_URL`; no `https://` assertion on operator overrides
**File:** `packages/litellm-client/src/config.ts:29, 39-42`

```ts
export const DEFAULT_LITELLM_BASE_URL = "http://litellm:4000";
```

The project hard rule is **HTTPS-only on externally reachable ports**. `litellm:4000` is a docker-compose internal service name, NOT externally reachable, so this default is defensible — but there is **no assertion** that operators who override `LITELLM_BASE_URL` use `https://`. A misconfigured corp operator setting `LITELLM_BASE_URL=http://aimodels.inner.example` would send `Authorization: Bearer <master-key>` in plaintext over the internal network with no warning.

Add a config-load-time assertion: any override value whose scheme is not `https://` must explicitly opt in via a separate flag (e.g., `LITELLM_ALLOW_PLAINTEXT=1`) or be confined to the docker-compose hostname allowlist.

**Severity HIGH** for environments where the corporate LiteLLM proxy sits on a routable hop.

### MEDIUM

#### ME-1 — Error-drain asymmetry between streaming and non-streaming paths
**File:** `packages/litellm-client/src/index.ts:373-381` vs `index.ts:460-475`

`ensureOk` (line 377) calls `res.body.text()` directly with no explicit bound — relies on undici's `bodyTimeout: 120_000` (the inherited default) to provide an upper bound on the error-body drain. `chatCompletionsStream` (line 471) routes through `drainWithTimeout(..., ERROR_DRAIN_TIMEOUT_MS=15_000)` because its 2xx path uses `bodyTimeout: 0`. The asymmetry is **correct today** but fragile: anyone who later flips `chatCompletions` to `bodyTimeout: 0` (for long-context streaming additions) silently loses the error-drain bound.

Lift `drainWithTimeout` into `ensureOk` (with `ERROR_DRAIN_TIMEOUT_MS` as the bound) so the contract holds regardless of the per-method timeout configuration. Cheap defence-in-depth.

#### ME-2 — `process.env.LITELLM_BASE_URL` read outside `bootstrap`/`config` modules
**File:** `packages/litellm-client/src/index.ts:330`

```ts
const isOverride =
  opts.isOverride ??
  (config.baseUrl !== DEFAULT_LITELLM_BASE_URL || Boolean(process.env.LITELLM_BASE_URL));
```

LOCKER-01 covers `NODE_ENV` specifically, so this read is permitted. But the comment immediately above (lines 321-327) argues the whole point of the refactor was to derive `isOverride` from `config.baseUrl` rather than `process.env`, and then the fallback clause re-introduces `process.env`. The env-read clause is logically dead in any well-formed call chain (`loadLitellmConfigFromEnv` already pushes the env into `config.baseUrl`). Either drop the env clause or document why both sources are consulted.

#### ME-3 — Repeated `as Parameters<typeof doRequest>[1]` casts
**File:** `packages/litellm-client/src/index.ts:410, 458, 538, 557`

Four `as`-narrowed casts at the undici call sites because `reqOpts` is typed as `Record<string, unknown>`. LOCKER-02 permits single `as` casts so these are compliant — but the pattern is duplicated four times and reads as a smell. Pull a small typed builder helper out (`function callUndici(url, opts: Dispatcher.RequestOptions)`); the `Record<string, unknown>` middle-step is only needed because of TS struggling with the optional `signal` inclusion.

#### ME-4 — No defensive scrub on synchronous undici errors
**File:** `packages/litellm-client/src/index.ts:408-411, 456-459, 538-539, 555-558`

If undici fails to make the request (DNS, connection refused, TLS handshake) before any response is returned, the thrown error originates inside undici. Its message conventionally does not include request headers, BUT the request options object might be attached as `.cause` or in a stack frame on some failure modes. The package does no defensive scrubbing of caught network errors before rethrowing.

In practice this is unlikely to leak (undici errors carry `.code`, `.errno`, sometimes `.address`, not headers), but a defence-in-depth envelope (`try { await doRequest(...) } catch (cause) { throw scrubError(cause) }`) at each call site would close the residual surface — and document the LOCKER-05 spirit at the network-error boundary, not just the upstream-body boundary.

### LOW

#### LO-1 — `DEFAULT_CHAT_MODEL = "qwen3.6-plus"` hardcoded
**File:** `packages/litellm-client/src/config.ts:30`

Hardcoded model identifier as fallback. Operators with a custom `litellm_config.yaml` whose alias set does not include `qwen3.6-plus` get a 4xx-from-upstream when callers omit `model`. Today this is documented in the comment chain. Consider deriving from `loadBundledModelProviders()` keys so the default automatically tracks the yaml (out-of-scope file but the integration point is in-scope).

#### LO-2 — Static-fallback `BUNDLED_MODEL_PROVIDER` drift risk
**File:** `packages/litellm-client/src/index.ts:86-100`

The catch-branch fallback map (4 hard-coded entries: `qwen3.6-plus`, `gemini-3-flash`, `gpt-4o-mini`, `whisper-large-v3`) can drift from the yaml if `loadBundledModelProviders()` ever fails silently. The comment acknowledges this is intentional. Add an assertion in CI that the static fallback is a subset of the yaml-derived set.

#### LO-3 — `@internal` exports as public surface
**File:** `packages/litellm-client/src/index.ts:107, 113, 131, 133, 144, 217`

Six `export const` declarations all tagged `@internal — Plan 51-15b ... NOT a stable public API surface`. The comment is the right answer but the `export` keyword is still in the package's public d.ts. A truly internal symbol belongs in a separate file imported via a package-private export, or behind a `/** @internal */` JSDoc paired with `stripInternal` in tsconfig. Cosmetic at this stage.

#### LO-4 — Retry / backoff: not implemented (intentional?)
**File:** `packages/litellm-client/src/index.ts:386-560`

The review checklist asks for "exp backoff + jitter required". The package has **no retry loop** — every method fires undici once and surfaces the response/error. This is correct for chat-completions (non-idempotent — retrying a duplicated `user` attribution would double-bill) and arguably correct for transcribe (the audio body is a single-shot Readable that cannot be replayed without rebuffering, which would re-introduce the CRITICAL-FIX-09 bug).

Flagged LOW only to surface that this is by design; verify upstream LiteLLM proxy is configured to do its own provider-side retries, or document the absence here.

---

## Dead code

None detected in the in-scope files. Every exported symbol is either:
- Consumed by sibling routes in `apps/api` (`buildLitellmClient`, `loadLitellmConfigFromEnv`, `LitellmUpstreamError`, `MissingProviderKeyError`, `SsrfDispatcherNotInstalledError`, the three `DEFAULT_*` constants).
- Explicitly marked `@internal` for in-package test consumption (LO-3).

The re-exports from `model-aliases.js` at `index.ts:578-582` should be verified at a higher level (the file is out of this review's scope).

---

## Suppressed warnings / lint bypasses

None.

- Zero `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `as any`, `as unknown as` in scope.
- Three classes of single-step `as` narrowings (`index.ts:64, 410/458/538/557, 548`) — all LOCKER-02 compliant; the symbol-indexer cast at line 64 carries a Plan 52-01 justification comment, line 548 narrows `string → Dispatcher.HttpMethod`, lines 410/458/538/557 are the ME-3 cluster.
- No `eslint-disable`, no biome-disable, no `// @ts-*` directives.

---

## TODO / FIXME / HACK

None in scope. (Plan/Phase tag comments like `Phase 41.f / HI-2` are forward-historical markers, not unfinished work.)

---

## CLAUDE.md Hard-Rule-1 compliance ("never edit prod to make tests pass")

No evidence of test-driven prod edits. Two specific patterns inspected:

- The `BUNDLED_MODEL_PROVIDER` static fallback (`index.ts:90-99`) preserves "the pre-41.f surface" — the comment is forward-architectural, not a test-fix justification.
- `assertSsrfInstalled` is bypassed when `opts.request` is injected (`index.ts:334-338`). The bypass is documented as a test seam but is **also** a legitimate production seam (worker / CLI consumer). Acceptable.

---

## LOCKER cross-check

| Locker | Status | Notes |
|---|---|---|
| LOCKER-01 (no NODE_ENV branches) | OK | No NODE_ENV reads. `process.env.LITELLM_BASE_URL` read at `index.ts:330` is permitted (rule applies only to NODE_ENV). |
| LOCKER-02 (no type suppressions) | OK | Three single-step `as` narrowings, all justified. |
| LOCKER-03 (no hardcoded localhost / UUID / secret shapes) | WARN | `DEFAULT_LITELLM_BASE_URL = "http://litellm:4000"` is a compose service name, not localhost/127.0.0.1, not on the blocklist. The `:4000` port literal may trigger the LOCKER-03 lint's `:3000\|:4000\|:8080` clause — verify against `tools/lint-no-hardcode.ts` output and add a narrow allowlist if needed. |
| LOCKER-04 (route schema + rateLimit) | N/A | Not a route file. |
| LOCKER-05 (Error string-field truncation at construction) | WARN | See HI-1 — `LitellmUpstreamError` honors the spirit but the optional `message` constructor parameter creates a bypass surface. |
| LOCKER-06 (no shell credential interpolation) | OK | No `child_process`, no shell. |
| LOCKER-08 (no plaintext credential columns) | N/A | Not a schema file. |

---

## Multipart pass-through verification (CRIT scope)

Inspected `audioTranscriptions` (`index.ts:477-540`) explicitly for the re-buffering bug pattern from older clients. **No re-buffering present:**
- The caller's `Readable` is piped through a `PassThrough` (line 507).
- Only a small synthetic `name="model"` multipart part is written ahead of the pipe (line 508).
- The audio payload itself is never `await body.text()` / `await body.buffer()`-ed; it flows lazily into undici.
- Bidirectional teardown (lines 517-522) releases source FDs on destination error/close.

Multipart-handling here is correct and compatible with LiteLLM v1.83.7+'s native multipart-passthrough fix.

---

## Master-key / virtual-key leak surface

Inspected stringification paths:
- `LitellmClientConfig` is never logged in this package.
- `authHeaders()` (`index.ts:350-371`) constructs the Bearer header inline; not stored on a logged object.
- `LitellmUpstreamError` does not capture the request headers — only response status + truncated body.
- `MissingProviderKeyError` message contains only the env var name and the model name — no key value.
- `SsrfDispatcherNotInstalledError` message contains only a fixed string.

**No active leak path detected for `LITELLM_MASTER_KEY`** within this package. ME-4 covers the residual undici-side risk.

`LITELLM_VIRTUAL_KEY` is **never read** by this package, so there is no leak surface — but see HI-2 for the spec-divergence finding.

---

_Reviewed: 2026-05-20_
_Reviewer: gsd-code-reviewer (FORCE stance)_
_Depth: standard, scope-restricted to packages/litellm-client/src/{config,errors,index}.ts_
