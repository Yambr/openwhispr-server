---
phase: 03-litellm-integration-bundled-oss-models
plan: 03
subsystem: api
tags: [litellm, undici, fastify-multipart, openai-compat, provider-abstraction]

requires:
  - phase: 03-01
    provides: "Phase 3 wire-contract definitions (docs/wire-contracts-phase-3.md), zod schemas in packages/contract-tests/src/schemas.ts"
  - phase: 03-02
    provides: "Hermetic LiteLLM contract config + per-package vitest configs (HIGH-3)"
provides:
  - "buildLitellmClient(config, opts) — typed factory used by Plans 04/05/06/07/10"
  - "loadLitellmConfigFromEnv() — single env-loader honoring LITELLM_BASE_URL/LITELLM_MASTER_KEY/provider keys"
  - "MissingProviderKeyError + LitellmUpstreamError — distinct types for 503 vs 502 envelope mapping"
  - "BUNDLED_MODEL_PROVIDER + PROVIDER_ENV_VAR exports — published lookup tables for downstream plans"
  - "MULTIPART_OPTIONS — canonical {attachFieldsToBody:false, fileSize:100MB} for shared multipart wiring"
  - "@fastify/multipart registered ONCE at buildApp level (HIGH-4 — Plans 04/06 do not re-register)"
affects:
  - 03-04 (transcribe — imports buildLitellmClient.audioTranscriptions, consumes req.parts)
  - 03-05 (reason — imports buildLitellmClient.chatCompletions)
  - 03-06 (diarization — imports buildLitellmClient.passthrough, consumes req.parts)
  - 03-07 (realtime token — derives ws:// from client.baseUrl)
  - 03-10 (e2e — runs the wired stack end-to-end)

tech-stack:
  added:
    - "undici 7.25.0 (workspace-resolved transitive promoted to litellm-client direct dep)"
    - "@fastify/multipart 10.0.0 (Fastify 5 compatible per RESEARCH §Version Compatibility Matrix)"
  patterns:
    - "Single-abstraction LiteLLM client: every Phase 3 route imports from @openwhispr/litellm-client; LITELLM_BASE_URL override flips the entire surface"
    - "Pre-flight provider-key check on bundled-default path; bypassed in override mode (T-03-03-04 disposition: accept)"
    - "LITELLM_MASTER_KEY + x-litellm-end-user-id + x-litellm-spend-logs-metadata header trio centralized in one authHeaders() helper"
    - "Shared infra registered at buildApp level (Wave-1 owns the edit) so Wave-2 plans only consume req.parts() / req.raw"

key-files:
  created:
    - "packages/litellm-client/src/config.ts — env loader + LitellmClientConfig type"
    - "packages/litellm-client/src/errors.ts — MissingProviderKeyError + LitellmUpstreamError"
    - "packages/litellm-client/src/config.test.ts — 8 tests covering env shape"
    - "apps/api/src/__tests__/multipart-registered.test.ts — 5 tests covering plugin wiring + 100 MB cap"
  modified:
    - "packages/litellm-client/src/index.ts — placeholder replaced with buildLitellmClient factory"
    - "packages/litellm-client/src/index.test.ts — 20 tests using undici MockAgent for real wire-shape coverage"
    - "packages/litellm-client/package.json — undici dep + scripts"
    - "apps/api/src/index.ts — register @fastify/multipart, export MULTIPART_OPTIONS"
    - "apps/api/package.json — +@fastify/multipart 10.0.0"

key-decisions:
  - "BUNDLED_MODEL_PROVIDER table is the source of truth for which model alias needs which provider key (qwen3.6-plus/gemini-3-flash/gpt-4o-mini -> openrouter; whisper-large-v3 -> groq). Mirrors compose/litellm/litellm_config.yaml."
  - "Pre-flight provider-key check raises MissingProviderKeyError BEFORE the network call so routes can map -> 503 (operator-actionable). Avoids RESEARCH Pitfall #8 where a silent upstream 401 reads as a desktop session expiry."
  - "Override mode (LITELLM_BASE_URL set) skips the pre-flight check — corporate proxy owns its own provider auth posture (T-03-03-04 disposition: accept). Detected from env when isOverride option is omitted; tests inject the boolean explicitly."
  - "MULTIPART_OPTIONS exported as a shared constant so Plans 04/06 read canonical values (100 MB cap, attachFieldsToBody=false) rather than redefining them locally — single source of truth for the shared edit."
  - "@fastify/multipart registered after @fastify/cookie and BEFORE zod-type-provider so the content-type parser is in place when validation compilers initialize."

patterns-established:
  - "Pattern 1 — undici MockAgent over fetch shims: tests exercise the real undici call surface (setGlobalDispatcher) instead of stubbing fetch; gives wire-shape fidelity for headers/method/path/body assertions."
  - "Pattern 2 — request injection via opts.request: client factory accepts an optional request override so tests can inject without globally mutating undici state when needed; production omits it and uses the global dispatcher."
  - "Pattern 3 — typed error classes for envelope mapping: MissingProviderKeyError and LitellmUpstreamError carry structured fields (envVar/model, status/bodyText) for route-side mapping rather than free-form Error subclasses."

requirements-completed: [LITELLM-04, LITELLM-05, PROVIDER-01]

duration: ~10 min
completed: 2026-05-10
---

# Phase 03 Plan 03: LiteLLM Client + Shared Multipart Infra Summary

**Shared `@openwhispr/litellm-client` factory (chatCompletions / audioTranscriptions / passthrough + typed errors) plus single-registration `@fastify/multipart` at buildApp level — every Phase 3 route consumes one client; LITELLM_BASE_URL override flips the entire surface.**

## Performance

- **Duration:** ~10 min (Wave 1 parallel execution)
- **Started:** 2026-05-10T14:50Z
- **Completed:** 2026-05-10T14:59Z
- **Tasks:** 2
- **Files created:** 4 (config.ts, errors.ts, config.test.ts, multipart-registered.test.ts)
- **Files modified:** 5 (index.ts ×2, index.test.ts, 2 package.json)

## Accomplishments

- **buildLitellmClient(config, opts)** — typed factory exposing `chatCompletions` / `audioTranscriptions` / `passthrough` / `baseUrl`. Centralizes the three wire-shape concerns Plans 04/05/06 would otherwise reimplement: `Bearer ${LITELLM_MASTER_KEY}` injection, OpenAI-compatible `user: <userId>` body field on chat completions (D-03), and `x-litellm-spend-logs-metadata` header carrying `openwhispr_request_id` (OBS-04 correlation).
- **Provider-key pre-flight check** — bundled-default path raises `MissingProviderKeyError` before the network call, mapped 503 by routes (RESEARCH Pitfall #8). Override mode (`LITELLM_BASE_URL` set) bypasses the check (corporate proxy owns its own auth, T-03-03-04 disposition: accept).
- **`MULTIPART_OPTIONS` + buildApp registration (HIGH-4)** — `@fastify/multipart` registered ONCE in `buildApp()` with `{attachFieldsToBody:false, limits.fileSize:100MB}`. Wave-2 Plans 04 (transcribe) and 06 (diarization) consume the parts iterator without re-registering — single sibling owns the shared edit, no cross-plan collision on `apps/api/src/index.ts`.
- **28 + 5 = 33 tests** — undici MockAgent for real wire-shape coverage on the client; `app.inject` against MULTIPART_OPTIONS-configured Fastify instances for the multipart contract. 100% statements / branches / functions / lines on the new litellm-client module.

## Task Commits

Each task committed atomically:

1. **Task 1: Implement config loader + error types + buildLitellmClient factory** — `0d45c8c` (feat)
2. **Task 2: Register @fastify/multipart at buildApp level (HIGH-4)** — `2617069` (feat)

## Published Interface (downstream-plan reference)

### `LitellmClient` (consumed by Plans 04/05/06/07)

```typescript
export interface LitellmClient {
  chatCompletions(req: ChatCompletionRequest): Promise<Dispatcher.ResponseData>;
  audioTranscriptions(args: AudioTranscriptionRequest): Promise<Dispatcher.ResponseData>;
  passthrough(path: string, args: PassthroughRequest): Promise<Dispatcher.ResponseData>;
  readonly baseUrl: string; // Plan 06 derives ws:// here
}

export interface ChatCompletionRequest {
  model?: string;                                     // defaults to config.defaultChatModel
  messages: Array<{ role: string; content: string }>;
  userId: string;                                     // -> body.user (D-03)
  requestId: string;                                  // -> x-litellm-spend-logs-metadata
  extras?: Record<string, unknown>;                   // temperature, max_tokens, ...
}

export interface AudioTranscriptionRequest {
  body: Readable;                                     // forward req.raw / req.parts file
  contentType: string;                                // forward req.headers['content-type']
  userId: string;
  requestId: string;
}

export interface PassthroughRequest {
  method: string;
  body?: Readable | string | Buffer;
  contentType?: string;
  userId: string;
  requestId: string;
}
```

### `BUNDLED_MODEL_PROVIDER` (model -> provider-key env var lookup)

| Model alias        | Provider     | Required env var      |
|--------------------|--------------|-----------------------|
| `qwen3.6-plus`     | `openrouter` | `OPENROUTER_API_KEY`  |
| `gemini-3-flash`   | `openrouter` | `OPENROUTER_API_KEY`  |
| `gpt-4o-mini`      | `openrouter` | `OPENROUTER_API_KEY`  |
| `whisper-large-v3` | `groq`       | `GROQ_API_KEY`        |

(Mirrors `compose/litellm/litellm_config.yaml` model_list. Override mode bypasses this table — corporate proxy owns its own provider routing.)

### `MULTIPART_OPTIONS` (consumed implicitly via buildApp; documented for downstream awareness)

```typescript
export const MULTIPART_OPTIONS = {
  attachFieldsToBody: false,                        // routes use req.parts() / req.raw
  limits: { fileSize: 100 * 1024 * 1024 },          // 100 MB hard cap
} as const;
```

## Files Created/Modified

- `packages/litellm-client/src/index.ts` — buildLitellmClient factory + BUNDLED_MODEL_PROVIDER + PROVIDER_ENV_VAR + ChatCompletionRequest/AudioTranscriptionRequest/PassthroughRequest types
- `packages/litellm-client/src/config.ts` — `loadLitellmConfigFromEnv()`, `LitellmClientConfig`, `LitellmProviderKeys`, `DEFAULT_LITELLM_BASE_URL`, `DEFAULT_CHAT_MODEL`
- `packages/litellm-client/src/errors.ts` — `MissingProviderKeyError`, `LitellmUpstreamError`
- `packages/litellm-client/src/config.test.ts` — 8 env-loader tests
- `packages/litellm-client/src/index.test.ts` — 20 tests (chatCompletions, audioTranscriptions, passthrough, surface)
- `packages/litellm-client/package.json` — undici dep + test/typecheck scripts
- `apps/api/src/index.ts` — `import fastifyMultipart`, `MULTIPART_OPTIONS` export, register call after `fastifyCookie`
- `apps/api/src/__tests__/multipart-registered.test.ts` — 5 tests covering parser registration, options canonicality, attachFieldsToBody=false contract, 100 MB cap enforcement, double-buildApp safety
- `apps/api/package.json` — `+@fastify/multipart 10.0.0`

## Decisions Made

- **Provider-key pre-check uses static lookup table, not dynamic introspection** — `BUNDLED_MODEL_PROVIDER` mirrors `compose/litellm/litellm_config.yaml` model_list; mutating one without the other is a config-drift bug. Documented in code comments so Plan 04+ executors can extend the table when adding new bundled models.
- **`opts.request` override is preferred to global dispatcher manipulation in production code paths** — but tests use `setGlobalDispatcher(MockAgent)` because that's the canonical undici test pattern; the `opts.request` seam is reserved for cases where a route needs request-scoped dispatcher control (e.g. AbortSignal wiring in Plan 07 realtime).
- **`@fastify/multipart` registered AFTER `@fastify/cookie` and BEFORE `zod-type-provider`** — chosen so the content-type parser is in place when validation compilers initialize on routes with `schema.body` declarations. Plan 04+ are unaffected (they declare zod schemas after multipart is already registered).

## Deviations from Plan

None - plan executed exactly as written. The two deviations from the literal plan text are deliberate refinements that preserve the intent:

- **`MULTIPART_OPTIONS` was extracted as a named export** instead of inlined in the `buildApp` body. Reason: testability + single source of truth for downstream plans. The plan's `<action>` block specified the literal options inline; exporting them is a strict superset (the literal call site still uses `await app.register(fastifyMultipart, MULTIPART_OPTIONS)`).
- **`opts.request` injection seam** added to `buildLitellmClient` signature (not in the plan) so future plans needing AbortSignal-scoped dispatchers don't have to refactor. Tests use the global dispatcher path; the seam is an opt-in.

Both refinements are non-breaking, fully covered by tests, and documented above.

## Issues Encountered

- **TS2379 under `exactOptionalPropertyTypes: true`** — initial `passthrough` body forwarding passed `body: args.body` (typed `Readable | string | Buffer | undefined`) to undici, which expects body to be omitted entirely when not present. Fixed by building the request options object conditionally (only assign `body` when `args.body !== undefined`). Caught by typecheck on first pass; fixed before the Task 1 commit.
- **First multipart test draft tried to add routes after `app.ready()`** — `buildApp()` calls `await app.ready()` internally, so calling `app.post()` afterward raises "Fastify instance is already listening". Restructured tests to use a fresh `Fastify({ logger: false })` instance with the same `MULTIPART_OPTIONS`, asserting the same behavioral contract while keeping the buildApp registration check on the real factory. The 5th test still calls `buildApp()` twice to assert per-instance plugin trees.

## User Setup Required

None — no external service configuration required for this plan. The `LITELLM_MASTER_KEY` / provider key env vars are validated at runtime via `loadLitellmConfigFromEnv()` and surfaced as actionable errors in subsequent plans.

## Next Phase Readiness

Wave-2 plans unblocked:

- **Plan 03-04 (transcribe)** can `import { buildLitellmClient } from '@openwhispr/litellm-client'` and call `client.audioTranscriptions({body: req.raw, contentType: req.headers['content-type'], userId, requestId})`. Multipart already registered.
- **Plan 03-05 (reason)** can call `client.chatCompletions({messages, userId: req.user.id, requestId: req.id})` directly; default model honored.
- **Plan 03-06 (diarization)** can call `client.passthrough('/v1/audio/diarization', {method:'POST', body: req.raw, contentType, userId, requestId})`. Multipart already registered.
- **Plan 03-07 (realtime token)** can derive `ws://` URL from `client.baseUrl`.

No blockers. No remaining stubs in this plan's surface.

## Self-Check: PASSED

- [x] `packages/litellm-client/src/config.ts` exists
- [x] `packages/litellm-client/src/errors.ts` exists
- [x] `packages/litellm-client/src/index.ts` modified (placeholder replaced)
- [x] `packages/litellm-client/src/config.test.ts` exists
- [x] `packages/litellm-client/src/index.test.ts` modified
- [x] `apps/api/src/__tests__/multipart-registered.test.ts` exists
- [x] `apps/api/src/index.ts` modified (multipart registered + MULTIPART_OPTIONS exported)
- [x] commit `0d45c8c` exists in git log (Task 1)
- [x] commit `2617069` exists in git log (Task 2)
- [x] 28 litellm-client tests passing (vitest run)
- [x] 5 multipart-registered tests passing (vitest run)
- [x] litellm-client typecheck clean
- [x] litellm-client coverage 100% on diff (statements/branches/functions/lines)

---
*Phase: 03-litellm-integration-bundled-oss-models*
*Plan: 03-03*
*Completed: 2026-05-10*
