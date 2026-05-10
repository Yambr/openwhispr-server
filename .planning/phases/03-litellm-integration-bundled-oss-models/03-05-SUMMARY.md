---
phase: 03-litellm-integration-bundled-oss-models
plan: 05
subsystem: api
tags: [reason, litellm, chat-completions, usage-ledger, idempotency, d-03, d-06]

requires:
  - phase: 03-01
    provides: "Phase 3 wire-contract definitions (docs/wire-contracts-phase-3.md), ReasonRequest/ReasonResponse zod schemas in packages/contract-tests/src/schemas.ts"
  - phase: 03-03
    provides: "buildLitellmClient.chatCompletions, MissingProviderKeyError + LitellmUpstreamError, default chat model 'qwen3.6-plus' in litellm-client config (D-06)"
provides:
  - "POST /api/reason — JSON in, ReasonResponse out (qwen3.6-plus default model, OpenRouter routed)"
  - "MODEL_PROVIDER table — bundled-default model alias -> provider name; 'litellm' fallback for unknown aliases"
  - "buildAllRoutes() — now registers BOTH transcribe and reason under the deps.litellm conditional gate"
affects:
  - 03-06 (diarization — same conditional-registration template; uses client.passthrough)
  - 03-07 (realtime token — derives ws:// from client.baseUrl; same conditional gate)
  - 03-08 (spend-ingest worker — converges on the same usage_ledger row keyed on request_id)
  - 03-10 (e2e — exercises /api/reason end-to-end against the bundled stack)

tech-stack:
  added: []
  patterns:
    - "Plan 04 conditional-registration template applied verbatim: factory in routes/X.ts (XDeps with db + litellm), conditionally pushed into buildAllRoutes when deps.litellm present"
    - "503-not-401 on missing provider key (Pitfall #8): MissingProviderKeyError -> ServiceUnavailable -> 503 envelope; preserves WIRE-18 (401 means session expiry)"
    - "Manual ReasonRequest.parse(req.body) inside the handler — surfaces ZodError to the centralized error handler (canonical {error} envelope) rather than Fastify's `validation` shape"
    - "user param injection NEVER reads body.user — req.user.id flows through litellm-client; ReasonRequest is .strict() so a body-level `user` field also 400s (T-03-05-01 belt-and-suspenders)"

key-files:
  created:
    - "apps/api/src/routes/reason.ts — buildReasonRoutes(deps) factory + MODEL_PROVIDER table"
    - "apps/api/src/routes/reason.test.ts — 13 route tests (default model, explicit model, strict zod, no auth, 503, 502, ledger insert, idempotency, custom promptMode/matchType, unknown-alias fallback, missing-usage->units=0, body-level user rejection, unknown error catch-all)"
    - "packages/contract-tests/src/reason.test.ts — WIRE-06 conformance suite (4 cases: happy path, no-auth, strict-extras, empty-text)"
  modified:
    - "apps/api/src/routes/index.ts — buildAllRoutes registers buildReasonRoutes alongside buildTranscribeRoutes under deps.litellm; buildReasonRoutes added to barrel re-exports"
    - "apps/api/src/routes/index.test.ts — count delta updated to +2 (transcribe + reason); new behavior assertion that both /api/transcribe and /api/reason appear in app.printRoutes() when wired; fakeAuth() now returns a stub `handler` so buildBetterAuthHandlerRoutes accepts the test instance"

key-decisions:
  - "Default model resolution = body.model ?? deps.defaultModel ?? 'qwen3.6-plus' — explicit local fallback so the route is unit-testable WITHOUT loading litellm-client config from env. Production wires deps.defaultModel = undefined and litellm-client's defaultChatModel takes over via client.chatCompletions() (D-06). Tests can inject a model alias to assert routing without env mutation. The literal 'qwen3.6-plus' constant in this file is the authoritative wire-contract default for /api/reason; if D-06 ever changes, this constant changes in lockstep with packages/litellm-client/src/config.ts DEFAULT_CHAT_MODEL."
  - "MODEL_PROVIDER table is the source of truth for the `provider` field on ReasonResponse — mirrors compose/litellm/litellm_config.yaml. Unknown aliases (which a corporate-override LITELLM_BASE_URL may serve) fall back to the literal 'litellm' provider sentinel. This signals 'routed via the configured LiteLLM endpoint, provider opaque' to the desktop without forcing every override operator to register their model alias in our code. v2 may surface upstream-reported provider via LiteLLM's response headers — for v1 the static table is the cheapest correct path."
  - "Manual req.body parse instead of schema.body — registering the ReasonRequest zod schema via @fastify/type-provider-zod surfaces failures as Fastify's `validation` shape (which the centralized error-handler maps to 400 'Invalid request' generically). Calling ReasonRequest.parse(req.body) inside the handler raises ZodError with the actual issue's `.message`, which the centralized handler emits in the `{error}` envelope. Better operator UX without breaking the canonical envelope contract."
  - "promptMode + matchType default to 'default' on response when caller omits them — the desktop's BACKEND_SPEC.md (L286-L288) lists both as required-on-response fields; ReasonResponse zod schema marks them required. Echoing 'default' is the only correct behavior when the caller didn't specify; the desktop reads-but-doesn't-act on these fields when matchType is 'default'."
  - "502 envelope text differs from /api/transcribe by exactly one word ('reasoning' vs 'transcription') — kept generic so upstream LiteLLM body never echoes (T-03-05-04 mitigation)."

patterns-established:
  - "Pattern 1 — Plan 5+ Phase-3 JSON-route wiring template: factory in routes/X.ts (XDeps with db + litellm), manual zod parse inside handler, conditional push into buildAllRoutes when deps.litellm present. Same shape for any future LiteLLM-backed JSON endpoint (e.g. v2's /api/agent/stream)."
  - "Pattern 2 — fake-DB SQL recorder reused verbatim from Plan 04 — extracted-once-copied-twice signal that this should graduate to a shared test helper at the next refactor boundary (Plan 06 will be the third user)."
  - "Pattern 3 — index.test.ts behavior assertion via app.printRoutes() — replaces / supplements the brittle 'plugin-array-length+1' invariant with a direct route-tree assertion. Catches both 'forgot to push the plugin' AND 'pushed but URL changed' regressions in one test."

requirements-completed: [WIRE-06, LITELLM-04, PROVIDER-01, DATA-03]

duration: ~10 min
completed: 2026-05-10
---

# Phase 03 Plan 05: POST /api/reason Summary

**WIRE-06 implementation — Fastify route sends caller's text to LiteLLM `/v1/chat/completions` with default model qwen3.6-plus (D-06), `user: req.user.id` for per-user attribution (D-03), writes idempotent `usage_ledger` row keyed on `request_id` with `kind='reason_tokens'` and `units=upstream.usage.total_tokens`, and surfaces `503` on missing `OPENROUTER_API_KEY` (Pitfall #8).**

## Performance

- **Duration:** ~10 min (Wave 2 sequential within the wave per intra-wave file overlap on apps/api/src/routes/index.ts)
- **Started:** 2026-05-10T18:18Z
- **Completed:** 2026-05-10T18:28Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 2

## Accomplishments

- **POST /api/reason** — JSON-body endpoint sends a chat-completion request to LiteLLM via `@openwhispr/litellm-client.chatCompletions`. Default model `qwen3.6-plus` per D-06; per-user attribution via the OpenAI-compatible `user` field (D-03) sourced from `req.user.id`, NEVER from request body. `ReasonRequest.parse(req.body)` inside the handler — `.strict()` rejects extras (incl. body-level `user`/`foo`/etc.) with a 400 envelope.
- **`MODEL_PROVIDER` table** — bundled-default mapping (`qwen3.6-plus`/`gemini-3-flash`/`gpt-4o-mini` -> `openrouter`) drives ReasonResponse.provider. Unknown aliases (corporate override) fall back to `'litellm'` sentinel.
- **Idempotent usage_ledger write** — `INSERT ... ON CONFLICT (request_id) DO NOTHING` with `kind='reason_tokens'` and `units=upstream.usage.total_tokens` (or `0` when upstream omits usage). The Plan 08 spend-ingest worker writes from `LiteLLM_SpendLogs` to the same row (DATA-03 first-writer-wins).
- **Error envelope discipline** — 401 (no auth, defensive in-route check + centralized handler from dualAuthHook), 400 (zod parse fail — empty text, extras, body-level user), 503 (`MissingProviderKeyError` -> `ServiceUnavailable` -> centralized envelope using `err.message` verbatim — Pitfall #8), 502 (`LitellmUpstreamError` -> fixed-string envelope, NEVER echoes upstream body), 500 (unknown error -> centralized "Internal server error", `err.message` NEVER leaked). Test pins the master-key shape `sk-litellm-master` does not appear in any 502 response.
- **Conditional route registration** — `buildAllRoutes(deps)` now registers BOTH transcribe and reason under the same `deps.litellm` gate. Both routes appear in `app.printRoutes()` when the LiteLLM client is wired; both are 404 (centralized notFoundHandler) when LITELLM_MASTER_KEY is unset at boot.
- **13 unit tests** (route) + **4 contract tests** (WIRE-06 happy path, no-auth, strict-extras, empty-text) + **1 new buildAllRoutes assertion** that both LiteLLM-backed routes are reachable when wired. Contract tests skip cleanly when no backend is up (`describe.skipIf(!REACHABLE)`).

## Task Commits

Each task committed atomically with `--no-verify` (orchestrator runs hooks once after the wave):

1. **Task 1: buildReasonRoutes factory + 13 unit tests** — `f7a2b6b` (feat)
2. **Task 2: wire reason into buildAllRoutes + WIRE-06 contract test** — `5632972` (feat)

## Published Interface (downstream-plan reference)

### `ReasonDeps` (consumed by buildAllRoutes)

```typescript
export interface ReasonDeps {
  db: TransactionalDb<ExecutableTx>;
  litellm: LitellmClient;
  /** Optional override for the default chat model (production picks up D-06 from litellm-client config). */
  defaultModel?: string;
}
```

### Wire shape (locked by docs/wire-contracts-phase-3.md)

**Request** (`ReasonRequest`, `.strict()`):

| Field         | Type     | Required | Notes                                                |
|---------------|----------|----------|------------------------------------------------------|
| `text`        | `string` | yes      | `min(1)` — empty rejected                            |
| `model?`      | `string` | no       | omitted -> qwen3.6-plus (D-06)                       |
| `provider?`   | `string` | no       | echo only (response.provider is server-derived)      |
| `promptMode?` | `string` | no       | echoed; defaults to `'default'`                      |
| `matchType?`  | `string` | no       | echoed; defaults to `'default'`                      |

**Response** (`ReasonResponse`):

| Field        | Type     | Source                                                                  |
|--------------|----------|-------------------------------------------------------------------------|
| `text`       | `string` | upstream chat-completion `choices[0].message.content`                   |
| `model`      | `string` | upstream `model` (or echo of requested model)                           |
| `provider`   | `string` | `MODEL_PROVIDER[model]` lookup (default `'litellm'` for unknown alias)  |
| `promptMode` | `string` | request echo or `'default'`                                             |
| `matchType`  | `string` | request echo or `'default'`                                             |

### `MODEL_PROVIDER` (bundled-default lookup table)

| Model alias        | Provider     |
|--------------------|--------------|
| `qwen3.6-plus`     | `openrouter` |
| `gemini-3-flash`   | `openrouter` |
| `gpt-4o-mini`      | `openrouter` |
| `<other>`          | `litellm`    |

(Mirrors `compose/litellm/litellm_config.yaml` model_list. Override mode bypasses the table — corporate proxy owns its own provider routing.)

### Error mapping

| Trigger                                        | HTTP | Envelope                                                                            |
|------------------------------------------------|------|-------------------------------------------------------------------------------------|
| Auth fail (no bearer/cookie)                   | 401  | `{error:"Session expired"}` or in-route `"unauthorized"` (centralized handler)      |
| Empty `text` (zod `min(1)`)                    | 400  | `{error:"<zod issue message>"}`                                                     |
| Extra body field (.strict())                   | 400  | `{error:"<zod issue message>"}`                                                     |
| Body-level `user` field (.strict())            | 400  | `{error:"<zod issue message>"}` (T-03-05-01 belt-and-suspenders)                    |
| `MissingProviderKeyError(OPENROUTER_API_KEY)`  | 503  | `{error:"OPENROUTER_API_KEY is not configured. Set it in .env to enable model …"}`  |
| `LitellmUpstreamError`                         | 502  | `{error:"upstream reasoning provider failure"}` (NEVER echoes upstream body)        |
| Unknown error                                  | 500  | `{error:"Internal server error"}` (centralized — `err.message` NEVER leaked)        |

## Files Created/Modified

- `apps/api/src/routes/reason.ts` — `buildReasonRoutes(deps)` factory, `MODEL_PROVIDER` table, manual `ReasonRequest.parse(req.body)` inside handler
- `apps/api/src/routes/reason.test.ts` — 13 tests
- `packages/contract-tests/src/reason.test.ts` — 4 contract tests
- `apps/api/src/routes/index.ts` — `buildReasonRoutes` import + push under `if (deps.litellm)` block; barrel re-export
- `apps/api/src/routes/index.test.ts` — count delta updated; route-tree behavior assertion; fakeAuth() returns stub `handler`

## Decisions Made

- **Default model literal `'qwen3.6-plus'` lives in reason.ts AND in `packages/litellm-client/src/config.ts` (`DEFAULT_CHAT_MODEL`)** — duplication is intentional. The route's literal is the unit-testable wire-contract default; the client's literal is the runtime default fed via env. Production passes `deps.defaultModel = undefined` so client-side wins. If D-06 ever changes, both files must update in lockstep — caught by the contract test asserting `parsed.model === 'qwen3.6-plus'` when caller omits the field.
- **Manual zod parse over `schema.body` registration** — `@fastify/type-provider-zod` surfaces zod failures via Fastify's `validation` shape, which the centralized error-handler maps to a generic "Invalid request" 400. The desktop UI is more useful with the actual zod issue message (e.g., "Unrecognized key(s) in object: 'extraField'"). `ReasonRequest.parse(req.body)` raises ZodError directly, which the centralized handler emits with `first.issue.message` in the `{error}` envelope. Same canonical-envelope contract, more useful operator surface.
- **`'litellm'` fallback provider** — the OSS desktop reads ReasonResponse.provider for telemetry/UI labeling. Hard-coding 'unknown' or omitting the field would either break ReasonResponse zod (provider is required) or send a misleading label. `'litellm'` is the literal honest answer: routed via the configured LiteLLM endpoint, provider opaque from this layer's POV. Corporate operators with a custom internal taxonomy can patch the table or map it client-side.
- **Single `defaultModel?` in `ReasonDeps`** — explicit dep injection point lets tests assert routing without env mutation; production passes `undefined` so the litellm-client's config.defaultChatModel wins (D-06 single source of truth at the env layer).
- **502 envelope text `'upstream reasoning provider failure'`** — distinct from transcribe's `'upstream transcription provider failure'` so logs/Grafana alerts can disambiguate which hot-path failed without correlating route paths to error texts.

## Deviations from Plan

None — plan executed exactly as written. Two refinements that preserve intent:

- **`fakeAuth()` in `index.test.ts` now returns a stub `handler` function.** Reason: the new behavior assertion (both `/api/transcribe` and `/api/reason` reachable in the route tree) registers the ENTIRE plugin chain through `Fastify.register`, including `buildBetterAuthHandlerRoutes` which validates `auth.handler` is a function at register time. The previous `fakeAuth()` only stubbed `api.getSession`. Adding the stub `handler` is a strict superset; existing tests still pass.
- **One additional unit test** (`'returns wordsRemaining-equivalent from upstream usage; missing usage -> units=0'`) — not literally in the plan's behavior list, but the route file's `tokens = upstream.usage?.total_tokens ?? 0` defensive default needs a test to lock the contract. Filed under coverage-floor maintenance (per-phase ≥90%).

## Issues Encountered

- **Initial `index.test.ts` route-tree assertion failed** — `buildBetterAuthHandlerRoutes` raises at register time when `auth.handler` is not a function. Fixed by extending `fakeAuth()` (see Deviations). Same root cause as the recurring "Better Auth handler missing" issue documented in Phase 02.6 / D-01.
- **No node_modules in worktree at start.** The worktree was initialized from a single squashed commit; `git reset --hard` to the expected base (`789954c`) restored the working tree, then `pnpm install --ignore-scripts --prefer-offline` linked the workspace graph. lefthook prepare scripts skipped per `--ignore-scripts` so the parent worktree's `core.hooksPath` config didn't trip.

## User Setup Required

None — Plan 05 is fully autonomous. Operators wishing to exercise the route end-to-end must:

- Set `LITELLM_MASTER_KEY` and `OPENROUTER_API_KEY` in `.env` (or override `LITELLM_BASE_URL` to a corporate proxy with its own auth posture).
- Run `make contract-test` with the bundled compose stack + mock LiteLLM config.

## Next Phase Readiness

Wave 2 / Wave 3 follow-ons unblocked:

- **Plan 03-06 (diarization)** — copy the conditional-registration template from this plan; route handler uses `client.passthrough('/v1/audio/diarization', ...)` and the shared `audioMultipartBody()` helper.
- **Plan 03-07 (realtime token)** — derives ws:// URL from `client.baseUrl`; same conditional gate.
- **Plan 03-08 (spend-ingest worker)** — writes to the SAME `usage_ledger` row keyed on `request_id` with `kind='reason_tokens'`; the route's idempotency clause guarantees no duplicate.

No blockers. No remaining stubs in this plan's surface — `text`/`model`/`provider`/`promptMode`/`matchType` are all populated from real data sources (upstream chat-completion + locked default sentinels). The `'default'` strings on promptMode/matchType are intentional v1 semantics (BACKEND_SPEC.md L286-L288) and resolve to caller-supplied values when the desktop sends them.

## Self-Check: PASSED

- [x] `apps/api/src/routes/reason.ts` exists
- [x] `apps/api/src/routes/reason.test.ts` exists (13 tests passing)
- [x] `packages/contract-tests/src/reason.test.ts` exists (4 tests, skipped cleanly without backend)
- [x] `apps/api/src/routes/index.ts` modified (buildReasonRoutes registered + re-exported)
- [x] `apps/api/src/routes/index.test.ts` modified (count delta + route-tree assertion + fakeAuth stub)
- [x] commit `f7a2b6b` exists in git log (Task 1: feat — reason route + 13 unit tests)
- [x] commit `5632972` exists in git log (Task 2: feat — wire into buildAllRoutes + contract test)
- [x] `vitest run apps/api/src/routes/` reports 88/88 passing across all 11 route-test files (no regression to Plan 04 transcribe suite)
- [x] master-key shape `sk-litellm-master` does NOT appear in any 502 response (T-03-05-04 mitigation pinned by test)
- [x] body-level `user` field rejected with 400 (T-03-05-01 mitigation pinned by test)

---
*Phase: 03-litellm-integration-bundled-oss-models*
*Plan: 03-05*
*Completed: 2026-05-10*
