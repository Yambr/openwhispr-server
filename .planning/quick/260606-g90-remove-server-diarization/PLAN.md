---
quick_id: 260606-g90
slug: remove-server-diarization
date: 2026-06-06
status: in-progress
---

# Quick 260606-g90 — Remove server-side diarization entirely

## Goal

Owner decision: diarization stays client-local (desktop does sherpa-onnx). The server
`POST /v1/audio/diarization` is architecturally incompatible with notes-recording (streaming
audio, no single file, local speaker-profile DB) AND not called by the client for any flow
(verified: grep of /Users/nick/openwhispr/src = 0 hits). REMOVE it entirely. No version bump,
no release, no Chart.yaml appVersion change.

## RISK PRE-CLEARED by orchestrator (do not re-litigate)
- `BuildAppOptions.redis` (CR-01) is **diarization-ONLY** (index.ts:726-731 "forward the Valkey
  client + mockDiarization so /v1/audio/diarization is registered"). It is threaded ONLY into
  buildAllRoutes for the diarization route.
- rate-limit has its OWN redis (rate-limit.ts:44-46 "If redis provided in opts... Otherwise
  build from VALKEY_URL") — INDEPENDENT of `opts.redis`. Removing `opts.redis` does NOT touch
  rate-limit. Safe.
- `RedisLike` type is exported from idempotency-cache.js (being deleted). Since the `redis?`
  field is also removed, the type import goes away with it. If anything else still needs
  RedisLike, the executor must relocate the type — but audit says diarization is the sole user.
- idempotency-cache.ts + pyannote-client.ts = sole-user diarization (deletable).
- DiarizationResponse barrel-exported from wire-schemas/src/index.ts:15; no non-diarization
  importer.
- contract-tests/src/negative-matrix.ts enumerates /v1/audio/diarization → BLOCKER if left
  (contract-test asserts route exists). Must remove.

## SAFE TO DELETE (sole-purpose)
- apps/api/src/routes/diarization.ts
- apps/api/src/lib/pyannote-client.ts
- apps/api/src/lib/idempotency-cache.ts
- apps/api/src/config/diarization.ts
- packages/wire-schemas/src/diarization.ts

## DELETE (diarization tests — grep `diariz` across tests/, apps/api/tests/, packages/*/tests to catch stragglers)
- apps/api/tests/unit/routes/__tests__/diarization.test.ts
- apps/api/tests/unit/routes/diarization/ (whole dir)
- apps/api/tests/unit/config/diarization.test.ts
- apps/api/tests/unit/__tests__/build-app-diarization-wiring.test.ts
- tests/e2e/diarization.e2e.test.ts
- tests/e2e-cjm/steps/diarization.steps.ts + steps/__tests__/diarization.steps.test.ts
- tests/e2e-cjm/features/diarization.feature(.spec.js)
- packages/contract-tests/tests/unit/diarization.test.ts

## EDIT (remove refs — grep each symbol for CURRENT lines)
- apps/api/src/routes/index.ts — DiarizationConfig import, buildDiarizationRoutes/DiarizationDeps
  import, AllRoutesDeps fields redis?/mockDiarization?/diarizationConfig?, the
  `if (deps.redis){...buildDiarizationRoutes...}` block, buildDiarizationRoutes export.
- apps/api/src/index.ts — loadDiarizationConfigFromEnv/DiarizationConfig import, RedisLike import
  (from idempotency-cache), BuildAppOptions redis?/mockDiarization?/diarizationConfig? (+JSDoc),
  the diarization Valkey client construction block, `const mockDiarization=...`,
  `buildOpts.diarizationConfig=loadDiarizationConfigFromEnv()`, the redis/mockDiarization/
  diarizationConfig thread-through into buildAllRoutes (the `...(opts.redis?{redis}:{})` etc),
  diarization mentions in comments/log strings. DO NOT remove the rate-limit redis or its
  VALKEY_URL handling.
- packages/wire-schemas/src/index.ts — remove `export * from "./diarization.js"`.
- packages/contract-tests/src/negative-matrix.ts — remove /v1/audio/diarization entry.
- packages/contract-tests/tests/unit/missing-key-503.test.ts — remove diarization 503 case.
- packages/contract-tests/tests/unit/litellm-base-url-override.test.ts — remove diariz refs.
- apps/api/src/routes/capabilities.ts — verify no diariz ref (likely none → no edit).

## EDIT (env / compose / chart / docs — drop PYANNOTE_*, SPEACHES_DIARIZATION_*, MOCK_DIARIZATION)
- docker-compose.yml, compose/docker-compose.contract-test.yml, .embedded-litellm.yml,
  .load-test.realistic.yml
- charts/openwhispr/templates/{secrets,api-deployment,externalsecret}.yaml,
  charts/openwhispr-server/templates/secrets.yaml + values.yaml
- .env.full.example, .env.e2e.example, .env.embedded.example, .env.slim.example
- docs/** (operations.md, self-hosting.md, speaches-audio.md, wire-contracts-phase-3.md,
  security.md, litellm-target-spec.md), tests/e2e-cjm/GAPS.md (G3 → "removed, client-local").
  grep `diariz`, `PYANNOTE`, `SPEACHES_DIARIZATION`, `MOCK_DIARIZATION` across docs/.

## Constraints
- `pnpm --filter @openwhispr/api typecheck` MUST be clean after edits (dangling imports = main
  failure mode).
- contract-test + affected api unit suites GREEN. dead-export linter (LOCKER-04) clean — removing
  buildDiarizationRoutes export must leave no dangling ref + introduce no new dead export.
- NO version/tag/release/Chart.yaml appVersion change. No type-suppression. English-only.
  commitlint header ≤100, body ≤100. No --no-verify.
- Land atomic commit(s) on main locally; orchestrator handles test:all evidence + push.
  Suggested split: (1) code+tests removal, (2) env/compose/chart/docs cleanup.

## Done when
- grep -rn "diariz" apps/api/src packages/*/src → 0; same for buildDiarizationRoutes / pyannote /
  PyannoteClient / idempotency-cache / DiarizationResponse.
- grep "/v1/audio/diarization" → only historical-planning/changelog mentions.
- typecheck GREEN; contract-test GREEN; api unit suites GREEN; tree clean.
