---
quick_id: 260521-r24
slug: r24-ssrf-explicit-dispatcher
date: 2026-05-21
status: planned
---

# R24 — LiteLLM client must hold an explicit SSRF-wrapped dispatcher (Cloud-mode 500 blocker)

## Problem (live-confirmed)

Every Cloud-plane route (`/api/transcribe`, `/api/reason`, `/api/agent/*`)
returns **500** with `SsrfDispatcherNotInstalledError`. api-1 logs show
two such errors (`chatCompletions` + `audioTranscriptions`), then none —
i.e. the SSRF marker is present at boot and *missing by first LiteLLM
call*. `installGlobalSSRF()` runs correctly at `index.ts:138`; the boot
sequence is clean.

`assertSsrfInstalled()` reads `getGlobalDispatcher()[SSRF_WRAPPED_MARKER]`.
undici 7.25.0 stores the global dispatcher in
`globalThis[Symbol.for('undici.globalDispatcher.1')]` (process-global —
duplicate undici copies are NOT the cause). The marker is a
**non-enumerable own property of the Agent**; any code that calls
`setGlobalDispatcher(newAgent)` after boot silently drops it. The exact
clobbering caller is not pinned down — and **that is the point**: a fix
that depends on "nobody ever replaces the global dispatcher" is a
standing race.

## Decision — Option (a): explicit per-client dispatcher (advisor + client-agent confirmed)

`buildLitellmClient` already exposes an `opts.request` injection seam.
Bind it, at boot in trusted code, to the SSRF-wrapped Agent so the
LiteLLM client **never consults the mutable global dispatcher**. Race
becomes irrelevant.

Rejected: (b) reactive re-install in `ssrfGate` — treats the symptom,
leaves the race; and the global is shared with Better Auth / web-search
adapters, so a re-install there could fight another component.

## Implementation

### File 1 — `apps/api/src/bootstrap.ts`: expose the built dispatcher

`installGlobalSSRF()` currently builds the dispatcher and discards the
reference after `setGlobalDispatcher`. Add a sibling exported factory
`buildSsrfDispatcher(overrides?)` that returns the `Dispatcher` (same
config-loading path), and have `installGlobalSSRF` call it internally so
there is ONE construction path. Export a `getInstalledSsrfDispatcher()`
or simply have `index.ts` call `buildSsrfDispatcher()` once and use it
for BOTH `setGlobalDispatcher` (keep global install for Better Auth /
web-search) AND the LiteLLM `request` binding. Pick the minimal shape:
`installGlobalSSRF` returns the `Dispatcher` it installed.

### File 2 — `apps/api/src/index.ts`: bind LiteLLM's `request` to the SSRF dispatcher

- Capture the dispatcher: `const ssrfDispatcher = installGlobalSSRF();`
  (line ~138 — `installGlobalSSRF` now returns the installed dispatcher).
- At LiteLLM client construction (~line 737), pass an explicit `request`:
  `buildLitellmClient(litellmConfig, { request: (url, opts) =>
  undiciRequest(url, { ...opts, dispatcher: ssrfDispatcher }) })`.
  Import `request as undiciRequest` from `undici` at the top of index.ts
  (or a tiny helper module to keep index.ts lean).
- The bound `request` is created by trusted boot code, not per-call /
  not user-derived — this is NOT the per-call-dispatcher bypass that
  T-08.2-01 warns against (that warning is about exposing a dispatcher
  knob on the *public method surface*; the boot-time injection seam is
  the sanctioned path, already used by tests).

### File 3 — `packages/litellm-client/src/index.ts`: clarify the seam

- `usingGlobalDispatcher = opts.request === undefined` already skips
  `assertSsrfInstalled()` when `request` is injected — CORRECT, keep.
  But the injected `request` must itself be SSRF-safe. Update the
  `BuildLitellmClientOptions.request` JSDoc + `assertSsrfInstalled`
  JSDoc: the injection seam has TWO sanctioned uses — (1) test mocking,
  (2) **production boot-time binding to an explicit SSRF-wrapped
  dispatcher** (R24). The assertion-skip is safe in both because the
  injected fn owns its egress path.
- No method-surface change. `ssrfGate()` stays — it still protects the
  default (no-injection) path used by any future caller.

### File 4 — worker parity check

`apps/worker` builds no LiteLLM client today (grep-confirmed) — NO
worker change needed for R24. If a future worker LiteLLM path lands it
MUST use the same explicit-dispatcher injection (note it in the worker
plan, do not wire speculatively now).

## R25 — fail-fast readiness (same task, separate commits)

### File 5 — NEW `apps/api/src/routes/readiness.ts`: real readiness probe

`/api/ready` (NOT `/api/health` — that stays liveness). `config: {
auth: false, rateLimit: false }` (allowlisted `/api/ready` URL per
LOCKER-04). Checks, each a hard 200-or-503:
- SSRF dispatcher: `getGlobalDispatcher()[Symbol.for('openwhispr.ssrf-wrapped')]`
  is truthy — **catches runtime clobbering**, not just boot.
- LiteLLM client constructed (the `litellm` binding in buildApp is
  defined — thread it through via a readiness-state object or a
  `buildApp` decorator).
- Upstream reachable: a cheap `litellm` health/models ping under a
  short timeout (≤ 2s); degrade to 503 with a reason field on failure.
Response body: `{ status: 'ready'|'not_ready', checks: {...} }`.
Each check failure → 503. Never throws.

### File 6 — `compose/` healthcheck → `/api/ready`

Repoint the api service `healthcheck.test` from `/api/health` to
`/api/ready` so a container that cannot serve Cloud traffic is marked
`unhealthy` and pulled from rotation. Keep `/api/health` for the
liveness/restart probe (k8s `livenessProbe` semantics) — document the
split in the compose comment.

### File 7 — boot fail-fast for non-optional bootstrap

`installGlobalSSRF()` is a non-optional bootstrap step. Today a thrown
error there is uncaught → process exits non-zero (acceptable). VERIFY
this: if `installGlobalSSRF` can fail *silently* (e.g. config load
returns a degraded value), make it throw on a non-installable state so
the process crash-loops instead of serving 500s. Do NOT add a
NODE_ENV branch (LOCKER-01).

## R26 — containerised Cloud e2e (same task or fast-follow)

### File 8 — NEW `tests/e2e/cloud-plane.e2e.test.ts`

`E2E=1`, boots the real `docker compose` stack (hermetic mock-LiteLLM
acceptable per CLAUDE.md — a mock at the *network boundary*, not a mock
of internal logic). Flow: `docker compose up` → sign-up → verify →
sign-in → `get-session` → `POST /api/transcribe` (small fixture audio)
asserts **200** → `POST /api/reason` asserts 200 → `POST /api/agent/stream`
asserts 200 + NDJSON. This is the test that would have caught R24:
in-memory `buildApp` tests never run `installGlobalSSRF`, so its absence
was invisible. Gate via `make e2e-test`. Wire into the CI e2e job.

## TDD order (RED → GREEN — constitutional, tests in the same commit)

1. RED unit (`packages/litellm-client`): `buildLitellmClient` with an
   injected `request` does NOT call `assertSsrfInstalled` (no throw even
   when the global dispatcher lacks the marker); a no-injection client
   still throws on a bare global. Assert the injected `request` is the
   one actually invoked.
2. RED unit (`apps/api`, bootstrap): `installGlobalSSRF()` returns a
   `Dispatcher` carrying `SSRF_WRAPPED_MARKER`; `buildSsrfDispatcher()`
   returns an equivalently-marked dispatcher.
3. RED integration (`apps/api`): build the LiteLLM client the way
   `index.ts` does (explicit `request` bound to the SSRF dispatcher),
   then overwrite the global dispatcher with a plain `new Agent()` to
   simulate the clobber → `chatCompletions` / `audioTranscriptions`
   still succeed (no `SsrfDispatcherNotInstalledError`). Mock LiteLLM at
   the HTTP boundary.
4. RED unit (`apps/api`): `/api/ready` returns 503 when the global
   dispatcher lacks the SSRF marker; 200 when all checks pass.
5. RED e2e (File 8) — full Cloud-plane flow, 200s.
6. GREEN — implement Files 1-8. ≥ 90/90/90/90 coverage on the diff.

## Antipatterns to avoid

- ❌ Reactive `setGlobalDispatcher` re-install inside `ssrfGate` /
  request hot path (option b — race remains, fights other components).
- ❌ Exposing a per-call `dispatcher` knob on `LitellmClient`'s public
  method surface (T-08.2-01 — that IS a real bypass; the fix is a
  boot-time `opts.request`, not a per-request param).
- ❌ `as any` / `@ts-ignore` (LOCKER-02) — narrow single `as` only,
  matching the existing `assertSsrfInstalled` style.
- ❌ `NODE_ENV` branch anywhere outside config/bootstrap (LOCKER-01).
- ❌ Dropping `schema` / `config.rateLimit` on the new `/api/ready`
  route (LOCKER-04 — `/api/ready` is allowlisted for `rateLimit:false`).
- ❌ Mocking internal logic in the e2e — mock LiteLLM only at the HTTP
  boundary (CLAUDE.md no-internal-mocks rule).
- ❌ Speculatively wiring a worker LiteLLM dispatcher (no worker
  LiteLLM client exists today).

## Verification

- All lockers green (01/02/03/04, rls, colocated-tests, tdd, english).
- Rebuild: `docker compose up -d --build api`.
- Live curl against `:4000`, real sign-in bearer (no seed route):
  `POST /api/transcribe` → 200, `POST /api/reason` → 200,
  `POST /api/agent/stream` → 200 NDJSON.
- `curl /api/ready` → 200 `{status:'ready'}`; confirm compose marks api
  `healthy` only when `/api/ready` passes.
- e2e `make e2e-test` green for the new Cloud-plane test.
- After landing: update client `SERVER-REQUIREMENTS.md` §R24/R25/R26 to
  CLOSED with commit SHAs; notify the client agent to re-run live.
