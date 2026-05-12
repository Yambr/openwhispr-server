# Phase 8: Load Test, Tuning & SLO Publication — Research

**Researched:** 2026-05-12
**Domain:** Load testing (k6) + Postgres/PgBouncer tuning + OS resource limits + operator documentation
**Confidence:** HIGH on locked decisions; MEDIUM on Speaches Apple-Silicon throughput; HIGH on PgBouncer pool semantics

## Summary

Phase 8 is **load-test harness construction + a single on-Mac live run + a documentation deliverable**. The locked CONTEXT decisions specify everything important (executor profile, mix, two compose profiles, ≥1000 VU, 30 minutes, baseline + 20% SLOs, PgBouncer 100×4, FD probe). This research answers *how* to implement those decisions well on a 48 GB M-series Mac with the existing docker-compose stack — not whether or what.

**Primary recommendation:** Native k6 v2.0.0 on the Mac host (`brew install k6`) driving `https://api.localhost` through Traefik; two compose profiles (`load-test-mock`, `load-test-realistic`) added as net-new services without touching the `default` profile; k6 metrics streamed via `--out experimental-prometheus-rw` into the existing Mimir at `compose/mimir` so the live run is visible on Grafana while it executes; a small Node/Fastify mock LiteLLM replaces the real LiteLLM in the `load-test-mock` profile (NOT a config tweak — the existing `compose/litellm/litellm_config.contract.yaml` is for hermetic contract tests, not for variable-latency simulation). PgBouncer scales out to 4 replicas via `deploy.replicas: 4`, each with `DEFAULT_POOL_SIZE=100`. The file-descriptor probe lives in the api and traefik container ENTRYPOINTs and reads `/proc/self/limits`. The first concern is **Apple-Silicon Whisper-large-v3 throughput** in `load-test-realistic` — at ~1× realtime on CPU, the test will be Speaches-bound (not server-bound), which is exactly why D-PROF-1 lables that profile "end-to-end p95 (Mac CPU inference)" and the mock profile carries the actionable gateway p95.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Execution model**
- **D-EXEC-1 — On-demand, manual, local.** `make load-test` (or equivalent npm/pnpm script) runs the k6 scenario against the local docker-compose stack on the developer's Mac. NO nightly cron. NO self-hosted GHA runner. NO ephemeral cloud env. Operators re-run after architectural changes; regression discipline is documented, not automated.
- **D-EXEC-2 — Live run mandatory in this phase.** The first `make load-test` run actually executes on the Mac and produces real baseline numbers. Raw k6 output + summary table embedded in `08-SUMMARY.md`. No estimates, no extrapolated numbers in operations.md.

**Load profile**
- **D-LOAD-1 — 1000 concurrent active users.** Matches CLAUDE.md scale constraint. Lower scale (e.g., 100, 500) is acceptable for development smoke; 1000 is required for the baseline run that establishes published SLO budgets.
- **D-LOAD-2 — 30-minute scenario.** 5m ramp-up → 20m sustained @ 1000 VU → 5m ramp-down. Standard k6 pattern; long enough to flush ramp-up outliers from p95.
- **D-LOAD-3 — v1 assumed mix ratios (locked).** 50% transcribe, 25% reason, 15% agent/stream, 10% WSS realtime. Document in operations.md as `v1 assumed mix; revisit after operator feedback`.

**Compose profiles**
- **D-PROF-1 — Two profiles, both baselines published.**
  - `load-test-mock`: LiteLLM upstream replaced with a mock that returns static responses with simulated latency (sleep(1500ms) for `/v1/audio/transcriptions`, sleep(300ms) for `/v1/chat/completions`, ~200ms first-token for `/v1/chat/completions?stream=true`). Measures gateway + auth + DB + Valkey + Traefik p95 in isolation. Labeled in docs as "gateway p95 (LLM excluded)".
  - `load-test-realistic`: Real Speaches container (Whisper-large-v3 + pyannote) inside compose. Apple Silicon → CPU inference, no GPU passthrough. Measures end-to-end p95. Labeled in docs as "end-to-end p95 (Mac CPU inference)".
- **D-PROF-2 — Both profiles are net-new additions to docker-compose.yml.** Should not affect the existing `default` profile (Phase 07.1 still works). Profile activation via `docker compose --profile load-test-mock up` or `--profile load-test-realistic up`.

**SLO budget model**
- **D-SLO-1 — Baseline-driven, +20% headroom.** First live run establishes p95 per endpoint per profile. Published SLO = p95_baseline × 1.20. Documented per endpoint in operations.md.
- **D-SLO-2 — Two budget tables.** One for gateway p95 (mock profile), one for end-to-end p95 (realistic profile).
- **D-SLO-3 — No CI enforcement in Phase 8.** Phase 8 publishes numbers; future phases or operator-side automation can wire regression checks against them.

**Tuning targets**
- **D-TUNE-1 — PgBouncer 100×4 transaction-mode.** Server-pool 100 per instance × 4 instances. Verified by metrics during the load test (pool exhaustion ratio < 5% under sustained 1000 VU).
- **D-TUNE-2 — File-descriptor limit 65535.** On api + traefik containers. Startup probe in api/traefik checks `prlimit --nofile=65535:65535` (or equivalent) and refuses to start if soft limit < 65535. Default 1024 must NOT silently regress.
- **D-TUNE-3 — No GPU tuning in Phase 8.** Apple Silicon Docker has no GPU passthrough; Speaches inference is CPU. Cloud GPU tuning is Phase 9 (Helm) territory.

**Documentation**
- **D-DOCS-1 — `docs/operations.md`** receives all operator-facing artifacts (how to run, p95 tables, sizing matrix, PgBouncer/FD rationale, limitations explicit).

**Test discipline**
- **D-TDD-1 — Strict TDD** per CLAUDE.md.
- **D-TDD-2 — ≥90/90/90/90 coverage on diff** for any TypeScript/JavaScript code added in `tools/load-test/` or similar.

### Claude's Discretion

- Mock LiteLLM implementation language/runtime (recommendation: Node/Fastify — same stack as api, reusable test fixtures).
- Speaches image variant / version pin (recommendation in §3 below).
- k6 script layout and TypeScript build toolchain (recommendation in §1 below).
- FD-probe implementation detail (shell vs node, location in ENTRYPOINT chain).
- Mac Docker Desktop resource allocation guidance.
- Risk-register and "won't-publish-numbers-unless" exit criteria for the live run.

### Deferred Ideas (OUT OF SCOPE)

- Nightly CI cadence
- Ephemeral cloud env (Phase 9)
- GPU tuning (Phase 9)
- Regression-budget CI gate (future automation)
- Per-tenant load profiles
- xk6-browser scenarios (web frontend)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SCALE-02** | PgBouncer transaction-mode in front of Postgres; sized for 1000 concurrent (server-pool 100 × 4 instances) | §5 PgBouncer tuning — `deploy.replicas: 4` + `DEFAULT_POOL_SIZE=100`; verify via `SHOW POOLS` `cl_waiting` < 1% of `cl_active` (HIGH) |
| **SCALE-06** | Load test (k6) demonstrates 1000 concurrent at p95 SLO | §1 k6 setup, §2 mock LiteLLM, §3 Speaches, §4 auth strategy, §7 Grafana live dashboard |
| **SCALE-07** | File-descriptor limits raised to 65535 on API + ingress containers; documented sizing matrix per topology | §6 FD probe (compose `ulimits:` + ENTRYPOINT probe); §10 operations.md sizing matrix |
| **TEST-LOAD-01** | k6 nightly load test asserts 1000 concurrent at p95 SLO; CI fails on regression | **PARTIALLY SUPERSEDED** by CONTEXT D-EXEC-1: nightly cadence is explicitly deferred; phase 8 ships the harness + first baseline + operator runbook only. Regression-CI is future work — REQUIREMENTS.md text needs an update note in the phase SUMMARY. |
</phase_requirements>

## Standard Stack

### Core

| Tool | Version | Purpose | Why standard |
|------|---------|---------|--------------|
| **k6** | **v2.0.0** (released 2026-05-11) `[VERIFIED: github.com/grafana/k6/releases/latest]` | Load-test driver | Grafana-maintained, Go-binary, single-process can sustain 30-40k VUs on one host; v2.0 is the cleanup major (removed `k6 login`, removed externally-controlled executor, OpenTelemetry exporter envvar rename, Go module path `go.k6.io/k6/v2`) `[CITED: grafana.com/docs/k6/latest/get-started/migrating-to-v2/]` |
| **k6 native binary** | matches above | Run on Mac host, hit Traefik | Avoids Docker-in-Docker tax; `brew install k6` is the documented Mac path; binary is amd64+arm64 |
| **@grafana/k6-types** | latest (npm) | TypeScript types for k6 globals | Type-safety for `import { check, sleep } from 'k6'` and the executors API |
| **tsup** | already in repo (apps/api uses it) | Build TS → single ES bundle k6 can `import` | k6 v2.0 imports plain ES modules; bundling collapses local imports into one file |
| **k6 `experimental-prometheus-rw` output** | bundled in k6 v0.42+ (native) `[CITED: grafana.com/docs/k6/latest/results-output/real-time/prometheus-remote-write/]` | Stream live metrics into Mimir | No xk6 build required — flag-driven. Visualizes in Grafana while the test runs |
| **k6/websockets** | bundled in k6 v2.0 (was `k6/experimental/websockets`, graduated) `[CITED: github.com/grafana/k6/issues/3185]` | WSS realtime scenario | Standard-WebSocket API surface, global event loop, replaces legacy `k6/ws` |
| **Speaches** | `ghcr.io/speaches-ai/speaches:latest-cpu` (latest tagged release **v0.9.0-rc.3**, 2025-12-27) `[VERIFIED: github.com/speaches-ai/speaches/releases]` | OpenAI-compatible STT server | Faster-whisper + dynamic model load/offload; CPU & CUDA variants; project supersedes faster-whisper-server |
| **Mock LiteLLM** | net-new Fastify app under `compose/mock-litellm/` | Static latency-simulated upstream | Internal — same Node 24 + Fastify 5 stack as `apps/api`, leverages existing tsup + Docker patterns |
| **edoburu/pgbouncer** | already pinned `v1.25.1-p0` (compose) | Replicated 4× under load-test profiles | 1.23+ supports `max_prepared_statements` in transaction mode (Drizzle/pg works) `[CITED: pgbouncer.org/config.html, crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer]` |

### Supporting

| Tool | Version | Purpose | When to use |
|------|---------|---------|-------------|
| **k6 Grafana dashboard 19665** | "k6 Prometheus" (Grafana Labs dashboards repository) `[CITED: grafana.com/grafana/dashboards/19665-k6-prometheus/]` | Pre-built panel set for k6 RPS / p95 / VU / errors | Import via `compose/grafana/provisioning/dashboards/k6-prometheus.json`; alternate 18030 if native histograms are enabled |
| **`docker compose config --quiet`** | bundled | Validate compose profile YAML in CI | Used in the TDD step §9 to assert profiles are syntactically valid before the live run |

### Alternatives considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Native k6 on Mac | `grafana/k6:2.0` Docker image | Docker-in-Docker adds latency + network hop overhead between k6 and api; native is the documented path for Mac live runs |
| Mock LiteLLM (Fastify) | Patch `compose/litellm/litellm_config.contract.yaml` with `mock_response` | LiteLLM's `mock_response` is for hermetic CONTRACT-01 tests, NOT variable-latency load simulation; latency injection requires application-level sleep; cleaner to ship a tiny Node service |
| k6 Prometheus remote-write | k6 JSON summary only | JSON summary is end-of-run only; live observation during a 30-min test is required (D-EXEC-2 produces baselines; you need to see the run unfold) |
| Per-VU "scenario picker" | Separate `scenarios{}` blocks per endpoint | See §1 below — single picker with weighted RNG is simpler, deterministically reproduces the 50/25/15/10 mix; separate scenarios complicate VU accounting against the 1000-target |

### Installation

```bash
# Mac host
brew install k6        # k6 v2.0+

# k6 TS deps (in tools/load-test/)
pnpm add -D @grafana/k6-types tsup typescript

# Speaches & mock-litellm images pulled by docker compose
```

### Version verification

| Package | Verified version | Source |
|---------|------------------|--------|
| grafana/k6 | v2.0.0, 2026-05-11 | `curl -s https://api.github.com/repos/grafana/k6/releases/latest` |
| speaches-ai/speaches | v0.9.0-rc.3, 2025-12-27 | `curl -s https://api.github.com/repos/speaches-ai/speaches/releases/latest` |
| edoburu/pgbouncer | v1.25.1-p0 (already pinned in docker-compose.yml) | repository state |
| ghcr.io/berriai/litellm | main-v1.83.14-stable (already pinned, NOT changed) | repository state |
| traefik | v3.6 (already pinned) | repository state |

## Architecture Patterns

### Recommended project structure

```
tools/load-test/
├── package.json                       # @grafana/k6-types, tsup, typescript
├── tsup.config.ts                     # bundles src/* → dist/*.js (k6-importable)
├── k6.config.ts                       # shared options + thresholds (imported by main.ts)
├── src/
│   ├── main.ts                        # entrypoint: exports options + default fn
│   ├── scenario-picker.ts             # weighted RNG over the 4 endpoints (50/25/15/10)
│   ├── setup.ts                       # k6 setup(): provisions 100 users + tokens
│   ├── flows/
│   │   ├── transcribe.ts              # multipart POST /api/transcribe
│   │   ├── reason.ts                  # POST /api/reason
│   │   ├── agent-stream.ts            # POST /api/agent/stream (NDJSON drain)
│   │   └── realtime-ws.ts             # WSS /v1/realtime open + ping + close
│   ├── fixtures/
│   │   ├── sample-5s-16k.wav          # ~80 KB mono PCM WAV, baked into bundle via open()
│   │   ├── prompt-strings.json        # 50 short reasoning prompts
│   │   └── conversation-history.json  # canned messages array
│   └── utils/
│       ├── auth.ts                    # Better Auth sign-up + sign-in helpers
│       └── http.ts                    # base URL, headers, tlsInsecureSkipVerify
├── scripts/
│   ├── run.sh                         # the make-target script
│   └── verify-compose.sh              # `docker compose --profile load-test-mock config --quiet`
└── README.md                          # how to interpret the output

compose/
├── mock-litellm/                      # NEW
│   ├── Dockerfile
│   ├── package.json
│   └── src/server.ts                  # Fastify app, 3 endpoints, configurable latency
└── speaches/                          # NEW
    └── (no files — image pulled, env via compose only)

docker-compose.yml                     # +mock-litellm service (profile: load-test-mock)
                                       # +speaches service (profile: load-test-realistic)
                                       # +pgbouncer scale-out via `deploy.replicas: 4`
                                       # +`ulimits:` block on api + traefik

apps/api/Dockerfile                    # ENTRYPOINT prepends fd-probe before exec node
compose/traefik/Dockerfile             # NEW (currently uses upstream image directly)
                                       # — or use a docker-compose entrypoint override

Makefile                               # `load-test` target invokes tools/load-test/scripts/run.sh
docs/operations.md                     # NEW deliverable (D-DOCS-1)
```

### Pattern 1: Single-scenario "scenario picker" mix

**What:** One k6 `scenarios.main` block of `executor: ramping-vus` with the 5/20/5-min stages. The `default` function picks the endpoint per iteration by weighted RNG.

**When to use:** This phase. Locks 1000-VU envelope cleanly, gives deterministic 50/25/15/10 distribution over enough iterations, simplifies p95 attribution (one tag per request labels which endpoint it was).

**Example:**
```typescript
// Source: grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/
// + grafana.com/docs/k6/latest/using-k6/metrics/create-custom-metrics/

import { check, sleep } from 'k6';
import http from 'k6/http';
import { transcribe } from './flows/transcribe';
import { reason } from './flows/reason';
import { agentStream } from './flows/agent-stream';
import { realtimeWs } from './flows/realtime-ws';
import { pick } from './scenario-picker';

export const options = {
  scenarios: {
    main: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m',  target: 1000 },
        { duration: '20m', target: 1000 },
        { duration: '5m',  target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Threshold-by-endpoint via tag; baseline run records, doesn't enforce
    'http_req_duration{endpoint:transcribe}':   ['p(95)<60000'],  // generous; baseline-establishing
    'http_req_duration{endpoint:reason}':       ['p(95)<10000'],
    'http_req_duration{endpoint:agent-stream}': ['p(95)<15000'],
    'http_req_failed': ['rate<0.01'],
  },
  insecureSkipTLSVerify: true,  // self-signed cert at https://api.localhost
};

// Distribute the 100 pre-provisioned users to VUs
export function setup() {
  return { users: provision100Users() };  // see §4 below
}

export default function (data: { users: User[] }) {
  // Rotate user per-iteration so a single user doesn't blow per-route rate limits
  const user = data.users[(__VU - 1) % data.users.length];
  const endpoint = pick();                                  // weighted RNG
  switch (endpoint) {
    case 'transcribe':   transcribe(user); break;
    case 'reason':       reason(user); break;
    case 'agent-stream': agentStream(user); break;
    case 'realtime-ws':  realtimeWs(user); break;
  }
}
```

The `pick()` weighted RNG is deterministic-seedable (k6 has `Math.random()` only — for the TDD test, factor the RNG behind an injectable `() => number`).

### Pattern 2: k6 metrics → Mimir (live dashboard)

**What:** Run k6 with `--out experimental-prometheus-rw` pointing at Mimir's remote-write endpoint inside the compose network (Mac host can reach via Traefik or by exposing mimir's `9009` to the host).

**Example invocation:**
```bash
# Mac host runs k6; Mimir is on the docker bridge but its OTLP receiver and remote-write
# endpoint can be exposed on a host port for the load test.
export K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9009/api/v1/push
export K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true
export K6_INSECURE_SKIP_TLS_VERIFY=true
k6 run --out experimental-prometheus-rw dist/main.js
```
Note: Mimir is currently NOT exposed on a host port (only Traefik is). Phase 8 adds a port mapping on the `load-test-mock` and `load-test-realistic` profile overrides for `mimir` so the Mac k6 process can push metrics. Internal traffic is unaffected (`default` profile unchanged).

### Pattern 3: PgBouncer horizontal replicas via `deploy.replicas`

**What:** Same image, 4 replicas inside the compose network. Docker DNS round-robins `pgbouncer` to the 4 container IPs. Each replica has `DEFAULT_POOL_SIZE=100` server connections to Postgres → 400 backend connections from PgBouncer, well under Postgres 17's `max_connections` default of 100 — **so `max_connections` on Postgres MUST be raised to ≥500 in the load-test profiles**.

```yaml
# docker-compose.yml under profile: [load-test-mock, load-test-realistic]
pgbouncer:
  # existing fields unchanged
  deploy:
    replicas: 4              # docker-compose v2 supports this for non-Swarm
  environment:
    DEFAULT_POOL_SIZE: "100"
    # rest unchanged

postgres:
  command: ["postgres", "-c", "max_connections=500"]   # load-test-mock + realistic only
```

Caveat: `deploy.replicas` works in docker-compose v2.20+ outside Swarm but the cleaner approach is named services `pgbouncer-1..pgbouncer-4` and a Traefik-style internal alias `pgbouncer`. **Recommended pattern for stability:** explicit 4 service entries + Docker network alias `pgbouncer` shared by all 4, with health-gated round-robin via `depends_on`. This eliminates docker-compose-deploy-replicas edge cases (HEALTHCHECK runs per replica; alias-shared services are well-tested). The api's `DATABASE_URL_APP=postgresql://...@pgbouncer:5432/...` resolves to one of the 4 backends per connection.

### Pattern 4: File-descriptor probe + ulimit

**What:** Two coordinated mechanisms.

1. `ulimits:` block in docker-compose.yml raises the OS soft+hard limits for the container processes:
   ```yaml
   api:
     ulimits:
       nofile:
         soft: 65535
         hard: 65535
   traefik:
     ulimits:
       nofile:
         soft: 65535
         hard: 65535
   ```
2. ENTRYPOINT probe reads `/proc/self/limits` and exits 1 if the soft limit is < 65535. This catches the case where docker-compose lost the `ulimits:` block in a future PR.

   ```sh
   #!/bin/sh
   # apps/api/scripts/fd-probe.sh — chained before `exec node /app/...`
   ulimit_n=$(ulimit -n)
   if [ "$ulimit_n" -lt 65535 ]; then
     echo "[fd-probe] soft fd limit $ulimit_n < 65535 — refusing to start (D-TUNE-2)" >&2
     exit 1
   fi
   exec "$@"
   ```

   Wired into `apps/api/Dockerfile` ENTRYPOINT chain alongside the existing `check-default-secrets.cjs`. For Traefik, the upstream image is used; layer this by either (a) baking a thin `compose/traefik/Dockerfile` that wraps the official image with the probe, or (b) overriding the `command:` to run the probe then `exec /entrypoint.sh traefik`.

   **Recommended:** option (b) for Traefik (no image rebuild), option (a)-equivalent (ENTRYPOINT chain modification) for api.

### Anti-Patterns to avoid

- **Running k6 inside docker-compose alongside the system-under-test.** Resource contention between the k6 process and the api/postgres makes the numbers worthless. The Mac host runs k6 natively; only the SUT runs in compose.
- **Hand-rolling latency simulation in LiteLLM YAML.** LiteLLM's `mock_response` is a stub — no jitter, no realistic distribution. A 50-line Fastify app does it correctly with `await new Promise(r => setTimeout(r, mean + jitter()))`.
- **Provisioning 1000 unique users.** Better Auth sign-up has a per-IP and per-email rate limit; 1000 sign-ups from the same Mac IP would itself trigger throttling. Pre-provision 100 users; each VU rotates through them (specifics §4).
- **Asserting hard SLO thresholds in the FIRST run.** This phase ESTABLISHES baselines. Thresholds in `options.thresholds` should be generous; the published SLO = baseline × 1.20 comes from the *output*, not the threshold input.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Load test executor | a Node script with `Promise.all([1..1000])` | k6 | k6's Go runtime + per-VU JS isolate handles 1000 VUs in <5 GB RAM; Node's single-thread event loop chokes |
| WebSocket load testing | k6/ws with a custom event loop | `k6/websockets` (k6 v2 native, was xk6-websockets) | Standard WebSocket API surface, global event loop, well-tested under sustained load `[CITED: github.com/grafana/k6/issues/3185]` |
| Live metrics streaming | parsing k6 JSON output mid-run | `--out experimental-prometheus-rw` | k6 v0.42+ native flag; no xk6 build, no parser to maintain |
| Grafana k6 dashboard | building from scratch | Import dashboard ID **19665** (k6 Prometheus) | Maintained by Grafana Labs; panels for VUs, p95 by endpoint, RPS, error rate |
| Multipart audio fixture generation | piping ffmpeg in a hot path | bake a real 5-second 16kHz mono WAV (~80 KB) committed to `tools/load-test/src/fixtures/sample-5s-16k.wav` | k6's `open()` reads file at script-init time; no per-iteration cost |
| Test-user provisioning | spawning 1000 BA sign-ups | provision 100 in `setup()`, store bearer tokens in SharedArray, VUs rotate | BA rate limit is per-IP + per-email; 100 amortizes across the 30-min run |
| FD probe | parsing `/proc/self/limits` in TypeScript at API startup | shell `ulimit -n` in ENTRYPOINT before `exec node` | Probe must run BEFORE the Node process opens its first connection — Node's V8 startup itself consumes ~30 FDs |
| pgbouncer pool sizing math | a Node tuning script | document the 100×4 = 400-backend formula in operations.md | Static formula; SCALE-02 is locked at 100×4 |

**Key insight:** k6 is itself the abstraction. Everything in this phase is gluing k6 to the existing OpenWhispr stack and translating its output into operator-readable SLO budgets. No custom load-test framework, no custom metrics aggregator, no custom dashboarding.

## Runtime State Inventory

Phase 8 adds new compose services and configuration; it does NOT rename, refactor, or migrate existing runtime state. This section is omitted.

## Common Pitfalls

### Pitfall 1: Mac Docker Desktop default RAM is 8 GB
**What goes wrong:** Compose stack (postgres + 4×pgbouncer + valkey + traefik + api + worker + otel + loki + tempo + mimir + grafana + minio + speaches) crosses 12–14 GB; Docker Desktop OOM-kills services mid-run; p95 spikes from container restarts contaminate the baseline.
**Why it happens:** Docker Desktop on Mac runs everything inside a Linux VM with a fixed RAM ceiling.
**How to avoid:** Document in operations.md and the make-target preflight: Docker Desktop → Settings → Resources → RAM ≥ 32 GB, CPU ≥ 6 cores. `make load-test` runs a `docker info` probe and refuses to start if the host advertises < 24 GB (allowing some headroom under the requested 32).
**Warning signs:** Mid-run `docker compose logs api` shows container exit code 137 (SIGKILL = OOM); grafana RED panels show p95 doubling abruptly at minute N.

### Pitfall 2: Apple Silicon Whisper-large-v3 is ~1× realtime on CPU
**What goes wrong:** `load-test-realistic` 5-second audio takes 5+ seconds to transcribe on Mac CPU; under 500 transcribe RPS expected by the mix at 1000 VUs, Speaches becomes a saturation bottleneck and p95 reflects queue depth, not server work.
**Why it happens:** Whisper-large-v3 is a 1.55 B-param encoder-decoder; faster-whisper / CT2 quantized still runs roughly 1× realtime on M1 CPU for "large" model, faster on M2/M3 but still bound by RAM bandwidth `[CITED: macparakeet.com — Whisper, Parakeet, and Race; community benchmarks]`.
**How to avoid:** This is BY DESIGN per D-PROF-1. operations.md labels the realistic profile baseline as "end-to-end p95 (Mac CPU inference) — bounded by developer hardware, NOT a production prediction." The mock-profile baseline is the operator-actionable number.
**Warning signs:** transcribe p95 in `load-test-realistic` is 10–60× of mock profile p95; speaches container CPU sits at 100% across all assigned cores; transcribe error rate climbs from request-timeout, not 5xx.

### Pitfall 3: PgBouncer transaction mode + prepared statements pitfall
**What goes wrong:** Drizzle issues SQL with implicit prepared statements; in transaction mode without `max_prepared_statements > 0` PgBouncer raises `ERROR: prepared statement does not exist` because each transaction borrows a different server connection.
**Why it happens:** Transaction-mode pooling rotates server connections per transaction; prepared statements live per-server-conn. PgBouncer 1.21+ added LRU caching of prepared statements across rotations `[CITED: crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer]`.
**How to avoid:** Already configured — `MAX_PREPARED_STATEMENTS=200` in current docker-compose.yml line 101. Phase 8 keeps that value for all 4 replicas; the load test will verify under sustained traffic by tailing pgbouncer logs for `prepared statement does not exist` errors (zero tolerance).
**Warning signs:** api logs contain `prepared statement does not exist`; pg_stat_statements diverges from pgbouncer's `SHOW STATS` query counts.

### Pitfall 4: Better Auth bearer rotation interferes with long-running VUs
**What goes wrong:** AUTH-03 specifies bearer rotation via `set-auth-token` response header; VUs that don't read+re-set the bearer between iterations get 401s mid-run.
**Why it happens:** Better Auth issues a fresh bearer when the previous one ages past a threshold; old token has a 5-min grace window. A 30-min test sustains well beyond that.
**How to avoid:** k6 `flows/*.ts` helpers extract `set-auth-token` from every response and update the in-VU bearer state. Alternative: pre-provision tokens with the **30-day** TTL (already the default per AUTH-03) and rely on grace overlap — but the explicit refresh handler is more correct.
**Warning signs:** 401 rate climbs as the test ages past ~5 minutes; k6 thresholds for `http_req_failed` blow past the 1% floor.

### Pitfall 5: Better Auth + Fastify rate limit still throttles k6 traffic
**What goes wrong:** Phase 6 rate-limit policy is 60/min user-tier + global IP ceiling. 1000 VUs from one Mac IP burns through the IP ceiling in <1 second; even with 100 users rotating, each user's per-route limit fires (transcribe is 20/min user-tier per `routeRateLimitConfig`).
**Why it happens:** The rate limit is doing its job. Synthetic load needs to bypass.
**How to avoid:** Current state — `RATE_LIMIT_GLOBAL_USER_MAX` env var exists (Phase 07.1) but **there is NO general "disable rate limit" env switch** `[VERIFIED: grep -rn OPENWHISPR_DISABLE_RATE_LIMIT apps/]` (the CONTEXT.md reference at lines 75 and 95 is a forward-looking note, not implemented code). Phase 8 MUST add an `OPENWHISPR_DISABLE_RATE_LIMIT=1` env switch to `apps/api/src/plugins/rate-limit.ts` AND to Better Auth (`apps/api/src/auth.ts` has its own rate-limiter at line 261-266+). Switch is set ONLY in the load-test compose profiles; the default profile is unaffected. Add a unit test asserting that with the env unset, the limiter still fires.
**Warning signs:** k6 `http_req_failed{status:429}` becomes non-zero; 429 responses dominate the first minute of ramp-up.

### Pitfall 6: Streaming endpoints + k6 HTTP client buffer entire body
**What goes wrong:** `POST /api/agent/stream` returns NDJSON with chunked encoding; k6's default `http.post()` waits for the response body to complete before recording `http_req_duration`. p95 becomes "time to last byte" not "time to first byte" — different SLO than what operators care about.
**Why it happens:** k6's http module is a request-response abstraction; it doesn't expose first-byte time directly.
**How to avoid:** For agent/stream, record TWO custom metrics:
  - `agent_stream_ttfb` via `http_req_waiting` tag (k6 exposes time-to-first-byte as `http_req_waiting`)
  - `agent_stream_total` from `http_req_duration`
operations.md publishes TTFB as the primary p95 for streaming endpoints (matches operator intuition about "responsiveness").

### Pitfall 7: TLS verification breaks on self-signed cert
**What goes wrong:** k6 default rejects the self-signed cert at `https://api.localhost` (compose/traefik/certs); test fails on `x509: certificate signed by unknown authority`.
**Why it happens:** The bootstrap-generated root CA is trusted by the contract-test-runner (via NODE_EXTRA_CA_CERTS) but the Mac-host k6 has no such trust.
**How to avoid:** Set `insecureSkipTLSVerify: true` in k6 `options` (already in the example above) OR set `K6_INSECURE_SKIP_TLS_VERIFY=true` env. Both work; the options form is documented in the script.
**Warning signs:** k6 startup logs `x509: certificate signed by unknown authority`; zero requests succeed.

### Pitfall 8: Mimir host port not exposed
**What goes wrong:** k6 runs on the Mac host; `--out experimental-prometheus-rw` needs to reach Mimir's remote-write endpoint. The current `mimir` service exposes nothing to the host.
**Why it happens:** Default compose isolates Mimir to the internal bridge.
**How to avoid:** Under the load-test profiles, expose Mimir's `9009` to host as `localhost:9009`. The `default` profile is unaffected. Documented in operations.md as a load-test-only port.

### Pitfall 9: macOS file descriptor host limit lower than container request
**What goes wrong:** Docker Desktop's Linux VM has its own FD limits inherited from the host launchd/init; raising the container's nofile to 65535 may be capped by the VM's limit (default ~1M on recent Docker Desktop, but worth checking).
**Why it happens:** Container ulimit cannot exceed the kernel namespace's nr_open.
**How to avoid:** Probe the host before the run: `sysctl kern.maxfilesperproc` on macOS (and `ulimit -n` inside the VM via `docker run --rm alpine sh -c 'ulimit -n'`). Document the threshold in operations.md.

### Pitfall 10: Speaches loads the model on first request (cold start)
**What goes wrong:** Speaches' dynamic-model loading defers Whisper-large-v3 download + load to the FIRST `/v1/audio/transcriptions` request. The first request takes 30–120 s. k6 ramp-up records this as a 30 s p95 outlier.
**Why it happens:** Speaches' design — lazy model load (faster boot, can hot-swap models).
**How to avoid:** Pre-warm: the `make load-test` target hits `/v1/audio/transcriptions` ONCE with a tiny WAV against the realistic profile before launching the actual k6 run, and waits for 200. Alternative: set Speaches env var to preload models at startup (check Speaches v0.9 README — `PRELOAD_MODELS` or similar; verify at implementation time).

## Code Examples

### Mock LiteLLM Fastify endpoint shapes

```typescript
// Source: own design, mirrors LiteLLM /v1/audio/transcriptions wire shape per
// compose/litellm/litellm_config.yaml and apps/api/src/routes/transcribe.ts:53–58

import Fastify from 'fastify';
import multipart from '@fastify/multipart';

const app = Fastify({ logger: false });
await app.register(multipart);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (mean: number, sd: number) =>
  Math.max(50, mean + (Math.random() * 2 - 1) * sd);

app.post('/v1/audio/transcriptions', async (req, reply) => {
  // Drain the multipart body before responding — clients (transcribe.ts forwards
  // req.raw) will hang if we close the upstream half-duplex socket early.
  for await (const _part of req.parts()) { /* consume */ }
  await sleep(jitter(1500, 400));
  return {
    text: 'lorem ipsum dolor sit amet consectetur adipiscing elit',
    duration: 5.0,
    language: 'en',
  };
});

app.post('/v1/chat/completions', async (req, reply) => {
  const body = req.body as { stream?: boolean };
  if (body?.stream) {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    });
    await sleep(jitter(200, 50));  // ~200ms first token
    reply.raw.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hello ' }}]})}\n\n`);
    await sleep(jitter(50, 20));
    reply.raw.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'world' }}]})}\n\n`);
    reply.raw.write(`data: [DONE]\n\n`);
    reply.raw.end();
    return reply;
  }
  await sleep(jitter(300, 80));
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    choices: [{ message: { role: 'assistant', content: 'mock response' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
});

app.get('/health/liveliness', async () => ({ status: 'ok' }));

await app.listen({ port: 4000, host: '0.0.0.0' });
```

### k6 setup() — user provisioning

```typescript
// Source: grafana.com/docs/k6/latest/using-k6/test-lifecycle/ + apps/api/src/auth.ts Better Auth
import http from 'k6/http';

const BACKEND = 'https://api.localhost';
const N_USERS = 100;

export function setup() {
  const users: Array<{ email: string; token: string }> = [];
  for (let i = 0; i < N_USERS; i++) {
    const email = `loadtest-${i}-${Date.now()}@example.local`;
    const password = `LoadTest!${i}#aB`;
    // Sign-up + auto-sign-in via Better Auth
    const r = http.post(`${BACKEND}/api/auth/sign-up/email`, JSON.stringify({
      email, password, name: `LoadTest ${i}`,
    }), { headers: { 'content-type': 'application/json' }, tags: { setup: 'true' } });
    if (r.status !== 200) throw new Error(`sign-up ${i} failed: ${r.status}`);
    // BA returns the bearer in body.token or in set-auth-token header
    const body = r.json() as { token?: string };
    const token = body?.token ?? r.headers['Set-Auth-Token'];
    if (!token) throw new Error(`no token for user ${i}`);
    users.push({ email, token });
  }
  return { users };
}
```

### Compose profile addition skeleton (illustrative)

```yaml
# docker-compose.yml additions (NOT exhaustive — see Plan for full diff)

services:

  mock-litellm:
    build:
      context: ./compose/mock-litellm
    profiles: [load-test-mock]
    networks:
      openwhispr_internal:
        aliases: [litellm]   # api's LITELLM_BASE_URL=http://litellm:4000 resolves here
    healthcheck:
      test: ["CMD", "wget", "--spider", "--quiet", "http://localhost:4000/health/liveliness"]
      interval: 5s
      timeout: 3s

  speaches:
    image: ghcr.io/speaches-ai/speaches:latest-cpu
    profiles: [load-test-realistic]
    networks: [openwhispr_internal]
    environment:
      WHISPER_MODEL: Systran/faster-whisper-large-v3
    healthcheck:
      test: ["CMD", "wget", "--spider", "--quiet", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      start_period: 180s  # generous — model preload on CPU is slow

  # api / traefik gain ulimits under the load-test profiles only — use profile-
  # specific overrides via docker-compose.load-test.override.yml OR conditionally
  # via env var on the existing services (preferred: keep one compose file).
```

### Scenario picker

```typescript
// Source: own design; deterministic seedable RNG for the TDD test
export type Endpoint = 'transcribe' | 'reason' | 'agent-stream' | 'realtime-ws';

const WEIGHTS: Record<Endpoint, number> = {
  'transcribe':   50,
  'reason':       25,
  'agent-stream': 15,
  'realtime-ws':  10,
};

export function pickWith(rng: () => number): Endpoint {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const [ep, w] of Object.entries(WEIGHTS)) {
    if ((r -= w) <= 0) return ep as Endpoint;
  }
  return 'transcribe';  // unreachable
}

export const pick = () => pickWith(Math.random);
```

The TDD test injects a seeded RNG and asserts that over 10,000 iterations the distribution is within ±2% of 50/25/15/10.

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| JMeter / Gatling for HTTP load | k6 v2 | ~2021 (k6 mainstream); v2 cleanup 2026-05-11 | Lower overhead per VU; TypeScript scripts; native Prometheus output |
| Hand-coded `Math.random()` mix in scenarios | weighted scenario-picker function | Always (k6 idiom) | One executor → one VU pool target = 1000; mix is per-iteration |
| InfluxDB for k6 results | Prometheus remote-write → Mimir | k6 v0.42+ | Native integration with existing LGTM stack; `k6 login influxdb` removed in v2 |
| `k6/ws` | `k6/websockets` (graduated from `k6/experimental/websockets`) | k6 v2 stabilization | Standard WebSocket API; better global event loop |
| faster-whisper-server (project) | speaches-ai/speaches | renamed ~2024 | Same upstream maintainer; broader scope (TTS too) |

**Deprecated/outdated (relative to this phase):**
- `k6 login cloud` / `k6 login influxdb` — removed in k6 v2. We don't use cloud anyway.
- `K6_OTEL_EXPORTER_TYPE` → use `K6_OTEL_EXPORTER_PROTOCOL`. Not in our path (we use prometheus-rw, not OTel).
- `browser_web_vital_fid` → INP. Not in scope (no browser scenarios).

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | Speaches `latest-cpu` image tag exists and preloads Whisper-large-v3 via `WHISPER_MODEL` env | §3 Code Examples | Plan task must verify exact image tag + env var names at Speaches v0.9.0-rc.3 README time; impact = swap image tag, no architectural change `[ASSUMED]` |
| A2 | Mac Docker Desktop nofile limit ≥ 65535 by default | Pitfall #9 | If lower, `ulimits: nofile=65535` is silently capped; FD probe correctly fails and operator sees the error. **No false-pass risk.** `[ASSUMED]` |
| A3 | k6 v2 native `k6/websockets` supports the OpenAI Realtime WSS handshake (binary frames + custom subprotocol if any) | §1, flows/realtime-ws | Could need to drop to `k6/ws` legacy or skip WSS load-testing in v1. Mitigation: smoke-test in Wave 0. `[ASSUMED]` |
| A4 | k6 native binary on Mac M-series can drive 1000 VUs (each opening an HTTP/2 + 100 WSS connections) without saturating the Mac itself | §1, §8 | k6's documented envelope is 30–40k VU/process; 1000 is well within range, but the WSS path keeps connections open. Mitigation: monitor `top` during the run. `[VERIFIED for HTTP: grafana.com/docs/k6/.../running-large-tests]` `[ASSUMED for mixed HTTP+WSS]` |
| A5 | `OPENWHISPR_DISABLE_RATE_LIMIT` env switch does NOT exist in current code | Pitfall #5 | Wave 0 task to ADD this switch (referenced in CONTEXT lines 75, 95 as if it exists). `[VERIFIED: grep returned 0 matches in apps/, packages/, .env.example]` |
| A6 | `docker compose deploy.replicas` works in non-Swarm mode for v2.20+ | Pattern 3 | Recommend the explicit 4-service alternative (more reliable across docker-compose versions). `[ASSUMED — needs Plan-time verification]` |
| A7 | Better Auth sign-up at 100/test does not itself need rate-limit bypass for the setup() phase | §4 | If BA sign-up rate limits at <100/min/IP, setup() must run serially with a 1s pacing OR pre-provision users via a one-shot script before k6 starts. Mitigation: pre-provision via a separate `make load-test-seed` target run once. `[ASSUMED]` |
| A8 | Whisper-large-v3 throughput is "roughly 1× realtime" on M-series CPU | Pitfall #2 | Published numbers span 0.5×–2× depending on M1 vs M3 and quantization. The exact baseline is what Phase 8 measures and publishes — we are NOT predicting, we are MEASURING. `[CITED but bounded: macparakeet, fazm.ai]` |
| A9 | Mimir's remote-write endpoint accepts the k6 prometheus-rw output without auth (single-tenant default) | Pattern 2 | If Mimir requires tenant header in multi-tenant mode, set `K6_PROMETHEUS_RW_HEADERS=X-Scope-OrgID:openwhispr`. Mitigation: verify `compose/mimir/mimir.yaml` runs single-tenant. `[ASSUMED]` |

**Empty cells:** none — all assumptions enumerated for planner.

## Open Questions

1. **Should `OPENWHISPR_DISABLE_RATE_LIMIT` be one switch or two (Fastify rate-limit + Better Auth rate-limit)?**
   - What we know: They're two distinct subsystems (`apps/api/src/plugins/rate-limit.ts` and Better Auth's internal limiter in `auth.ts` lines 261-266+).
   - What's unclear: Whether one env var should kill both, or each gets its own switch.
   - Recommendation: ONE env var (`OPENWHISPR_DISABLE_RATE_LIMIT=1`) that disables both. Simpler operator surface; the two subsystems should never disagree about whether the environment is a load test.

2. **Speaches model preload mechanism**
   - What we know: Speaches supports dynamic load/offload by model name in request.
   - What's unclear: Whether v0.9.0-rc.3 has a `PRELOAD_MODELS` env (or similar) to load Whisper-large-v3 at boot.
   - Recommendation: Plan-time spike: read Speaches v0.9 README/env-var docs. If no preload env: keep the pre-warm hit in `make load-test`.

3. **Should the load test run via Traefik or directly against the api container?**
   - What we know: Locked decision implies Traefik (HTTPS-only constraint).
   - What's unclear: Whether to also publish "direct-to-api" numbers in operations.md so operators can subtract Traefik overhead.
   - Recommendation: Through Traefik (matches production); operations.md can note that Traefik overhead is typically <5ms p95 and reference Phase 6 instrumentation for the breakdown.

4. **Where does the raw k6 summary JSON live for `08-SUMMARY.md`?**
   - What we know: D-EXEC-2 says "Raw k6 output + summary table embedded in `08-SUMMARY.md`."
   - What's unclear: Whether to embed JSON inline (large) or commit it as `tools/load-test/results/2026-05-XX-baseline-mock.json` and reference from SUMMARY.
   - Recommendation: commit raw JSON to `tools/load-test/results/`; SUMMARY embeds the digested table + links the JSON.

5. **TEST-LOAD-01 wording reconciliation**
   - REQUIREMENTS.md TEST-LOAD-01: "k6 nightly load test asserts 1000 concurrent at p95 SLO; CI fails on regression."
   - CONTEXT D-EXEC-1: nightly cron explicitly deferred.
   - Recommendation: Phase 8 SUMMARY notes the deviation and proposes a v1 amendment to TEST-LOAD-01 ("k6 manual on-demand load test; nightly + CI-regression are v2"). Planner adds a task to update REQUIREMENTS.md when SUMMARY lands.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Desktop (Mac) | All compose services | ✓ (operator must ensure ≥32 GB RAM, ≥6 CPU allocated) | latest | none — operator must allocate |
| k6 native binary | k6 run on host | ✗ (not installed at research time) | — | `brew install k6` documented in operations.md; OR `docker run grafana/k6:2.0` (fallback) |
| Node 24 + pnpm | tools/load-test bundling, mock-litellm build | ✓ (repo standard) | 24-LTS / pnpm 11 | none needed |
| ghcr.io/speaches-ai/speaches:latest-cpu | load-test-realistic profile | ✗ (not pulled) | v0.9.0-rc.3 (latest) | Skip realistic profile, ship only mock baseline + clear deferral note |
| Whisper-large-v3 model weights (Hugging Face) | Speaches first run | ✗ (downloaded at container first start) | Systran/faster-whisper-large-v3 | Operator HF token if rate-limited |
| Mimir host port 9009 | k6 prometheus-rw output | ✗ (not currently exposed) | — | Phase 8 adds host port mapping under load-test profiles only |
| OS file-descriptor limit | api + traefik tuning | ✓ via `ulimits:` block | 65535 target | FD probe blocks startup if missing |

**Missing dependencies with no fallback:** None — Speaches is the only hard-to-replace dependency, and the mock profile is independent of it.

**Missing dependencies with fallback:** k6 (brew vs docker), Speaches (defer realistic baseline if image unavailable).

## Validation Architecture

### Test framework

| Property | Value |
|----------|-------|
| Framework (existing) | Vitest 1.x for unit, Playwright for e2e (web), in-cluster Docker contract-tests |
| New test files this phase | `tools/load-test/src/**/*.test.ts` (Vitest, unit), shell scripts assert compose validity |
| Config file | `tools/load-test/vitest.config.ts` (new, mirrors `apps/api/vitest.config.ts`) |
| Quick run command | `pnpm --filter @openwhispr/load-test test` |
| Full suite command | `pnpm test` (root, picks up new package) |

### Phase requirements → test map

| Req ID | Behavior | Test type | Automated command | File exists? |
|--------|----------|-----------|-------------------|-------------|
| SCALE-02 | PgBouncer 4 replicas × pool 100 keeps cl_waiting < 5% under 1000 VU | manual (during live run; SHOW POOLS snapshot at mid-test) | `docker compose exec pgbouncer psql -h 127.0.0.1 -p 5432 -U pgbouncer_admin pgbouncer -c 'SHOW POOLS'` | ❌ Wave 0 documents the verification recipe |
| SCALE-02 | Compose profile YAML is syntactically valid | unit (shell + docker compose config) | `docker compose --profile load-test-mock config --quiet && docker compose --profile load-test-realistic config --quiet` | ❌ Wave 0 — `tools/load-test/scripts/verify-compose.sh` |
| SCALE-06 | Scenario picker produces 50/25/15/10 over 10,000 iterations | unit | `vitest run scenario-picker.test.ts` | ❌ Wave 0 |
| SCALE-06 | setup() user provisioning is idempotent (re-run does not error) | unit | `vitest run setup.test.ts` (mocked http) | ❌ Wave 0 |
| SCALE-06 | Mock LiteLLM `/v1/audio/transcriptions` returns valid TranscribeResponse-shaped body | unit | `vitest run compose/mock-litellm/src/server.test.ts` | ❌ Wave 0 |
| SCALE-06 | Mock LiteLLM latency mean+jitter within expected window | unit | `vitest run --testTimeout 5000 latency.test.ts` (statistical assertion over 50 samples) | ❌ Wave 0 |
| SCALE-06 | `make load-test` end-to-end (the live run itself) produces non-empty k6 summary JSON | manual (the live run is the test) | `make load-test && test -s tools/load-test/results/$(date)-baseline-mock.json` | ❌ Wave 4 |
| SCALE-07 | FD probe rejects ulimit < 65535 | unit (shell) | `bash tools/load-test/scripts/fd-probe.test.sh` simulating ulimit 1024 | ❌ Wave 0 |
| SCALE-07 | FD probe passes at ulimit 65535 | unit (shell) | same script, different sim value | ❌ Wave 0 |
| SCALE-07 | api Dockerfile contains the probe wiring | unit (grep + AST check) | `vitest run dockerfile.test.ts` (regex on Dockerfile body) | ❌ Wave 0 |
| TEST-LOAD-01 | Live run completes without container restarts | manual exit gate | `docker compose ps --filter status=restarting` returns empty | ❌ Wave 4 |
| TEST-LOAD-01 | Live run error rate < 1% | manual exit gate | k6 thresholds `http_req_failed: rate<0.01` | ❌ Wave 4 |

### Sampling rate

- **Per task commit:** `pnpm --filter @openwhispr/load-test test` (sub-second; unit tests only)
- **Per wave merge:** `pnpm test` + `bash tools/load-test/scripts/verify-compose.sh`
- **Phase gate:** ONE actual `make load-test` live run on the developer Mac. Two passes: `--profile load-test-mock` and `--profile load-test-realistic`. Total ~60 minutes wall clock. Exit gates: error rate < 1%, no container restarts, all four endpoints report p95.

### Wave 0 gaps

- [ ] `tools/load-test/package.json` — workspace package definition
- [ ] `tools/load-test/vitest.config.ts` — Vitest config inheriting root preset
- [ ] `tools/load-test/src/scenario-picker.test.ts` — RED first
- [ ] `tools/load-test/src/setup.test.ts` — RED first (mocked http)
- [ ] `compose/mock-litellm/src/server.test.ts` — RED first (Fastify inject)
- [ ] `tools/load-test/scripts/fd-probe.test.sh` — shell-test for the probe
- [ ] `tools/load-test/scripts/verify-compose.sh` — compose-config CI assertion
- [ ] Wave 0 also includes: ADD `OPENWHISPR_DISABLE_RATE_LIMIT` env switch + unit test to `apps/api/src/plugins/rate-limit.ts` AND Better Auth config

## Security Domain

### Applicable ASVS categories

| ASVS Category | Applies | Standard control |
|---------------|---------|------------------|
| V2 Authentication | yes — Better Auth bearer reuse | Use existing Better Auth flow in `setup()`; load test does NOT bypass auth (rate limit only) |
| V3 Session Management | yes | k6 honors `set-auth-token` rotation in helpers; no session-fixation |
| V4 Access Control | no (single-tenant load) | n/a for this phase |
| V5 Input Validation | yes — mock LiteLLM accepts arbitrary multipart | Mock validates content-type and consumes body; never echoes input |
| V6 Cryptography | no new crypto | n/a |
| V7 Error Handling | yes | Mock LiteLLM error envelope matches LiteLLM shape so api error-mapping is exercised under load |
| V14 Configuration | yes | `OPENWHISPR_DISABLE_RATE_LIMIT` MUST default OFF; documented as load-test-only; CLAUDE.md-style `--no-rate-limit` red flag |

### Known threat patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| `OPENWHISPR_DISABLE_RATE_LIMIT=1` leaks into production .env | Elevation of Privilege | Document in .env.example as LOAD-TEST-ONLY; add a startup-banner warn in api when the flag is on; CI grep for the flag in production .env templates |
| Mock LiteLLM accidentally enabled in production compose | Tampering | Profile-gated; never in `default`; lint test asserts mock-litellm has `profiles: [load-test-mock]` and no other profile |
| Test user accounts persist after load run | Information Disclosure | k6 `teardown()` calls `/api/auth/delete-account` for each provisioned user; documented operator step to drop the test tenant if teardown misses any |
| Speaches image not version-pinned | Supply chain | Pin to a specific tag (NOT `:latest`); verify image digest in `scripts/verify-images.sh` |

## Project Constraints (from CLAUDE.md)

- **English-only source** for all new files (tools/load-test/, compose/mock-litellm/, docs/operations.md).
- **Strict TDD:** every code file (including k6 scripts, mock server) has its test land in the SAME commit, RED before GREEN.
- **≥90/90/90/90 coverage on diff** for all TS/JS added in `tools/load-test/` and `compose/mock-litellm/`.
- **No mocks of internal logic:** the mock-litellm IS a process boundary (external HTTP service). PgBouncer + Postgres + Valkey + api stay real under load.
- **No workarounds:** if a layer (e.g., rate-limit bypass) needs an env switch, it lands as a properly-tested feature, not a `--legacy` flag or commented-out code.
- **GitHub Actions only sanctioned CI:** Phase 8 does NOT add the load test to CI (D-EXEC-1); it does add the unit-test files which automatically join the existing CI matrix.
- **HTTPS only:** k6 hits `https://api.localhost` (Traefik); mock-litellm is HTTP-only on the internal bridge, which is correct (no external port).
- **No bundled local AI models** (per global memory `feedback_no_bundled_local_models`): Speaches in `load-test-realistic` is a TEST-ONLY profile dependency, explicitly NOT part of the shipping default stack. This is consistent — Speaches is reference-only for production; here it's a measurement instrument.

## Sources

### Primary (HIGH confidence)
- [grafana.com/docs/k6/latest/get-started/migrating-to-v2/](https://grafana.com/docs/k6/latest/get-started/migrating-to-v2/) — k6 v2 migration guide
- [grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/) — ramping-vus executor reference
- [grafana.com/docs/k6/latest/results-output/real-time/prometheus-remote-write/](https://grafana.com/docs/k6/latest/results-output/real-time/prometheus-remote-write/) — k6 `experimental-prometheus-rw`
- [grafana.com/docs/k6/latest/testing-guides/running-large-tests/](https://grafana.com/docs/k6/latest/testing-guides/running-large-tests/) — VU memory sizing
- [pgbouncer.org/config.html](https://www.pgbouncer.org/config.html) — `max_prepared_statements`, pool_mode
- [crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer](https://www.crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer) — prepared-statements in transaction mode pitfalls
- [github.com/grafana/k6/releases](https://github.com/grafana/k6/releases) — k6 v2.0.0 release verification (2026-05-11)
- [github.com/speaches-ai/speaches](https://github.com/speaches-ai/speaches) — Speaches releases, image registry

### Secondary (MEDIUM confidence)
- [grafana.com/grafana/dashboards/19665-k6-prometheus/](https://grafana.com/grafana/dashboards/19665-k6-prometheus/) — k6 Grafana dashboard
- [github.com/grafana/k6/issues/3185](https://github.com/grafana/k6/issues/3185) — k6/websockets graduation
- [macparakeet.com/blog/whisper-to-parakeet-neural-engine/](https://macparakeet.com/blog/whisper-to-parakeet-neural-engine/) — Apple-Silicon Whisper benchmarks

### Tertiary (LOW confidence, flagged in Assumptions)
- Community benchmarks for Speaches throughput on M-series CPU — varies; Phase 8 measures empirically rather than relying on these.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via GitHub API; k6 + PgBouncer behavior well-documented
- Architecture patterns: HIGH — k6 + compose + Traefik well-established; mock-litellm is a thin wrapper
- Pitfalls: HIGH on pitfalls 3, 4, 5, 7 (verified against current codebase); MEDIUM on pitfall 2 (Apple-Silicon throughput is empirically variable — the whole point of the live run); HIGH on pitfall 10 (Speaches docs imply cold start)
- Environment availability: HIGH

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days; k6 v2 just landed, Speaches at rc.3 — both stable enough to plan against)
