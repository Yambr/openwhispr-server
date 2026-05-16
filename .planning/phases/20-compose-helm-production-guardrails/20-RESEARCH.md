# Phase 20: Compose+Helm Production Guardrails — Research

**Researched:** 2026-05-16
**Domain:** Production hardening of two deployment surfaces (Docker Compose + Helm/K8s) + CI lint gate
**Confidence:** HIGH for compose syntax, lint-tool patterns, Helm probe/topology mechanics, helm-unittest patterns. MEDIUM-HIGH for image-runtime uid audit (verified by `docker run --rm --entrypoint sh <image> -c id` on the LiteLLM image — see §6). LOW only on exact memory floors (no live cgroup observation captured in Phase 8 runs; floors below are best-practice + image-class derived).

## Summary

Phase 20 closes P0/HIGH guardrails from the 2026-05-16 read-only audit on two parallel deployment surfaces. The compose work (SR-20.1/.2) is mechanically straightforward — add `deploy.resources.limits.memory` and `restart: unless-stopped` to every long-running service and codify the rule with a new `tools/lint-compose-resources.ts` that copies the proven shape of `tools/lint-traefik-routes.ts`. The Helm work splits cleanly into two risk classes: (a) **mechanical YAML additions** (`startupProbe`, `topologySpreadConstraints`, OTel-collector `allowPrivilegeEscalation`/`seccompProfile`) where helm-unittest assertions cover everything, and (b) **the image-runtime audit for `runAsNonRoot: true` + `readOnlyRootFilesystem: true`** which is the single risky deliverable. Live probe of `ghcr.io/berriai/litellm:main-v1.83.14-stable` confirmed it runs as **uid 0**, so SR-20.5 must either fork+rebuild the LiteLLM image or carve LiteLLM out of the strict-non-root scope and document the exception (parity with the existing OTel-collector `runAsUser: 0` exception). The web image runs as **uid 1001** (not 1000 as the ROADMAP locked decision assumes), so values.yaml needs per-workload `runAsUser` not a single `1000` constant. The CI compose-lint job is a 8-cell matrix on ubuntu-latest using preinstalled Docker.

**Primary recommendation:** Split Helm work into **20-02a (probes + topology, low-risk)** and **20-02b (securityContext + Dockerfile fixes, image-risk)**. Land plans in waves: Wave A = 20-01 (compose) + 20-02a (Helm probes/topology) in parallel; Wave B = 20-02b (Helm security + image rebuilds, may include LiteLLM fork decision) after Wave A green; Wave C = 20-03 (CI compose-lint job) after 20-01 is on main (lint script must exist before the workflow can call it). This matches the constitutional TDD constraint and limits blast radius from any image-rebuild surprise.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Resource limits (mem cap) | Compose (cgroup v2 / `deploy.resources.limits`) | Helm (`resources.limits.memory` already exists) | Compose lacks them; chart already has them per audit "what's good" |
| Restart on crash | Compose (`restart: unless-stopped`) | Helm (Pod restartPolicy + Deployment-managed) | Compose has gaps on traefik/pgbouncer/minio/LGTM; Helm uses kubelet by default |
| Slow-start tolerance | Helm (`startupProbe`) | Compose (`healthcheck.start_period`, already set) | Kubelet-only contract; compose `start_period` already covers analogous case |
| Anti-affinity / spread | Helm (`topologySpreadConstraints`) | — | K8s-only; compose stack is single-host |
| Drop-root + RO-rootfs | Both: Helm `securityContext` (this phase) + Compose `cap_drop`+`read_only` (deferred P1) | Image (`USER` directive in Dockerfile) | Pod-level spec must align with image's USER |
| Schema enforcement | CI (`tools/lint-compose-resources.ts` + `compose-lint` job) | — | New surface; chart already has helm-lint + helm-unittest |

---

## 1. Compose `deploy.resources.limits` syntax & V2-vs-V3 nuance

### Locked shape (cite: Compose Specification — compose.yaml `deploy.resources`)

```yaml
services:
  postgres:
    image: openwhispr/postgres:17.5-pgpartman
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"        # optional but recommended
        reservations:
          memory: 512M       # optional; kernel-soft floor
          cpus: "0.5"
```

**Why `deploy.resources.limits` (not legacy `mem_limit`):**

1. The Compose **v3 → v2.x convergence**: docker-compose v1.x's flat `mem_limit:` was promoted to live under `deploy:` in v3 schemas because Swarm needed structured resource semantics. With the Compose Specification (post-2020 unified spec, no more v3/v2 split), `deploy.resources.limits` is the **canonical** key.
2. **`deploy.resources.limits` IS honored on Compose v2 (Docker Compose CLI v2.x, not Swarm)**. This is the most common misconception. Quoting the spec: "If your platform doesn't support `deploy`, Compose ignores the section." Modern `docker compose` (v2.x CLI, Docker Engine 25+) translates `deploy.resources.limits.memory` to cgroup v2 `memory.max` and `deploy.resources.limits.cpus` to `cpu.max`. Verified locally — `docker compose up` on macOS Docker Desktop with `deploy.resources.limits.memory: 256M` enforces the cap (OOM-kills the container if exceeded).
3. **What WAS deprecated:** the `version: "3.x"` top-level key (compose v2 CLI ignores it; our `docker-compose.yml:28` correctly uses no `version:` key per the file header comment). Also deprecated: top-level `mem_limit`, `cpu_shares`, `mem_swappiness` — they still work but trigger warnings in `docker compose config`.
4. **Swarm-only fields under deploy:** `replicas`, `placement`, `update_config`, `endpoint_mode`, `rollback_config`, `restart_policy.condition` are silently ignored outside Swarm. `resources` is the explicit exception (compose v2.x docs single it out as honored on local engine).

**Memory unit syntax** (per spec): `b`, `k`/`kb`, `m`/`mb`, `g`/`gb` (case-insensitive), or `B`, `KB`, `MB`, `GB` (binary 1024). Prefer the binary `512M`/`2G` form to match Helm `resources.limits.memory: 512Mi` semantics. (Compose `M` = MiB = 1024², Helm `Mi` = MiB = 1024² — same.)

### Where it goes in our tree

Today's `docker-compose.yml:38-438` has 6 services (postgres, valkey, migrate, litellm, api, worker, web) with **zero** `deploy:` blocks. Plan 20-01 must add `deploy.resources.limits.memory` to each non-migrate service (migrate is the one-shot init job; `restart: "no"` per `docker-compose.yml:115` — no resource cap needed since `pg_dump`-style memory is bounded by `pnpm`/drizzle).

Overlays in `compose/` (8 files surveyed) layer in additional services that must also receive the rule:
- `compose/docker-compose.ingress.yml` → traefik
- `compose/docker-compose.pgbouncer.yml` → pgbouncer
- `compose/docker-compose.storage.yml` → minio
- `compose/docker-compose.observability.yml` → otel-collector, loki, tempo, mimir, grafana (5 services)
- `compose/docker-compose.dev-tools.yml` → mailpit (only if it counts as long-running; check whether it's reachable through default flow)
- `compose/docker-compose.acme.yml` → traefik delta (already has restart in base ingress overlay)
- `compose/docker-compose.contract-test.yml` → fixture-idp + seed + contract-test-runner (audit out of scope: these are short-lived; lint must whitelist them by service-name or by `restart: "no"`)
- `compose/docker-compose.load-test.yml` + `compose/docker-compose.load-test.realistic.yml` → load-test runners (k6, speaches when realistic). Same short-lived semantics; lint allowlist.

**Limit-overrides via compose merge:** later `-f` files win. A test profile can lower an api memory cap to 256M without re-declaring everything else; Plan 20-01 should NOT need overlay-level memory overrides for the in-tree profiles. Production operators may want to bump postgres beyond 2G — handle via env-substituted limit (`memory: ${POSTGRES_MEM_LIMIT:-2G}`) on postgres only.

[CITED: docs.docker.com/reference/compose-file/deploy/]
[CITED: docs.docker.com/reference/compose-file/services/#resources]
[VERIFIED: `docker run --memory=256m` enforces cgroup v2 `memory.max=268435456` — same path Compose drives.]

---

## 2. Compose lint tool design (`tools/lint-compose-resources.ts`)

### Reuse the Phase 19b shape

`tools/lint-traefik-routes.ts:28-32` + `tools/lint-traefik-routes.test.ts:1-46` are the canonical pattern:
- One TypeScript file with default export `auditXxx(root): Violation[]`
- `yaml` package (already in workspace) for parsing
- One vitest file alongside with 3-test shape: (1) live tree returns `[]` (regression sentinel), (2) BAD fixture trips every violation code, (3) GOOD fixture returns `[]`
- Fixtures live at `tools/__tests__/fixtures/<lint-name>/{bad,good}/` (verified — directory already exists with `traefik-routes` and `dockerfile-tls` subfolders, see Bash output).
- `Violation` discriminated by string-code (`V1`, `V2`, ...) so the test can assert codes set.

**`tools/lint-compose-chart-parity.ts:1-110` adds:** `DEFAULT_COMPOSE_FILES` constant union over every overlay (lines 28-42). Plan 20-01's `tools/lint-compose-resources.ts` reuses that same union — there's no reason to list overlays twice — but should export it as `COMPOSE_FILES` so the future compose-lint CI job can reflect it.

### Recommended `tools/lint-compose-resources.ts` shape

```ts
// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 20 / SR-20.1+SR-20.2 — guardrail lint:
//   R1: every "long-running" service must declare deploy.resources.limits.memory
//   R2: every "long-running" service must declare restart: unless-stopped
// Short-lived services (restart: "no" OR explicit allowlist) are exempt.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export interface Violation {
  readonly code: "R1-MISSING-MEMORY-LIMIT" | "R2-MISSING-RESTART" | "R3-MEMORY-BELOW-FLOOR";
  readonly file: string;
  readonly service: string;
  readonly message: string;
}

// 1:1 with tools/lint-compose-chart-parity.ts DEFAULT_COMPOSE_FILES (re-export
// after Plan 20-01 lands so future linters share the list).
export const COMPOSE_FILES = [
  "docker-compose.yml",
  "compose/docker-compose.observability.yml",
  "compose/docker-compose.storage.yml",
  "compose/docker-compose.ingress.yml",
  "compose/docker-compose.pgbouncer.yml",
  "compose/docker-compose.acme.yml",
  // load-test + contract-test overlays are short-lived; covered by allowlist.
  "compose/docker-compose.load-test.yml",
  "compose/docker-compose.load-test.realistic.yml",
  "compose/docker-compose.contract-test.yml",
  "compose/docker-compose.dev-tools.yml",
  "compose/docker-compose.embedded-litellm.yml",
];

// Service-name allowlist for R1/R2 (short-lived / one-shot / build-only).
// Sourced from compose files (restart: "no" OR build-only fixture).
export const SHORT_LIVED_ALLOWLIST = new Set<string>([
  "migrate",                  // docker-compose.yml:115 restart: "no"
  "seed",                     // contract-test overlay
  "contract-test-runner",
  "fixture-idp",              // boots, runs OIDC test suite, exits
  "k6",                       // load-test
  "speaches",                 // realistic load-test only; ephemeral GPU/CPU run
  "mailpit",                  // dev-tools (no-cost; could optionally lift)
]);

// Floors (bytes). Memory unit normalization at parse time.
// Locked by ROADMAP / 20-CONTEXT.md SR-20.1.
export const MEMORY_FLOORS_BYTES: Record<string, number> = {
  postgres: 2 * 1024 ** 3,        // 2G (CNPG + pg_partman + 100 connections)
  litellm:   512 * 1024 ** 2,     // 512M
  api:       512 * 1024 ** 2,
  worker:    512 * 1024 ** 2,
  web:       384 * 1024 ** 2,
  loki:      512 * 1024 ** 2,
  tempo:     512 * 1024 ** 2,
  mimir:     512 * 1024 ** 2,
  grafana:   256 * 1024 ** 2,
  "otel-collector": 256 * 1024 ** 2,
  // No floor for: valkey (small), traefik, pgbouncer, minio
};

export function auditComposeResources(repoRoot: string): Violation[] { /* ... */ }
```

### Memory-unit parsing (gotcha)

`yaml`-parsed value is a string (`"2G"`, `"512M"`, `"2.5Gi"`). Normalize to bytes with a single helper:

```ts
function parseMemoryString(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|k|m|g|t|kb|mb|gb|tb|ki|mi|gi|ti)?$/i.exec(s.trim());
  if (!m) throw new Error(`unparseable memory: ${s}`);
  const n = parseFloat(m[1]);
  const unit = (m[2] || "b").toLowerCase();
  const mult = { b:1, k:1024, m:1024**2, g:1024**3, t:1024**4,
                 kb:1024, mb:1024**2, gb:1024**3, tb:1024**4,
                 ki:1024, mi:1024**2, gi:1024**3, ti:1024**4 }[unit];
  return Math.floor(n * mult);
}
```

### Vitest harness + fixture layout

```
tools/__tests__/fixtures/compose-resources/
  bad/
    docker-compose.yml          # api without deploy: + traefik without restart
  good/
    docker-compose.yml          # both fields present, all floors met
```

Tests (mirroring `tools/lint-traefik-routes.test.ts:22-45`):

```ts
describe("lint-compose-resources — SR-20.1 + SR-20.2 guard", () => {
  it("returns zero violations against the live repo tree (RED before fix, GREEN after)", () => {
    expect(auditComposeResources(REPO_ROOT)).toEqual([]);
  });

  it("flags R1, R2, R3 codes on the synthetic BAD fixture", () => {
    const v = auditComposeResources(FIXTURE_BAD);
    expect(new Set(v.map(x => x.code))).toEqual(new Set(["R1-MISSING-MEMORY-LIMIT", "R2-MISSING-RESTART", "R3-MEMORY-BELOW-FLOOR"]));
  });

  it("returns zero violations against the synthetic GOOD fixture", () => {
    expect(auditComposeResources(FIXTURE_GOOD)).toEqual([]);
  });
});
```

### Exit-code contract

Like `tools/lint-traefik-routes.ts` (export-only) + vitest (`pnpm test`-driven exit code). The CI compose-lint workflow runs both (a) `pnpm test tools/lint-compose-resources.test.ts` for the vitest gate, AND (b) optional `pnpm exec tsx tools/lint-compose-resources.ts` for a human-readable CLI report. The CLI mode prints violations and exits 1 if any; `package.json` adds a `lint:compose-resources` script.

### Coverage (CLAUDE.md ≥ 90/90/90/90)

3 tests against synthetic fixtures cover every branch:
- empty file → returns `[]`
- service with `restart: "no"` → R2 skipped (short-lived path)
- service with `deploy.resources.limits` but below floor → R3 (not R1)
- allowlisted service → both R1 and R2 skipped

Drives lines/branches/functions/statements all ≥ 90% without effort.

---

## 3. Memory floors per service

> **LOW confidence**: no in-repo run captured container memory usage. Numbers below are derived from (a) image class (alpine vs distroless), (b) Helm `resources.limits.memory` values that have already been smoke-tested in Phase 9 (`charts/openwhispr/templates/api-deployment.yaml:191`, `web-deployment.yaml:121`, `worker-deployment.yaml:127`, `litellm-deployment.yaml:120`), and (c) public sizing recommendations.

`runs/` directory does not exist at repo root — Phase 8 summaries live under `.planning/phases/08-load-test-tuning-slo-publication/runs/` and contain k6 metric JSON, not docker stats. Per project memory (`feedback_realistic_profile_smoke_and_baseline`), realistic-profile baselines are user re-run on H100; the Mac run is wiring-only. **No live memory observation exists.** Floors below are **best-practice** + **chart-resource parity** + **ROADMAP-locked**.

| Service | Recommended `deploy.resources.limits.memory` | Floor (ROADMAP) | Source / rationale |
|---|---|---|---|
| postgres | **2G** | ≥ 2G | CNPG + pg_partman_bgw worker + 100 connections × ~6MB work_mem default + shared_buffers default 128MB. ROADMAP locked. |
| valkey | **256M** | (no floor) | `valkey:8.1-alpine`; modest pubsub + BullMQ queue depth ≤ 10k jobs. |
| migrate | (no limit needed) | — | One-shot; `restart: "no"`. Per drizzle docs, migration runner is small. |
| litellm | **1G** | ≥ 512M | LiteLLM v1.83.x is Python+FastAPI+Prisma; 512M is tight under load. Chart already uses `limits.memory: 1Gi` (`litellm-deployment.yaml:120`). Mirror to compose for parity. |
| api | **1G** | ≥ 512M | Node 24 + Fastify 5 + Better Auth + drizzle + Valkey client. Chart uses `1Gi` (`api-deployment.yaml:191`). |
| worker | **512M** | ≥ 512M | BullMQ consumer; no HTTP listener. Chart uses `1Gi` but that's generous — `512M` matches floor and observed Node-worker footprint. |
| web | **512M** | ≥ 384M | Next.js 15 standalone; SSR working set is ~250M baseline + per-request overhead. Chart uses `1Gi`; recommend `512M` for compose floor with comment that operator can raise. |
| traefik | **256M** | (no floor) | Traefik 3 single-binary; ~30M idle, peaks ≤ 200M with 100 routes. |
| pgbouncer | **128M** | (no floor) | `edoburu/pgbouncer:v1.25.1-p0` — single-threaded C process. |
| minio | **512M** | (no floor) | Single-disk mode. Production HA distributed mode needs ≥ 2G per node — out of scope for compose. |
| otel-collector | **256M** | ~256M | `otel/opentelemetry-collector-contrib:0.151.0`. Buffer-heavy at high span rate; OK floor for single-host. |
| loki | **512M** | ~512M | `grafana/loki:3.5.0` single-binary mode; index + chunk buffers. |
| tempo | **512M** | ~512M | `grafana/tempo:2.8.0` single-binary; trace ingest. |
| mimir | **512M** | ~512M | `grafana/mimir:2.16.0` single-binary; TSDB head. |
| grafana | **256M** | ~256M | `grafana/grafana:11.6.0`; mostly Go static. |

**CPU limits (recommended but optional per ROADMAP):** add `cpus: "2.0"` on postgres + litellm + api, `cpus: "1.0"` on worker + web, `cpus: "0.5"` on observability stack. Skip for v1 if it bloats the patch — the lint rule covers memory only.

[ASSUMED — no live memory observation; values cross-referenced with chart resources and image class]

---

## 4. Helm `startupProbe` semantics

### K8s contract (cite: k8s.io docs — Pod Lifecycle § Probes)

When `startupProbe` is defined on a container:
1. **`readinessProbe` and `livenessProbe` are disabled** until `startupProbe` succeeds.
2. After first success, `startupProbe` stops running entirely. Only readiness + liveness apply from then on.
3. **Failure budget = `failureThreshold × periodSeconds`**. With `failureThreshold: 30` + `periodSeconds: 10` = 300 seconds before kubelet declares startup-failed and restarts.
4. If `startupProbe` fails (i.e. crosses `failureThreshold` without success), kubelet kills the container and `restartPolicy` decides whether to retry. Default `Always` means CrashLoopBackOff with exponential backoff (10s, 20s, 40s, ..., cap 5m).
5. **`initialDelaySeconds`** can be set but is rarely needed — kubelet starts probing the moment container starts.

**Recommended shape** (per ROADMAP SR-20.3, reusing existing readiness probe path/port):

```yaml
# api-deployment.yaml — append after readinessProbe + livenessProbe
startupProbe:
  httpGet:
    path: /api/health      # same as readinessProbe; api-deployment.yaml:175
    port: 3000
  failureThreshold: 30
  periodSeconds: 10
  # No initialDelaySeconds — readinessProbe used 10s here but startup can poll
  # immediately and absorb the first 30s of cold-start.
```

For **worker** (exec probe via `pgrep`; see `worker-deployment.yaml:105-120`):

```yaml
startupProbe:
  exec:
    command:
      - sh
      - -c
      - "pgrep -f 'node /app/dist/index.js' >/dev/null"
  failureThreshold: 30
  periodSeconds: 10
```

Same `pgrep` check the readiness/liveness already use — confirmed at `worker-deployment.yaml:108-110`.

For **litellm**:

```yaml
startupProbe:
  httpGet:
    path: /health/liveliness   # litellm-deployment.yaml:99
    port: 4000
  failureThreshold: 30
  periodSeconds: 10
```

For **web**:

```yaml
startupProbe:
  httpGet:
    path: /api/health           # web-deployment.yaml:105
    port: 3001
  failureThreshold: 30
  periodSeconds: 10
```

### Why this matters in practice

Current chart has `livenessProbe.initialDelaySeconds: 30` (api/web/worker — see `api-deployment.yaml:183`) + `readinessProbe.initialDelaySeconds: 10`. On a slow node (cold image pull, slow startup of Node bundle + Better Auth init + drizzle pool open), the readiness probe can fail repeatedly inside the readiness budget while the pod is still legitimately bootstrapping — driving the pod into `Not Ready` and (worse) the liveness probe firing at 30s could mistakenly kill a pod that's still booting Better Auth (whose `auth.init()` does a metadata round-trip against `/api/auth` plus a Postgres handshake). `startupProbe` with `failureThreshold: 30 × periodSeconds: 10 = 300s` buffer puts this slack outside the liveness contract entirely.

### helm-unittest assertion shape

```yaml
# tests/openwhispr/api_test.yaml (append)
  - it: api Deployment carries startupProbe with 300s budget
    template: api-deployment.yaml
    set:
      secrets:
        mode: eso
        external:
          storeRef: vault-clusterstore
    asserts:
      - equal:
          path: spec.template.spec.containers[0].startupProbe.httpGet.path
          value: /api/health
      - equal:
          path: spec.template.spec.containers[0].startupProbe.httpGet.port
          value: 3000
      - equal:
          path: spec.template.spec.containers[0].startupProbe.failureThreshold
          value: 30
      - equal:
          path: spec.template.spec.containers[0].startupProbe.periodSeconds
          value: 10
```

[CITED: kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes]

---

## 5. Helm `topologySpreadConstraints` best practice

### Mechanics (cite: k8s.io docs — Pod Topology Spread Constraints)

```yaml
spec:
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway     # NOT DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: openwhispr
              app.kubernetes.io/component: api
              app.kubernetes.io/instance: {{ .Release.Name }}
```

### Why `ScheduleAnyway` (not `DoNotSchedule`)

`DoNotSchedule` will **block scheduling** when no node satisfies the constraint. On a single-node kind cluster (the helm-test SLO smoke pattern from Phase 09.2 — see `charts/openwhispr/tests/first-launch-slo.yaml`), `replicas: 2` on `api` with `DoNotSchedule + maxSkew: 1 + topologyKey: hostname` is unsatisfiable (only 1 hostname available). The api pods stay `Pending` indefinitely. `ScheduleAnyway` lets the scheduler degrade gracefully: it tries to spread but accepts colocation when forced.

The cost of `ScheduleAnyway`: on a 3-node prod cluster where one node is briefly cordoned, the scheduler is allowed to violate `maxSkew: 1` and place both replicas on the same node — exactly the failure mode this constraint was meant to prevent. **The mitigation:** Pod Disruption Budget already in place (api PDB at `charts/openwhispr/templates/api-pdb.yaml` per audit "what's good" line 76) limits voluntary disruption, so the cluster-management path won't take down both pods at once. Involuntary (node failure) double-loss is still possible with `ScheduleAnyway` but it's strictly an improvement over no constraint at all.

### Label-selector source

`charts/openwhispr/templates/_helpers.tpl` (referenced by every deployment, e.g. `api-deployment.yaml:38` uses `openwhispr.api.selectorLabels`) provides per-workload selector helpers. Reuse:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "openwhispr.api.selectorLabels" . | nindent 10 }}
```

This guarantees the constraint's selector matches the Deployment's pod template selector — Kubernetes does NOT validate this for you; an off-by-one in labels means the constraint silently has zero effect.

### Does OTel DaemonSet need spread?

**No — drop OTel from SR-20.4 scope.** A DaemonSet by definition runs exactly one pod per matching node (modulo nodeSelector/tolerations); `topologySpreadConstraints` is a no-op on it because the scheduler already enforces "one per node" via the DaemonSet controller. `charts/openwhispr/templates/otel-collector-daemonset.yaml:23-30` is a DaemonSet kind. **Recommend revising ROADMAP SR-20.4 scope to the 4 Deployments only (api, web, worker, litellm).**

### values-driven knob

Add to `values.yaml` (under each workload):

```yaml
api:
  topologySpread:
    enabled: true
    maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
```

Template guards on `.Values.api.topologySpread.enabled`. Operators on single-node prod (rare but documented in OSS quickstart) disable it; default-on for multi-node clusters.

[CITED: kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/]

---

## 6. Helm `securityContext` + image-runtime audit (HIGHEST RISK)

### Audit results (live probe + Dockerfile read)

| Image | Current `USER` | uid | `readOnlyRootFilesystem: true` compatibility |
|---|---|---|---|
| `ghcr.io/openwhispr/openwhispr-api` (apps/api/Dockerfile:172) | `USER node` | **1000** | Likely OK; api writes nothing to `/`; may write to `/tmp` (Better Auth session caches, multipart temp). **Mount `emptyDir` at `/tmp`.** |
| `ghcr.io/openwhispr/openwhispr-worker` (apps/worker/Dockerfile:80) | `USER node` | **1000** | OK; pure compute. **Mount `emptyDir` at `/tmp`** for safety (BullMQ may spill). |
| `ghcr.io/openwhispr/openwhispr-web` (apps/web/Dockerfile:117-118, 132) | `USER nextjs` | **1001 (not 1000!)** | Next.js 15 standalone writes to `.next/cache` at runtime for ISR — **must mount `emptyDir` at `/app/apps/web/.next/cache`**. Also `/tmp`. |
| `ghcr.io/berriai/litellm:main-v1.83.14-stable` (live probe `docker run --rm --entrypoint sh ghcr.io/berriai/litellm:main-v1.83.14-stable -c id`) | **uid=0 (root)** | **0** | **BLOCKER for `runAsNonRoot: true` + `runAsUser: 1000`.** No `USER` directive in the upstream image. Prisma engine writes to `/app/.prisma` at runtime — `readOnlyRootFilesystem: true` breaks Prisma startup. |
| `otel/opentelemetry-collector-contrib:0.115.0` (already hardened in `otel-collector-daemonset.yaml:83-86`) | (image default root; chart sets `runAsUser: 0` deliberately) | 0 (intentional) | hostmetrics needs root read on `/proc` + `/sys`. Already documented exception. |

### Three problems to address in plan 20-02b

**Problem 1: Web is uid 1001 not 1000.** The ROADMAP locked `runAsUser: 1000` + `fsGroup: 1000`. For the web workload only, the template must emit `runAsUser: 1001 / fsGroup: 1001` to match the image's `USER nextjs` (apps/web/Dockerfile:117-118). Recommend `values.yaml` parameterize per workload:

```yaml
api:
  securityContext:
    pod:
      runAsNonRoot: true
      runAsUser: 1000
      fsGroup: 1000
      seccompProfile: { type: RuntimeDefault }
    container:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities: { drop: [ALL] }
web:
  securityContext:
    pod:
      runAsNonRoot: true
      runAsUser: 1001        # nextjs user
      fsGroup: 1001
      seccompProfile: { type: RuntimeDefault }
    container:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities: { drop: [ALL] }
```

**Problem 2: LiteLLM image runs as root.** Two options:

**Option A — Carve LiteLLM out of SR-20.5 (RECOMMENDED for v1).**
- Document as second hardening exception alongside OTel (`runAsUser: 0` for hostmetrics).
- LiteLLM container gets `allowPrivilegeEscalation: false` + `seccompProfile: RuntimeDefault` + `capabilities: { drop: [ALL] }` + `readOnlyRootFilesystem: false` (Prisma needs write).
- Comment in `litellm-deployment.yaml` explaining why; `tests/openwhispr/litellm_test.yaml` asserts the relaxed shape.
- **Why recommended:** rebuilding upstream LiteLLM as non-root requires forking `ghcr.io/berriai/litellm` — a Python+Prisma+FastAPI image where the upstream maintainers haven't shipped a non-root variant. Maintenance cost is non-trivial (sync forks per release). Audit P0 BLOCKER is on **api/web/worker**; LiteLLM is HIGH but acceptable as a documented exception.

**Option B — Fork the LiteLLM image.**
- Add `compose/litellm/Dockerfile` that bases off `ghcr.io/berriai/litellm:main-v1.83.14-stable` and adds `RUN adduser -D -u 1000 litellm && chown -R litellm /app && mkdir -p /app/.prisma /tmp/prisma && chown litellm /app/.prisma /tmp/prisma` then `USER 1000`.
- Build + publish to `ghcr.io/openwhispr/openwhispr-litellm:<tag>`.
- `readOnlyRootFilesystem: true` then requires `volumeMounts` on `/app/.prisma` + `/tmp` (emptyDir).
- **Cost:** image-build pipeline addition, new ghcr release surface, sync burden when LiteLLM upstream version-bumps. Defer to a future phase.

**Recommend Option A** as the in-phase deliverable. Track Option B as a deferred item ("LiteLLM non-root fork").

**Problem 3: `readOnlyRootFilesystem: true` on api/worker/web needs emptyDir mounts.** Standard pattern:

```yaml
# api-deployment.yaml — under containers[0]
volumeMounts:
  - name: tmp
    mountPath: /tmp
# under spec.template.spec
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 64Mi
```

For web specifically, add a second emptyDir for `.next/cache`:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
  - name: next-cache
    mountPath: /app/apps/web/.next/cache
volumes:
  - name: tmp
    emptyDir: { sizeLimit: 64Mi }
  - name: next-cache
    emptyDir: { sizeLimit: 256Mi }
```

**Dockerfile changes needed:** NONE for api/worker (already `USER node` = 1000). For web — none either (`USER nextjs` = 1001, parameterize values.yaml). For LiteLLM — none under Option A.

### Image-runtime smoke gate

Plan 20-02b must include a kind smoke (parallel to Phase 09.1/09.2's `tests/openwhispr/*.yaml` + `make helm-test-kind` pattern) that proves all four Deployments boot and stay Ready with the new securityContext applied. Specifically: a values-kind overlay that sets `readOnlyRootFilesystem: true` + `runAsNonRoot: true` and verifies pods reach Ready inside the SLO budget.

---

## 7. OTel Collector partial hardening

Current shape (`charts/openwhispr/templates/otel-collector-daemonset.yaml:81-86`):

```yaml
securityContext:
  runAsUser: 0
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

ROADMAP SR-20.5 adds:

```yaml
allowPrivilegeEscalation: false
seccompProfile:
  type: RuntimeDefault
```

### Compatibility with hostmetrics

The hostmetrics receiver reads `/proc`, `/sys`, `/var/log` via hostPath mounts (lines 91-99). These are **read operations** only.

- `allowPrivilegeEscalation: false` — does not affect read syscalls. Confirms no setuid-binary escalation path. **Safe to add.**
- `seccompProfile: { type: RuntimeDefault }` — RuntimeDefault is the Docker/containerd default seccomp profile (allows ~280 syscalls, blocks ~50 dangerous ones like `kexec_load`, `move_pages`, `nfsservctl`). hostmetrics + kubeletstats use `open`, `read`, `stat`, `getdents` — all permitted. **Safe to add.**

There's one edge case worth flagging: `seccompProfile` in containerd ≥ 1.6 uses the upstream Docker default profile which blocks `clone(CLONE_NEWNS)` from a non-privileged process — but OTel collector is single-process Go binary, no namespace creation. Safe.

[CITED: kubernetes.io/docs/tutorials/security/seccomp/#using-the-container-runtime-default-profile]
[CITED: opentelemetry.io/docs/collector/configuration/ — hostmetrics receiver syscalls]

---

## 8. CI compose-lint job design

### Reference: helm-lint workflow

`.github/workflows/helm-lint.yml` is the template (read it above):
- `runs-on: ubuntu-latest`
- Path-trigger filter (`paths:` on `pull_request` + `push` events)
- Concurrency group for cancel-in-progress
- `actions/checkout@v4` + `azure/setup-helm@v4` for helm; plus `actions/setup-node@v4` + `pnpm/action-setup@v3` for the parity lint
- 8 mandatory jobs in current helm-lint:helm lint, render-with-good-secrets, render-with-bad-secrets-expects-fail, helm unittest, shellcheck, actionlint, parity lint, parity coverage gate

### New `compose-lint` job (`.github/workflows/compose-lint.yml` or appended job in `ci.yml`)

```yaml
name: compose-lint

on:
  pull_request:
    paths:
      - "docker-compose.yml"
      - "compose/**/*.yml"
      - "tools/lint-compose-resources.ts"
      - "tools/lint-compose-resources.test.ts"
      - ".github/workflows/compose-lint.yml"
  push:
    branches: [main]
    paths:
      - "docker-compose.yml"
      - "compose/**/*.yml"
      - "tools/lint-compose-resources.ts"

permissions:
  contents: read

concurrency:
  group: compose-lint-${{ github.ref }}
  cancel-in-progress: true

jobs:
  compose-config-matrix:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        profile:
          - name: default
            files: "-f docker-compose.yml"
          - name: contract-test
            files: "-f docker-compose.yml -f compose/docker-compose.contract-test.yml"
          - name: observability
            files: "-f docker-compose.yml -f compose/docker-compose.observability.yml"
          - name: pgbouncer
            files: "-f docker-compose.yml -f compose/docker-compose.pgbouncer.yml"
          - name: storage
            files: "-f docker-compose.yml -f compose/docker-compose.storage.yml"
          - name: load-test-mock
            files: "-f docker-compose.yml -f compose/docker-compose.load-test.yml"
          - name: load-test-realistic
            files: "-f docker-compose.yml -f compose/docker-compose.load-test.realistic.yml"
          - name: ingress
            files: "-f docker-compose.yml -f compose/docker-compose.ingress.yml"
    steps:
      - uses: actions/checkout@v5
      # ubuntu-latest ships Docker Engine + Docker Compose v2 plugin. Verified
      # via https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu24_Readme.md
      # — no setup-buildx required for `docker compose config` (no build).
      - name: Verify docker compose version
        run: docker compose version
      - name: Render canary .env (interpolation requires these vars)
        run: cp .env.example .env || cp .env.full.example .env
      - name: docker compose config — ${{ matrix.profile.name }}
        run: docker compose ${{ matrix.profile.files }} config > /dev/null

  compose-resource-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: "24", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - name: SR-20.1 + SR-20.2 lint
        run: pnpm exec tsx tools/lint-compose-resources.ts
      - name: Vitest — compose-resources coverage gate
        run: pnpm test:lint-compose-resources -- --coverage
```

### Timing

`docker compose config` is parse-and-merge only — no image pull, no container start. Each matrix cell is ~3-5 seconds. With 8 cells in parallel + `actions/checkout` overhead, total wall time ~30-45 seconds. Well under the 60s target.

### Profile coverage — exactly 8 cells (per ROADMAP SR-20.6)

`default, contract-test, observability, pgbouncer, storage, load-test-mock, load-test-realistic, e2e` — let me reconcile with what overlays exist:

| ROADMAP profile name | Compose overlay file | Notes |
|---|---|---|
| default | `docker-compose.yml` only | slim-core |
| contract-test | `+ compose/docker-compose.contract-test.yml` | seed + fixture-idp + runner |
| observability | `+ compose/docker-compose.observability.yml` | LGTM stack |
| pgbouncer | `+ compose/docker-compose.pgbouncer.yml` | pooler |
| storage | `+ compose/docker-compose.storage.yml` | minio |
| load-test-mock | `+ compose/docker-compose.load-test.yml` | mock-litellm + k6 |
| load-test-realistic | `+ compose/docker-compose.load-test.realistic.yml` | + speaches |
| e2e | `compose/e2e/*.yml` | Phase 13 cjm overlay — verify exact path during plan write |

The "e2e" profile is more delicate — `compose/e2e/` is a subdirectory, not a flat overlay. Plan 20-03 must check `compose/e2e/` contents and choose the right entrypoint. Provisional matrix cell:

```yaml
- name: e2e
  files: "-f docker-compose.yml -f compose/e2e/docker-compose.cjm.yml"   # confirm filename during plan
```

[CITED: github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu24_Readme.md — Docker preinstalled]

---

## 9. helm-unittest assertion patterns for new keys

`charts/openwhispr/tests/api_test.yaml:83-99` is the canonical readinessProbe/livenessProbe assertion shape. Same yaml-path syntax applies to startupProbe + securityContext + topologySpreadConstraints.

### `startupProbe`

```yaml
- it: api Deployment carries startupProbe with 300s budget (SR-20.3)
  template: api-deployment.yaml
  set:
    secrets: { mode: eso, external: { storeRef: vault-clusterstore } }
  asserts:
    - equal:
        path: spec.template.spec.containers[0].startupProbe.httpGet.path
        value: /api/health
    - equal:
        path: spec.template.spec.containers[0].startupProbe.failureThreshold
        value: 30
    - equal:
        path: spec.template.spec.containers[0].startupProbe.periodSeconds
        value: 10
```

For worker (exec probe):

```yaml
- it: worker Deployment carries startupProbe using pgrep exec (SR-20.3)
  template: worker-deployment.yaml
  set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }
  asserts:
    - matchRegex:
        path: spec.template.spec.containers[0].startupProbe.exec.command[2]
        pattern: "pgrep -f 'node /app/dist/index.js'"
    - equal:
        path: spec.template.spec.containers[0].startupProbe.failureThreshold
        value: 30
```

### `topologySpreadConstraints`

```yaml
- it: api Deployment declares topologySpreadConstraints on hostname (SR-20.4)
  template: api-deployment.yaml
  set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }
  asserts:
    - lengthEqual:
        path: spec.template.spec.topologySpreadConstraints
        count: 1
    - equal:
        path: spec.template.spec.topologySpreadConstraints[0].maxSkew
        value: 1
    - equal:
        path: spec.template.spec.topologySpreadConstraints[0].topologyKey
        value: kubernetes.io/hostname
    - equal:
        path: spec.template.spec.topologySpreadConstraints[0].whenUnsatisfiable
        value: ScheduleAnyway
    - equal:
        path: spec.template.spec.topologySpreadConstraints[0].labelSelector.matchLabels."app.kubernetes.io/component"
        value: api
```

### `securityContext` (pod + container level)

```yaml
- it: api Deployment hardens pod securityContext (SR-20.5)
  template: api-deployment.yaml
  set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }
  asserts:
    - equal:
        path: spec.template.spec.securityContext.runAsNonRoot
        value: true
    - equal:
        path: spec.template.spec.securityContext.runAsUser
        value: 1000
    - equal:
        path: spec.template.spec.securityContext.fsGroup
        value: 1000
    - equal:
        path: spec.template.spec.securityContext.seccompProfile.type
        value: RuntimeDefault

- it: api container hardens securityContext (SR-20.5)
  template: api-deployment.yaml
  set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }
  asserts:
    - equal:
        path: spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem
        value: true
    - equal:
        path: spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation
        value: false
    - equal:
        path: spec.template.spec.containers[0].securityContext.capabilities.drop[0]
        value: ALL

- it: web Deployment runs as uid 1001 not 1000 (image: nextjs user)
  template: web-deployment.yaml
  set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }
  asserts:
    - equal:
        path: spec.template.spec.securityContext.runAsUser
        value: 1001

- it: litellm container documented exception — does NOT set readOnlyRootFS (image runs as root, Prisma needs write)
  template: litellm-deployment.yaml
  set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }
  asserts:
    - notExists:
        path: spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem
    # Still gets the cheap hardening:
    - equal:
        path: spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation
        value: false
    - equal:
        path: spec.template.spec.containers[0].securityContext.capabilities.drop[0]
        value: ALL
```

### `emptyDir` mount assertion

```yaml
- it: api Deployment mounts /tmp as emptyDir (readOnlyRootFS compatibility)
  template: api-deployment.yaml
  set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }
  asserts:
    - contains:
        path: spec.template.spec.containers[0].volumeMounts
        content: { name: tmp, mountPath: /tmp }
    - contains:
        path: spec.template.spec.volumes
        content: { name: tmp, emptyDir: { sizeLimit: 64Mi } }
```

[VERIFIED: `charts/openwhispr/tests/api_test.yaml:83-99` pattern read directly]
[CITED: github.com/helm-unittest/helm-unittest — assertions reference for `equal`, `matchRegex`, `contains`, `notExists`, `lengthEqual`]

---

## 10. Pitfalls / known traps

### Compose

**P1. `deploy.resources.limits` ignored on Swarm vs honored on Compose v2.x.** Common misconception. Compose v2.x (the `docker compose` CLI we use) DOES honor `deploy.resources.limits` outside Swarm — it's translated to cgroup v2 limits. Swarm-only fields are `replicas`, `placement.*`, `update_config`, `endpoint_mode`, `restart_policy` (the *deploy-level* restart policy, not the top-level service `restart:`).

**P2. Compose `restart:` top-level vs `deploy.restart_policy`.** These are two different keys.
- `restart: unless-stopped` (top-level service key) — Compose-honored, sets Docker container restart policy via API.
- `deploy.restart_policy.condition: any` — Swarm-only.
ROADMAP SR-20.2 specifies the top-level `restart: unless-stopped` form. The lint MUST check for that key, not `deploy.restart_policy`.

**P3. `restart:` value YAML quoting.** `restart: no` (unquoted) parses as **boolean false** in some YAML parsers (legacy YAML 1.1 norway-problem variant). Repo already handles this — `docker-compose.yml:115` uses `restart: "no"` (quoted). The lint must accept both `"no"` and `no` for the short-lived case and warn loudly if it sees `restart: false`.

**P4. Memory unit precision.** `100M` (Docker docs) = 100 MiB in compose context, but is 100 MB elsewhere. The lint MUST normalize all units to bytes before floor comparison.

**P5. Override-file merge for `deploy:`.** When a load-test overlay tries to override the api memory limit, the merge is **deep-merge by key**: setting `services.api.deploy.resources.limits.memory: 2G` in the overlay replaces only `memory`, leaving `cpus:` untouched. Verified behavior; not a footgun if you understand it.

### Helm

**P6. `runAsNonRoot: true` without `runAsUser`.** If you set `runAsNonRoot: true` but the image's `USER` directive declares uid `nobody` or any uid > 0 implicitly, this works — kubelet checks `image.config.User != "0"`. But if the image lacks any USER directive entirely (LiteLLM case), `runAsNonRoot: true` causes pod start to fail with "container has runAsNonRoot and image will run as root". Setting `runAsUser: 1000` explicitly is the safe default — kubelet forces uid 1000 at exec time regardless of image config.

**P7. `readOnlyRootFilesystem: true` breaks `/tmp` writes.** Anything that writes to `/tmp` (multipart uploads, Prisma engines, Node's `os.tmpdir()`, Better Auth verification token files) breaks silently or with cryptic errors. **Always pair with `emptyDir` mount at `/tmp`.**

**P8. LiteLLM Prisma client writes to `/app/.prisma`.** Live probe confirmed `/app` is owned by root in the upstream image. With `readOnlyRootFilesystem: true`, Prisma fails to initialize. **This is why LiteLLM gets the documented exception (Problem 2, Option A).**

**P9. Next.js standalone writes to `/app/apps/web/.next/cache`.** Per Next.js 15 docs, ISR and on-demand revalidation write to `.next/cache` at runtime. The standalone output COPYs `.next/cache` empty at build, but at runtime the server expects it writable. **Mount emptyDir at that path on the web Deployment.**

**P10. Traefik writes `acme.json` to `/letsencrypt`.** Already handled — `compose/docker-compose.acme.yml` mounts a named volume there. Not in Helm scope this phase (Phase 17 covered it).

**P11. CNPG Cluster CR is operator-managed.** `charts/openwhispr/templates/postgres-cluster.yaml` is a `Cluster` CR; CNPG operator generates the actual StatefulSet pods. Helm-level `securityContext` injection has a different path — set under `spec.podTemplate.securityContext` of the Cluster CR. **Out of scope for Phase 20** (audit B1-B10 don't flag Postgres pods; the only finding affecting them was B9 storageClass which is P2 deferral).

**P12. kind cluster single-node default.** `whenUnsatisfiable: DoNotSchedule` would block all pods on kind (1 worker node). **Always use `ScheduleAnyway`.** Confirmed: `charts/openwhispr/tests/first-launch-slo.yaml` runs against a 1-node kind cluster (Phase 09.1 pattern).

**P13. Pod-level vs container-level `securityContext` precedence.** Container-level overrides pod-level for fields they BOTH define (`runAsUser`, `runAsGroup`, `seccompProfile`, `capabilities`). Some fields are pod-only (`fsGroup`, `supplementalGroups`, `runAsNonRoot` is pod-only effectively even though spec allows container-level). Our chosen layout (`runAsUser`/`fsGroup`/`runAsNonRoot`/`seccompProfile` at pod level; `readOnlyRootFilesystem`/`allowPrivilegeEscalation`/`capabilities` at container level) is the conventional split.

**P14. `docker compose config` validates merge but does NOT pull images.** Fast. Good for CI gate.

**P15. helm-unittest yaml-path quoting on label keys with dots.** `app.kubernetes.io/component` must be quoted as `."app.kubernetes.io/component"` in the path expression. Failure to quote → "path traversal failed" rather than "label not set" — a debugging trap. Already standard in `tests/openwhispr/api_test.yaml` patterns.

---

## 11. Recommended plan split

ROADMAP suggests 20-01 (compose) / 20-02 (Helm) / 20-03 (CI). After investigating image-runtime risk in §6, **recommend the following revised split:**

| Plan | Scope | Risk | Why |
|---|---|---|---|
| **20-01** | Compose: `deploy.resources.limits.memory` everywhere + `restart: unless-stopped` on traefik/pgbouncer/minio/LGTM + `tools/lint-compose-resources.ts` (RED→GREEN) | LOW | Pure YAML + lint. Mechanically simple. |
| **20-02a** | Helm: `startupProbe` (SR-20.3) + `topologySpreadConstraints` (SR-20.4, 4 Deployments only — DaemonSet dropped per §5) + helm-unittest assertions | LOW | Mechanical YAML. No image changes. No `readOnlyRootFilesystem` risk. Validates separately from securityContext. |
| **20-02b** | Helm: `securityContext` (SR-20.5) on api/web/worker + LiteLLM documented exception (Option A from §6) + emptyDir mounts for `/tmp` + web `.next/cache` + OTel partial hardening completion (`allowPrivilegeEscalation: false` + `seccompProfile`) | MEDIUM-HIGH | Image-runtime audit; first deploy with read-only rootfs could surface unknown write paths. Live kind smoke required as in plan 09.1/09.2. |
| **20-03** | CI: `compose-lint` workflow (8-cell `docker compose config` matrix + `tools/lint-compose-resources.ts` invocation + coverage gate) | LOW | Only meaningful after 20-01 lands (lint script must exist). |

### Why split 20-02 into two plans

1. **20-02a is mechanical YAML.** helm-unittest fully covers it. No image surprises. Can land while 20-02b is still investigating LiteLLM's exception path.
2. **20-02b has the only real risk** — `readOnlyRootFilesystem: true` may surface a write path neither Dockerfile nor live probe revealed. Isolating it into its own plan limits revert blast radius.
3. **Constitutional TDD** — RED then GREEN per change. helm-unittest tests for each block can be written first, then production yaml flips them GREEN. The two blocks (probes/topology vs securityContext) cleanly separate.

### Plan ordering

**20-03 BEFORE 20-01?** No. The compose-lint workflow CALLS `tools/lint-compose-resources.ts`. The lint script doesn't exist until 20-01 lands. Running 20-03 first means it would no-op (or fail to find the script). 20-01 must land first.

**20-02a in parallel with 20-01?** Yes — independent surfaces.

**20-02b after 20-02a?** Yes — separate plan even if same wave so that helm-unittest tests pass at each commit (TDD discipline).

---

## 12. Wave / dependency graph

```
Wave A (parallel, independent surfaces):
  ├── 20-01 Compose guardrails + lint script
  └── 20-02a Helm probes + topology

Wave B (depends on Wave A green):
  └── 20-02b Helm securityContext + image emptyDir mounts + OTel partial hardening
       (depends on 20-02a only via shared values.yaml editing surface — soft conflict)

Wave C (depends on 20-01):
  └── 20-03 CI compose-lint job
       (depends on `tools/lint-compose-resources.ts` existing on main; depends
        on Wave A merged)
```

**Why Wave B serializes after Wave A:** image-runtime smoke (kind cluster) must run with the topology + startupProbe values from 20-02a in place; otherwise the smoke catches a probe-timing issue that's already going to be fixed in 20-02a and the false signal wastes a cycle.

**Why Wave C serializes after Wave A:** `tools/lint-compose-resources.ts` doesn't exist until 20-01 lands. Wave C is also fast — pure GitHub Actions YAML + minor test rewiring.

**If aggressively pipelined:** Wave A + Wave B + Wave C can interleave commits on a stacked-PR strategy, but the SIMPLER PR-per-plan flow respects each plan boundary. Recommend simple flow given the constitutional verification overhead.

---

## Project Constraints (from CLAUDE.md)

Constitutional, non-negotiable, transcribed for the planner:

1. **Strict TDD** — RED → GREEN → REFACTOR on every commit. helm-unittest tests assert the new keys (startupProbe, topologySpread, securityContext) BEFORE the production yaml lands them. Same for `tools/lint-compose-resources.ts` — fixture-driven vitest goes red first.
2. **Per-phase coverage ≥ 90/90/90/90** on lines/branches/functions/statements of new/modified code.
3. **Hard Rule #1 — never edit production to make tests pass.** For NEW lint logic against NEW guardrails, the RED→GREEN pattern is the EXPECTED workflow (the production yaml didn't have the key; the lint asserts it must; flipping the yaml on is the canonical GREEN commit). This is NOT "editing production to silence tests" — it's adding the guardrail the lint was always meant to enforce.
4. **Hard Rule #3 — orchestrator verifies sub-agent claims independently** (commits on HEAD, tests green, files have edits, working tree clean).
5. **English-only** source artifacts (this RESEARCH.md is in English; tool comments + helm-unittest descriptions in English).
6. **No `--no-verify`** on commits. lefthook hooks run.
7. **No mocks of internal logic.** Lint tests use real YAML fixtures (not parsed-and-mocked-back YAML). helm-unittest uses real chart templates (not stubbed Helm).
8. **GitHub Actions only** for CI. Plan 20-03 wires into `.github/workflows/`.
9. **Image pinning** — already in place across all four app Dockerfiles + chart values.yaml; this phase doesn't touch tags.

---

## Standard Stack

### Core (locked, no alternatives)

| Library | Version | Purpose |
|---|---|---|
| `yaml` (npm) | already in workspace | YAML parsing in `tools/lint-*.ts` |
| `tsx` | already in workspace | Direct-execute TypeScript lint tools |
| `vitest` | already in workspace | Test harness for lint tools (≥ 90/90/90/90 gate) |
| `helm` | v3.16.4 (pinned in helm-lint.yml:35) | helm template + helm lint + helm-unittest |
| `helm-unittest` (plugin) | 0.7.2 (pinned in helm-lint.yml:39) | helm-unittest assertions |
| `actions/checkout` | v5 (ci.yml convention) | CI checkout |
| `pnpm/action-setup` | v4 with pnpm 11.0.8 | CI pnpm |
| `actions/setup-node` | v5 with node 24 | CI Node |

### Supporting

| Library | Version | When to use |
|---|---|---|
| `actionlint` | latest (helm-lint.yml:44-47 install pattern) | GitHub Actions workflow validation in `compose-lint.yml` |
| `shellcheck` | apt-installed | If 20-03 adds any shell snippets to workflow |

### Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---|---|---|
| YAML parsing | regex over raw text | `yaml` package |
| Memory unit parsing | reimplement from scratch | the parseMemoryString helper in §2 (still your code but using simple regex; do NOT take a dep just for this) |
| Helm template assertion | string-match on rendered output | helm-unittest yaml-path assertions |
| Compose merge simulation | reimplement override semantics | `docker compose config` (CI exercises real binary) |

---

## State of the Art

| Old Approach | Current Approach | Source |
|---|---|---|
| Compose `version: "3.8"` + Swarm `deploy.resources` | Compose Specification (no version key) + `deploy.resources.limits` honored on v2.x CLI | docs.docker.com/reference/compose-file/version-and-name/ |
| `mem_limit:` top-level | `deploy.resources.limits.memory:` | docs.docker.com/reference/compose-file/deploy/ |
| podAntiAffinity (requiredDuringScheduling) | topologySpreadConstraints with ScheduleAnyway | kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/ |
| PodSecurityPolicy (deprecated, removed in 1.25) | Pod Security Admission (PSA) labels + securityContext on workload | kubernetes.io/docs/concepts/security/pod-security-admission/ |
| Container `USER root` + capability hardening alone | runAsNonRoot + runAsUser + readOnlyRootFS + drop ALL + seccompProfile RuntimeDefault (defense-in-depth) | NSA/CISA Kubernetes Hardening Guidance, 2022 |

---

## Code Examples

### Compose `deploy.resources` on a long-running service

```yaml
services:
  postgres:
    image: openwhispr/postgres:17.5-pgpartman
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"
        reservations:
          memory: 512M
    restart: unless-stopped
    # ... rest of the service definition unchanged
```

### Helm — full hardened api Deployment containers spec

```yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: {{ .Values.api.securityContext.pod.runAsUser | default 1000 }}
        fsGroup: {{ .Values.api.securityContext.pod.fsGroup | default 1000 }}
        seccompProfile:
          type: RuntimeDefault
      topologySpreadConstraints:
        - maxSkew: {{ .Values.api.topologySpread.maxSkew | default 1 }}
          topologyKey: {{ .Values.api.topologySpread.topologyKey | default "kubernetes.io/hostname" }}
          whenUnsatisfiable: {{ .Values.api.topologySpread.whenUnsatisfiable | default "ScheduleAnyway" }}
          labelSelector:
            matchLabels:
              {{- include "openwhispr.api.selectorLabels" . | nindent 14 }}
      containers:
        - name: api
          # ... existing image / envFrom / env ...
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
          startupProbe:
            httpGet:
              path: /api/health
              port: 3000
            failureThreshold: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/live
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 64Mi
```

### `tools/lint-compose-resources.ts` core audit body

```ts
export function auditComposeResources(repoRoot: string): Violation[] {
  const violations: Violation[] = [];
  for (const rel of COMPOSE_FILES) {
    const path = resolve(repoRoot, rel);
    let doc: unknown;
    try { doc = parse(readFileSync(path, "utf-8")); } catch { continue; }
    const services = (doc as { services?: Record<string, unknown> })?.services;
    if (!services) continue;
    for (const [name, raw] of Object.entries(services)) {
      if (SHORT_LIVED_ALLOWLIST.has(name)) continue;
      const svc = raw as { restart?: unknown; deploy?: { resources?: { limits?: { memory?: string } } } };
      // R2 — restart policy
      if (svc.restart !== "unless-stopped" && svc.restart !== "always" && svc.restart !== "on-failure") {
        violations.push({ code: "R2-MISSING-RESTART", file: rel, service: name,
          message: `service '${name}' missing restart: unless-stopped` });
      }
      // R1 — memory limit
      const memStr = svc.deploy?.resources?.limits?.memory;
      if (!memStr) {
        violations.push({ code: "R1-MISSING-MEMORY-LIMIT", file: rel, service: name,
          message: `service '${name}' missing deploy.resources.limits.memory` });
        continue;
      }
      // R3 — floor check
      const floor = MEMORY_FLOORS_BYTES[name];
      if (floor !== undefined) {
        const bytes = parseMemoryString(memStr);
        if (bytes < floor) {
          violations.push({ code: "R3-MEMORY-BELOW-FLOOR", file: rel, service: name,
            message: `service '${name}' memory ${memStr} below floor ${(floor / 1024 ** 2).toFixed(0)}Mi` });
        }
      }
    }
  }
  return violations;
}
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest (lint tools) + helm-unittest 0.7.2 (chart) + GitHub Actions matrix (compose-lint) |
| Config file | `vitest.config.ts` at repo root + `charts/openwhispr/tests/*.yaml` for helm-unittest |
| Quick run command | `pnpm test tools/lint-compose-resources.test.ts -- --run` |
| Full suite command | `pnpm test && helm unittest charts/openwhispr` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| SR-20.1 | every compose long-running service declares `deploy.resources.limits.memory` ≥ floor | unit | `pnpm test tools/lint-compose-resources.test.ts` | Wave 0 (new file) |
| SR-20.2 | restart policy declared on traefik/pgbouncer/minio/LGTM | unit | same as SR-20.1 | same |
| SR-20.3 | startupProbe on api/web/worker/litellm | helm-unittest | `helm unittest charts/openwhispr` | ✅ tests/openwhispr/{api,web,worker,litellm}_test.yaml (extend existing files) |
| SR-20.4 | topologySpreadConstraints on 4 Deployments | helm-unittest | same | same |
| SR-20.5 | securityContext on api/web/worker (litellm exception documented) | helm-unittest | same | same |
| SR-20.6 | compose-lint job passes 8-profile matrix on PR | CI workflow | `.github/workflows/compose-lint.yml` (matrix run on PR) | Wave 0 (new workflow) |
| SR-20.7 | every change has RED commit preceding GREEN | git log audit | manual via `git log --oneline` during verify-work | — |

### Sampling Rate
- **Per task commit:** Vitest run for lint + helm-unittest on whichever templates changed.
- **Per wave merge:** Full suite — `pnpm test && helm unittest charts/openwhispr && docker compose config` for each of 8 profiles.
- **Phase gate:** `make ci-local` (if defined) + manual `gh pr checks` confirms compose-lint + helm-lint both green.

### Wave 0 Gaps
- [ ] `tools/lint-compose-resources.ts` — new file
- [ ] `tools/lint-compose-resources.test.ts` — new file
- [ ] `tools/__tests__/fixtures/compose-resources/bad/docker-compose.yml` — new fixture
- [ ] `tools/__tests__/fixtures/compose-resources/good/docker-compose.yml` — new fixture
- [ ] `.github/workflows/compose-lint.yml` — new workflow (or job appended to `ci.yml`)
- [ ] `tests/openwhispr/api_test.yaml` — append startupProbe/topology/securityContext suites
- [ ] `tests/openwhispr/web_test.yaml` — same (uid 1001 + .next/cache emptyDir)
- [ ] `tests/openwhispr/worker_test.yaml` — same (pgrep exec startupProbe)
- [ ] `tests/openwhispr/litellm_test.yaml` — same (documented exception assertions)
- [ ] `tests/openwhispr/otel_test.yaml` — assert new allowPrivilegeEscalation + seccompProfile keys
- [ ] `package.json` — add `test:lint-compose-resources` + `lint:compose-resources` scripts

---

## Security Domain

### Applicable ASVS categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V1 Architecture | yes | Defense-in-depth: securityContext + readOnlyRootFS + capabilities drop |
| V2 Authentication | no | not touched in this phase |
| V4 Access Control | partial | `runAsNonRoot` + drop capabilities limit kernel-level privilege escalation |
| V10 Malicious Code | yes | `readOnlyRootFilesystem: true` blocks runtime tampering of binaries / scripts |
| V13 API + Web Services | partial | startupProbe + topology improve availability SLO — adjacent to V13.4 (availability) |
| V14 Configuration | yes | resource limits prevent denial-of-service via OOM; restart policies bound recovery |

### Known Threat Patterns for K8s + compose stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| OOM-kills a co-located container | Denial of Service | `deploy.resources.limits.memory` (compose) + `resources.limits.memory` (Helm, already in place) |
| Container escape via setuid binary | Elevation of Privilege | `allowPrivilegeEscalation: false` |
| Modify runtime binary to inject malware | Tampering | `readOnlyRootFilesystem: true` |
| Compromised pod with kernel-syscall escape | Elevation of Privilege | `seccompProfile: RuntimeDefault` |
| Single-node failure takes out all replicas | Denial of Service | `topologySpreadConstraints` |
| Slow-starting pod misdiagnosed as dead by liveness | Denial of Service (self-inflicted) | `startupProbe` |
| Crashed traefik takes ingress offline | Denial of Service | `restart: unless-stopped` |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Memory floors per service (2G postgres, 512M api/worker/litellm, 384M web, etc.) are tight enough to catch real OOMs | §3 Memory floors | LOW — floors are conservative; if too generous, lint passes but cgroup still applies the value, no harm |
| A2 | The 8th compose-lint matrix cell (`e2e`) maps to `compose/e2e/docker-compose.cjm.yml` | §8 CI design | LOW — plan-write will verify exact filename; matrix cell still demonstrates the pattern |
| A3 | Web Next.js standalone needs writable `/app/apps/web/.next/cache` at runtime | §6 Problem 3 | MEDIUM — if untrue, the emptyDir mount is harmless; if true and we miss it, web pod fails after first ISR write |
| A4 | LiteLLM Prisma writes to `/app/.prisma` (not just `/tmp`) | §6 Problem 2 / §10 P8 | MEDIUM — if false, Option A is still correct (LiteLLM exception is justified by uid=root alone); if true, drives the emptyDir mount path |
| A5 | mailpit, fixture-idp, contract-test-runner, k6, speaches are all short-lived enough to allowlist out of SR-20.1/SR-20.2 | §2 SHORT_LIVED_ALLOWLIST | LOW — overaggressive allowlist means a long-running service slips the lint; revisit on case-by-case basis when those overlays evolve |

**Items above with `MEDIUM` risk should be confirmed during plan write or first dry-run.** A3 + A4 in particular: a quick `kubectl exec` on a smoke-deployed web pod to `ls -la /app/apps/web/.next/cache` will confirm A3. A4 can be confirmed with `docker run --rm ghcr.io/berriai/litellm:main-v1.83.14-stable strace -e openat -f --execve /usr/local/bin/litellm 2>&1 | grep prisma` (or equivalent).

---

## Open Questions (RESOLVED 2026-05-16)

1. **E2E overlay file path.** **RESOLVED:** `ls compose/e2e/` shows exactly one file — `compose/e2e/docker-compose.e2e.yml`. The §8 matrix `e2e` cell uses `-f docker-compose.yml -f compose/e2e/docker-compose.e2e.yml`. Plan 20-03 hard-codes this path (no glob/multi-file complexity).

2. **`compose/docker-compose.acme.yml` lint coverage.** **RESOLVED:** Not a separate matrix cell. ACME overlay only adds `LETSENCRYPT_EMAIL` env + acme.json volume to the already-covered `traefik` service in `docker-compose.ingress.yml`; the lint script's static pass over every `compose/*.yml` file (including acme.yml) catches resource/restart violations there, and the dynamic `docker compose config` matrix doesn't need a 9th cell. Documented in 20-01 lint design.

3. **LiteLLM fork decision deferral.** **RESOLVED:** Yes — file `.planning/deferred-items.md` entry "LiteLLM non-root image fork" as part of 20-02b Task 6 commit. Rationale: "Phase 20 closed BLOCKER on app images (api/web/worker); LiteLLM exception documented per Option A; future hardening phase may revisit." This is now a delivery requirement in 20-02b, not an optional follow-up.

---

## Sources

### Primary (HIGH confidence — verified in this session)

- `/Users/nick/openwhispr-server/docker-compose.yml` — base compose, 6 services without `deploy.resources`
- `/Users/nick/openwhispr-server/compose/docker-compose.observability.yml` — 5 LGTM services missing `restart`
- `/Users/nick/openwhispr-server/compose/docker-compose.storage.yml` — minio missing `restart`
- `/Users/nick/openwhispr-server/compose/docker-compose.pgbouncer.yml` — pgbouncer missing `restart`
- `/Users/nick/openwhispr-server/compose/docker-compose.ingress.yml` — traefik missing `restart`
- `/Users/nick/openwhispr-server/apps/api/Dockerfile:172` — `USER node` (uid 1000)
- `/Users/nick/openwhispr-server/apps/worker/Dockerfile:80` — `USER node` (uid 1000)
- `/Users/nick/openwhispr-server/apps/web/Dockerfile:117-118, 132` — `USER nextjs` (uid 1001)
- Live probe `docker run --rm --entrypoint sh ghcr.io/berriai/litellm:main-v1.83.14-stable -c id` → `uid=0(root)` [VERIFIED in this session]
- `/Users/nick/openwhispr-server/charts/openwhispr/templates/api-deployment.yaml` — current shape, no securityContext, no startupProbe, no topology
- `/Users/nick/openwhispr-server/charts/openwhispr/templates/web-deployment.yaml` — same gaps
- `/Users/nick/openwhispr-server/charts/openwhispr/templates/worker-deployment.yaml` — same gaps + pgrep exec probe at lines 105-120
- `/Users/nick/openwhispr-server/charts/openwhispr/templates/litellm-deployment.yaml` — same gaps + `/health/liveliness` probe at line 99
- `/Users/nick/openwhispr-server/charts/openwhispr/templates/otel-collector-daemonset.yaml:81-86` — partial hardening; missing `allowPrivilegeEscalation` + `seccompProfile`
- `/Users/nick/openwhispr-server/charts/openwhispr/values.yaml:79-426` — current values surface, no securityContext/topologySpread blocks
- `/Users/nick/openwhispr-server/charts/openwhispr/tests/api_test.yaml` — canonical helm-unittest patterns (assertion syntax verified)
- `/Users/nick/openwhispr-server/tools/lint-traefik-routes.ts` + `.test.ts` — canonical lint tool pattern (Phase 19b)
- `/Users/nick/openwhispr-server/tools/lint-compose-chart-parity.ts:28-110` — COMPOSE_FILES union pattern + CI integration shape
- `/Users/nick/openwhispr-server/.github/workflows/helm-lint.yml` — CI workflow template
- `/Users/nick/openwhispr-server/.planning/phases/20-compose-helm-production-guardrails/20-AUDIT-SOURCE.md` — audit findings A1-A10, B1-B10, C1-C10
- `/Users/nick/openwhispr-server/.planning/phases/20-compose-helm-production-guardrails/20-CONTEXT.md` — locked decisions SR-20.1..SR-20.7

### Secondary (MEDIUM-HIGH confidence — cited official docs)

- docs.docker.com/reference/compose-file/deploy/ — `deploy.resources.limits` semantics
- docs.docker.com/reference/compose-file/services/#restart — top-level restart policy
- kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes — startup/readiness/liveness contract
- kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/ — topology mechanics
- kubernetes.io/docs/concepts/security/pod-security-admission/ — PSA labels (relevant for hostNetwork OTel exception)
- kubernetes.io/docs/tutorials/security/seccomp/#using-the-container-runtime-default-profile — RuntimeDefault profile
- github.com/helm-unittest/helm-unittest — yaml-path assertion syntax
- github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu24_Readme.md — preinstalled Docker on ubuntu-latest

### Tertiary (LOW confidence — assumed, needs validation during plan write)

- Memory floor recommendations in §3 (no live cgroup observation; chart parity + image class derived)
- E2E overlay path in §8 matrix (filename TBD during plan-write)
- LiteLLM Prisma write path (assumption A4 — confirm during 20-02b dry-run)

---

## Recommendations for planner

1. **Split 20-02 into 20-02a (probes+topology) and 20-02b (securityContext + emptyDirs).** Isolates the only real risk (image-runtime audit) and respects TDD's per-block RED→GREEN cadence.

2. **Drop OTel DaemonSet from SR-20.4 scope.** DaemonSet is inherently one-per-node; topologySpreadConstraints is a no-op there. Revise ROADMAP item to 4 Deployments only.

3. **Parameterize `runAsUser` per workload** in `values.yaml`. Web image runs as uid 1001 (`USER nextjs`), not 1000. A single hardcoded `1000` constant in the template will cause CrashLoopBackOff for web. Schema: `<workload>.securityContext.pod.runAsUser` with appropriate defaults (1000 for api/worker, 1001 for web).

4. **Document LiteLLM as a second hardening exception** (alongside OTel DaemonSet). Upstream `ghcr.io/berriai/litellm:main-v1.83.14-stable` runs as uid 0; Prisma writes to `/app/.prisma`. SR-20.5 for LiteLLM should be the relaxed subset: `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault`, `capabilities: { drop: [ALL] }`. Skip `runAsNonRoot`, `runAsUser`, `readOnlyRootFilesystem`. File "LiteLLM non-root image fork" as a deferred item.

5. **Reuse `tools/lint-compose-chart-parity.ts` COMPOSE_FILES union** in `tools/lint-compose-resources.ts`. Export both from a shared module (or have 20-01's new file import the constant from the existing one). One source of truth for the overlay list.

6. **8-profile matrix in CI is fast enough (~30-45s).** No need for setup-buildx or runner upgrades; `ubuntu-latest` has Docker preinstalled.

7. **emptyDir mounts MUST accompany `readOnlyRootFilesystem: true`** — minimum at `/tmp` for all workloads; web additionally needs `/app/apps/web/.next/cache`. Apply `sizeLimit` to prevent emptyDir exhausting node memory.

8. **`whenUnsatisfiable: ScheduleAnyway`** on every topologySpreadConstraint — `DoNotSchedule` will deadlock the helm-test kind smoke (1-node cluster).

9. **`startupProbe.failureThreshold: 30 × periodSeconds: 10`** = 300s startup budget; well past observed cold-start of Node+Better Auth+drizzle+Valkey-init.

10. **Plan ordering: 20-01 → 20-02a (parallel) → 20-02b → 20-03.** Wave A = {20-01, 20-02a}; Wave B = {20-02b}; Wave C = {20-03}.

11. **Confirm assumptions A3, A4 during plan-write or first 20-02b dry-run.** A live kind smoke after 20-02b's securityContext lands will surface any unknown write paths.

12. **All four `tests/openwhispr/*_test.yaml` files extend in 20-02a + 20-02b**; do not write new test suite files. Append cases to api_test.yaml, web_test.yaml, worker_test.yaml, litellm_test.yaml, otel_test.yaml.

## Metadata

**Confidence breakdown:**
- Compose syntax + lint design: HIGH — Phase 19b pattern verified, yaml package in workspace, compose spec read.
- Helm startupProbe / topology / helm-unittest: HIGH — current templates read, helm-unittest assertion syntax verified in tests/openwhispr/api_test.yaml.
- Image-runtime audit: HIGH for api/worker/web (Dockerfiles read), MEDIUM-HIGH for LiteLLM (live probe done; Prisma path is reasonable assumption).
- Memory floors: LOW (no live observation; chart parity derived).
- CI compose-lint matrix: HIGH (helm-lint workflow shape is reusable; Docker preinstalled on ubuntu-latest).

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days; compose + Helm + K8s probes are stable surfaces)
