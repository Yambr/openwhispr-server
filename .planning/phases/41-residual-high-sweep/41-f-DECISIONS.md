# Phase 41.f — Decisions

Source: HIGH-FIX-LITELLM cluster (HI-1..4 from `.planning/review/litellm-client.md`).
User OFFLINE; agent acted as advisor for grey-area decisions per orchestration brief.

## D-41f-1 — Timeout defaults (HI-1)

**Decision:** `headersTimeout = 30_000ms`, `bodyTimeout = 120_000ms` (chat/passthrough);
caller can override per-call. `chatCompletionsStream` keeps `bodyTimeout = 0` (long-lived SSE)
unchanged.

**Rationale:**
- `apps/api/src/lib/dep-check.ts` already uses tens-of-seconds for health probes; production
  paths must be at least as defensive.
- Phase 8 load-test SLOs target p95 chat-completions ≤ 30 s (`reason` route) and
  transcribe ≤ 90 s for 10-minute audio. `headersTimeout=30s` covers connect+TLS+first byte
  comfortably; `bodyTimeout=120s` is generous for streaming completions and chunk-reading.
- For transcribe (audio multipart upload + Whisper processing), 120 s is tight for very
  long files but callers can pass a per-call override. Keeping a single conservative
  default beats hardcoding two values and surfacing the wrong one to a forgetful caller.
- The review brief (HI-01) suggested 30s/60s for chat and 30s/300s for transcribe; we
  picked one set of defaults to keep the surface uniform and let routes pass overrides
  when they know better. The 30s headers / 120s body pair is the median that passes both
  Phase 8 SLO + 1000-concurrent stall vector defence.

**AbortSignal forwarding:** Forwarded to undici `request({ signal })` for ALL THREE
methods (`chatCompletions`, `audioTranscriptions`, `passthrough`). The Phase 08.2
`chatCompletionsStream` rationale for "do NOT forward signal" applied ONLY to an
older undici-7-with-SSRF-wrapped-Agent compatibility break that was specific to per-call
`dispatcher:` option (T-08.2-01); plain `signal` on `request()` is dispatcher-agnostic
in undici 7.25.0 and works through the global SSRF Agent without issue. The Test D in
the existing index.test.ts already proves signal flows through for the stream path —
same shape applies here.

## D-41f-2 — SSRF dispatcher marker mechanism (HI-2)

**Decision:** Tag the Agent built by `makeSSRFDispatcher()` with a non-enumerable own
property `__openwhispr_ssrf_wrapped` set to a Symbol-keyed value. The client checks for
the symbol on `getGlobalDispatcher()` at first call to any of the four methods, throws a
typed `SsrfDispatcherNotInstalledError` if absent.

**Rationale:**
- **Symbol vs string-property:** the tag must NOT collide with any user-set property on a
  future Agent subclass. Using a module-exported `Symbol.for('openwhispr.ssrf-wrapped')`
  registers it in the global symbol registry — the client can re-derive the same symbol
  without importing the dispatcher module, which would create a circular dep (client →
  apps/api).
- **Constructor-name check rejected:** `dispatcher.constructor.name === 'Agent'` is true
  for BOTH the bundled SSRF Agent AND undici's default Agent; can't disambiguate.
- **Property-on-prototype rejected:** would be inherited by all Agent instances if the
  user happened to subclass; the wrapper-specific tag must live on the instance itself.
- **First-call vs module-load:** module-load assertion would force every consumer (incl.
  test files that don't actually fire requests) to bootstrap SSRF, which is hostile to
  unit-test ergonomics. First-call assertion still catches worker/CLI bypass before any
  outbound bytes leave the process — same security posture, friendlier developer surface.
- **Test injection bypass:** `opts.request` override (existing test seam) bypasses the
  assertion because the assertion path runs only on the default global dispatcher branch.
  Tests that inject `request` are explicitly opting out of the global-dispatcher path
  and own their own network mocking — same posture as Phase 08.2 dispatcher-omission test.

## D-41f-3 — Model alias derivation (HI-3 / ME-01)

**Decision:** Derive `BUNDLED_MODEL_PROVIDER` lazily from
`loadLitellmModelAliases(yamlPath)` at first read, using a per-alias provider-inference
from the yaml `litellm_params.model` field (e.g., `openrouter/qwen/qwen3.6-plus` →
`openrouter`, `groq/whisper-large-v3` → `groq`). Static fallback retained for the four
known aliases when the yaml is unreadable (test env without compose dir).

**Rationale:**
- Phase 41.b already shipped the yaml loader and parked it as dead-export
  (`tools/lint-prod-readiness.allowlist.txt:57`) awaiting Phase 41.f consumption.
  This task consumes it; allowlist entry can be removed in the closing commit.
- Provider inference from `litellm_params.model` prefix (string-split on `/`, take token 0)
  matches LiteLLM's own router resolution shape — same source of truth, no duplication.
- The static map's 4 entries are kept as the in-source fallback so unit tests don't need
  to mount a yaml file; tests can also pass an explicit `yamlPath` to derive from a
  fixture if they need to assert the derived shape.

## D-41f-4 — streamOptions opt-out (HI-4)

**Decision:** Flip the spread order in `chatCompletionsStream` so caller's
`stream_options` (whether passed via `extras.stream_options` or the future explicit
`streamOptions` param) wins over the `{ include_usage: true }` default. Default remains
`include_usage: true` for backward compat.

**Rationale:** Trivial — review-prescribed fix, no grey area. The existing Test A in
`index.test.ts:587` already asserts the merge shape; we add a sibling test for the
explicit-false case and adjust the spread.

## What we did NOT do

- **Did not change `chatCompletionsStream`'s timeouts** — Phase 08.2 explicitly set
  `bodyTimeout: 0` for SSE; revisiting that is out of HI-1 scope.
- **Did not touch `errors.ts`** — CR-9 (Phase 37) already truncates `bodyText` private
  + non-enumerable.
- **Did not add `dispatcher` injection option** — review's HI-2 fix offered two paths
  (per-call dispatcher OR boot-time assertion); we chose the assertion path because the
  per-call option would resurrect the T-08.2-01 mitigation we already locked.

## References

- `.planning/review/litellm-client.md` (HI-1..4 + ME-01)
- `.planning/phases/41-residual-high-sweep/41-CONTEXT.md` §41.f
- `.planning/phases/41-residual-high-sweep/41-b-DECISIONS.md` (yaml loader rationale)
