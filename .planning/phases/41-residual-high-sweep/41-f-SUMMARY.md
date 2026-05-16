# Phase 41.f — Summary (HIGH-FIX-LITELLM)

Source review: `.planning/review/litellm-client.md` (HI-1, HI-2, HI-3, HI-4 + ME-01).
Branch: main. Scope: `packages/litellm-client/**` + tagging hook in
`apps/api/src/lib/ssrf-dispatcher.ts`. No worktree; user-side edits stashed
pre-flight and popped after closure.

## Commits (atomic, 5)

| Task   | Subject                                                 | SHA       |
| ------ | ------------------------------------------------------- | --------- |
| HI-1   | feat(41f): add timeouts and abortsignal to 3 litellm methods | `c57dab4` |
| HI-2   | feat(41f): assert ssrf dispatcher installed before first call | `eed4c05` |
| HI-3   | feat(41f): derive bundled model provider from litellm yaml | `5544754` |
| HI-4   | feat(41f): caller streamoptions opt out of include_usage | `5bb598e` |
| Close  | docs(41f): summary litellm-client HIGH closed           | (this commit) |

## Findings closed

### HI-1 — Timeouts + AbortSignal

`chatCompletions`, `audioTranscriptions`, `passthrough` gained:

- `signal?: AbortSignal` (forwarded to undici `request({ signal })`).
- `headersTimeout?: number` (default `DEFAULT_HEADERS_TIMEOUT_MS = 30_000`).
- `bodyTimeout?: number` (default `DEFAULT_BODY_TIMEOUT_MS = 120_000`).

`chatCompletionsStream` kept its existing `bodyTimeout: 0` SSE invariant.

D-41f-1 records the rationale: 30 s headers / 120 s body covers Phase 8 SLO
budgets (chat p95 ≤ 30 s, transcribe ≤ 90 s) and defends the 1000-concurrent
stall-vector. Routes pass per-call overrides when they need transcribe-on-long-
audio behaviour. AbortSignal forwarding works through the global SSRF Agent
in undici 7.25.0 (the T-08.2-01 dispatcher-option mitigation did not apply
to plain `signal:`).

### HI-2 — SSRF dispatcher first-call assertion

- New typed error `SsrfDispatcherNotInstalledError` (code: `SSRF_DISPATCHER_NOT_INSTALLED`).
- `apps/api/src/lib/ssrf-dispatcher.ts::makeSSRFDispatcher` stamps a
  non-enumerable `Symbol.for("openwhispr.ssrf-wrapped")` property on every
  Agent it returns.
- Client calls `getGlobalDispatcher()` at first call and throws if the
  marker is absent (only when `opts.request` was NOT injected — test seam
  bypasses the assertion).
- All four methods (`chatCompletions`, `chatCompletionsStream`,
  `audioTranscriptions`, `passthrough`) gate on the assertion.

D-41f-2 captures why Symbol-keyed marker beats constructor-name / property-name
alternatives (no false-positive on default `Agent`, no circular dep, no
prototype-inheritance leak).

### HI-3 / ME-01 — Bundled-model provider map derived from yaml

- New export `loadBundledModelProviders(yamlPath?)` in `model-aliases.ts`
  reads `compose/litellm/litellm_config.yaml`, parses `litellm_params.model`,
  derives `Record<model_name, provider>`. Only `openrouter`, `groq`, `pyannote`
  prefixes are included (matches `LitellmProviderKeys`); `openai/` realtime
  entries are dropped (realtime route owns its own auth).
- `BUNDLED_MODEL_PROVIDER` in `index.ts` now resolves via
  `deriveBundledModelProviderMap()` at module load with a 4-entry static
  fallback for yaml-unreadable test environments.
- Removed allowlist entry `packages/litellm-client/src/index.ts:323`
  (Phase 41.b had parked `loadLitellmModelAliases` as dead-export pending
  Phase 41.f consumption; HI-3 now consumes it through the sibling loader).

### HI-4 — streamOptions opt-out

- New first-class `streamOptions?: Record<string, unknown>` on
  `ChatCompletionsStreamRequest`.
- Merge order (later wins): `{ include_usage: true }` → `extras.stream_options` →
  `streamOptions`. Caller passing `streamOptions: { include_usage: false }`
  now correctly opts out of the per-stream usage chunk.

## Tests

`pnpm` filter unusable inside this monorepo's lefthook gauntlet; used
`node node_modules/vitest/vitest.mjs run --project '@openwhispr/litellm-client'
--dir packages/litellm-client --coverage`.

| Metric        | Before | After |
| ------------- | ------ | ----- |
| Test files    | 4      | 4     |
| Tests passing | 50     | 70    |
| Tests failing | 0      | 0     |
| Tests skipped | 0      | 0     |

20 new tests added across the four sub-fixes.

## Coverage on diff (≥ 90 / 90 / 90 / 90 required)

```
File              | % Stmts | % Branch | % Funcs | % Lines
index.ts          |   96.55 |    95.23 |    92.30 |   98.68
model-aliases.ts  |   97.50 |    96.42 |   100.00 |  100.00
All files         |   97.29 |    96.42 |    95.65 |   99.24
```

All four axes pass the constitutional 90 % floor.

## Locker status

`pnpm lint:lockers` → exit 0 after Phase 41.f closure (allowlist entry
removed; no new violations across LOCKER-01..08).

## Stub / threat surface scan

No stubs introduced. No new network endpoints, auth paths, file access, or
schema changes — HI-2 hardens an existing surface; HI-3 reads an existing
yaml; HI-1 / HI-4 are option-surface additions.

## Self-Check: PASSED

- Commits exist on HEAD:
  - `c57dab4` feat(41f): add timeouts and abortsignal to 3 litellm methods
  - `eed4c05` feat(41f): assert ssrf dispatcher installed before first call
  - `5544754` feat(41f): derive bundled model provider from litellm yaml
  - `5bb598e` feat(41f): caller streamoptions opt out of include_usage
- Files touched (vs. main pre-phase):
  - `packages/litellm-client/src/index.ts` — modified
  - `packages/litellm-client/src/errors.ts` — modified (+ SsrfDispatcherNotInstalledError)
  - `packages/litellm-client/src/model-aliases.ts` — modified (+ loadBundledModelProviders)
  - `packages/litellm-client/tests/unit/index.test.ts` — modified (HI-1, HI-2, HI-4 tests)
  - `packages/litellm-client/tests/unit/model-aliases.test.ts` — modified (HI-3 tests)
  - `apps/api/src/lib/ssrf-dispatcher.ts` — modified (SSRF_WRAPPED_MARKER stamp)
  - `tools/lint-prod-readiness.allowlist.txt` — modified (entry removed)
  - `.planning/phases/41-residual-high-sweep/41-f-DECISIONS.md` — created
  - `.planning/phases/41-residual-high-sweep/41-f-SUMMARY.md` — created
- Working tree clean post-closure-commit.
- 70 tests passing; coverage ≥ 90 / 90 / 90 / 90.
- `pnpm lint:lockers` exit 0.

## Out of scope (deferred)

- ME-02 (passthrough method whitelist), ME-03 (plaintext baseUrl warning),
  ME-04 (LITELLM_MASTER_KEY vs LITELLM_VIRTUAL_KEY doc), LO-01
  (type-safety on requestOpts cast), LO-02 (requestId header size cap) —
  all medium/low priority; logged to `.planning/deferred-items.md` for a
  future Phase 42.x sweep.

## References

- `.planning/review/litellm-client.md` (source)
- `.planning/phases/41-residual-high-sweep/41-CONTEXT.md` § 41.f
- `.planning/phases/41-residual-high-sweep/41-f-DECISIONS.md`
