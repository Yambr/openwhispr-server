---
phase: 06-observability-ops-hardening-workers
plan: 04
subsystem: kubelet-probes-and-scale-tag
tags: [obs-05, scale-01, health-probes, lru-cache, x-served-by, d-p1, d-p2, d-p3]
dependency_graph:
  requires:
    - 06-01-SUMMARY.md (RED stubs for dep-check.test / probes.test / served-by.test)
    - 06-CONTEXT.md (D-P1, D-P2, D-P3)
    - 06-RESEARCH.md §5 (lru-cache choice + promise-dedup pattern)
  provides:
    - apps/api/src/lib/dep-check.ts — makeDepCheck() factory with 5s LRU + inflight Map dedup
    - apps/api/src/routes/probes.ts — /livez (no deps), /readyz (deps), /startupz (boot flag), /api/health (deprecation alias)
    - apps/api/src/plugins/served-by.ts — onSend hook attaching x-served-by header per response
    - apps/api/src/index.ts wiring — servedByPlugin registered before routes; probes registered last; markStartupComplete() flips /startupz to 200 after app.ready()
  affects:
    - apps/api/src/routes/index.ts (drops healthRoutes from registration list; /api/health now served by registerProbes)
    - apps/api/src/__tests__/entrypoint-db-shape.test.ts (stubs new modules so Phase 02.6 D-01 witness stays narrowly scoped)
    - Plan 06-09 (rate-limit) — probes already carry `config.rateLimit=false` so back-edit is unnecessary
    - Plan 06-12 (horizontal-scale e2e) — x-served-by header now present; e2e can flip GREEN against `--scale api=2`
tech_stack:
  added: [lru-cache@^11.3.6]
  patterns:
    - "5s TTL cache + in-flight Map promise dedup for upstream probe collapse"
    - "kubelet-canonical three-probe split (live/ready/startup) — liveness decoupled from dep health"
    - "probe() is total: errors captured into DepResult, .then chain branch-free → 100% coverable"
    - "RFC 8594 Deprecation + Link successor-version headers on /api/health alias"
    - "onSend hook attaches replica-tag header; existing upstream tag preserved"
key_files:
  created:
    - apps/api/src/lib/dep-check.ts
    - apps/api/src/routes/probes.ts
    - apps/api/src/plugins/served-by.ts
  modified:
    - apps/api/src/lib/dep-check.test.ts (RED→GREEN, 13 tests)
    - apps/api/src/routes/probes.test.ts (RED→GREEN, 17 tests)
    - apps/api/src/plugins/served-by.test.ts (RED→GREEN, 5 tests)
    - apps/api/src/index.ts (servedByPlugin + registerProbes + markStartupComplete wiring; depCheck field on BuildAppOptions; destructure pool from makeAppDb)
    - apps/api/src/routes/index.ts (drop healthRoutes from registration list)
    - apps/api/src/__tests__/entrypoint-db-shape.test.ts (stub the three new Plan 06-04 modules)
    - apps/api/package.json (add lru-cache@^11.3.6 direct dep)
    - pnpm-lock.yaml
decisions:
  - "lru-cache 11 uses perf_now() for TTL bookkeeping, NOT Date.now() — vi.setSystemTime() does NOT expire entries. The TTL-expiry test sleeps 5.2s in real-timer mode rather than swap to a configurable-TTL constructor that would dilute the production-vs-test contract."
  - "probe() captures every error path into the DepResult shape; the awaited promise never rejects. We exploit that totality to keep the inflight bookkeeping branch-free (single .then arm) and 100% coverable — adding a defensive .catch arm would be unreachable code that drags F/L coverage below 90% with no testable behavior to compensate."
  - "/api/health is served by registerProbes() (Plan 06-04) at buildApp scope, not by routes/health.js. The healthRoutes barrel export remains for the rate-limit-health-exempt.test back-compat consumer; the route plugin is just no longer added to buildAllRoutes's plugin array (single-source-of-truth for the health surface)."
  - "x-served-by hostname is resolved ONCE at plugin-load time (os.hostname() is cheap but allocating per-response at SCALE-01's 1000 concurrent budget is wasteful). On Kubernetes, kubelet sets HOSTNAME to the pod name, and os.hostname() reads it on Linux — pod-granular tagging for free without a downward-API env mount."
  - "/api/health emits RFC 8594 Deprecation:true + Link:</livez>; rel=\"successor-version\" so contract consumers (desktop client, monitoring) get a standards-track migration signal alongside the unchanged {status:'ok'} body."
metrics:
  duration: ~70min
  completed: 2026-05-11
  files_created: 3
  files_modified: 8
  commits: 3
  tests_added: 35  # 13 dep-check + 17 probes + 5 served-by
  tests_passing: 35/35 (100%)
  coverage:
    "apps/api/src/lib/dep-check.ts": "100/100/100/100 (L/B/F/S)"
    "apps/api/src/routes/probes.ts": "100/100/100/100 (L/B/F/S)"
    "apps/api/src/plugins/served-by.ts": "100/100/100/100 (L/B/F/S)"
---

# Phase 6 Plan 04: Kubelet Health Probes + x-served-by Replica Tag Summary

Three-probe kubelet-canonical health surface (`/livez` zero-deps, `/readyz` PG+Valkey+LiteLLM with 5s LRU cache + inflight dedup, `/startupz` boot flag) plus a tiny `x-served-by` Fastify plugin so the Plan 06-12 horizontal-scale e2e can verify Traefik round-robin distribution.

## What Landed

| Module | Surface | Behavior |
|--------|---------|----------|
| `apps/api/src/lib/dep-check.ts` | `makeDepCheck({pg, valkey, litellmUrl})` → `(name) => Promise<DepResult>` | `lru-cache@11` (max:16, ttl:5_000) + in-flight `Map<DepName, Promise>` dedup. `probe()` is total; errors captured into `{ok:false, latency_ms, error}` |
| `apps/api/src/routes/probes.ts` | `GET /livez`, `GET /readyz`, `GET /startupz`, `GET /api/health` | All four routes `config.auth=false` + `config.rateLimit=false`. `/api/health` carries RFC 8594 Deprecation + Link successor-version headers. `markStartupComplete()` flips `/startupz` 503→200 after `app.ready()` |
| `apps/api/src/plugins/served-by.ts` | Fastify `onSend` hook | Attaches `x-served-by: ${os.hostname()}` to every reply; preserves an upstream-provided tag if present |
| `apps/api/src/index.ts` wiring | `BuildAppOptions.depCheck?: DepCheck` | Production wires `makeDepCheck({pg: appPool, valkey: redis, litellmUrl: process.env.LITELLM_BASE_URL})`; `servedByPlugin` registered as step 2b (before routes); probes registered last; `markStartupComplete()` called after `app.ready()` |

## Tests Flipped GREEN

| Test File | Tests | Approach |
|-----------|-------|----------|
| `apps/api/src/lib/dep-check.test.ts` | 13/13 | testcontainers postgres:17-alpine + valkey/valkey:8-alpine (real services per CLAUDE.md "no mocks of internal logic") + in-process `http.Server` LiteLLM stand-in (real network boundary) |
| `apps/api/src/routes/probes.test.ts` | 17/17 | bare Fastify + deterministic `depCheck` fake — concerned with routing + status-code + body-shape only |
| `apps/api/src/plugins/served-by.test.ts` | 5/5 | bare Fastify + `app.inject()` — verifies header on every reply + upstream-preservation invariant |

**Coverage on each new file:** 100/100/100/100 (lines / branches / functions / statements).

## Commits

- `e5201cd feat(06-04): dep-check library with 5s LRU cache + promise dedup (D-P2)`
- `2405538 feat(06-04): kubelet probes + x-served-by plugin (D-P1, D-P3)`
- `baac5f7 feat(06-04): wire probes + served-by + dep-check into buildApp (OBS-05)`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] `entrypoint-db-shape.test.ts` regressed after wiring**
- **Found during:** Task 1, after wiring `registerProbes` into `buildApp`
- **Issue:** The test mocks `fastify` to return a minimal fake app object lacking `app.route()`. After `buildApp` started calling `registerProbes` (which uses `app.route({...})`), the test crashed with `TypeError: app.route is not a function`.
- **Fix:** Added `vi.mock("../routes/probes.js", ...)` + `vi.mock("../plugins/served-by.js", ...)` + `vi.mock("../lib/dep-check.js", ...)` stubs. Test stays narrowly scoped to the Phase 02.6 D-01 witness (no incidental coupling to the Phase 6 probe surface).
- **Files modified:** `apps/api/src/__tests__/entrypoint-db-shape.test.ts`
- **Commit:** `baac5f7`

**2. [Rule 3 — Blocker] `/api/health` double-registration**
- **Found during:** Task 1, while wiring `registerProbes` into `buildApp`
- **Issue:** Both `routes/health.js` (registered via `buildAllRoutes`) and `routes/probes.js` define `GET /api/health`. Fastify rejects duplicate routes at boot.
- **Fix:** Dropped `healthRoutes` from the `buildAllRoutes` plugin array. The `healthRoutes` symbol remains in the barrel export so the existing `rate-limit-health-exempt.test.ts` still imports it directly (that test mounts it on a bare Fastify, no collision).
- **Files modified:** `apps/api/src/routes/index.ts`
- **Commit:** `baac5f7`

**3. [Rule 1 — Bug] Defensive `.catch` arm in `dep-check.ts` dragged F+L coverage below 90%**
- **Found during:** Task 1, coverage verification
- **Issue:** Initial implementation had a `probe().then(_, err => { inflight.delete(name); return {ok:false, ...} })` defensive catch arm. Since `probe()` itself captures every error into a `DepResult`, the catch arm is structurally unreachable — but v8 coverage flagged it: F=80% (4/5 functions), L=93.93%.
- **Fix:** Removed the defensive `.catch` arm. The contract is now explicit: `probe()` is total; the `.then` chain is single-arm. If a future refactor lets an unhandled rejection escape `probe()`, the test suite will surface it as a real failure rather than silently swallowing it here.
- **Files modified:** `apps/api/src/lib/dep-check.ts`
- **Commit:** `e5201cd` (folded into the dep-check commit before the coverage run)

### Implementation Decisions

**TTL test uses real timers, not fake timers.** lru-cache@11 uses `perf_now()` for TTL bookkeeping, not `Date.now()`. `vi.setSystemTime()` does NOT expire entries. The `re-checks after TTL expiry` test sleeps 5.2s in real-timer mode rather than introducing a configurable-TTL constructor that would dilute the production-vs-test contract. Total dep-check suite runtime ~9s including the sleep.

**hostname resolved once at plugin load.** `os.hostname()` is cheap but allocating per-response at SCALE-01's 1000 concurrent budget is wasteful. On Kubernetes, kubelet sets `HOSTNAME` to the pod name, which `os.hostname()` reads on Linux — pod-granular tagging for free without a downward-API env mount.

## Threat Surface

No new threat-relevant surface beyond what was already enumerated in the plan's `<threat_model>`:

- **T-readiness-cascade (mitigate)** — `/livez` zero-deps invariant locked by 4 unit tests; even with PG/Valkey/LiteLLM DOWN, `/livez` returns 200 → kubelet cannot cascade-restart.
- **T-06-09 (accept)** — probe timing reveals dep latency. Indirectly mitigated by the 5s cache obscuring exact RT.
- **T-06-10 (mitigate)** — thundering herd. Verified by the `dedupes concurrent probes — one upstream call per cache window` test (4 parallel callers → 1 upstream hit).

## Acceptance Criteria

- [x] `apps/api/src/lib/dep-check.ts` exists with `LRUCache` + `ttl: 5_000` + in-flight `Map` dedup
- [x] `apps/api/src/routes/probes.ts` registers `/livez`, `/readyz`, `/startupz`, `/api/health` alias
- [x] `grep -c "rateLimit: false" apps/api/src/routes/probes.ts` ≥ 4
- [x] `apps/api/src/plugins/served-by.ts` uses `os.hostname()` + `onSend` hook
- [x] `apps/api/src/index.ts` imports & registers servedByPlugin AND probes
- [x] `grep -c 'markStartupComplete' apps/api/src/index.ts` ≥ 1
- [x] The 3 RED stubs no longer throw `Error('not yet implemented')`
- [x] Coverage on `dep-check.ts` ≥ 90/90/90/90 — actual 100/100/100/100
- [x] Coverage on `probes.ts` ≥ 90/90/90/90 — actual 100/100/100/100
- [x] Coverage on `served-by.ts` ≥ 90/90/90/90 — actual 100/100/100/100

The `curl http://localhost:3000/...` integration assertions in the plan's acceptance criteria are exercised by the `tests/e2e/probes-dependency.test.ts` e2e suite, which Plan 06-12 wires to a real `docker compose --profile default up` stack. That e2e remains gated on `E2E=1` and is the responsibility of Plan 06-12 (per the test file's own header comment).

## Deferred Items

**Pre-existing typecheck errors in unrelated files (out of scope per executor scope-boundary):**
- `src/middleware/auth-callback-route-handler.ts` (Fastify http-proxy type mismatch — predates Plan 06-04)
- `src/routes/test-only.test.ts` (exactOptionalPropertyTypes issues — predates Plan 06-04)
- `src/routes/tokens/_call-provider.ts`, `src/routes/tokens/openai-realtime.test.ts` (predates Plan 06-04)
- `src/routes/transcriptions/{batch-create,create}.ts` (CloudTranscriptionRow index signature — predates Plan 06-04)

**Pre-existing RED stubs awaiting their owning plans:**
- `apps/api/src/plugins/rate-limit.test.ts` — Plan 06-08/06-09
- Multiple `*.integration.test.ts` files in `apps/api/src/routes/` — env-dependent, separate execution context
- `apps/api/scripts/check-default-secrets.test.ts` — DATA-06 plan

## Self-Check: PASSED

All claimed files exist on disk:

- FOUND: apps/api/src/lib/dep-check.ts
- FOUND: apps/api/src/lib/dep-check.test.ts
- FOUND: apps/api/src/routes/probes.ts
- FOUND: apps/api/src/routes/probes.test.ts
- FOUND: apps/api/src/plugins/served-by.ts
- FOUND: apps/api/src/plugins/served-by.test.ts

All commits exist in history:

- FOUND: e5201cd feat(06-04): dep-check library with 5s LRU cache + promise dedup (D-P2)
- FOUND: 2405538 feat(06-04): kubelet probes + x-served-by plugin (D-P1, D-P3)
- FOUND: baac5f7 feat(06-04): wire probes + served-by + dep-check into buildApp (OBS-05)
