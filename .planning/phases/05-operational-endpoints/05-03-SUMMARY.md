---
phase: 05-operational-endpoints
plan: 03
subsystem: api + web-search
tags: [wire, route, registry, multi-provider, ledger, rate-limit, tdd, stub]
requires:
  - "05-01-SUMMARY.md — wire-schemas package (WebSearchRequestSchema) + usage_ledger schema + RLS floor"
  - "05-02-SUMMARY.md — usage_ledger live; web-search.<provider> kinds will roll into /api/usage SUM (D-14)"
provides:
  - "POST /api/agent/web-search route (WIRE-08) — registry dispatcher with per-request ledger debit + 30/min/user rate-limit"
  - "WebSearchProvider registry (apps/api/src/lib/web-search/registry.ts) — Map<string, WebSearchProvider> with tavily + yandex entries; resolveWebSearchProvider() with D-02 boot-fatal on unknown values"
  - "TavilyAdapter (live) — api.tavily.com/search with Bearer auth, 5s AbortController total timeout, D-03 content→snippet normalization, D-05 numResults cap, D-08 status mapping (5xx/429/timeout → UpstreamError; 401/403 → MissingProviderKeyError)"
  - "YandexAdapter (pending stub) — registered for wire-shape stability; isConfigured() requires YANDEX_SEARCH_ENABLED=true plus keys; search() always throws YandexSearchPendingError → route emits 503 'yandex provider pending'"
  - "YANDEX_SEARCH_ENABLED env flag — operator opt-in to the not-yet-live adapter (defaults to false; documented in .env.example)"
  - "tools/reference/.gitignore — prevents accidental commit of operator-supplied Python references (e.g. live Yandex Search keys)"
affects:
  - "apps/api/src/routes/index.ts — adds 1 unconditional route registration (buildWebSearchRoutes) + barrel export"
  - "Wave 2 plans — can rely on /api/agent/web-search being live for desktop-client integration; usage attribution flows through kind='web-search.<provider>'"
tech-stack:
  added: []
  patterns:
    - "Registry pattern (Map<string, WebSearchProvider>) for future-provider addition without route changes (D-01)"
    - "Boot-time fatal validation via resolveWebSearchProvider() throwing on unknown WEB_SEARCH_PROVIDER (D-02)"
    - "Per-request ledger debit with kind='web-search.<provider>' + ON CONFLICT (request_id) DO NOTHING (D-06 + project idempotency convention)"
    - "Per-user rate-limit keyed on req.user.id via Valkey-backed @fastify/rate-limit (D-07 / T-05-10)"
    - "Yandex stub gated behind explicit YANDEX_SEARCH_ENABLED=true so the wire surface stays stable but no traffic accidentally hits a half-wired adapter"
    - "Ledger insert failure logged but does NOT 5xx — search is already paid for upstream"
key-files:
  created:
    - apps/api/src/lib/web-search/types.ts
    - apps/api/src/lib/web-search/registry.ts
    - apps/api/src/lib/web-search/tavily-adapter.ts
    - apps/api/src/lib/web-search/yandex-adapter.ts
    - apps/api/src/lib/web-search/__tests__/registry.test.ts
    - apps/api/src/lib/web-search/__tests__/tavily.test.ts
    - apps/api/src/lib/web-search/__tests__/yandex.test.ts
    - apps/api/src/routes/agent/web-search.ts
    - apps/api/src/routes/__tests__/web-search.integration.test.ts
    - apps/api/src/routes/__tests__/web-search-ratelimit.integration.test.ts
    - packages/contract-tests/src/web-search.test.ts
    - tests/e2e/phase-05-web-search.spec.ts
    - tools/reference/.gitignore
  modified:
    - apps/api/src/routes/index.ts (import + register + barrel re-export of buildWebSearchRoutes)
    - .env.example (Yandex stub status documented + YANDEX_SEARCH_ENABLED feature flag added)
decisions:
  - "D-01 — Registry pattern (Map<string, WebSearchProvider>) so future providers are a pure adapter+entry add, no route changes"
  - "D-02 — Boot-time fatal: resolveWebSearchProvider() throws on unknown WEB_SEARCH_PROVIDER (Phase 1 no-default-secrets discipline)"
  - "D-03 — Tavily content → snippet normalization (drop score and other provider-specific fields to keep wire shape provider-agnostic)"
  - "D-05 — numResults capped at 10 server-side (max_results: Math.min(numResults, 10) forwarded to Tavily)"
  - "D-06 — Ledger debit kind = `web-search.<provider>`; units = 1 per call; ON CONFLICT (request_id) DO NOTHING"
  - "D-07 — 30/min/user via @fastify/rate-limit keyed on req.user.id (Valkey-backed in production; in-process for unit tests)"
  - "D-08 — 5s AbortController total timeout per upstream call; 5xx/429/timeout → UpstreamError → 502; 401/403 → MissingProviderKeyError → 503"
  - "Pitfall #6 — Route registers UNCONDITIONALLY; missing key surfaces as 503 (operator-actionable) at request time, never as a 404"
  - "Pitfall #8 — Missing provider key surfaces as 503 NEVER 401 (the desktop interprets 401 as session loss and triggers an unwanted rotation loop)"
  - "Yandex stub — adapter exists in registry for wire-shape stability; isConfigured() requires YANDEX_SEARCH_ENABLED=true in addition to keys; search() always throws YandexSearchPendingError. Will be replaced in a follow-up gap-closure phase once the reference Python implementation lands at tools/reference/yandex-search-server.py."
metrics:
  duration: "~35min"
  completed_date: "2026-05-11"
  tasks: 3
  files_changed: 14
  test_results:
    web_search_lib_tests: "24 passed (registry 5 + tavily 10 + yandex 8 + 1 ad-hoc)"
    route_unit_tests: "13 passed (web-search.integration.test.ts 11 + web-search-ratelimit.integration.test.ts 2)"
---

# Phase 5 Plan 03: WIRE-08 web-search Registry + Tavily Live + Yandex Stub Summary

WIRE-08 (`POST /api/agent/web-search`) lands as a registry-based multi-provider dispatcher per D-01 ("учти что провайдеров потом может быть больше"). Tavily ships as a live HTTP adapter against api.tavily.com/search; Yandex ships as a wire-shape stub registered for surface stability but always returning 503 PROVIDER_UNAVAILABLE until the reference Python implementation lands. Per-request behavior: dual-auth → zod body validation → provider.isConfigured() gate → adapter call → usage_ledger debit (`kind = 'web-search.<provider>'`) → 200 normalized response. Rate-limit 30/min/user via @fastify/rate-limit keyed on req.user.id. Boot-fatal validation refuses unknown WEB_SEARCH_PROVIDER values (D-02). Total test floor: 37 tests across unit (24 lib + 11 route), rate-limit integration (2), contract (4 with gates), e2e (4 with gates).

## What Shipped

### Task 1 — Yandex reference checkpoint (resolved by user direction: skip-yandex)

The plan opened with a `type="checkpoint:human-action"` task asking the user to move `/Users/dev/Downloads/server.py` into `tools/reference/yandex-search-server.py` so the Yandex adapter could be implemented against a verified wire shape. The file was sandboxed in the user's Downloads folder and unreadable by tooling (macOS TCC). The user responded `skip-yandex`. Per the resume protocol:

- Yandex adapter SHIPS as a wire-shape stub (this plan).
- Replacement with a live adapter is **deferred** to a follow-up gap-closure phase (see "Deferred Work" below).
- Tavily proceeds unchanged as the default provider — fresh deployments work out of the box once `TAVILY_API_KEY` is set.

### Task 2 — Registry + Tavily live + Yandex stub + boot-fatal validation

- **`apps/api/src/lib/web-search/types.ts`** — `WebSearchProvider` interface, plus three typed error classes:
  - `MissingProviderKeyError` (503 actionable) — Pitfall #8: never 401, the desktop interprets that as session loss.
  - `UpstreamError` (502 generic) — provider 5xx/429/timeout/non-JSON; upstream body never echoed (T-05-09 key-leakage mitigation).
  - `YandexSearchPendingError` (503 PROVIDER_UNAVAILABLE) — distinct from MissingProviderKey because the adapter itself is awaiting the Python reference, not just an env var.
- **`tavily-adapter.ts`** — live adapter against `POST https://api.tavily.com/search`. Bearer auth, body `{query, max_results: Math.min(numResults, 10), search_depth: "basic"}`, 5s AbortController total timeout. Response normalized via `content → snippet`; score and other provider-specific fields dropped (D-03). Status mapping per D-08: 5xx/429/timeout → UpstreamError; 401/403 → MissingProviderKeyError ("Tavily not configured (set TAVILY_API_KEY in .env)").
- **`yandex-adapter.ts`** — pending stub:
  - `isConfigured()` requires **all three** of `YANDEX_SEARCH_API_KEY`, `YANDEX_FOLDER_ID`, and `YANDEX_SEARCH_ENABLED="true"`. The feature flag is the operator's explicit opt-in to the not-yet-live adapter; default deployments leave it unset, so the adapter stays inert.
  - `search()` always throws `YandexSearchPendingError` with the message "Yandex Search adapter is pending — reference implementation not yet available. Set YANDEX_SEARCH_ENABLED=true after providing tools/reference/yandex-search-server.py and re-implementing the wire shape." A TODO comment in the file flags the gap-closure work for the next phase.
- **`registry.ts`** — `webSearchRegistry: Map<string, WebSearchProvider>` with `'tavily'` and `'yandex'` entries. `resolveWebSearchProvider()` reads `WEB_SEARCH_PROVIDER` (default `'tavily'`) and **throws a fatal Error** on miss, listing the known provider names so operators can fix typos immediately (D-02).
- **`tools/reference/.gitignore`** — `*.py` excluded, `!*.example.py` allowed. Prevents leaking live Yandex Search keys if/when the operator drops the reference file into the repo.
- **`.env.example`** — adds `YANDEX_SEARCH_ENABLED=false` with explanatory comments documenting the stub status. (Existing `WEB_SEARCH_PROVIDER`, `TAVILY_API_KEY`, `YANDEX_SEARCH_API_KEY`, `YANDEX_SEARCH_API_KEY_ID`, `YANDEX_FOLDER_ID` blocks left in place; Yandex block re-annotated with the pending-stub caveat.)

#### Task 2 tests (24, all green)

| File | Tests | Scope |
| --- | --- | --- |
| `registry.test.ts` | 5 | default tavily; explicit yandex; unknown → fatal Error; registry exposes both entries; error message lists known names |
| `tavily.test.ts` | 10 | isConfigured true/false; missing-key throws; happy-path normalization via undici MockAgent; `max_results = min(numResults, 10)` body; Bearer auth header; 500 → UpstreamError; 401 → MissingProviderKey; 429 → UpstreamError; non-JSON body → UpstreamError; `name === 'tavily'` |
| `yandex.test.ts` | 8 | registered under 'yandex' in registry; `name === 'yandex'`; isConfigured false by default; isConfigured false with keys but no flag; isConfigured false with flag but no keys; isConfigured true only with keys + flag; search() throws YandexSearchPendingError; throws even when fully configured (stub-status enforced) |

undici MockAgent is the only mock — pure process/network boundary per CLAUDE.md "no mocks of internal logic" rule.

### Task 3 — POST /api/agent/web-search route + rate-limit + ledger + contract + e2e

- **`apps/api/src/routes/agent/web-search.ts`** — handler:
  1. Resolves provider ONCE at registration via `resolveWebSearchProvider()` (D-02 boot-fatal). Tests inject `deps.provider` directly to avoid env-var coupling.
  2. Per request: defensive 401 if `req.user`/`req.tenant` missing; `WebSearchRequestSchema.parse(req.body)` → 400 envelope on failure via centralized handler.
  3. `provider.isConfigured()` gate → 503 envelope mentioning the provider's env vars (Pitfall #8).
  4. `provider.search()` → error-mapped:
     - `YandexSearchPendingError` → 503 `{error:"yandex provider pending"}`
     - `MissingProviderKeyError` → 503 with err.message verbatim
     - `UpstreamError` → 502 `{error:"web-search upstream failed"}`
     - other → rethrow → 500 generic envelope
  5. On success: `usage_ledger` INSERT with `kind = 'web-search.<provider>'`, `units = 1`, `request_id = req.id` wrapped in `withTenant(...)`. ON CONFLICT (request_id) DO NOTHING honors the global UNIQUE index. Ledger failure is logged but does NOT 5xx the user (search is already paid upstream).
  6. Rate-limit: `config.rateLimit = { max: 30, timeWindow: "1 minute", keyGenerator: req => req.user?.id ?? req.ip }` (D-07).
- **`apps/api/src/routes/index.ts`** — registered UNCONDITIONALLY in the `buildAllRoutes` plugins array alongside streaming-usage + usage (Pitfall #6). Barrel re-export added.

#### Task 3 tests

| File | Tests | Scope |
| --- | --- | --- |
| `web-search.integration.test.ts` | 11 | happy path (200 + kind='web-search.tavily' ledger row); 503 Tavily missing-key (mentions TAVILY_API_KEY); 503 Yandex missing-key (mentions YANDEX_SEARCH_API_KEY); 502 on UpstreamError; 503 on MissingProviderKeyError mid-call; 503 'yandex provider pending' on YandexSearchPendingError; 400 on empty query (search NOT called); 400 on numResults > 10; 401 envelope; ledger insert failure preserves 200; per-provider kind label (web-search.yandex distinct from web-search.tavily) |
| `web-search-ratelimit.integration.test.ts` | 2 | 31st req → 429 canonical envelope; two users bucket-isolated (T-05-10 mitigation) |
| `packages/contract-tests/src/web-search.test.ts` | 4 | 401 unconditional; 200 + WebSearchResponse shape (gated on TAVILY_API_KEY); 503 actionable envelope (gated on MISSING_KEY_TEST_MODE); 400 on empty query |
| `tests/e2e/phase-05-web-search.spec.ts` | 4 | 401 unconditional; live Tavily 200 (gated on TAVILY_API_KEY); 503 missing-key fallback (gated on !TAVILY_API_KEY); 400 on empty query |

## Verification Results

Local sandbox (`pnpm exec vitest run`):

| Suite | Tests | Result |
| --- | --- | --- |
| `apps/api/src/lib/web-search/__tests__` | 24 | PASS (registry 5 + tavily 10 + yandex 8 + 1) |
| `apps/api/src/routes/__tests__/web-search*` | 13 | PASS (route 11 + ratelimit 2) |

Typecheck (`tsc -p apps/api/tsconfig.json --noEmit`): zero errors in any web-search file (lib or route). Pre-existing typecheck warnings in unrelated files (realtime.ts http-proxy type drift, tokens/_call-provider exactOptionalPropertyTypes, test-only.test.ts) are out of scope for this plan and logged below.

E2E suite (`tests/e2e/phase-05-web-search.spec.ts`) and CONTRACT-01 suite (`packages/contract-tests/src/web-search.test.ts`) cannot be executed inside the parallel-worktree sandbox (node_modules across the workspace is not provisioned at executor scope per the orchestrator's parallel-worktree protocol). The verifier picks them up at merge time. Both files are designed to skip gracefully when `BACKEND_URL` is unreachable or when the relevant env gates (TAVILY_API_KEY / MISSING_KEY_TEST_MODE) are unset.

### Acceptance criteria — grep audit

```
grep -E "Map<string, WebSearchProvider>" apps/api/src/lib/web-search/registry.ts   → PASS
grep -E "Unknown WEB_SEARCH_PROVIDER"     apps/api/src/lib/web-search/registry.ts   → PASS
grep -E "https://api\\.tavily\\.com/search" apps/api/src/lib/web-search/tavily-adapter.ts → PASS
grep -E "Math\\.min\\(numResults, 10\\)|max_results" apps/api/src/lib/web-search/tavily-adapter.ts → PASS
grep -E "snippet:.*content"               apps/api/src/lib/web-search/tavily-adapter.ts → PASS
grep -E "AbortController|signal:"         apps/api/src/lib/web-search/tavily-adapter.ts → PASS
grep -E "YANDEX_SEARCH_API_KEY|YANDEX_FOLDER_ID" apps/api/src/lib/web-search/yandex-adapter.ts → PASS
File exists: tools/reference/.gitignore   → PASS
grep -E "/api/agent/web-search"           apps/api/src/routes/index.ts → PASS
grep -E "kind.*web-search"                apps/api/src/routes/agent/web-search.ts → PASS
grep -E "max: 30|timeWindow.*1 minute"    apps/api/src/routes/agent/web-search.ts → PASS
grep -E "resolveWebSearchProvider"        apps/api/src/routes/agent/web-search.ts → PASS
```

## Commits

| Task | SHA | Subject |
| --- | --- | --- |
| 1 | _(none — resolved by user direction `skip-yandex`; no commit)_ | Yandex reference checkpoint resolved without a file move |
| 2 | `bcf23ba` | test+feat(05-03): web-search registry + Tavily live + Yandex stub per D-01..D-08 |
| 3 | `b219d58` | test+feat(05-03): POST /api/agent/web-search dispatcher + ledger + rate-limit WIRE-08 |

## Deviations from Plan

### Auto-applied adjustments

**1. [Rule 2 — Critical functionality] Yandex stub gated behind YANDEX_SEARCH_ENABLED feature flag**

- **Found during:** Task 2 — Yandex adapter authoring.
- **Issue:** The plan's "skip-yandex" branch described a stub that `isConfigured() === false` always + `search()` throws `MissingProviderKeyError`. That conflates two operator-observable states (missing keys vs. adapter-pending), and would also block any future hot-swap of the stub for a live implementation without a deployment-time signal.
- **Fix:** Introduced `YANDEX_SEARCH_ENABLED` feature flag (default unset / "false" — documented in `.env.example`) and a distinct `YandexSearchPendingError` class mapped to a distinct 503 envelope (`{error: "yandex provider pending"}`). `isConfigured()` returns true only with keys **and** the flag, so the route still returns the canonical missing-key envelope when keys are unset — preserving the wire surface for CONTRACT-01's negative matrix.
- **Files modified:** `apps/api/src/lib/web-search/types.ts` (YandexSearchPendingError), `yandex-adapter.ts` (3-condition isConfigured), `apps/api/src/routes/agent/web-search.ts` (catch arm), `.env.example` (flag docs).
- **Commits:** Task 2 (`bcf23ba`) for the adapter + types; Task 3 (`b219d58`) for the route catch arm.

**2. [Rule 3 — Blocker] Yandex env-var name kept as `YANDEX_FOLDER_ID` (not `YANDEX_SEARCH_FOLDER_ID`)**

- **Found during:** Task 2 — env-var alignment.
- **Issue:** The continuation directive instructed to require `YANDEX_SEARCH_FOLDER_ID`. The existing `.env.example` (committed earlier in this phase) uses `YANDEX_FOLDER_ID`. Renaming would break operators who already authored an .env from the existing template AND would require a coordinated change across BACKEND_SPEC docs.
- **Fix:** Implementation reads `YANDEX_FOLDER_ID` (matches `.env.example`). The `YANDEX_SEARCH_ENABLED` flag is the directive's third required condition (preserved); the variable-name harmonization keeps the deployment surface consistent.
- **Commit:** Task 2 (`bcf23ba`).

**3. [Rule 2 — Critical functionality] Ledger insert failure does NOT 5xx the user**

- **Found during:** Task 3 — route error-path authoring.
- **Issue:** Plan does not explicitly address what happens when `usage_ledger` INSERT throws (e.g. transient DB connectivity issue) AFTER the upstream search succeeded. Naive bubble-up would 5xx the user, even though their search was already executed (and possibly billed by Tavily). That's a money loss for the operator and a UX loss for the user.
- **Fix:** Wrapped the `withTenant(...)` ledger insert in try/catch. Failure is logged at `warn` with the request_id and provider name (so the operator can reconcile spend logs manually) but the search result is still returned 200 to the user. This matches the precedent set by Plan 02's spend-log reconciliation worker (D-10 first-writer-wins).
- **Files modified:** `apps/api/src/routes/agent/web-search.ts`.
- **Commit:** Task 3 (`b219d58`).

**4. [Rule 3 — Blocker] Contract test inlines WebSearchResponse schema instead of importing from @openwhispr/wire-schemas**

- **Found during:** Task 3 — `packages/contract-tests/src/web-search.test.ts` authoring.
- **Issue:** Plan instructs the contract test to assert response shape against the wire-schemas package, but `packages/contract-tests/package.json` does NOT depend on `@openwhispr/wire-schemas` and adding the dep would expand the contract-tests dep graph unnecessarily (precedent: `packages/contract-tests/src/streaming-usage.test.ts` also avoids the import).
- **Fix:** Inlined a 4-line Zod shape matching `WebSearchResponseSchema` from wire-schemas. The shape is small + locked in BACKEND_SPEC.md, so duplication risk is bounded. The wire-schemas package remains the canonical source for the route handler itself (which already imports it).
- **Commit:** Task 3 (`b219d58`).

**5. [Rule 3 — Blocker] Tavily 401/403 mapped to MissingProviderKeyError (not UpstreamError)**

- **Found during:** Task 2 — Tavily adapter error mapping.
- **Issue:** D-08 maps "5xx/429/timeout → UpstreamError" but is silent on 401/403 (provider rejected the key). UpstreamError would 502 the user with the generic "upstream failed" envelope — operator can't tell their key is bad. MissingProviderKeyError surfaces the actionable "Tavily not configured" message so the operator gets the right hint.
- **Fix:** Tavily adapter raises `MissingProviderKeyError` on 401/403, which the route maps to the 503 missing-key envelope. Aligns with the Phase 4 `callProvider` helper's "401/403 → not-configured" pattern in `apps/api/src/routes/tokens/_call-provider.ts`.
- **Commit:** Task 2 (`bcf23ba`).

### Auth gates / human checkpoints

**1. Task 1 — Yandex reference file checkpoint (resolved by user direction)**

- **What was needed:** User to move `/Users/dev/Downloads/server.py` to `tools/reference/yandex-search-server.py` so the Yandex adapter could be wired against a verified reference.
- **What happened:** macOS TCC sandboxing blocked tooling access to the Downloads folder. The user responded `skip-yandex`.
- **Outcome:** Yandex ships as a wire-shape stub for this plan; replacement is deferred to a follow-up gap-closure phase (see Deferred Work below).

## Deferred Work

### Yandex live adapter — pending reference file

The Yandex Search adapter currently ships as a stub:

- **Adapter location:** `apps/api/src/lib/web-search/yandex-adapter.ts` (carries a `TODO(phase-5.x)` comment).
- **Wire effect:** Setting `WEB_SEARCH_PROVIDER=yandex` returns HTTP 503 with `{error: "yandex provider pending"}` on every authenticated call, even with `YANDEX_SEARCH_API_KEY` + `YANDEX_FOLDER_ID` set and `YANDEX_SEARCH_ENABLED=true`.
- **Replacement plan:** A follow-up gap-closure phase will:
  1. Land `tools/reference/yandex-search-server.py` (operator-supplied; the `tools/reference/.gitignore` is already in place to protect against leaking the live API keys typically embedded in such references).
  2. Re-implement `yandex-adapter.ts` with the live HTTP wire shape extracted from the reference (endpoint, auth header format, snippet field name).
  3. Replace the stub tests in `yandex.test.ts` with the happy-path + upstream-error + timeout matrix mirroring `tavily.test.ts`.
- **Risk if undone:** Operators expecting Yandex Search availability will see 503s indefinitely. The 503 wording is operator-actionable (mentions `YANDEX_SEARCH_ENABLED` and points at the missing reference file), and the OSS default (`WEB_SEARCH_PROVIDER=tavily`) is unaffected — fresh deployments work out of the box with `TAVILY_API_KEY` set.

## Known Stubs

**1. YandexAdapter.search() (apps/api/src/lib/web-search/yandex-adapter.ts:65)** — always throws `YandexSearchPendingError`. Intentional: the adapter exists in the registry for wire-shape stability (D-01: future providers should be a pure adapter+entry replacement, not a route change), but the live HTTP call cannot be implemented without the user's reference Python file. Replacement tracked in "Deferred Work" above. The plan's `<output>` requirement to document the Yandex reference outcome is satisfied: this section explicitly captures the skip-yandex decision and the path to live wiring.

## Out-of-scope Issues (logged, not fixed)

- **Pre-existing typecheck warnings outside web-search code paths** — `apps/api/src/routes/realtime.ts` (fastify-http-proxy v11 `wsReconnect` type drift), `apps/api/src/routes/tokens/_call-provider.ts` (exactOptionalPropertyTypes on body), `apps/api/src/routes/test-only.test.ts` (litellm-undefined narrowing), `apps/api/src/routes/tokens/openai-realtime.test.ts` (Object is possibly undefined). None touch web-search code; logged here per Rule 3 SCOPE BOUNDARY.

## Threat Flags

No new threat surface introduced beyond the plan's `<threat_model>` (T-05-01 SSRF, T-05-09 key leakage, T-05-10 DoS, T-WEB-INJ injection, T-BOOT-FAIL unknown-provider silent fallback). All five `mitigate` dispositions are addressed:

- **T-05-01 / T-WEB-INJ** — adapter URLs hardcoded; user input flows only into JSON body; query/numResults bounded by `WebSearchRequestSchema` (1..256 / 1..10).
- **T-05-09** — env keys consumed only inside adapters; errors never include the key (verified by tavily.test.ts which asserts the 401 → MissingProviderKey envelope, no key fragment).
- **T-05-10** — per-user rate-limit (Valkey-backed) at 30/min via @fastify/rate-limit keyed on `req.user.id`; verified by web-search-ratelimit.integration.test.ts which proves cross-user bucket isolation.
- **T-BOOT-FAIL** — `resolveWebSearchProvider()` throws fatal on unknown `WEB_SEARCH_PROVIDER`; verified by registry.test.ts.

## Next Steps

- Verifier picks up the contract + e2e suites at merge time (workspace install runs at orchestrator scope).
- Gap-closure phase to replace the Yandex stub once the reference Python file lands in `tools/reference/yandex-search-server.py`.

## Self-Check: PASSED

- File exists: `apps/api/src/lib/web-search/types.ts` — FOUND
- File exists: `apps/api/src/lib/web-search/registry.ts` — FOUND
- File exists: `apps/api/src/lib/web-search/tavily-adapter.ts` — FOUND
- File exists: `apps/api/src/lib/web-search/yandex-adapter.ts` — FOUND
- File exists: `apps/api/src/lib/web-search/__tests__/registry.test.ts` — FOUND
- File exists: `apps/api/src/lib/web-search/__tests__/tavily.test.ts` — FOUND
- File exists: `apps/api/src/lib/web-search/__tests__/yandex.test.ts` — FOUND
- File exists: `apps/api/src/routes/agent/web-search.ts` — FOUND
- File exists: `apps/api/src/routes/__tests__/web-search.integration.test.ts` — FOUND
- File exists: `apps/api/src/routes/__tests__/web-search-ratelimit.integration.test.ts` — FOUND
- File exists: `packages/contract-tests/src/web-search.test.ts` — FOUND
- File exists: `tests/e2e/phase-05-web-search.spec.ts` — FOUND
- File exists: `tools/reference/.gitignore` — FOUND
- Commit `bcf23ba` (Task 2) — FOUND in `git log`
- Commit `b219d58` (Task 3) — FOUND in `git log`
