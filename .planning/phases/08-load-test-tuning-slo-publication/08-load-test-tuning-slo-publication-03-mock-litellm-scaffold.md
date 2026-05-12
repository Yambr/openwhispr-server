---
phase: 08-load-test-tuning-slo-publication
plan: 03
type: tdd
wave: 0
depends_on: []
files_modified:
  - compose/mock-litellm/package.json
  - compose/mock-litellm/tsconfig.json
  - compose/mock-litellm/Dockerfile
  - compose/mock-litellm/src/server.ts
  - compose/mock-litellm/src/server.test.ts
  - compose/mock-litellm/src/latency.ts
  - compose/mock-litellm/src/latency.test.ts
  - compose/mock-litellm/README.md
  - pnpm-workspace.yaml
autonomous: true
requirements:
  - SCALE-06
must_haves:
  truths:
    - "A net-new Fastify 5 app exists at compose/mock-litellm/ that responds to /v1/audio/transcriptions, /v1/chat/completions (both sync and streaming), and /health/liveliness."
    - "Latency simulation uses configurable mean+jitter Gaussian-ish noise (mean=1500ms/300ms/200ms per D-PROF-1)."
    - "Unit tests use Fastify .inject() (no real network) and verify response shape, headers, and latency-injection mean+sd statistically over a sample."
    - "Multi-stage Dockerfile builds the app under Node 24 + pnpm and produces a small final image (no dev deps)."
    - "Mock LiteLLM is profile-gated (Wave 1 wires the compose service) — no impact on default profile."
  artifacts:
    - path: "compose/mock-litellm/package.json"
      provides: "Fastify 5 + @fastify/multipart deps, build/start scripts"
      contains: "@openwhispr/mock-litellm"
    - path: "compose/mock-litellm/src/server.ts"
      provides: "Fastify app factory with all 3 endpoints"
      exports: ["buildApp", "startServer"]
    - path: "compose/mock-litellm/src/latency.ts"
      provides: "jitter(mean, sd) helper + sleep(ms) primitive"
      exports: ["jitter", "sleep"]
    - path: "compose/mock-litellm/Dockerfile"
      provides: "Multi-stage build (deps → build → runner) under Node 24"
      contains: "FROM node:24"
  key_links:
    - from: "compose/mock-litellm/src/server.ts"
      to: "compose/mock-litellm/src/latency.ts"
      via: "imports jitter for endpoint sleep"
      pattern: "from ['\"]\\./latency"
    - from: "compose/mock-litellm/Dockerfile"
      to: "compose/mock-litellm/package.json"
      via: "pnpm install in deps stage"
      pattern: "pnpm install"
---

<objective>
Stand up the `compose/mock-litellm/` Fastify 5 app that simulates the LiteLLM upstream surface with controllable latency. Wave 1 (plan 05) wires this service into docker-compose.yml under the `load-test-mock` profile and Docker network alias `litellm`.

This plan ships:
- Workspace package (`@openwhispr/mock-litellm`) with Fastify 5 + @fastify/multipart.
- Three endpoints: POST /v1/audio/transcriptions (1500ms ± jitter), POST /v1/chat/completions (sync 300ms ± / streaming ~200ms first token), GET /health/liveliness.
- Latency helpers (jitter + sleep).
- Multi-stage Dockerfile (Node 24).
- Unit tests via Fastify `.inject()` covering response shape, content-type, multipart drain semantics, and statistical latency assertions.

Per D-TDD-1 and D-TDD-2: tests RED before GREEN, ≥90/90/90/90 coverage on diff.

Per CLAUDE.md "no mocks of internal logic": mock-litellm IS a process boundary (external HTTP service the api connects to via LITELLM_BASE_URL). It is NOT a mock of internal logic — it is a stand-in for the external LiteLLM. This satisfies CLAUDE.md.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md
@.planning/phases/08-load-test-tuning-slo-publication/08-RESEARCH.md
@compose/litellm/litellm_config.yaml
@apps/api/src/routes/transcribe.ts
@apps/api/Dockerfile

<interfaces>
<!-- Endpoint shapes from LiteLLM/OpenAI wire surface, drawn from RESEARCH.md §Code Examples. -->
<!-- The api forwards multipart via @fastify/http-proxy at apps/api/src/routes/transcribe.ts:53–58. -->
<!-- The mock MUST drain the multipart body before responding to avoid half-duplex socket hangs. -->

Fastify app shape:

```typescript
export interface AppConfig {
  port: number;
  host: string;
  transcribeMeanMs: number;  // default 1500
  transcribeSdMs: number;    // default 400
  chatMeanMs: number;        // default 300
  chatSdMs: number;          // default 80
  streamFirstTokenMs: number; // default 200
  streamFirstTokenSdMs: number; // default 50
}
export function buildApp(cfg?: Partial<AppConfig>): FastifyInstance;
export function startServer(cfg?: Partial<AppConfig>): Promise<FastifyInstance>;
```

Response shapes (from RESEARCH.md lines 408-462):
- /v1/audio/transcriptions: `{ text: string, duration: number, language: 'en' }`
- /v1/chat/completions (sync): `{ id, object: 'chat.completion', choices: [{ message, finish_reason }], usage }`
- /v1/chat/completions (stream=true): SSE with `data: { choices: [{ delta: { content }}]}` chunks then `data: [DONE]`
- /health/liveliness: `{ status: 'ok' }`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Workspace scaffold + latency helper (RED → GREEN)</name>
  <files>compose/mock-litellm/package.json, compose/mock-litellm/tsconfig.json, compose/mock-litellm/src/latency.ts, compose/mock-litellm/src/latency.test.ts, pnpm-workspace.yaml</files>
  <behavior>
    - Test 1 (RED): `sleep(50)` resolves after ≥45ms (use Vitest fake timers for deterministic assertion).
    - Test 2 (RED): `jitter(1000, 200)` returns a number; over 1000 samples, mean ∈ [950, 1050] and standard deviation ∈ [150, 250].
    - Test 3 (RED): `jitter(50, 0)` always returns exactly 50.
    - Test 4 (RED): `jitter(100, 9999)` is clamped to ≥50 (no negative-sleep panic).
  </behavior>
  <action>
    Step 1 (scaffold):
    - Create `compose/mock-litellm/package.json`: name `@openwhispr/mock-litellm`, private: true, type: "module", scripts (build via tsup, start via `node dist/server.js`, test via vitest, test:coverage). Deps: `fastify ^5.3`, `@fastify/multipart ^9`. DevDeps: `tsup ^8`, `typescript ^5.7`, `vitest ^1.6`, `@vitest/coverage-v8 ^1.6`, `@types/node ^24`.
    - Create `tsconfig.json` extending root base with `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`.
    - Create `compose/mock-litellm/vitest.config.ts` with coverage thresholds 90/90/90/90 and `include: ['src/**/*.ts']`, `exclude: ['src/server-bootstrap.ts']` (the bootstrap line is the one untestable line).
    - Append `compose/mock-litellm` to `pnpm-workspace.yaml`.
    - `pnpm install`.

    Step 2 (RED): Write `compose/mock-litellm/src/latency.test.ts` with 4 behaviors above. Use a deterministic seedable PRNG for the statistical tests (Mulberry32 again, or accept Math.random with a large sample size and a loose ± tolerance). Run `pnpm --filter @openwhispr/mock-litellm test latency` — MUST fail. Commit: `test(08-03): RED — latency helpers (sleep, jitter)`.

    Step 3 (GREEN): Implement `compose/mock-litellm/src/latency.ts` with `sleep(ms): Promise<void>` and `jitter(mean: number, sd: number): number` using the formula from RESEARCH.md line 420 (`Math.max(50, mean + (Math.random() * 2 - 1) * sd)`). Run tests — MUST pass with ≥90/90/90/90 coverage. Commit: `feat(08-03): GREEN — latency helpers`.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/mock-litellm test latency</automated>
  </verify>
  <done>4 tests pass; coverage ≥90/90/90/90 on latency.ts.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fastify server with all 3 endpoints (RED → GREEN)</name>
  <files>compose/mock-litellm/src/server.ts, compose/mock-litellm/src/server.test.ts</files>
  <behavior>
    - Test 1 (RED): GET /health/liveliness returns 200 with body `{ status: 'ok' }`.
    - Test 2 (RED): POST /v1/audio/transcriptions with a multipart body returns 200 with body `{ text, duration: 5.0, language: 'en' }` and `text` is non-empty.
    - Test 3 (RED): POST /v1/audio/transcriptions DRAINS the multipart body before responding (assert `req.parts()` was iterated — use a spy or assert via no half-duplex hang).
    - Test 4 (RED): POST /v1/chat/completions with `{ stream: false }` returns 200 + body shape `{ id, object: 'chat.completion', choices: [{ message: { role, content }, finish_reason: 'stop' }], usage }`.
    - Test 5 (RED): POST /v1/chat/completions with `{ stream: true }` returns 200 with content-type `text/event-stream`, the raw body contains at least one `data: { choices: [...] }` line, and the stream ends with `data: [DONE]`.
    - Test 6 (RED): Statistical latency: 30 sequential calls to /v1/audio/transcriptions (with cfg `transcribeMeanMs: 100, transcribeSdMs: 30`) have mean elapsed time ∈ [80, 130]ms (loose tolerance for CI flake).
    - Test 7 (RED): Unknown route returns 404.
    - Test 8 (RED): buildApp() accepts a partial config and merges with defaults.
  </behavior>
  <action>
    Step 1 (RED): Write `compose/mock-litellm/src/server.test.ts` with all 8 tests. Use Fastify's `app.inject()` for tests 1, 2, 4, 7, 8. For test 5 (streaming), inject and then `await response.body` (Fastify inject captures the full SSE stream as a string). For test 6 (latency), use `buildApp({ transcribeMeanMs: 100, transcribeSdMs: 30 })` and time real awaits via `performance.now()` — keep N small (30) so the test stays under 5s. Run `pnpm --filter @openwhispr/mock-litellm test server` — MUST fail. Commit: `test(08-03): RED — Fastify mock-litellm server + 3 endpoints`.

    Step 2 (GREEN): Implement `compose/mock-litellm/src/server.ts` per the RESEARCH.md §Code Examples block (lines 408-462) with these refinements:
    - Export `buildApp(cfg?: Partial<AppConfig>): FastifyInstance` (NOT auto-listening — tests need .inject()).
    - Export `startServer(cfg?: Partial<AppConfig>): Promise<FastifyInstance>` which calls `buildApp` then `.listen({ port: cfg.port ?? 4000, host: cfg.host ?? '0.0.0.0' })`.
    - DEFAULT_CONFIG exported for test re-use.
    - Register `@fastify/multipart` only once at app build.
    - For the streaming endpoint, use `reply.hijack()` then `reply.raw.write()` per Fastify 5 idiom (do NOT use the older `reply.raw.writeHead` pattern shown in research — that bypasses Fastify lifecycle). Reference: Fastify 5 streaming docs.
    - Drain multipart body inside a `for await (const part of req.parts())` BEFORE awaiting jitter sleep (otherwise client uploads stall waiting for the body to be consumed).
    - Add a `bootstrap.ts` (or `server-bootstrap.ts`) line `if (import.meta.url === \`file://${process.argv[1]}\`) startServer()` so the Docker CMD `node dist/server.js` works — but this single line is excluded from coverage (see vitest.config exclude).
    - Run tests — MUST pass with ≥90/90/90/90 coverage. Commit: `feat(08-03): GREEN — Fastify mock-litellm with /v1/audio/transcriptions + /v1/chat/completions + /health/liveliness`.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/mock-litellm test server</automated>
  </verify>
  <done>8 tests pass; coverage ≥90/90/90/90 on server.ts; streaming endpoint uses Fastify 5 idiomatic reply.hijack().</done>
</task>

<task type="auto">
  <name>Task 3: Multi-stage Dockerfile + README</name>
  <files>compose/mock-litellm/Dockerfile, compose/mock-litellm/.dockerignore, compose/mock-litellm/README.md</files>
  <action>
    Create `compose/mock-litellm/Dockerfile` as a 3-stage build:
    1. `deps` stage: `FROM node:24-alpine`, install pnpm, copy package.json + pnpm-lock.yaml, `pnpm install --frozen-lockfile`.
    2. `build` stage: copy source, `pnpm build` (tsup → dist/).
    3. `runner` stage: `FROM node:24-alpine`, copy only `dist/` + `node_modules/` (production-only via `pnpm install --prod --frozen-lockfile` in a fresh layer to drop dev deps), `USER node`, `EXPOSE 4000`, `CMD ["node", "dist/server.js"]`. Add HEALTHCHECK pointing at /health/liveliness.

    Create `.dockerignore` excluding `node_modules`, `dist`, `*.test.ts`, `vitest.config.ts`, `tsconfig.json` build artifacts.

    Create `README.md` (1 page): purpose (mock LiteLLM for load-test-mock profile), endpoints + latency contracts, how to run locally (`pnpm dev` and `docker build`), explicit note that this is profile-gated and MUST NOT run in the default profile.

    Verify Docker build: `docker build -t openwhispr-mock-litellm:dev compose/mock-litellm/` exits 0 and produces an image ≤ 150MB. Run the image and curl /health/liveliness to confirm 200.

    Commit: `feat(08-03): docker image for mock-litellm (Node 24 multi-stage, profile-gated)`.

    NOTE: This task is NOT TDD — it's pure infrastructure config. Per CLAUDE.md `<role>` task-level TDD exceptions: configuration-only files do not require tdd="true". The verification IS the docker build + curl probe.
  </action>
  <verify>
    <automated>docker build -t openwhispr-mock-litellm:dev compose/mock-litellm/ && docker run -d --rm --name mock-litellm-smoke -p 4000:4000 openwhispr-mock-litellm:dev && sleep 2 && curl -fsS http://localhost:4000/health/liveliness && docker stop mock-litellm-smoke</automated>
  </verify>
  <done>Image builds < 150MB; container starts; /health/liveliness returns 200; README documents profile-gating contract.</done>
</task>

</tasks>

<verification>
- `pnpm --filter @openwhispr/mock-litellm test` runs all unit tests green
- `pnpm --filter @openwhispr/mock-litellm test:coverage` shows ≥90/90/90/90 on the diff
- `pnpm --filter @openwhispr/mock-litellm typecheck` clean
- `docker build` succeeds and the smoke probe returns 200
</verification>

<success_criteria>
- `@openwhispr/mock-litellm` workspace exists with passing tests + 90/90/90/90 coverage
- All 3 endpoints respond per the wire-shape contracts
- Latency simulation is mean+jitter Gaussian-ish per D-PROF-1
- Docker image is small, profile-gated (Wave 1 wires it in), and runs on Node 24
</success_criteria>

<output>
After completion, create `.planning/phases/08-load-test-tuning-slo-publication/08-03-SUMMARY.md` per template.
</output>
