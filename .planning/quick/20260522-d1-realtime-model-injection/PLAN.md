---
quick_id: 260522-d1
slug: d1-realtime-model-injection
date: 2026-05-22
status: planned
---

# D1 — `/v1/realtime` server-side model injection (provider-agnostic realtime)

## Problem

`WSS /v1/realtime` (`apps/api/src/routes/realtime.ts`) is a transparent
WS passthrough. The OpenAI Realtime protocol requires the CLIENT to send
a `model` (e.g. `gpt-realtime`) in its `session.update` frame. So the
immutable desktop client carries an OpenAI-specific model name — and
breaks the moment the backend is swapped to Speaches (which expects
`Systran/faster-whisper-*`). The model identifier is an operator /
infrastructure detail; it must not live in a backend-agnostic client.

## Decision — Option B (advisor-confirmed): force `?model=` server-side

LiteLLM routes `/v1/realtime` on the **`?model=` query parameter**, NOT
the in-band `session.update` frame. `realtime.ts` ALREADY rewrites the
URL server-side — its `preHandler` forces `?user=<id>` and overwrites
any caller-supplied value (threat T-03-07-04). Apply the identical
mechanism to `?model=`: the proxy forces `?model=<env-driven alias>`,
overwriting whatever the client sent (or omitted). The model becomes
pure operator config; OpenAI→Speaches is a one-line `litellm_config`
edit, zero client change.

Rejected — Option A (parse/rewrite the `session.update` WS frame):
couples Fastify to the OpenAI Realtime wire-protocol version, adds JSON
parsing on the hot audio path, creates an upgrade-smuggling surface.
A passthrough proxy must stay payload-opaque.

## Implementation

### File 1 — `apps/api/src/routes/realtime.ts`

- Add a `realtimeModel: string` field to `RealtimeDeps` (injected, NOT
  read from `process.env` at register time — mirror the `masterKey`
  testable-deps pattern).
- In the `preHandler`, where `?user=` is forced on `req.raw.url` (the
  `u.searchParams.set("user", user.id)` line), add
  `u.searchParams.set("model", deps.realtimeModel)`. This OVERWRITES any
  client-supplied `?model=` — same tamper-normalization as `?user=`.
- Update the file-header threat-model comment: caller-supplied `?model=`
  is normalized to the server-configured alias (new T-03-07-05 facet).

### File 2 — `apps/api/src/routes/index.ts`

- Where `buildRealtimeRoutes` / `RealtimeDeps` is constructed, pass
  `realtimeModel` from a new env var `LITELLM_REALTIME_MODEL` (default
  `"realtime-default"`). Read it via the same config seam the route
  registration already uses for litellm wiring — keep `process.env`
  reads in `index.ts` / `config/*` only (LOCKER-01).

### File 3 — env example + config

- `.env.example` (and `.env.slim.example` if separate): add
  `LITELLM_REALTIME_MODEL=realtime-default` with a comment — the
  server-injected realtime alias; operators retarget the alias in
  `litellm_config.yaml`, not here.

### File 4 — `compose/litellm/litellm_config.yaml`

- Add a `model_name: realtime-default` entry — `mode: realtime`,
  `model: openai/gpt-realtime`, `api_key: os.environ/OPENAI_API_KEY`.
  KEEP the existing `gpt-realtime` / `gpt-realtime-mini` /
  `gpt-4o-realtime-preview` entries as extra aliases (backward compat).
- `compose/litellm/litellm_config.local-speaches.yaml` +
  `litellm_config.realistic.yaml`: add a `realtime-default` entry
  pointing at the Speaches realtime upstream (`api_base`
  `http://speaches:8000/v1`, `mode: realtime`, the faster-whisper
  realtime model id Speaches expects, `api_key: speaches-dummy`). This
  one entry IS the OpenAI→Speaches switch.
- `compose/litellm/litellm_config.contract.yaml`: add a
  `realtime-default` entry mirroring the existing realtime contract
  entry (realtime does not honor `mock_response` — see
  `docs/litellm-mock-mode.md` Realtime caveat; just the alias presence).

### File 5 — docs

- `docs/litellm-target-spec.md` §Realtime WSS — document that the
  realtime model alias is server-injected via `LITELLM_REALTIME_MODEL`
  and is NOT client-supplied; the client sends no model.

## TDD order (RED → GREEN — same atomic commit)

1. RED unit (`apps/api`, `realtime.test.ts` or the preHandler unit
   test): the preHandler rewrites `req.raw.url` to carry
   `?model=<deps.realtimeModel>`; a client-supplied `?model=evil` in the
   incoming URL is OVERWRITTEN (mirror the existing `?user=` tamper
   test). `?user=` injection still works (no regression).
2. RED unit: `buildRealtimeRoutes` requires `realtimeModel` in
   `RealtimeDeps` (type + runtime).
3. GREEN — implement Files 1-5. ≥90/90/90/90 on the diff.

## Antipatterns to avoid

- ❌ Parsing / rewriting the `session.update` WS application frame.
- ❌ `process.env` read inside `realtime.ts` at plugin register time —
  inject via `RealtimeDeps` (LOCKER-01 + testable-deps pattern).
- ❌ Trusting a client-supplied `?model=` — overwrite it server-side.
- ❌ Hardcoding the alias as a route literal — env-driven default.
- ❌ Dropping route `schema` / `config.rateLimit` (LOCKER-04 — note
  `/v1/realtime` rate-limit posture stays as-is).

## Verification

- Lockers green (01/02/03/04, tdd, english).
- `docker compose up -d --build api`.
- Live WS handshake: `wss://localhost:4000/v1/realtime` with a real
  Better Auth bearer → OPEN; capture the upstream-bound URL (debug log /
  litellm access log) and confirm it carries `?model=realtime-default`
  AND `?user=<id>`, regardless of any client-sent `?model=`.
- `litellm_config.local-speaches.yaml` parses and contains a
  `realtime-default` entry pointing at the Speaches upstream.
- After landing: notify the client agent — the desktop should send NO
  model on `/v1/realtime` (server injects it); update the client
  `SERVER-REQUIREMENTS.md` realtime card.
