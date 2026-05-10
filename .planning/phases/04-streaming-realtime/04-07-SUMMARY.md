---
phase: 04
plan: 07
subsystem: streaming-realtime
tags: [tdd, mock-realtime, hermetic, e2e, scale-05, t-04-02, t-04-reconnect-loop, d-22, d-27]
requires:
  - .planning/phases/04-streaming-realtime/04-CONTEXT.md (D-22, D-27)
  - .planning/phases/04-streaming-realtime/04-RESEARCH.md (§2.9 lines 732-775)
  - .planning/phases/04-streaming-realtime/04-01-SUMMARY.md (mock-realtime workspace skeleton)
  - .planning/phases/04-streaming-realtime/04-05-SUMMARY.md (:8443 dedicated realtime entrypoint that hosts the tightened proxy)
provides:
  - tests/e2e/mock-realtime/server.ts (real implementation — replaces 04-01 stub)
  - tests/e2e/mock-realtime/server.test.ts (8 protocol tests, 100/100/100/100 coverage on server.ts)
  - tests/e2e/mock-realtime/cli.ts (container CLI bootstrap — excluded from coverage)
  - tests/e2e/mock-realtime/Dockerfile (multi-stage node:24-alpine; non-root)
  - tests/e2e/mock-realtime/vitest.config.ts (package-local 90/90/90/90 thresholds)
  - compose/e2e/docker-compose.e2e.yml (e2e profile overlay; mock-realtime service)
  - apps/api/src/routes/realtime.ts (D-27: wsReconnect false + handshakeTimeout 10000)
affects:
  - tests/e2e/mock-realtime/package.json (added ws + @types/ws + @vitest/coverage-v8 dev deps; vitest bumped to 4.x)
  - tests/e2e/mock-realtime/tsconfig.json (dropped parent extends so the in-container tsc has no out-of-context dependencies)
  - apps/api/src/routes/realtime.test.ts (added 2 D-27 wsClientOptions assertions)
  - pnpm-lock.yaml (regenerated for new mock-realtime devDeps)
tech-stack:
  added:
    - "Hermetic mock-realtime WS server (Fastify 5 + @fastify/websocket v11) under @openwhispr/mock-realtime"
    - "compose/e2e/docker-compose.e2e.yml overlay (profiles:[e2e])"
  patterns:
    - "Container-image build context self-contained (no parent files referenced) — image builds identically on dev mac, GHA Linux, arm64 servers"
    - "Vitest package-local config with 90/90/90/90 thresholds for packages NOT covered by the repo-root vitest config (which excludes tests/**)"
    - "register-call interception via app.register monkey-patch for asserting plugin options that affect failure-mode behavior expensive to elicit at runtime"
    - "Build-context env override (\${MOCK_REALTIME_CONTEXT:-./tests/e2e/mock-realtime}) for predictable resolution when the overlay is the second -f file"
key-files:
  created:
    - tests/e2e/mock-realtime/server.test.ts
    - tests/e2e/mock-realtime/cli.ts
    - tests/e2e/mock-realtime/Dockerfile
    - tests/e2e/mock-realtime/vitest.config.ts
    - compose/e2e/docker-compose.e2e.yml
    - .planning/phases/04-streaming-realtime/04-07-SUMMARY.md
  modified:
    - tests/e2e/mock-realtime/server.ts (replaced Wave-0 stub with full implementation)
    - tests/e2e/mock-realtime/package.json (deps + scripts)
    - tests/e2e/mock-realtime/tsconfig.json (standalone — no parent extends)
    - apps/api/src/routes/realtime.ts (D-27 wsClientOptions tightening)
    - apps/api/src/routes/realtime.test.ts (2 new D-27 assertions)
    - pnpm-lock.yaml
decisions:
  - "Use Fastify v5 listen() return value (URL string with bound port) instead of introspecting server.address() — eliminates the only defensive non-AddressInfo branch and gets server.ts to 100/100/100/100 without untestable code paths"
  - "Move CLI bootstrap to cli.ts so server.ts is pure library code — vitest coverage on server.ts excludes import-meta/process.argv branches that cannot be exercised inside a vitest worker"
  - "Healthcheck dials /v1/realtime over plain HTTP and accepts any 2xx-4xx response (server returns 426 Upgrade Required for non-WS GET — proves listener bound + route mounted; no curl/wget needed in alpine image)"
  - "Track open sockets server-side and close them with code 1000 in stop() before app.close() — Fastify's defaultPreClose calls client.close() with no code (peer sees 1005); this gives test clients a clean 1000 close they can assert"
  - "wsReconnect lives at the TOP LEVEL of register opts (sibling of wsClientOptions, NOT nested) per @fastify/http-proxy v11 API — wired on tests so a future API drift breaks the test, not silently downgrades behavior"
metrics:
  duration: ~25m
  tasks_completed: 3
  files_created: 6
  files_modified: 5
  commits: 5
  completed_date: 2026-05-11
---

# Phase 04 Plan 07: Hermetic Mock-Realtime + D-27 Proxy Tightening

Replaced the 04-01 mock-realtime workspace stub with a real ~50 LoC
Fastify-backed OpenAI Realtime protocol mock; wired it into a new
`compose/e2e/docker-compose.e2e.yml` overlay under `profiles: [e2e]`;
tightened the existing `apps/api/src/routes/realtime.ts`
`@fastify/http-proxy` registration with the D-27 settings
(`handshakeTimeout: 10000`, `wsReconnect: false`). Closes the
hermetic-soak prerequisite (SCALE-05) so the Wave 3 plan 04-09 5-min
soak can target a zero-cost upstream.

## What Landed

### 1. Mock-realtime WS server (Task 1)

`tests/e2e/mock-realtime/server.ts` — real implementation:

| Capability | Implementation |
|---|---|
| `session.created` on connect | Sent immediately on the websocket open callback with `session.id = sess_<Date.now()>` |
| `response.done` on `response.create` | Per-message handler in `socket.on('message')`; replies with `response.id = resp_<Date.now()>` |
| Ping/pong | Handled at protocol layer by the `ws` library backing `@fastify/websocket` (RFC 6455 §5.5.2/5.5.3) — no application-layer handler |
| Graceful shutdown | `stop()` closes tracked sockets with code 1000 then awaits `app.close()` |
| Configurable port | `port: 0` yields ephemeral OS-assigned port; `host` defaults to `127.0.0.1`; container CLI defaults to `0.0.0.0:8765` |

Coverage on `server.ts`:

```text
Statements   : 100% ( 22/22 )
Branches     : 100% ( 4/4 )
Functions    : 100% ( 5/5 )
Lines        : 100% ( 21/21 )
```

CLI bootstrap moved to `cli.ts` (excluded from coverage — pure
process.argv glue with no testable branches inside a vitest worker).

### 2. Dockerfile + e2e compose overlay (Task 2)

`tests/e2e/mock-realtime/Dockerfile` — multi-stage `node:24-alpine`:

| Stage | Purpose |
|---|---|
| `build` | `npm install` deps, `tsc -p tsconfig.json` compiles `server.ts` + `cli.ts` to `dist/` |
| `runtime` | Copies node_modules + dist + package.json; runs `node dist/cli.js` as the non-root `node` user (uid 1000) |

Self-contained build context — `tsconfig.json` no longer extends
`../../../tsconfig.base.json` so the in-container `tsc` invocation has
no out-of-context dependencies. Vitest is unaffected (uses its own
config).

`compose/e2e/docker-compose.e2e.yml` — overlay declaring:

```yaml
networks:
  openwhispr_internal:
    external: true
    name: openwhispr_openwhispr_internal

services:
  mock-realtime:
    profiles: [e2e]
    container_name: openwhispr-mock-realtime
    build:
      context: ${MOCK_REALTIME_CONTEXT:-./tests/e2e/mock-realtime}
      dockerfile: Dockerfile
    environment:
      PORT: "8765"
    networks: [openwhispr_internal]
    healthcheck:
      test:
        - "CMD"
        - "node"
        - "-e"
        - "require('http').get('http://localhost:8765/v1/realtime',(r)=>process.exit(r.statusCode>=200&&r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
    restart: "no"
```

Internal-only — no host port published, no Traefik route. LiteLLM in
the e2e profile (Wave 3) dials `ws://mock-realtime:8765/v1/realtime`.

Healthcheck timing (live verification):

| Event | Time (UTC) | Detail |
|---|---|---|
| Container start | 2026-05-10T21:28:53 | `up -d` returned |
| First probe | 21:28:59.130 | start_period (5s) elapsed; probe ran |
| First probe end | 21:28:59.225 | exit 0 (HTTP 426 → 426>=200 && 426<500) |
| Health = healthy | 21:28:59 (≈ 6s after start) | `docker inspect` reported `healthy` on first poll |

### 3. /v1/realtime wsClientOptions tightening (Task 3)

`apps/api/src/routes/realtime.ts` `buildRealtimeRoutes` — diff:

```diff
     await app.register(fastifyHttpProxy, {
       upstream: upstreamHttp,
       wsUpstream: upstreamWs,
       prefix: "/v1/realtime",
       rewritePrefix: "/v1/realtime",
       websocket: true,
+      // D-27: don't auto-reconnect — let the client handle it.
+      // Auto-reconnect in the proxy masks ingress timeout bugs and
+      // creates retry storms (T-04-RECONNECT-LOOP mitigation).
+      wsReconnect: false,
       wsClientOptions: {
         rewriteRequestHeaders: buildRewriteRequestHeaders(deps.masterKey),
+        // D-27: 10s handshake ceiling on stuck connecting clients
+        // prevents an ingress slot from being held indefinitely on the
+        // dedicated :8443 entrypoint (T-04-02 mitigation).
+        handshakeTimeout: 10000,
       },
       preHandler: async (req, _reply) => { ... },
     });
```

| Before | After |
|---|---|
| `wsClientOptions: { rewriteRequestHeaders }` only | `wsClientOptions: { rewriteRequestHeaders, handshakeTimeout: 10000 }` + top-level `wsReconnect: false` |
| Stuck-connecting client could hold an ingress slot indefinitely | 10s ceiling — slot reclaimed at the proxy |
| Proxy could attempt to auto-reconnect on upstream failure | Disabled — desktop client owns reconnect policy |

Phase 03 contract intact:

- `buildRewriteRequestHeaders` unchanged — master-key swap, spend-logs
  metadata injection, `authorization`/`Authorization` stripping, and
  `anonymous` fallback all preserved.
- `preHandler` unchanged — `?user=<id>` injection, `AuthError` on
  missing `req.user`, `raw.url` → `req.url` fallback all preserved.

Coverage on `apps/api/src/routes/realtime.ts`:

```text
Statements   : 100% ( 22/22 )
Branches     : 100% ( 8/8 )
Functions    : 100% ( 6/6 )
Lines        : 100% ( 22/22 )
```

15 tests in `realtime.test.ts` all green (13 Phase 03 regression + 2
new D-27 assertions).

## Threat Mitigations Verified

| Threat ID | Component | Verified by |
|---|---|---|
| T-04-02 (DoS via stuck WS upgrade) | `wsClientOptions.handshakeTimeout` | Test asserts the value is exactly 10000 in the registered plugin opts |
| T-04-RECONNECT-LOOP (proxy retry storm) | `wsReconnect` flag | Test asserts the value is exactly `false` at the top level of the register opts (sibling of `wsClientOptions`) |
| T-04-MOCK-EXPOSE (production exposure of mock) | `profiles: [e2e]` gate + no published host port + internal-only network | `docker compose up` (no `--profile e2e`) does NOT start `mock-realtime`; manual verification via `docker compose config` shows the service only when `--profile e2e` is passed |

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 (RED) | `a195348` | `test(04-07): RED — mock-realtime WS server protocol tests` |
| 1 (GREEN) | `b0a6deb` | `feat(04-07): GREEN — implement hermetic mock-realtime WS server (D-22)` |
| 2 | `188f946` | `feat(04-07): hermetic mock-realtime container + e2e compose overlay` |
| 3 (RED) | `097a694` | `test(04-07): RED — assert D-27 wsClientOptions tightening on /v1/realtime` |
| 3 (GREEN) | `285886c` | `feat(04-07): GREEN — tighten /v1/realtime wsClientOptions per D-27` |

## Deviations from Plan

**[Rule 3 — auto-fix blocking issue] Race-condition fix in two tests.**
Initial test draft awaited `ws.once('open', ...)` BEFORE
`ws.once('message', ...)`, which loses the immediate `session.created`
frame when it arrives between the two `await` boundaries (the `ws`
library emits `message` to no-listeners and drops it). Fixed by
attaching the `message` listener as the first await — the connection
is fully open by the time the first frame arrives, and `'open'` is
implicitly observable through receipt of any frame. Tracked under
Task 1's GREEN commit (`b0a6deb`). Not architectural — a test-only
correction to a known `ws` library emission ordering quirk.

**[Rule 2 — auto-add missing critical functionality] Server-side socket
tracking for graceful shutdown.** Fastify's `app.close()` triggers the
`@fastify/websocket` `defaultPreClose` which calls `client.close()`
with no arguments — peers receive close code 1005 (no status), which
is technically clean but not the canonical 1000 (normal closure)
desired for graceful shutdown semantics. Added a small `Set<socket>`
tracked at registration / cleared on `'close'`; `stop()` iterates and
calls `socket.close(1000, 'server stopping')` BEFORE awaiting
`app.close()`. This is required for the test that asserts
"clean close with code 1000" but also matches the Wave 3 soak harness'
expectation. Tracked under Task 1's GREEN commit (`b0a6deb`).

**[Rule 3 — auto-fix blocking issue] Build-context env-var override.**
Docker Compose resolves relative build contexts against the FIRST `-f`
file's directory, NOT the file in which the build context is declared
— a long-standing compose quirk that surfaced because the relative
path `../../tests/e2e/mock-realtime` from the overlay was resolved
against the base `docker-compose.yml` location, yielding an
out-of-tree absolute path. Fixed by using
`${MOCK_REALTIME_CONTEXT:-./tests/e2e/mock-realtime}` so the path is
predictably project-root-relative under the default. Tracked under
Task 2's commit (`188f946`).

**[Rule 1 — bug] tsconfig parent-extends removed.** The Wave-0 skeleton's
`tsconfig.json` extended `../../../tsconfig.base.json`, which is
outside the Docker build context (the build context is the package
directory itself, not the repo root). The in-container `tsc`
invocation would fail at config load. Made the local `tsconfig.json`
self-contained (inlined the relevant compiler options); vitest is
unaffected because it uses its own configuration. Tracked under
Task 2's commit (`188f946`).

## Authentication Gates

None. No external services contacted. Hermetic — mock-realtime is its
own upstream.

## Known Stubs

None. The previous mock-realtime stub from 04-01 is fully replaced.

## Threat Flags

None. The new surface (mock-realtime container) is internal-only,
gated behind `profiles: [e2e]`, and never reachable from outside the
docker bridge. The realtime.ts edit is a config tightening that
narrows existing behavior — no new endpoints or trust boundaries.

## Verification

- `pnpm --filter @openwhispr/mock-realtime test --run --coverage`
  → 8 passed, 100/100/100/100 on server.ts ✅
- `cd apps/api && pnpm vitest run src/routes/realtime.test.ts --coverage --coverage.include='src/routes/realtime.ts' --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90`
  → 15 passed, 100/100/100/100 on realtime.ts ✅
- `docker compose -f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml --profile e2e config` → exit 0 ✅
- `docker compose -f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml --profile e2e build mock-realtime` → image tagged `openwhispr-mock-realtime` ✅
- `docker compose -f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml --profile e2e up -d mock-realtime` → healthy in ~6s ✅
- `grep -E 'handshakeTimeout.*10000' apps/api/src/routes/realtime.ts` → 1 match ✅
- `grep -E 'wsReconnect.*false' apps/api/src/routes/realtime.ts` → 2 matches (1 code, 1 explanatory comment) ✅
- `test -f tests/e2e/mock-realtime/Dockerfile` ✅
- `test -f compose/e2e/docker-compose.e2e.yml` ✅

## Self-Check: PASSED

All claimed files present:
- FOUND: tests/e2e/mock-realtime/server.ts
- FOUND: tests/e2e/mock-realtime/server.test.ts
- FOUND: tests/e2e/mock-realtime/cli.ts
- FOUND: tests/e2e/mock-realtime/Dockerfile
- FOUND: tests/e2e/mock-realtime/vitest.config.ts
- FOUND: tests/e2e/mock-realtime/package.json (modified)
- FOUND: tests/e2e/mock-realtime/tsconfig.json (modified)
- FOUND: compose/e2e/docker-compose.e2e.yml
- FOUND: apps/api/src/routes/realtime.ts (modified)
- FOUND: apps/api/src/routes/realtime.test.ts (modified)

All claimed commits present:
- FOUND: a195348 (Task 1 RED)
- FOUND: b0a6deb (Task 1 GREEN)
- FOUND: 188f946 (Task 2)
- FOUND: 097a694 (Task 3 RED)
- FOUND: 285886c (Task 3 GREEN)
