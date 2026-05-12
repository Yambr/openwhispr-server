---
phase: 08-load-test-tuning-slo-publication
plan: 06
type: tdd
wave: 2
depends_on:
  - 02
  - 05
files_modified:
  - tools/load-test/src/main.ts
  - tools/load-test/src/k6.config.ts
  - tools/load-test/src/flows/transcribe.ts
  - tools/load-test/src/flows/transcribe.test.ts
  - tools/load-test/src/flows/reason.ts
  - tools/load-test/src/flows/reason.test.ts
  - tools/load-test/src/flows/agent-stream.ts
  - tools/load-test/src/flows/agent-stream.test.ts
  - tools/load-test/src/flows/realtime-ws.ts
  - tools/load-test/src/flows/realtime-ws.test.ts
  - tools/load-test/src/fixtures/sample-5s-16k.wav
  - tools/load-test/src/fixtures/prompt-strings.json
  - tools/load-test/src/fixtures/conversation-history.json
  - tools/load-test/scripts/run.sh
  - tools/load-test/scripts/pre-warm-speaches.sh
  - compose/grafana/dashboards/k6-prometheus.json
  - compose/grafana/provisioning/dashboards/k6.yaml
  - Makefile
autonomous: true
requirements:
  - SCALE-06
  - TEST-LOAD-01
must_haves:
  truths:
    - "`tools/load-test/dist/main.js` is a single ES bundle k6 can import (no relative imports left)."
    - "main.ts exports the locked options (5m ramp / 20m sustained / 5m ramp-down @ 1000 VU; insecureSkipTLSVerify true; thresholds tagged by endpoint)."
    - "The default function picks an endpoint per iteration via the scenario picker and dispatches to the correct flow."
    - "Each flow file produces tagged http_req_duration metrics so p95 attribution is per-endpoint."
    - "agent-stream flow records TTFB separately from total time (RESEARCH.md §Pitfall 6)."
    - "realtime-ws flow opens a WSS connection via k6/websockets, pings, and closes cleanly within iteration budget."
    - "transcribe flow uploads the 5-second 16kHz mono WAV fixture (~80 KB) via multipart."
    - "Grafana dashboard 19665 is provisioned under compose/grafana/dashboards/ and auto-loads."
    - "`make load-test PROFILE=mock` runs preflight, brings the stack up, pre-warms speaches if realistic, runs k6 with prometheus-rw output, captures raw JSON to .planning/phases/08-.../runs/, and tears down."
    - "Unit tests cover every flow function with mocked http (process boundary mock only)."
  artifacts:
    - path: "tools/load-test/src/main.ts"
      provides: "k6 entrypoint with options + setup() + default function"
    - path: "tools/load-test/src/flows/transcribe.ts"
      provides: "POST /api/transcribe with multipart WAV"
      exports: ["transcribe"]
    - path: "tools/load-test/src/flows/reason.ts"
      provides: "POST /api/reason with canned prompt"
      exports: ["reason"]
    - path: "tools/load-test/src/flows/agent-stream.ts"
      provides: "POST /api/agent/stream with NDJSON drain + TTFB metric"
      exports: ["agentStream"]
    - path: "tools/load-test/src/flows/realtime-ws.ts"
      provides: "WSS realtime open + ping + close via k6/websockets"
      exports: ["realtimeWs"]
    - path: "tools/load-test/src/fixtures/sample-5s-16k.wav"
      provides: "Real 5-second 16kHz mono PCM WAV (~80 KB) baked via k6 open()"
    - path: "compose/grafana/dashboards/k6-prometheus.json"
      provides: "Grafana dashboard 19665 (k6 Prometheus) for live view"
    - path: "Makefile"
      provides: "`make load-test PROFILE=mock|realistic` target"
      contains: "load-test"
    - path: "tools/load-test/scripts/run.sh"
      provides: "End-to-end runner: preflight → up → pre-warm → k6 → capture → down"
  key_links:
    - from: "tools/load-test/src/main.ts"
      to: "tools/load-test/src/scenario-picker.ts"
      via: "import + per-iteration pick()"
      pattern: "from ['\"]\\./scenario-picker"
    - from: "Makefile load-test target"
      to: "tools/load-test/scripts/run.sh"
      via: "shell exec"
      pattern: "tools/load-test/scripts/run\\.sh"
    - from: "k6 prometheus-rw output"
      to: "mimir 127.0.0.1:9009"
      via: "K6_PROMETHEUS_RW_SERVER_URL env"
      pattern: "9009/api/v1/push"
---

<objective>
Implement the k6 load test itself: the 4 endpoint flows (transcribe, reason, agent-stream, realtime-ws), the main.ts entrypoint binding them with the locked options (5m/20m/5m @ 1000 VU, mix 50/25/15/10 from plan 02's scenario picker), the WAV fixture, the Grafana dashboard provisioning, the pre-warm-speaches.sh helper (RESEARCH.md §Pitfall 10), and the orchestration Makefile target + run.sh that wraps preflight → compose up → pre-warm → k6 → capture → teardown.

Per D-TDD-1: each flow function has a unit test landed in the SAME commit (RED → GREEN) BEFORE the k6-runtime composition in main.ts. The k6-runtime entrypoint itself (the default function) is exempt from coverage (k6 globals are not vitest-compatible) but the per-flow logic is fully unit tested by mocking the http boundary.

This plan does NOT execute the live run — that is plan 07 (Wave 3). This plan ships the harness ready to run.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-load-test-tuning-slo-publication/08-CONTEXT.md
@.planning/phases/08-load-test-tuning-slo-publication/08-RESEARCH.md
@tools/load-test/src/scenario-picker.ts
@tools/load-test/src/setup.ts
@apps/api/src/routes/transcribe.ts
@apps/api/src/routes/reason.ts
@apps/api/src/routes/agent/stream.ts

<interfaces>
<!-- Each flow is a pure function over an injectable HTTP client + a user. -->

```typescript
export interface HttpClient {
  request(method: string, url: string, body?: unknown, opts?: { headers?: Record<string,string>; tags?: Record<string,string> }): { status: number; body: string; headers: Record<string,string>; timings: { waiting: number; duration: number } };
  ws(url: string, params: WsParams, handler: (socket: WsSocket) => void): { status: number; };
}
export interface User { email: string; token: string; }
export function transcribe(user: User, client?: HttpClient): void;
export function reason(user: User, client?: HttpClient): void;
export function agentStream(user: User, client?: HttpClient): void;
export function realtimeWs(user: User, client?: HttpClient): void;
```

<!-- Default `client` for k6 runtime: a thin adapter around `import http from 'k6/http'` and `import { WebSocket } from 'k6/websockets'`. -->
<!-- Adapter lives in src/utils/http-client.ts (created here); test files inject a vi.fn() mock. -->

<!-- Endpoint URLs (verify against current apps/api routes at plan time): -->
<!--   POST https://api.localhost/api/transcribe (multipart: file, model, language) -->
<!--   POST https://api.localhost/api/reason     (JSON: model, messages) -->
<!--   POST https://api.localhost/api/agent/stream  (JSON: messages, tools; NDJSON response) -->
<!--   WS   wss://api.localhost/v1/realtime?model=... (with Authorization: Bearer header) -->

<!-- k6 metric tagging: pass `tags: { endpoint: 'transcribe' }` so http_req_duration{endpoint:transcribe} works. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: HTTP client adapter + WAV fixture (RED → GREEN)</name>
  <files>tools/load-test/src/utils/http-client.ts, tools/load-test/src/utils/http-client.test.ts, tools/load-test/src/fixtures/sample-5s-16k.wav, tools/load-test/src/fixtures/prompt-strings.json, tools/load-test/src/fixtures/conversation-history.json</files>
  <behavior>
    - Test 1 (RED): `createK6Adapter()` returns an object satisfying the HttpClient interface (shape assertion).
    - Test 2 (RED): When given a mock-fetch shim, request('POST', url, body, { tags }) propagates tags through.
    - Test 3 (RED): The WAV fixture is a valid RIFF PCM file (parse the first 44 bytes — `RIFF....WAVEfmt `).
    - Test 4 (RED): The WAV fixture is approximately 5 seconds long at 16kHz mono (sample rate field + data chunk size).
    - Test 5 (RED): prompt-strings.json contains ≥ 50 non-empty strings.
    - Test 6 (RED): conversation-history.json is a valid `messages` array with ≥ 3 entries shape `{ role, content }`.
  </behavior>
  <action>
    Step 1 (RED): Write the tests. For tests 3-4, use Node `fs.readFileSync` and a tiny WAV parser (just the header — 44 bytes). For tests 5-6, parse JSON and assert array shapes. Run — MUST fail (fixtures + adapter don't exist). Commit: `test(08-06): RED — k6 http adapter + fixtures`.

    Step 2 (GREEN — fixtures):
    - Generate the WAV fixture programmatically (one-shot script committed into the test file or a `scripts/generate-fixtures.ts`): use Node Web Audio polyfill OR write a raw PCM WAV header + 16000 samples/sec × 5 sec × 2 bytes = 160000 bytes of low-amplitude sine wave. Commit binary as `tools/load-test/src/fixtures/sample-5s-16k.wav` (~160 KB). Document the generator in a comment so it's reproducible.
    - Create `prompt-strings.json` with 50 short reasoning prompts (English-only per CLAUDE.md). Examples: "Summarize the key points of effective load testing", "Explain PgBouncer transaction mode", etc.
    - Create `conversation-history.json` with 3-5 canned `{ role: 'user'|'assistant', content: string }` messages.

    Step 3 (GREEN — adapter):
    - Implement `tools/load-test/src/utils/http-client.ts`:
      ```typescript
      export interface HttpClient { /* per interfaces */ }
      export function createK6Adapter(): HttpClient {
        // dynamic require to avoid bundling k6 globals during vitest
        // — bundled by tsup for k6, no-op in vitest where http is injected
      }
      export function createMockAdapter(impl: Partial<HttpClient>): HttpClient { /* test-only */ }
      ```
    - tsup config: mark `k6` and `k6/http` and `k6/websockets` as `external` so they remain unresolved imports in the bundle (k6 supplies them at runtime).
    - Run tests — MUST pass with ≥90/90/90/90 coverage on http-client.ts (the k6 adapter wraps k6 globals so its k6-runtime branch is excluded — only the mock-adapter + interface contract are unit-tested).
    - Commit: `feat(08-06): GREEN — k6 http adapter + 5s WAV fixture + prompt fixtures`.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/load-test test http-client utils/ && file tools/load-test/src/fixtures/sample-5s-16k.wav | grep -q WAVE</automated>
  </verify>
  <done>All 6 tests pass; WAV fixture is parseable as RIFF/WAVE; fixtures registered in src/fixtures/.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Four flow functions (RED → GREEN)</name>
  <files>tools/load-test/src/flows/transcribe.ts, tools/load-test/src/flows/transcribe.test.ts, tools/load-test/src/flows/reason.ts, tools/load-test/src/flows/reason.test.ts, tools/load-test/src/flows/agent-stream.ts, tools/load-test/src/flows/agent-stream.test.ts, tools/load-test/src/flows/realtime-ws.ts, tools/load-test/src/flows/realtime-ws.test.ts</files>
  <behavior>
    transcribe.ts:
    - Test 1 (RED): Calls client.request('POST', BASE_URL + '/api/transcribe', ...) with Authorization Bearer header from user.token.
    - Test 2 (RED): Body is multipart with field name `file` containing the WAV bytes + fields `model` + `language: en`.
    - Test 3 (RED): Tags include `endpoint: 'transcribe'`.
    - Test 4 (RED): On 200, bearer-rotation helper updates user.token if response carries `set-auth-token`.
    - Test 5 (RED): On non-2xx, k6 `check()` (mocked) records the failure but flow does not throw.

    reason.ts:
    - Test 6 (RED): POST /api/reason with JSON body `{ model, messages }` where messages pulls one random prompt from fixtures.
    - Test 7 (RED): Tags include `endpoint: 'reason'`.

    agent-stream.ts:
    - Test 8 (RED): POST /api/agent/stream with `{ messages, stream: true }`.
    - Test 9 (RED): Records TWO metrics: `agent_stream_ttfb` from response.timings.waiting AND `agent_stream_total` from response.timings.duration (RESEARCH.md §Pitfall 6).
    - Test 10 (RED): Tags include `endpoint: 'agent-stream'`.

    realtime-ws.ts:
    - Test 11 (RED): Opens WS to `wss://api.localhost/v1/realtime` with `Authorization: Bearer ${user.token}` header.
    - Test 12 (RED): Sends one ping message, awaits response, closes cleanly within iteration.
    - Test 13 (RED): Tags include `endpoint: 'realtime-ws'`.
    - Test 14 (RED): Iteration budget — full open+ping+close completes in <2s under the mock (asserting flow logic, not real network).
  </behavior>
  <action>
    Step 1 (RED): Write all 4 test files asserting the 14 behaviors. Use `createMockAdapter({ request: vi.fn().mockReturnValue(...), ws: vi.fn() })` to inject. Run `pnpm --filter @openwhispr/load-test test flows/` — MUST fail. Commit: `test(08-06): RED — 4 endpoint flows (transcribe/reason/agent-stream/realtime-ws)`.

    Step 2 (GREEN): Implement each flow file against the interfaces block. Specific patterns:
    - transcribe: use k6 `open(path, 'b')` to read the WAV at script-init (binary). Build multipart manually (k6 has a `FormData` polyfill). At runtime use the adapter; in tests inject the mock.
    - reason: pick a prompt by `data.prompts[__ITER % data.prompts.length]` for determinism.
    - agent-stream: after request returns, push TTFB to a `Trend` metric (k6 `new Trend('agent_stream_ttfb')`); push total to another. In tests, the adapter's mock returns synthetic `timings: { waiting: 100, duration: 500 }` and the test asserts the Trend.add calls (mock the Trend class too).
    - realtime-ws: use `k6/websockets` (new API — NOT legacy `k6/ws`). Handler: on('open') → ws.send('ping') → on('message') → ws.close(1000).

    Verify imports are bundled correctly via `pnpm --filter @openwhispr/load-test build` and inspecting `dist/main.js` (next task). Run tests — MUST pass with ≥90/90/90/90 coverage. Commit: `feat(08-06): GREEN — 4 endpoint flows + TTFB metric for streaming`.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/load-test test flows/</automated>
  </verify>
  <done>14 tests pass; coverage ≥90/90/90/90 on flows/*.ts; mock adapter pattern keeps flows unit-testable outside k6.</done>
</task>

<task type="auto">
  <name>Task 3: main.ts entrypoint + tsup bundle</name>
  <files>tools/load-test/src/main.ts, tools/load-test/src/k6.config.ts, tools/load-test/tsup.config.ts</files>
  <action>
    Implement `main.ts` per RESEARCH.md §Pattern 1 (lines 196-243). Exports:
    - `options`: ramping-vus executor (5m → 1000, 20m sustained, 5m → 0), thresholds tagged per endpoint (generous baselines per CONTEXT D-SLO-1, NOT enforcement — see comment in code), `insecureSkipTLSVerify: true`.
    - `setup()`: thin wrapper that calls `provisionUsers({ backend: BASE_URL, count: 100 })` from plan 02.
    - `teardown(data)`: per RESEARCH.md §Security row "Test user accounts persist after load run" — call DELETE /api/auth/delete-account for each provisioned user (or document a `make load-test-cleanup` if BA lacks the endpoint).
    - default function: `const user = data.users[__VU % data.users.length]; const ep = pick(); switch(ep) {...}`.

    `k6.config.ts` (not a runtime file — pure constants imported by main.ts): N_USERS, BASE_URL, threshold values, metric names. Allows other config to be tweaked without touching main.ts logic.

    Update `tsup.config.ts`:
    - entry: `src/main.ts`
    - format: `esm`
    - target: `es2022`
    - bundle: `true`
    - external: `['k6', 'k6/http', 'k6/websockets', 'k6/metrics']` (these are k6 runtime globals — must remain as bare imports in the bundle)
    - outDir: `dist`
    - clean: `true`
    - sourcemap: `true`

    Verify the build:
    - `pnpm --filter @openwhispr/load-test build` produces `dist/main.js`.
    - `grep -c "import.*from ['\"]k6" dist/main.js` returns ≥ 3 (externals preserved).
    - `node -e "import('./tools/load-test/dist/main.js').catch(e => process.exit(e.message.includes('k6') ? 0 : 1))"` confirms the bundle fails to load in Node (because of bare `k6` imports) — that's correct; only k6 can load it.

    Commit: `feat(08-06): main.ts + tsup bundle (k6 entrypoint, externals preserved)`.

    NOTE: main.ts is excluded from vitest coverage (its execution context is k6, not vitest). The constituent pieces (scenario-picker, flows, setup, http-client) are fully covered by their own unit tests.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/load-test build && test -s tools/load-test/dist/main.js && grep -q "from \"k6" tools/load-test/dist/main.js</automated>
  </verify>
  <done>dist/main.js builds; k6 externals preserved; main.ts wires setup + default function + scenario picker correctly.</done>
</task>

<task type="auto">
  <name>Task 4: Grafana dashboard 19665 provisioning</name>
  <files>compose/grafana/dashboards/k6-prometheus.json, compose/grafana/provisioning/dashboards/k6.yaml</files>
  <action>
    1. Download Grafana dashboard 19665 (k6 Prometheus) JSON from https://grafana.com/api/dashboards/19665/revisions/latest/download . Commit as `compose/grafana/dashboards/k6-prometheus.json`. Pin to a specific revision (record revision number in a header comment inside a sibling README or in the JSON's `__inputs` field).
    2. Read existing `compose/grafana/provisioning/dashboards/` (if it exists) to learn the current dashboard provisioning pattern. If a YAML provider already exists, ADD an entry pointing at `compose/grafana/dashboards/`. If none, create `compose/grafana/provisioning/dashboards/k6.yaml`:
       ```yaml
       apiVersion: 1
       providers:
         - name: 'k6'
           orgId: 1
           folder: 'Load Test'
           folderUid: 'k6-load-test'
           type: file
           disableDeletion: false
           updateIntervalSeconds: 30
           options:
             path: /etc/grafana/dashboards/k6
       ```
       Mount the dashboards folder in docker-compose (Phase 6 likely already mounts the grafana provisioning dir — verify and extend in docker-compose.load-test.yml if needed).
    3. If Phase 6 grafana provisioning structure differs, follow Phase 6's pattern (read `compose/grafana/provisioning/datasources/` and dashboards/ to confirm).
    4. Smoke: `docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-mock up -d grafana` then `curl -fsS http://localhost:3000/api/dashboards/uid/<dashboard-uid>` returns 200 with the dashboard JSON. (Dashboard UID is in the downloaded JSON.)

    Commit: `feat(08-06): provision Grafana k6 Prometheus dashboard (19665)`.

    No TDD step required — this is configuration provisioning. The verification IS the API probe.
  </action>
  <verify>
    <automated>test -s compose/grafana/dashboards/k6-prometheus.json && python3 -c "import json; d=json.load(open('compose/grafana/dashboards/k6-prometheus.json')); assert d.get('uid') or d.get('__inputs') is not None"</automated>
  </verify>
  <done>Dashboard JSON committed; provisioning YAML wired; live API probe confirms Grafana loads the dashboard.</done>
</task>

<task type="auto">
  <name>Task 5: run.sh orchestrator + pre-warm-speaches.sh + Makefile target</name>
  <files>tools/load-test/scripts/run.sh, tools/load-test/scripts/pre-warm-speaches.sh, Makefile</files>
  <action>
    1. Create `tools/load-test/scripts/run.sh`:
       ```sh
       #!/bin/sh
       set -euo pipefail
       PROFILE="${1:-mock}"  # mock | realistic
       case "$PROFILE" in
         mock) COMPOSE_PROFILE=load-test-mock ;;
         realistic) COMPOSE_PROFILE=load-test-realistic ;;
         *) echo "usage: $0 mock|realistic" >&2; exit 1 ;;
       esac

       # 1. Preflight
       bash tools/load-test/scripts/preflight.sh --yes

       # 2. Build mock-litellm + traefik images
       docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
         --profile "$COMPOSE_PROFILE" build

       # 3. Up
       docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
         --profile "$COMPOSE_PROFILE" up -d --wait

       # 4. Pre-warm speaches (realistic only)
       if [ "$PROFILE" = "realistic" ]; then
         bash tools/load-test/scripts/pre-warm-speaches.sh
       fi

       # 5. Build the k6 bundle
       pnpm --filter @openwhispr/load-test build

       # 6. Run k6 with prometheus-rw output + JSON summary
       RUN_DIR=.planning/phases/08-load-test-tuning-slo-publication/runs
       mkdir -p "$RUN_DIR"
       STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
       JSON_OUT="$RUN_DIR/${STAMP}-${PROFILE}.json"
       SUMMARY_OUT="$RUN_DIR/${STAMP}-${PROFILE}-summary.json"

       export K6_PROMETHEUS_RW_SERVER_URL=http://127.0.0.1:9009/api/v1/push
       export K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true
       export K6_INSECURE_SKIP_TLS_VERIFY=true
       k6 run \
         --out experimental-prometheus-rw \
         --out "json=$JSON_OUT" \
         --summary-export "$SUMMARY_OUT" \
         tools/load-test/dist/main.js

       # 7. Capture exit code; tear down
       K6_EXIT=$?
       docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
         --profile "$COMPOSE_PROFILE" down

       echo "Results: $JSON_OUT  Summary: $SUMMARY_OUT"
       exit $K6_EXIT
       ```

    2. Create `tools/load-test/scripts/pre-warm-speaches.sh` (RESEARCH.md §Pitfall 10):
       ```sh
       #!/bin/sh
       set -euo pipefail
       echo "[pre-warm] sending one transcription request to load Whisper-large-v3..."
       # Use the same fixture as the load test
       FIXTURE=tools/load-test/src/fixtures/sample-5s-16k.wav
       # Hit speaches directly (bypassing api/auth) — internal docker network not host-accessible,
       # so we exec inside the speaches container or hit via api with a one-shot signed-in user.
       # Simplest: docker exec speaches curl localhost:8000/v1/audio/transcriptions with the fixture mounted.
       docker compose -f docker-compose.yml -f docker-compose.load-test.yml \
         --profile load-test-realistic exec -T speaches \
         sh -c 'curl -fsS -F file=@/dev/stdin -F model=Systran/faster-whisper-large-v3 http://localhost:8000/v1/audio/transcriptions' \
         < "$FIXTURE" || {
           echo "[pre-warm] FAILED — speaches not ready or fixture path wrong" >&2
           exit 1
         }
       echo "[pre-warm] OK"
       ```
       (If `docker exec` stdin redirection has issues, fall back to mounting the fixture as a volume into the speaches container and curl-ing the local path. Verify at plan execution time.)

    3. Update `Makefile` — add target:
       ```makefile
       .PHONY: load-test
       load-test:
       	@bash tools/load-test/scripts/run.sh $(PROFILE)
       ```
       Default `PROFILE=mock` documented in target help.

    `chmod +x` both scripts. Commit: `feat(08-06): run.sh orchestrator + pre-warm-speaches + Makefile load-test target`.

    Add a smoke test `tools/load-test/scripts/run.test.sh` that asserts run.sh exists, is executable, parses PROFILE arg, and rejects unknown profiles. (No live execution — that's plan 07.)
    - Test 1: `bash run.sh unknown 2>&1 | grep -q "usage"` exits 0 OR rejection appears.
    - Test 2: `grep -F "K6_PROMETHEUS_RW_SERVER_URL" run.sh` finds the env wiring.
    - Test 3: `grep -F "experimental-prometheus-rw" run.sh` finds the k6 output flag.
    Commit run.test.sh + run.sh as a RED→GREEN pair.
  </action>
  <verify>
    <automated>bash tools/load-test/scripts/run.test.sh && test -x tools/load-test/scripts/run.sh && test -x tools/load-test/scripts/pre-warm-speaches.sh && grep -q "load-test" Makefile</automated>
  </verify>
  <done>run.sh + pre-warm-speaches.sh + Makefile target all in place; smoke test passes; documented in run.test.sh.</done>
</task>

</tasks>

<verification>
- `pnpm --filter @openwhispr/load-test test` ALL pass with ≥90/90/90/90 coverage on the diff
- `pnpm --filter @openwhispr/load-test build` produces dist/main.js with k6 externals preserved
- `bash tools/load-test/scripts/run.test.sh` exits 0
- Grafana provisioning loads the dashboard JSON (manual smoke: `make up && curl /api/dashboards/...`)
- `make load-test PROFILE=mock` (DRY RUN: stop after preflight + build, do not actually run k6) — orchestrator can simulate by passing `--dry-run` if needed; live run is plan 07
- All 14 flow unit tests pass with mocked http
- WAV fixture parses as RIFF/WAVE/PCM at 16 kHz mono ≈ 5s
</verification>

<success_criteria>
- All 4 flows implemented + unit-tested with ≥90/90/90/90 coverage
- main.ts is a clean k6 entrypoint binding scenario picker + setup + flows
- tsup bundle preserves k6 externals
- Grafana dashboard 19665 is provisioned and reachable
- `make load-test PROFILE=mock|realistic` is the one-command entrypoint Wave 3 will execute
- Speaches pre-warm script makes realistic-profile cold-start latency invisible to the load test
</success_criteria>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| k6 (host) → Traefik (HTTPS) | Untrusted synthetic traffic crosses into the api |
| mock-litellm → api | api treats mock-litellm output as it would treat real LiteLLM (must validate) |
| WS handshake → realtime gateway | Bearer token in header |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-08-01 | Tampering | mock-litellm accidentally enabled in production compose | mitigate | Mock is profile-gated to load-test-mock only; profile-lint.test.sh (plan 05) asserts |
| T-08-02 | Elevation of Privilege | OPENWHISPR_DISABLE_RATE_LIMIT leaks into production .env | mitigate | Boot WARN banner (plan 01); .env.example annotates LOAD-TEST-ONLY; documented in operations.md |
| T-08-03 | Information Disclosure | Test user accounts persist after load run | mitigate | teardown(data) calls /api/auth/delete-account for each provisioned user; documented operator cleanup as fallback |
| T-08-04 | Spoofing | Self-signed cert at api.localhost makes MITM trivial for k6 traffic | accept | Load test runs against local stack only (no remote target); insecureSkipTLSVerify is scoped to the load-test harness, never the api |
| T-08-05 | DoS | k6 1000-VU run starves the developer Mac | mitigate | preflight.sh checks 24 GB RAM, ports free, no other heavy workloads |
| T-08-06 | Supply chain | speaches/k6/mock-litellm images pulled from public registries | mitigate | Pin to digest in docker-compose.load-test.yml (plan 05); `scripts/verify-images.sh` validation if exists |
</threat_model>

<output>
After completion, create `.planning/phases/08-load-test-tuning-slo-publication/08-06-SUMMARY.md` per template.
</output>
