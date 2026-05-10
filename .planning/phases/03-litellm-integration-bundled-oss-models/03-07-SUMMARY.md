---
phase: 03-litellm-integration-bundled-oss-models
plan: 07
subsystem: api
tags: [realtime, wss, fastify-http-proxy, litellm, traefik, opaque-bearer, d-04, d-12]
status: complete
completed: 2026-05-10
requirements: [LITELLM-03, LITELLM-04, PROVIDER-01]

dependency-graph:
  requires:
    - 03-01
    - 03-02
    - 03-03
  provides:
    - "WSS /v1/realtime — Fastify reverse-proxy (D-04) preserves opaque-bearer; desktop never sees LITELLM_MASTER_KEY or OPENAI_API_KEY"
    - "buildRealtimeRoutes(deps) — RealtimeDeps factory consumed by buildAllRoutes when both deps.litellm + deps.litellmMasterKey are present"
    - "compose/traefik/dynamic.yml api-realtime router + api-realtime-transport serversTransport (3600s idleConnTimeout)"
  affects:
    - "apps/api/src/routes/index.ts (extended deps surface — litellmMasterKey?)"
    - "apps/api/src/index.ts (BuildAppOptions.litellmMasterKey?, production bootstrap surfaces masterKey alongside client construction)"

tech-stack:
  added:
    - "@fastify/http-proxy ^11.4.4 — Fastify v5-compatible reverse-proxy with wsUpstream WebSocket pass-through"
    - "ws ^8.20.0 + @types/ws ^8.18.1 (apps/api devDeps) — real WS upstream + client used in route tests"
    - "ws ^8.20.0 + @types/ws ^8.18.1 (contract-tests devDeps) — WS dialer for the contract handshake test"
  patterns:
    - "WSS reverse-proxy with header-rewrite: wsClientOptions.rewriteRequestHeaders strips desktop bearer + injects LITELLM_MASTER_KEY + x-litellm-spend-logs-metadata; preHandler enforces dual-auth + appends ?user=<userId> to req.raw.url"
    - "Real ws.WebSocketServer in route tests (no @fastify/http-proxy mocks per CLAUDE.md): an ephemeral localhost upstream captures upgrade headers + URL so rewriteRequestHeaders + ?user injection are observable end-to-end"
    - "Conditional registration via dual-gate: realtime route registered ONLY when BOTH litellm + litellmMasterKey supplied; missing master key yields 404 via notFoundHandler (distinct from registered-but-dead 503 semantics)"
    - "Traefik long-lived transport: dedicated `api-realtime` router + `api-realtime-svc` + `api-realtime-transport` with 3600s idleConnTimeout, isolating WS sockets from short-lived JSON traffic on the catch-all router"

key-files:
  created:
    - "apps/api/src/routes/realtime.ts — buildRealtimeRoutes(deps) factory"
    - "apps/api/src/routes/realtime.test.ts — 5 unit tests (registration, auth-fail, master-key inject, ?user overwrite, scheme derivation)"
    - "packages/contract-tests/src/realtime.test.ts — 2 contract tests (auth gate 401, proxy-hop NOT 401 with valid session)"
  modified:
    - "apps/api/src/routes/index.ts — RealtimeDeps wired under deps.litellm conditional, gated on deps.litellmMasterKey; buildRealtimeRoutes added to barrel re-exports"
    - "apps/api/src/routes/index.test.ts — +2 tests (realtime NOT registered without masterKey; /v1/realtime in route tree when both deps supplied)"
    - "apps/api/src/index.ts — BuildAppOptions.litellmMasterKey?: string; production bootstrap surfaces masterKey from loadLitellmConfigFromEnv() alongside the client construction (single source of truth)"
    - "compose/traefik/dynamic.yml — +api-realtime router (priority 100), +api-realtime-svc service, +api-realtime-transport serversTransport (3600s idleConnTimeout)"
    - "apps/api/package.json — +@fastify/http-proxy@^11.4.4 dep, +ws +@types/ws devDeps"
    - "packages/contract-tests/package.json — +ws +@types/ws devDeps"
    - "pnpm-lock.yaml — workspace graph updated"

key-decisions:
  - "Master key passed explicitly through deps.masterKey (not pulled from env at register time) — keeps the route unit-testable WITHOUT mutating process.env, and production wires both `litellm` and `litellmMasterKey` from the SAME loadLitellmConfigFromEnv() call site so they cannot drift out of sync at boot."
  - "Dual-gate conditional registration (`if (deps.litellm) { … if (deps.litellmMasterKey) push realtime }`) — missing LITELLM_MASTER_KEY at boot leaves /v1/realtime unwired and the canonical notFoundHandler emits 404, NOT 503. The 404-not-503 semantic matches the Plan 04 precedent (a 404 says 'this surface was never wired — operator must set the env'; a 503 implies a transient upstream failure — try again later)."
  - "rewriteRequestHeaders deletes both `authorization` AND `Authorization` before injecting ours — Node's http module normalizes header keys to lower-case on read but accepts mixed-case writes, so the explicit double-delete defends against any case-sensitivity edge in @fastify/http-proxy's header-merging path."
  - "preHandler mutates req.raw.url AFTER auth so `?user=<userId>` carries the AUTHENTICATED user id (T-03-07-04 mitigation) — any caller-supplied `?user=attacker` is silently overwritten by the server-side identity. Other query params (e.g. `?intent=transcription`) are preserved."
  - "Real ws.WebSocketServer in tests — CLAUDE.md / 03-07-PLAN.md explicitly forbid mocking @fastify/http-proxy. An ephemeral localhost ws upstream (createServer + WebSocketServer({ server })) is the cheapest correct way to observe upgrade headers and URLs end-to-end. The Fastify `app.listen({ port: 0, host: '127.0.0.1' })` pattern keeps tests hermetic + parallel-safe."
  - "Dedicated Traefik router with priority 100 — co-resident with the catch-all `api` router on `api.localhost`. Without a per-PathPrefix router, all WS traffic would land on `api-svc` (default transport) and inherit Traefik's default short idleConnTimeout (90s). The dedicated `api-realtime-transport` raises this to 3600s (Pitfall #7). The websecure entrypoint's pre-existing `respondingTimeouts.read/writeTimeout: 3700s` (set during SCALE-05) covers the client-facing side."

patterns-established:
  - "Pattern 1 — fastify-http-proxy WSS mount template: prefix + rewritePrefix matched, wsUpstream derived by `replace(/^http(s?):/i, 'ws$1:')`, wsClientOptions.rewriteRequestHeaders for credential swap, preHandler for auth + URL mutation. Reusable for any future WSS proxy plane (e.g. v2 voice-assist)."
  - "Pattern 2 — dual-gate conditional registration: when a single env var unlocks an entire surface, gate the route on BOTH the constructed dep AND the raw env-derived value. Catches the edge where the dep is wired but a downstream env var is silently missing."
  - "Pattern 3 — real ws upstream in unit tests: createServer + WebSocketServer({ server }) on an ephemeral port with capture refs in the connection handler. Lets us verify rewriteRequestHeaders + URL mutation WITHOUT mocking the proxy library, satisfying the 'no mocks of @fastify/http-proxy' constraint while keeping tests fast and hermetic."

requirements-completed: [LITELLM-03, LITELLM-04, PROVIDER-01]

duration: ~25 min
completed: 2026-05-10
---

# Phase 03 Plan 07: WSS /v1/realtime Reverse-Proxy Summary

**LITELLM-03 / D-04 implementation — `@fastify/http-proxy` v11 wsUpstream mount on `/v1/realtime` that swaps the desktop's opaque bearer for `LITELLM_MASTER_KEY` on upstream-bound upgrade headers, injects `x-litellm-spend-logs-metadata` (request_id + user_id), appends `?user=<userId>` for D-03 attribution, and runs behind a dedicated Traefik router with 3600s idleConnTimeout (Pitfall #7).**

Per **D-12** (sync 2026-05-10) the LiteLLM realtime upstream is **OpenAI Realtime API direct** (`mode: realtime` + `api_key: os.environ/OPENAI_API_KEY` in Plan 01's bundled `litellm_config.yaml`). The Fastify proxy itself is provider-agnostic — this plan owns the api↔litellm hop only. Live realtime against OpenAI is e2e/Phase 4 territory and requires `OPENAI_API_KEY` in `.env.e2e`.

## Performance

- **Duration:** ~25 min (Wave 2 sequential — last plan in the wave chain)
- **Started:** 2026-05-10 (post-03-06 commit `3762397`)
- **Completed:** 2026-05-10
- **Tasks:** 2
- **Files created:** 3 (realtime.ts, realtime.test.ts, packages/contract-tests/src/realtime.test.ts)
- **Files modified:** 6 (apps/api index.ts/routes index.ts/routes index.test.ts/package.json + compose/traefik/dynamic.yml + packages/contract-tests/package.json)

## Accomplishments

- **WSS /v1/realtime mounted via `@fastify/http-proxy` v11 wsUpstream.** Single Fastify plugin; preHandler runs the dual-auth gate; wsClientOptions.rewriteRequestHeaders rewrites the upgrade. The desktop never sees `LITELLM_MASTER_KEY`; LiteLLM never sees the desktop's opaque bearer.
- **Per-user attribution via `?user=<userId>`** — the preHandler mutates `req.raw.url` from the server-side `req.user.id` AFTER auth, so any caller-supplied `?user=` value is silently overwritten with the authenticated identity (T-03-07-04 mitigation pinned by test).
- **Spend-logs metadata injection** — `x-litellm-spend-logs-metadata: {"openwhispr_request_id":"…","openwhispr_user_id":"…"}` lets OBS-04 correlate `LiteLLM_SpendLogs` rows back to our structured log lines + Plan 08's usage_ledger reconciliation.
- **Auth gate BEFORE upgrade** — preHandler defensively re-checks `req.user` and throws `AuthError` on miss; the centralized error handler emits the canonical 401 envelope and the upgrade is aborted (T-03-07-02 mitigation).
- **Dual-gate conditional registration** — realtime route is pushed only when BOTH `deps.litellm` AND `deps.litellmMasterKey` are present. Missing master key yields 404 via the canonical notFoundHandler — the right "you forgot to set LITELLM_MASTER_KEY" signal, distinct from a registered-but-dead 503.
- **Traefik 3600s timeout on the realtime route** — dedicated `api-realtime` router (priority 100) + `api-realtime-svc` + `api-realtime-transport` serversTransport with `forwardingTimeouts.idleConnTimeout: 3600s` (Pitfall #7). The websecure entrypoint's pre-existing `respondingTimeouts.read/writeTimeout: 3700s` (SCALE-05) covers the client-facing side. Co-resident with the catch-all `api` router; WS upgrades inherit the long-lived transport while short-lived JSON traffic stays on the default service.
- **11 unit tests** (5 realtime route + 6 buildAllRoutes registry) — all green. **2 contract tests** (auth-gate 401 + proxy-hop NOT-401-with-valid-session) — skip cleanly when no backend reachable, activate on `make contract-test`.

## Task Commits

Each task committed atomically with `--no-verify` (orchestrator runs hooks once after the wave):

1. **Task 1: realtime route + 7 tests + buildAllRoutes wiring** — `c651b71` (feat)
2. **Task 2: Traefik 3600s realtime route + WSS contract test** — `d0d52ef` (feat)

## Published Interface (downstream-plan reference)

### `RealtimeDeps` (consumed by buildAllRoutes)

```typescript
export interface RealtimeDeps {
  litellm: LitellmClient;
  /** LITELLM_MASTER_KEY string injected on upstream-bound upgrade headers. */
  masterKey: string;
}
```

### Wire shape (locked by docs/wire-contracts-phase-3.md "WSS /v1/realtime")

| Layer                | Inbound (desktop → Fastify)                             | Outbound (Fastify → LiteLLM)                                                            |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TLS                  | terminated at Traefik                                    | plaintext on internal docker network                                                    |
| URL                  | `wss://api.localhost/v1/realtime[?intent=…]`             | `ws://litellm:4000/v1/realtime?user=<userId>[&intent=…]`                                |
| `authorization`      | `Bearer <opaque-desktop-token>` (Better Auth)            | `Bearer ${LITELLM_MASTER_KEY}` (rewriteRequestHeaders)                                  |
| spend-logs metadata  | (absent)                                                 | `x-litellm-spend-logs-metadata: {"openwhispr_request_id":…,"openwhispr_user_id":…}`     |
| Sec-WebSocket-* etc. | passed through                                           | passed through                                                                          |

### Error mapping

| Trigger                                | HTTP | Envelope                                                |
| -------------------------------------- | ---- | ------------------------------------------------------- |
| WS upgrade without bearer/cookie       | 401  | `{error:"unauthorized"}` (centralized handler)          |
| LITELLM_MASTER_KEY unset at boot       | 404  | route not registered → notFoundHandler canonical 404    |
| Upstream LiteLLM unreachable / 5xx     | (proxy semantics — connection close with upstream code) |

## Decisions Made

- **Master key passed via deps** (not pulled from env at register time) so unit tests inject without mutating `process.env`. Production wires `litellm` + `litellmMasterKey` from the SAME `loadLitellmConfigFromEnv()` call so they cannot drift.
- **404-not-503 on missing LITELLM_MASTER_KEY** — operator-actionable "this surface was never wired" signal. Matches Plan 04 precedent for missing LiteLLM client.
- **Real ws upstream in tests** — CLAUDE.md / plan explicitly forbid mocking `@fastify/http-proxy`. An ephemeral localhost `ws.WebSocketServer` is the cheapest correct way to observe rewriteRequestHeaders + URL mutation end-to-end. Tests bind on port 0 for parallel safety.
- **Dedicated Traefik router (priority 100) for WS** — without it all `api.localhost` traffic falls onto `api-svc` with the default ~90s idleConnTimeout, causing spurious mid-session disconnects on long dictations. The new `api-realtime-svc` + `api-realtime-transport` (3600s) isolates WS sockets while leaving short-lived JSON traffic on the default service.
- **Both `Authorization` AND `authorization` deleted before injection** — Node's http module normalizes header keys to lower-case on read but accepts mixed-case writes; the double-delete is a defensive no-op in the lower-case-only path and a real fix in the mixed-case-spread path.

## Files Created/Modified

- `apps/api/src/routes/realtime.ts` — `buildRealtimeRoutes(deps)` factory (122 LOC)
- `apps/api/src/routes/realtime.test.ts` — 5 tests (registration, auth-fail-401, master-key+metadata-inject, ?user-overwrite, http→ws scheme derivation)
- `packages/contract-tests/src/realtime.test.ts` — 2 tests (auth-gate 401, proxy-hop NOT 401 with valid session)
- `apps/api/src/routes/index.ts` — `RealtimeDeps` import + dual-gate push under `if (deps.litellm) { … if (deps.litellmMasterKey) push realtime }`; `buildRealtimeRoutes` re-exported
- `apps/api/src/routes/index.test.ts` — +2 tests for the new conditional + route-tree assertions
- `apps/api/src/index.ts` — `BuildAppOptions.litellmMasterKey?: string`; production bootstrap surfaces `litellmConfig.masterKey` alongside the client construction
- `compose/traefik/dynamic.yml` — `api-realtime` router (priority 100, `Host(api.localhost) && PathPrefix(/v1/realtime)`); `api-realtime-svc` service; `api-realtime-transport` serversTransport (3600s idleConnTimeout)
- `apps/api/package.json` — `+@fastify/http-proxy@^11.4.4`, `+ws@^8.20.0` (devDep), `+@types/ws@^8.18.1` (devDep)
- `packages/contract-tests/package.json` — `+ws@^8.20.0` (devDep), `+@types/ws@^8.18.1` (devDep)

## Deviations from Plan

None — plan executed exactly as written. Two refinements that preserve intent:

- **`AllRoutesDeps.litellmMasterKey?: string` instead of pulling from `deps.litellm`** — the LitellmClient surface intentionally does NOT expose `masterKey` (it's wrapped inside the closure that constructs auth headers). Surfacing the raw key on `AllRoutesDeps` keeps the realtime route's header-rewrite testable without forcing the LitellmClient interface to leak the secret. Production wires both fields from the same `loadLitellmConfigFromEnv()` call site so single-source-of-truth at the env layer is preserved.
- **`api-realtime-transport` lives at `http.serversTransports`, not as a top-level Traefik 2.x-style root key** — Traefik 3 routes `serversTransports` under `http`. Verified by parsing the rendered YAML through `yaml.parse` and confirming the keys land at `http.serversTransports.api-realtime-transport.forwardingTimeouts.{dialTimeout,responseHeaderTimeout,idleConnTimeout}`.

## Issues Encountered

- **`pnpm install` failed on `lefthook prepare`** — `core.hooksPath` is set in the parent worktree's git config; lefthook's prepare script refuses to overwrite. Resolved by running every install with `--ignore-scripts`. Workspace deps were linked correctly so the test runs were unaffected. (Same root cause documented in 03-04-SUMMARY and 03-05-SUMMARY.)
- **5 pre-existing test failures** (`scripts/check-default-secrets.test.ts` + `litellm-spike-request-id.test.ts` "audio fixture exists") are out of scope per the deviation-rules scope boundary. Documented in 03-06-SUMMARY; same fingerprint here. No regression introduced by Plan 07.

## User Setup Required

None — Plan 07 is fully autonomous in bundled-mode. Operators wishing to exercise the route end-to-end must:

- Set `LITELLM_MASTER_KEY` in `.env` (already required by Plans 04/05).
- Set `OPENAI_API_KEY` in `.env` (or `.env.e2e` for the live realtime variant) — Plan 01's bundled `litellm_config.yaml` model `gpt-realtime` declares `mode: realtime` + `api_key: os.environ/OPENAI_API_KEY`. Without this, the LiteLLM realtime model entry returns close-with-error on upgrade — but the proxy mount itself is unaffected.
- Run `make contract-test` with the bundled compose stack (Plans 04..06 already wire the contract-test profile; this plan inherits).

## Next Phase Readiness

Wave 2 / Wave 3 follow-ons unblocked:

- **Plan 03-08 (spend-ingest worker)** — reads `LiteLLM_SpendLogs` rows containing the `openwhispr_request_id` + `openwhispr_user_id` metadata injected here. The shared metadata header schema is identical to Plans 04/05 so the worker has a single parser path.
- **Plan 03-09 (rate-limit + validation hardening)** — may add per-route rate-limit on `/v1/realtime` upgrades. The current mount uses Fastify's default rate-limit posture (no per-route override) — a `config.rateLimit: false` is intentionally NOT set, so the global plugin (Phase 02 Plan 04) covers WS upgrades.
- **Plan 03-10 (e2e against bundled stack)** — exercises the contract test with `OPENAI_API_KEY` set so a real OpenAI realtime handshake completes. The handshake-success branch of the contract test is already structured for this (status === 101 vs status !== 401).

No blockers. The Plan 07 surface introduces no new stubs. The "auth gate 401" assertion in the contract test is structurally identical to Plans 04/05/06 — same canonical envelope contract.

## Known Stubs

**None.** The route's only fallback values are:

1. `userId ?? 'anonymous'` in `rewriteRequestHeaders` — defensive default for the impossible code path where `req.user` is missing AFTER preHandler enforced its presence. Reachable only via a programming bug in the preHandler chain, not via any normal request flow. Documented inline.

The contract test's "proxy-hop NOT 401" assertion intentionally accepts any non-401 status (including 101 success and clean upstream-close codes) because the contract-test mock LiteLLM does not implement Realtime mode (D-12 — bundled upstream is OpenAI Realtime API direct, gated on `OPENAI_API_KEY` which CI does not hold). Live realtime smoke is Phase 4 / e2e per the plan.

## Threat Flags

No new security-relevant surface beyond what `<threat_model>` enumerates (T-03-07-01..05). Mitigations pinned by tests:

- **T-03-07-01 (master-key leak)** — `realtime.test.ts` asserts the master-key shape `sk-litellm-master` does not appear in any 401 response body.
- **T-03-07-02 (auth bypass via WS upgrade)** — `realtime.test.ts` asserts the auth-fail path returns a 401 envelope BEFORE the upgrade completes (the test uses `app.inject` which fires the onRequest → preHandler chain on a synthetic GET with WS upgrade headers).
- **T-03-07-04 (?user tampering)** — `realtime.test.ts` asserts a caller-supplied `?user=attacker-id` is overwritten with the authenticated `req.user.id` while other query params (`?intent=transcription`) are preserved.

## Self-Check: PASSED

- [x] `apps/api/src/routes/realtime.ts` — FOUND
- [x] `apps/api/src/routes/realtime.test.ts` — FOUND (5 tests passing)
- [x] `packages/contract-tests/src/realtime.test.ts` — FOUND (2 tests, skipped cleanly without backend)
- [x] `apps/api/src/routes/index.ts` — modified (RealtimeDeps wired + buildRealtimeRoutes re-exported)
- [x] `apps/api/src/routes/index.test.ts` — modified (+2 tests, both passing)
- [x] `apps/api/src/index.ts` — modified (BuildAppOptions.litellmMasterKey + production bootstrap)
- [x] `compose/traefik/dynamic.yml` — modified (api-realtime router + svc + transport, validated via yaml.parse)
- [x] `apps/api/package.json` — modified (+@fastify/http-proxy + ws + @types/ws)
- [x] `packages/contract-tests/package.json` — modified (+ws + @types/ws)
- [x] commit `c651b71` exists in git log (Task 1: feat — realtime route + 7 tests)
- [x] commit `d0d52ef` exists in git log (Task 2: feat — Traefik 3600s + contract test)
- [x] vitest run on `apps/api/src/routes/realtime.test.ts apps/api/src/routes/index.test.ts` reports 11/11 passing
- [x] vitest run on `packages/contract-tests/src/realtime.test.ts` reports 2/2 skipped cleanly when no backend
- [x] master-key shape `sk-litellm-master` does NOT appear in any 401 response (T-03-07-01 mitigation pinned by test)
- [x] caller-supplied `?user=` overwritten with `req.user.id` (T-03-07-04 mitigation pinned by test)

---
*Phase: 03-litellm-integration-bundled-oss-models*
*Plan: 03-07*
*Completed: 2026-05-10*
