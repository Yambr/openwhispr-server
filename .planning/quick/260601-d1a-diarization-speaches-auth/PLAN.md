# Quick 260601-d1a — Speaches diarization passthrough sends Authorization

## Problem

`apps/api/src/routes/diarization.ts` — the Speaches diarization branch
(`handleSpeachesDiarization`, gated by `SPEACHES_DIARIZATION_URL`) makes its
outbound `POST ${url}/v1/audio/diarization` with NO `Authorization` header
(line ~552). In the bundled docker-compose stack the Speaches container is
open, so this works. But in a corporate deploy where `SPEACHES_DIARIZATION_URL`
points at an internal LiteLLM gateway exposing `/v1/audio/diarization` via
`pass_through_endpoints` with `auth: true`, the gateway validates a virtual
key — so OpenWhispr gets **401** and diarization is dead, even though STT and
realtime (which route through `litellm-client`'s `authHeaders()`) work fine.

## Fix (what / where / how)

- **Where:** `POST ${SPEACHES_DIARIZATION_URL}/v1/audio/diarization`
- **How:** add `Authorization: Bearer <key>` to the same fetch.
- **Body unchanged:** multipart `model` + `file`.

### Key source (precedence — reuses litellm-client HI-2)

1. `SPEACHES_DIARIZATION_API_KEY` (explicit override when the diarization
   gateway differs from the LLM gateway).
2. Fallback `LITELLM_VIRTUAL_KEY`, then `LITELLM_MASTER_KEY` — read DIRECTLY,
   NOT via `loadLitellmConfigFromEnv()` (which THROWS when neither litellm key
   is set; that would break the open-Speaches load-test profile where
   `SPEACHES_DIARIZATION_URL` is set but no litellm key exists).
3. None set → no header (back-compat with bundled open Speaches).

## Tasks (TDD, RED → GREEN, single atomic commit)

1. **RED** route tests (`diarization.test.ts` SPEACHES branch):
   - with `speachesDiarizationApiKey` set → outbound `Authorization: Bearer <key>`;
   - with no key → header absent (back-compat).
2. **RED** redact tests (`redact.test.ts`): `SPEACHES_DIARIZATION_API_KEY` in
   `REDACT_PATHS` + scrubbed in the sentinel sweep.
3. **RED** wiring test (`build-app-diarization-wiring.test.ts`): `buildApp`
   registers the route when `SPEACHES_DIARIZATION_URL` is set but NO litellm
   key exists (regression guard against the `loadLitellmConfigFromEnv` throw).
4. **GREEN** production:
   - `DiarizationDeps.speachesDiarizationApiKey?: string`;
   - `handleSpeachesDiarization` builds headers, conditionally adds bearer;
   - `routes/index.ts` resolves the key via `firstNonEmptyEnv(override, virtual,
     master)` and threads it into the deps;
   - `packages/observability/src/redact.ts` adds `SPEACHES_DIARIZATION_API_KEY`
     (+ `*.` wildcard).
5. Document `SPEACHES_DIARIZATION_API_KEY` in `.env.full.example`.

## Acceptance

`SPEACHES_DIARIZATION_URL=https://llm-api.<corp>` + `LITELLM_VIRTUAL_KEY=sk-…`
→ `POST /v1/audio/diarization` returns 200 with speaker segments, not 401.

## Constraints honored

- Mock only at the network boundary (`speachesFetch` stub); no internal mocks.
- No key logging — added to the redact allowlist with a regression assertion.
- No `loadLitellmConfigFromEnv` call (avoids its required-key throw).
- Tests + production code in the SAME atomic commit (strict TDD).
