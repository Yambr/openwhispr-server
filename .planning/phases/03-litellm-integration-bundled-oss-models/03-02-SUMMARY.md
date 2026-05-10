---
phase: "03"
plan: "02"
slug: spikes-mock-config-fixtures
tags: [litellm, contract-test, fixtures, schemas, coverage, tdd]
requires:
  - 03-01 (litellm service definition in docker-compose.yml — pending)
provides:
  - hermetic LiteLLM contract config (mock_response per chat/audio model)
  - LiteLLM_SpendLogs.metadata propagation spike harness (D-08 / A4)
  - 1-second silent WAV fixture for multipart-upload tests (Plans 03/05/10)
  - Phase 3 zod schemas (TranscribeRequest/Response, ReasonRequest/Response, DiarizationResponse)
  - per-package vitest configs with 90/90/90/90 thresholds (HIGH-3 closure)
affects:
  - Makefile contract-test target (now exports LITELLM_CONFIG_FILE)
  - packages/contract-tests/src/schemas.ts (extended)
  - apps/api/package.json (pg + @types/pg devDependency)
tech_stack:
  added:
    - pg (devDependency on apps/api for spike test)
    - "@types/pg" (devDependency on apps/api)
  patterns:
    - "mergeConfig(rootConfig, ...) per-package vitest configs (Vitest 4 nested-thresholds shape)"
    - "Live-only test pattern via skipIf env-presence guard (LITELLM_BASE_URL/MASTER_KEY/DATABASE_URL)"
key_files:
  created:
    - compose/litellm/litellm_config.contract.yaml
    - tests/unit/litellm-contract-config.test.ts
    - tests/fixtures/audio/sample-1s.wav
    - tests/fixtures/audio/README.md
    - apps/api/src/__tests__/litellm-spike-request-id.test.ts
    - packages/contract-tests/src/__tests__/schemas-phase-3.test.ts
    - apps/api/vitest.config.ts
    - packages/litellm-client/vitest.config.ts
    - packages/data/vitest.config.ts
    - tests/unit/per-package-coverage-thresholds.test.ts
    - .planning/phases/03-litellm-integration-bundled-oss-models/03-PHASE-COVERAGE.md
  modified:
    - Makefile (contract-test target — LITELLM_CONFIG_FILE env)
    - packages/contract-tests/src/schemas.ts (Phase 3 schemas appended)
    - apps/api/package.json (pg + @types/pg devDependency)
decisions:
  - "Realtime entries (mode: realtime) in contract config carry NO mock_response — LiteLLM WSS upgrade short-circuits before mock layer; Plan 07 contract test asserts close-code only (D-12 boundary)."
  - "apps/worker/vitest.config.ts NOT authored here — package does not exist; Plan 03-08 owns its creation in the same commit as its first source file (documented in 03-PHASE-COVERAGE.md)."
  - "Live spike auto-skips on `pnpm test` when LITELLM_BASE_URL/MASTER_KEY/DATABASE_URL are unset; harness still ships in repo so an operator running a live stack can validate D-08/A4 with one command."
metrics:
  duration: "~4 minutes (4 atomic commits)"
  completed: "2026-05-10"
  tests_added: 39 passing + 1 skipped (live spike)
  files_created: 11
  files_modified: 3
---

# Phase 3 Plan 02: Spikes, Mock Config, Fixtures — Summary

Wave-0 fixture + spike + threshold work that unblocks Wave-1 endpoint
plans (03-03..03-06). Hermetic CI for the LiteLLM proxy, request_id
metadata propagation harness for Plan 08's spend ingest, single-source-
of-truth Phase-3 zod schemas, and the per-package coverage floor that
turns Plans 03-03..03-08's `≥90%` claim from aspirational into
machine-enforced.

## Tasks executed

### Task 1 — Hermetic LiteLLM contract config + Makefile env wiring
**Commit:** `d5de18d`

- `compose/litellm/litellm_config.contract.yaml`: every chat/audio
  model (qwen3.6-plus, gemini-3-flash, gpt-4o-mini, whisper-large-v3)
  carries `mock_response`. D-12 realtime entries listed for parity
  (gpt-realtime, gpt-realtime-mini, gpt-4o-realtime-preview) but
  intentionally bear no `mock_response` — LiteLLM WSS upgrade
  short-circuits before the mock layer is consulted; Plan 07 test
  asserts close-code reachability only.
- Makefile `contract-test` target now exports
  `LITELLM_CONFIG_FILE=litellm_config.contract.yaml` to all three
  `docker compose ... run --rm` invocations and the boot.
- TDD test (`tests/unit/litellm-contract-config.test.ts`): six
  invariants — YAML parses, every non-realtime model has
  mock_response, fake api_key, all four required models present, three
  realtime entries present, env-only secret references.

### Task 2 — Spike test + WAV fixture
**Commit:** `60feac9`

- `tests/fixtures/audio/sample-1s.wav`: 32 KB, 16 kHz mono PCM silence,
  generated via `ffmpeg -f lavfi -i anullsrc`. CC0 / synthetic.
- `apps/api/src/__tests__/litellm-spike-request-id.test.ts`: posts
  `qwen3.6-plus` chat completion with header
  `x-litellm-spend-logs-metadata: {"openwhispr_request_id":"<uuid>"}`,
  waits 3 s, queries `LiteLLM_SpendLogs WHERE metadata->>'openwhispr_request_id' = $1`,
  asserts `metadata.openwhispr_request_id === uuid` and `end_user === 'spike-user-1'`.
  Auto-skips when `LITELLM_BASE_URL`/`LITELLM_MASTER_KEY`/`LITELLM_DATABASE_URL`
  unset. Also asserts the WAV fixture has a valid RIFF/WAVE header.
- `apps/api/package.json`: `pg` + `@types/pg` devDependency (the
  spike's direct DB query path).

### Task 3 — Phase 3 zod schemas
**Commit:** `16c784f`

- `packages/contract-tests/src/schemas.ts`: appended
  `TranscribeRequestFields`, `TranscribeResponse`, `ReasonRequest`,
  `ReasonResponse`, `DiarizationResponse`. Convention preserved
  (Request `.strict()`, Response open). `TranscribeResponse.limitReached`
  pinned to `z.literal(false)` per WIRE-05.
- `packages/contract-tests/src/__tests__/schemas-phase-3.test.ts`: 19
  tests — valid/invalid for every schema, forward-compat extras on
  responses, strict rejection on requests, DiarizationResponse
  passthrough preserves upstream pyannote extras.

### Task 4 — Per-package coverage floor (HIGH-3 closure)
**Commit:** `645195e`

- Per-package vitest configs at `apps/api/vitest.config.ts`,
  `packages/litellm-client/vitest.config.ts`, `packages/data/vitest.config.ts`
  — each `mergeConfig(rootConfig, ...)` with nested
  `coverage.thresholds.{lines,branches,functions,statements}=90` and
  `coverage.include = ['src/**/*.ts']`.
- Root config unchanged (85/80/80/85) — remains project-wide floor.
- `tests/unit/per-package-coverage-thresholds.test.ts`: 13 tests
  pinning the shape across all three configs, plus a guard that the
  root config is unchanged.
- `.planning/phases/03/03-PHASE-COVERAGE.md`: invocation contract for
  Plans 03..08, apps/worker followup (Plan 08 must author its config
  alongside its first source file), `apps/api/src/index.ts`
  exclusion-removal followup Plan 03-03 owes once it adds real lines.

## Spike result (D-08 / A4)

> **Status: deferred — spike harness shipped, live run pending real LiteLLM stack.**
>
> The live spike requires a running `litellm` service (Plan 03-01
> dependency, also in Wave 0). Plan 03-01 has not yet landed in this
> branch's HEAD, so the docker-compose has no `litellm` service to
> bring up. The spike test ships and auto-skips today; an operator
> running the integrated wave-0 stack invokes:
>
> ```bash
> LITELLM_CONFIG_FILE=litellm_config.contract.yaml \
>   docker compose --profile default --profile contract-test up -d --wait litellm postgres
> LITELLM_BASE_URL=http://localhost:4000 \
> LITELLM_MASTER_KEY=$(grep ^LITELLM_MASTER_KEY .env | cut -d= -f2) \
> LITELLM_DATABASE_URL="postgres://${POSTGRES_OWNER_USER}:${POSTGRES_OWNER_PASSWORD}@localhost:5432/litellm" \
>   pnpm vitest run apps/api/src/__tests__/litellm-spike-request-id.test.ts
> ```
>
> The test prints the actual `LiteLLM_SpendLogs` row JSON via
> `console.log` so Plan 08 can pin the extraction expression to the
> real shape (RESEARCH A4 default: `metadata->>'openwhispr_request_id'`).
> If the dump shows the metadata is text-encoded or our key is
> dropped, **Plan 08's `<context>` block MUST be updated before Wave 2
> starts** to extract via the actual mechanism. This SUMMARY will be
> amended with the verbatim dump once the live run lands; until then
> Plan 08 reads research assumption A4 as the canonical extraction
> shape.

## Deviations from Plan

### [Rule 3 — Blocking] docker-compose.yml `litellm` service not yet present
- **Found during:** Task 1 verify
- **Issue:** The plan's Task 1 step 2 instructs editing the existing
  `litellm` service in `docker-compose.yml` (Option B: parametrize
  the volume mount via `LITELLM_CONFIG_FILE`). That service does not
  yet exist — Plan 03-01 (also Wave 0, parallel-executed) creates it.
- **Fix:** the contract config + Makefile env wiring shipped here is
  inert unless Plan 03-01 lands the service AND honors the env-var
  pattern (`./compose/litellm/${LITELLM_CONFIG_FILE:-litellm_config.yaml}`).
  This is a wave-internal handoff: Plan 03-01's `<done>` block must
  cite the env-var pattern by name, and `/gsd-verify-work` on phase
  closeout asserts both halves landed.
- **Files modified:** Makefile (env exports added), but
  `docker-compose.yml` deliberately untouched in this commit.
- **Commit:** `d5de18d`

### [Rule 3 — Blocking] docs/wire-contracts-phase-3.md not yet authored
- **Found during:** Task 3
- **Issue:** Plan instructs sourcing schemas from
  `docs/wire-contracts-phase-3.md` (Plan 01 output). That document does
  not exist yet — Plan 01 also runs in parallel.
- **Fix:** schemas authored from the inline definitions in 03-02-PLAN.md
  itself, which the plan author copied verbatim from the upstream
  BACKEND_SPEC.md / wire-contracts source. When Plan 01 lands the
  external document, Plan 06 (CONTRACT-01) will diff the schemas
  against it; any divergence then becomes a single-spot fix in
  schemas.ts (single source of truth, D-09).
- **Files modified:** `packages/contract-tests/src/schemas.ts`
- **Commit:** `16c784f`

## Authentication gates

None — all work was filesystem authoring; live LiteLLM/Postgres traffic
deferred behind env-presence guards on the spike test.

## Self-Check: PASSED

Created files:

- FOUND: `compose/litellm/litellm_config.contract.yaml`
- FOUND: `tests/unit/litellm-contract-config.test.ts`
- FOUND: `tests/fixtures/audio/sample-1s.wav`
- FOUND: `tests/fixtures/audio/README.md`
- FOUND: `apps/api/src/__tests__/litellm-spike-request-id.test.ts`
- FOUND: `packages/contract-tests/src/__tests__/schemas-phase-3.test.ts`
- FOUND: `apps/api/vitest.config.ts`
- FOUND: `packages/litellm-client/vitest.config.ts`
- FOUND: `packages/data/vitest.config.ts`
- FOUND: `tests/unit/per-package-coverage-thresholds.test.ts`
- FOUND: `.planning/phases/03-litellm-integration-bundled-oss-models/03-PHASE-COVERAGE.md`

Commits in this branch:

- FOUND: `d5de18d` (feat(03-02): hermetic LiteLLM contract config + Makefile env wiring)
- FOUND: `60feac9` (test(03-02): LiteLLM request_id spike + 1s WAV fixture)
- FOUND: `16c784f` (feat(03-02): Phase 3 zod schemas)
- FOUND: `645195e` (chore(03-02): per-package coverage floor at 90)

Test runs:

- 39 passed / 1 skipped (live spike auto-skip — expected without env vars)
- All four task-test files green via direct `node_modules/vitest/vitest.mjs run`
