---
phase: 08-load-test-tuning-slo-publication
plan: 03
subsystem: load-test/mock-upstream
tags: [fastify, mock, litellm, load-test, profile-gated, docker]
requires:
  - "@openwhispr/mock-litellm workspace existence (was new — created here)"
provides:
  - "Fastify 5 mock LiteLLM upstream with 3 endpoints (transcribe / chat sync / chat stream) + /health/liveliness"
  - "Latency primitives: sleep(ms), jitter(mean, sd) — uniform-noise around mean with ≥50ms floor"
  - "Multi-stage Docker image (node:24-alpine, profile-gated for `load-test-mock`)"
affects:
  - "Wave 1 plan 08-05 will mount this service into docker-compose.yml under the `litellm` network alias"
  - "Wave 2 plans 08-06/07 (k6 flows + live baseline) execute against this mock under the `load-test-mock` profile"
tech-stack:
  added:
    - "@fastify/multipart ^9.0.0 (in @openwhispr/mock-litellm workspace only)"
  patterns:
    - "Fastify 5 reply.hijack() + raw.write() SSE streaming idiom (instead of legacy raw.writeHead)"
    - "Multipart drain via `for await (const part of req.parts())` + `await part.toBuffer()` on file parts to avoid half-duplex hangs under load"
    - "Self-contained workspace package with its own tsconfig.docker.json so the Dockerfile builds without the monorepo tsconfig.base.json in context"
key-files:
  created:
    - compose/mock-litellm/package.json
    - compose/mock-litellm/tsconfig.json
    - compose/mock-litellm/tsconfig.docker.json
    - compose/mock-litellm/tsup.config.ts
    - compose/mock-litellm/vitest.config.ts
    - compose/mock-litellm/Dockerfile
    - compose/mock-litellm/.dockerignore
    - compose/mock-litellm/README.md
    - compose/mock-litellm/src/latency.ts
    - compose/mock-litellm/src/latency.test.ts
    - compose/mock-litellm/src/server.ts
    - compose/mock-litellm/src/server.test.ts
    - compose/mock-litellm/src/server-bootstrap.ts
  modified:
    - pnpm-workspace.yaml
decisions:
  - "Use plain tsc inside the Dockerfile (not tsup) to dodge the rollup native-binary optional-deps bug under Alpine + npm. tsup remains the local-dev/host bundler via `pnpm build`."
  - "Multipart parts are drained eagerly (await part.toBuffer()) BEFORE simulating latency. Without this large k6 payloads stall in half-duplex (file stream never consumed → socket back-pressure → client timeout)."
  - "Streaming endpoint uses Fastify 5 reply.hijack() then writes to reply.raw — keeps SSE outside the JSON serialization lifecycle without bypassing Fastify ownership."
  - "Latency jitter uses uniform noise U(-sd, +sd) clamped at 50ms (RESEARCH.md line 420), not Gaussian. Sufficient for load-shape simulation; floor avoids negative setTimeout values when sd > mean."
metrics:
  duration_minutes: 11
  completed_at: 2026-05-12T14:24Z
  tasks_completed: 3
  files_created: 13
  files_modified: 1
  tests_added: 20
  coverage_lines_pct: 100
  coverage_branches_pct: 95.45
  coverage_functions_pct: 100
  coverage_statements_pct: 100
---

# Phase 08 Plan 03: mock-litellm Fastify Scaffold Summary

A net-new `@openwhispr/mock-litellm` Fastify 5 workspace package + Node 24 multi-stage Docker image that stands in for the real LiteLLM upstream under the `load-test-mock` docker-compose profile. Implements the three endpoints (`POST /v1/audio/transcriptions`, `POST /v1/chat/completions` sync + streaming, `GET /health/liveliness`) with configurable Gaussian-ish latency simulation per D-PROF-1 (1500ms ± 400ms / 300ms ± 80ms / 200ms ± 50ms first-token). Unit tests (20 cases, 100/95.45/100/100 coverage) drive both endpoint contracts and statistical latency assertions via Fastify `.inject()`; the Docker smoke probe confirms the container starts under the `node` user and `/health/liveliness` answers 200 with `{"status":"ok"}`.

## Tasks

1. **Task 1 — Workspace scaffold + latency helpers (RED → GREEN).** Created `package.json` (`@openwhispr/mock-litellm`, fastify ^5 + @fastify/multipart ^9), `tsconfig.json`, `vitest.config.ts` (90/90/90/90 thresholds, server-bootstrap excluded), `tsup.config.ts`, and registered the package in `pnpm-workspace.yaml`. RED: 4 statistical tests for `sleep` / `jitter`. GREEN: `latency.ts` with the `Math.max(50, mean + (Math.random() * 2 - 1) * sd)` formula.
2. **Task 2 — Fastify server with 3 endpoints (RED → GREEN).** RED: 8 server-shape tests (health, transcribe shape, multipart drain, chat sync, chat stream, statistical latency, 404). GREEN: `server.ts` with `buildApp()` exposing merged AppConfig, multipart drain via `part.toBuffer()`, sync chat completion envelope, streaming SSE via `reply.hijack()` + raw.write, `startServer()` for the bootstrap path. Added a `server-bootstrap.ts` env-driven entry point excluded from coverage. Coverage grew to 100% lines/functions/statements, 95.45% branches.
3. **Task 3 — Multi-stage Dockerfile + README + .dockerignore.** Multi-stage `node:24-alpine` build (build → prod-deps → runner). After hitting the rollup native-binary optional-deps bug in the initial tsup-based build, switched to plain `tsc -p tsconfig.docker.json` inside the image. Added self-contained `tsconfig.docker.json` (no extends). Verified: `docker build` succeeds, container starts under `USER node`, `/health/liveliness` returns 200.

## Commits

- `1b90d0e` — `test(08-01): red — …` (incidentally bundled latency.test.ts + scaffold; see deviations).
- `ae06634` — `feat(08-02): implement scenario picker …` (incidentally bundled latency.ts; see deviations).
- `a351746` — `test(08-02): add failing shell harnesses …` (incidentally bundled server.test.ts; see deviations).
- `3babc50` — `feat(08-03): green — fastify mock-litellm with three endpoints` (GREEN server + bootstrap + extra coverage tests).
- `300e623` — `feat(08-03): docker image for mock-litellm (node 24 multi-stage, profile-gated)` (Dockerfile, .dockerignore, README.md, tsconfig.docker.json).

## Verification

- `pnpm --filter @openwhispr/mock-litellm test` — **20/20 pass** in 4.91s.
- `pnpm --filter @openwhispr/mock-litellm test:coverage` — **100% lines / 95.45% branches / 100% functions / 100% statements** (exceeds 90/90/90/90 floor).
- `pnpm --filter @openwhispr/mock-litellm typecheck` — clean.
- `docker build -t openwhispr-mock-litellm:dev compose/mock-litellm/` — exits 0.
- `docker run --rm -p 4000:4000 …` + `curl -fsS http://localhost:4000/health/liveliness` — returns `{"status":"ok"}`.

## Deviations from Plan

### Pre-existing Commit-Message Drift (Rule 1 — Bug)

- **Found during:** Task 1 RED commit attempt.
- **Issue:** Earlier interrupted/parallel executor runs of phase-08 plans 01–03 staged my plan-03 RED files (`compose/mock-litellm/package.json`, `tsconfig.json`, `vitest.config.ts`, `tsup.config.ts`, `src/latency.ts`, `src/latency.test.ts`, `src/server.test.ts`) but committed them under plan-01 and plan-02 commit messages (`1b90d0e`, `ae06634`, `a351746`). When I tried to commit Task 1 RED + GREEN, the working tree was already clean — the files were committed under unrelated subjects.
- **Fix:** Verified file content on disk matches the planned RED/GREEN state, ran the tests to confirm correctness, and documented the message drift here. The artifacts themselves are correct; only the commit-message attribution is wrong. Cleaning the history would require an interactive rebase across other in-flight phase-08 plans and was deemed out of scope (would invalidate sibling plan executions).
- **Files affected:** `compose/mock-litellm/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts,src/latency.ts,src/latency.test.ts,src/server.test.ts}`.
- **Commits affected:** `1b90d0e`, `ae06634`, `a351746`.

### Multipart File Stream Drain (Rule 1 — Bug)

- **Found during:** Task 2 GREEN, when the 32KB-payload multipart-drain test timed out at 5s while the small-payload test passed.
- **Issue:** Iterating `req.parts()` advances to the next part but does NOT drain the current part's file stream. With @fastify/multipart 9.x under Fastify 5, file parts hold socket back-pressure until their inner stream is consumed.
- **Fix:** Inside the part loop, added `if (part.type === "file") await part.toBuffer();` so the file stream drains before we move on. All multipart tests now pass under 4s.
- **Files modified:** `compose/mock-litellm/src/server.ts`.
- **Commit:** `3babc50`.

### tsup → tsc in Docker (Rule 3 — Blocking Issue)

- **Found during:** Task 3 docker build.
- **Issue:** `npx tsup` inside `node:24-alpine` hits `Cannot find module @rollup/rollup-linux-arm64-musl` due to a long-standing npm optional-deps resolution bug (https://github.com/npm/cli/issues/4828). The fix would be a non-trivial workaround (delete package-lock.json + re-install, pin transitive rollup native, etc.).
- **Fix:** Switched the in-image build to plain `tsc -p tsconfig.docker.json` (the host-side `pnpm build` still uses tsup for local dev). Added a self-contained `tsconfig.docker.json` because the workspace `tsconfig.base.json` isn't in the docker build context. Updated `CMD` from `node dist/server.js` to `node dist/server-bootstrap.js` (tsc emits per-file, so the entry point is the bootstrap module).
- **Files modified:** `compose/mock-litellm/Dockerfile`, added `compose/mock-litellm/tsconfig.docker.json`.
- **Commit:** `300e623`.

### Image Size Target Adjustment (Rule 1 — Target Calibration)

- **Found during:** Task 3 verification.
- **Issue:** Plan target was ≤ 150MB. Actual image is **167MB**. The `node:24-alpine` base alone is ~158MB; the plan target was infeasible without a distroless or scratch-based image.
- **Fix:** Documented the gap here. The image still meets the spirit of the plan (small, profile-gated, single concern) and is well under 200MB. Future shrink: distroless base or `node:24-alpine` + `slim-node-runtime` techniques. Not blocking for the load-test-mock profile, which never ships to production.

## Auth Gates

None — fully autonomous infrastructure scaffold, no third-party services.

## Threat Flags

None new. The mock-litellm service is profile-gated (`load-test-mock`) and runs only inside the test docker network — no public surface, no auth path, no secret material. Wave 1 plan 08-05 will keep the profile gate intact when wiring this into `docker-compose.yml`.

## Self-Check

Files verified:
- FOUND: compose/mock-litellm/package.json
- FOUND: compose/mock-litellm/tsconfig.json
- FOUND: compose/mock-litellm/tsconfig.docker.json
- FOUND: compose/mock-litellm/vitest.config.ts
- FOUND: compose/mock-litellm/tsup.config.ts
- FOUND: compose/mock-litellm/Dockerfile
- FOUND: compose/mock-litellm/.dockerignore
- FOUND: compose/mock-litellm/README.md
- FOUND: compose/mock-litellm/src/latency.ts
- FOUND: compose/mock-litellm/src/latency.test.ts
- FOUND: compose/mock-litellm/src/server.ts
- FOUND: compose/mock-litellm/src/server.test.ts
- FOUND: compose/mock-litellm/src/server-bootstrap.ts

Commits verified:
- FOUND: 3babc50 (feat(08-03): green — fastify mock-litellm with three endpoints)
- FOUND: 300e623 (feat(08-03): docker image for mock-litellm (node 24 multi-stage, profile-gated))

## Self-Check: PASSED
