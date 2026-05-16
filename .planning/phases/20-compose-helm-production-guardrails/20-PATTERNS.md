# Phase 20: Compose+Helm Production Guardrails — Pattern Map

**Mapped:** 2026-05-16
**Files analyzed:** 13 new/modified (NEW: 4 tool + 5 helm-unittest; MODIFIED: 13 compose/helm/ci)
**Analogs found:** 13 / 13 (all closed against existing precedents)

---

## 0. Executive summary

Phase 20 lands two new TypeScript guardrail surfaces (`tools/lint-compose-resources.ts` + helm-unittest assertions) and modifies 11 existing files (compose overlays, helm templates, CI, Makefile). **Every new file has a strong analog already shipped in the repo** — the planner should copy the analog file verbatim and adapt rather than design from scratch.

**Three load-bearing precedents:**

1. **`tools/lint-traefik-routes.ts` + `tools/lint-traefik-routes.test.ts`** (Phase 19b/SR-19b.1) — the canonical "compose-YAML lint tool" shape. Same data flow, same vitest layout, same fixture directory convention (`tools/__tests__/fixtures/<lint-name>/{good,bad}/`).
2. **`tools/lint-compose-chart-parity.ts`** (Phase 09 DEPLOY-02) — closest existing compose-aware linter that enumerates compose services and reasons about them. Source of `extractComposeServices()` + `parse(yaml)` pattern with `yaml` package.
3. **`charts/openwhispr/tests/api_test.yaml`** + **`charts/openwhispr/tests/otel_test.yaml`** (Phase 09 Plan 06/09-10) — helm-unittest precedent with `equal:` / `matchRegex:` over `spec.template.spec...` JSONPath syntax. New phase 20 test files go alongside under `charts/openwhispr/tests/`, NOT under `tests/openwhispr/` (that path does NOT exist in the repo).

**One CRITICAL pre-condition surfaced by pattern analysis:**

- `apps/web/Dockerfile:117-118` creates user `nextjs` with **uid 1001** (NOT 1000). Phase 20 spec mandates pod `runAsUser: 1000` on web-deployment. This WILL CrashLoop on first install unless either (a) `apps/web/Dockerfile` is rebuilt to use uid 1000, or (b) the chart's `securityContext.runAsUser` for web is parametrised per workload (1000 for api/worker, 1001 for web). `apps/api/Dockerfile:172` uses `USER node` (uid 1000) and `apps/worker/Dockerfile:80` likewise — those two are compatible.

---

## 1. File classification

### NEW files

| File | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `tools/lint-compose-resources.ts` | utility / CLI lint | request-response (file in → violations out) | `tools/lint-traefik-routes.ts` | exact |
| `tools/lint-compose-resources.test.ts` | test (vitest unit) | request-response | `tools/lint-traefik-routes.test.ts` | exact |
| `tools/__tests__/fixtures/compose-resources/{good,bad}/*.yml` | test fixtures | static YAML | `tools/__tests__/fixtures/traefik-routes/{good,bad}/compose/*` | exact |
| `charts/openwhispr/tests/api-deployment_resources_test.yaml` (or extend `api_test.yaml`) | helm-unittest | request-response | `charts/openwhispr/tests/api_test.yaml` | exact |
| same for `web-deployment`, `worker-deployment`, `litellm-deployment`, `otel-collector-daemonset` | helm-unittest | request-response | `charts/openwhispr/tests/otel_test.yaml` | exact |

### MODIFIED files

| File | Role | Data flow | Closest analog (for the new fields) | Match |
|---|---|---|---|---|
| `docker-compose.yml` | config / compose service map | static YAML | `compose/docker-compose.load-test.yml` (already has `deploy.resources.limits`) | role-match |
| `compose/docker-compose.ingress.yml` | compose overlay | static YAML | itself + `compose/docker-compose.pgbouncer.yml` for `restart:` precedent | self |
| `compose/docker-compose.pgbouncer.yml` | compose overlay | static YAML | base `docker-compose.yml` services with healthchecks | role-match |
| `compose/docker-compose.storage.yml` | compose overlay | static YAML | same | role-match |
| `compose/docker-compose.observability.yml` | compose overlay | static YAML | same | role-match |
| `compose/docker-compose.embedded-litellm.yml`, `compose/docker-compose.load-test.yml`, `compose/docker-compose.load-test.realistic.yml`, `compose/e2e/docker-compose.e2e.yml`, `compose/live-soak/docker-compose.live.yml` | compose overlay | static YAML | same | role-match |
| `charts/openwhispr/templates/api-deployment.yaml` | helm template (Deployment) | request-response | itself (lines 173-191 readinessProbe/resources block); `otel-collector-daemonset.yaml:81-86` for securityContext shape | self + cross |
| `charts/openwhispr/templates/web-deployment.yaml` | helm template | request-response | `api-deployment.yaml` | role-match |
| `charts/openwhispr/templates/worker-deployment.yaml` | helm template (exec-probe service) | request-response | `worker-deployment.yaml` (already has exec readiness/liveness) + `api-deployment.yaml` for securityContext copy | self |
| `charts/openwhispr/templates/litellm-deployment.yaml` | helm template | request-response | `api-deployment.yaml` securityContext | cross |
| `charts/openwhispr/templates/otel-collector-daemonset.yaml` | helm template (DaemonSet) | request-response | itself (already has partial hardening at lines 81-86) | self |
| `charts/openwhispr/values.yaml` | helm values | static YAML | itself (existing `api:` block at line 238, `observability.collector.resources` precedent) | self |
| `charts/openwhispr/values.schema.json` | helm schema (JSON-Schema draft-07) | request-response | itself (existing `secrets` + `observability` blocks at lines 6-200) | self |
| `.github/workflows/ci.yml` | CI workflow | event-driven | `.github/workflows/helm-lint.yml` (parallel-job target) + existing `lint-rls` job at `.github/workflows/ci.yml:204-256` (closest in-file precedent) | role-match |
| `Makefile` | task runner | request-response | `Makefile:25-26` `lint-rls` target | exact |
| `apps/api/Dockerfile`, `apps/worker/Dockerfile` | image build | filesystem | already shipping `USER node` (uid 1000) — no change required | OK |
| `apps/web/Dockerfile` | image build | filesystem | needs new commit to switch `nextjs` from uid 1001 → uid 1000 OR chart parameterised per-workload | NEW CONSTRAINT |

---

## 2. Pattern assignments

### 2.1 `tools/lint-compose-resources.ts` (utility / CLI lint)

**Primary analog:** `/Users/nick/openwhispr-server/tools/lint-traefik-routes.ts`
**Why closest:** same data flow (read compose YAMLs → emit typed `Violation[]`), same CLI shape, same yaml-package usage, lives in same directory.

**Pattern: SPDX header + Phase tag (lines 1-2 of analog):**
```ts
// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 20 / SR-20.1 — lint guard for missing deploy.resources.limits +
// restart policies on long-running compose services.
```

**Pattern: imports block (analog lines 28-31):**
```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
```
Reuse verbatim. `yaml` package is already a dep (used by `lint-traefik-routes.ts` and `lint-compose-chart-parity.ts:23`).

**Pattern: Violation interface (analog lines 33-37):**
```ts
export interface Violation {
  readonly code: "R1" | "R2" | "R3" | "R4";   // R1=missing memory limit, R2=missing restart, R3=under-floor, R4=unparseable
  readonly file: string;
  readonly message: string;
}
```

**Pattern: safe-yaml reader (analog lines 53-59) — copy verbatim:**
```ts
function readYamlSafe(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}
```

**Pattern: top-level audit function with injectable options (analog lines 259-302):**
```ts
export interface AuditOptions {
  readonly composeFiles?: readonly string[];
  readonly memoryFloorsByService?: Readonly<Record<string, string>>;  // service → "512Mi", "2Gi", etc.
  readonly servicesRequiringRestart?: readonly string[];
}

export function auditComposeResources(repoRoot: string, opts: AuditOptions = {}): Violation[] {
  const composeFiles = opts.composeFiles ?? defaultComposeFiles(repoRoot);
  // …iterate, accumulate Violation[]
}
```

**Pattern: repo-root resolution + CLI entry guard (analog lines 304-323) — copy verbatim:**
```ts
function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = auditComposeResources(findRepoRoot());
  if (violations.length === 0) {
    console.log("lint-compose-resources: clean");
    process.exit(0);
  }
  for (const v of violations) {
    console.error(`${v.file}: [${v.code}] ${v.message}`);
  }
  process.exit(1);
}
```

**Pattern: default-compose-files list (analog lines 274-279) — extend with the full Phase 20 set:**
```ts
function defaultComposeFiles(repoRoot: string): string[] {
  return [
    resolve(repoRoot, "docker-compose.yml"),
    resolve(repoRoot, "compose/docker-compose.ingress.yml"),
    resolve(repoRoot, "compose/docker-compose.pgbouncer.yml"),
    resolve(repoRoot, "compose/docker-compose.storage.yml"),
    resolve(repoRoot, "compose/docker-compose.observability.yml"),
    resolve(repoRoot, "compose/docker-compose.embedded-litellm.yml"),
    resolve(repoRoot, "compose/docker-compose.load-test.yml"),
    resolve(repoRoot, "compose/docker-compose.load-test.realistic.yml"),
    resolve(repoRoot, "compose/e2e/docker-compose.e2e.yml"),
    resolve(repoRoot, "compose/live-soak/docker-compose.live.yml"),
  ];
}
```

**Secondary analog (for service-name enumeration):** `tools/lint-compose-chart-parity.ts:174-194` — `extractComposeServices()` returns `Object.keys(doc.services)`; `collectComposeServices()` unions across files with a per-file try/catch skip. Copy the iteration pattern, swap the inner check from "service present" to "service.deploy.resources.limits.memory present AND >= floor AND service.restart is one of {always, unless-stopped}".

**Memory-floor parsing helper (NEW, no analog — write inline):**
Parse `"512M" | "512Mi" | "2G" | "2Gi"` into bytes. Existing repo code uses Kubernetes-style suffixes in helm `values.yaml` (`memory: 1Gi` at `api-deployment.yaml:191`) and docker-compose-style `memory: 512M` in `compose/docker-compose.load-test.yml`. The lint must accept both.

---

### 2.2 `tools/lint-compose-resources.test.ts` (vitest unit)

**Primary analog:** `/Users/nick/openwhispr-server/tools/lint-traefik-routes.test.ts` (lines 1-45 — read whole file).
**Why closest:** identical three-case shape (live repo / synthetic BAD / synthetic GOOD), same fixture-path resolution, same vitest imports.

**Pattern: SPDX header + describe block (analog lines 1-22):**
```ts
// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 20 / SR-20.1 — vitest coverage for the compose-resources guard.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditComposeResources } from "./lint-compose-resources.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const FIXTURE_BAD = resolve(HERE, "__tests__", "fixtures", "compose-resources", "bad");
const FIXTURE_GOOD = resolve(HERE, "__tests__", "fixtures", "compose-resources", "good");
```

**Pattern: three test cases (analog lines 22-44) — copy verbatim shape:**
```ts
describe("lint-compose-resources — SR-20.1 guard", () => {
  it("returns zero violations against the live repo tree (regression sentinel)", () => {
    expect(auditComposeResources(REPO_ROOT)).toEqual([]);
  });

  it("flags every violation class on the synthetic BAD fixture", () => {
    const violations = auditComposeResources(FIXTURE_BAD);
    const codes = new Set(violations.map((v) => v.code));
    expect(codes.has("R1")).toBe(true);  // missing memory limit
    expect(codes.has("R2")).toBe(true);  // missing restart
    expect(codes.has("R3")).toBe(true);  // under floor
  });

  it("returns zero violations against the synthetic GOOD fixture", () => {
    expect(auditComposeResources(FIXTURE_GOOD)).toEqual([]);
  });
});
```

**TDD ordering (per CONTEXT.md SR-20.7):** The first `it("returns zero against the live tree")` is the RED in commit 1. Commit 2 lands the production limits in `docker-compose.yml` + overlays, turning it GREEN. The BAD/GOOD synthetic cases land GREEN from inception (they validate lint logic, not codebase state).

---

### 2.3 `tools/__tests__/fixtures/compose-resources/{good,bad}/*.yml` (fixtures)

**Primary analog:** `/Users/nick/openwhispr-server/tools/__tests__/fixtures/traefik-routes/{good,bad}/compose/*.yml`
**Why closest:** same directory convention, same role (synthetic compose snippets exercising the lint logic without touching the real repo).

**Reuse checklist:**
- Mirror the `{good,bad}` split — separate directories, NOT one file with multiple docs.
- Each fixture is a minimal `name: openwhispr-test\nservices: {...}` doc — keep ~20 lines, just enough to hit every violation code (R1..R4).
- `bad/docker-compose.yml` should have ≥ 1 service missing `deploy.resources.limits.memory` (R1), ≥ 1 service with no `restart:` key (R2), ≥ 1 service with `memory: 64M` against the postgres floor `2G` (R3).
- `good/docker-compose.yml` is the compliant shape — copy from the real `docker-compose.yml` after the production fix lands, trim to 3-4 services.

---

### 2.4 helm-unittest YAML files (`charts/openwhispr/tests/*_test.yaml`)

**Location correction:** the spec mentions `tests/openwhispr/*.yaml` but that path does NOT exist. The real path is `/Users/nick/openwhispr-server/charts/openwhispr/tests/` (verified via `find`). 22 existing `*_test.yaml` files live there including `api_test.yaml`, `web_test.yaml`, `worker_test.yaml`, `litellm_test.yaml`, `otel_test.yaml`. **Phase 20 should EXTEND those existing suites with new `tests:` entries rather than create parallel files.**

**Primary analog for assertions:** `/Users/nick/openwhispr-server/charts/openwhispr/tests/api_test.yaml:83-99` (readinessProbe assertions) and `:91-100` (path/port/initialDelay equality).

**Pattern: startupProbe assertion (NEW, derived from existing readinessProbe pattern at api_test.yaml:83-99):**
```yaml
  - it: api Deployment declares startupProbe failureThreshold 30 + period 10s (SR-20.3)
    template: api-deployment.yaml
    set:
      secrets:
        mode: eso
        external:
          storeRef: vault-clusterstore
    asserts:
      - equal:
          path: spec.template.spec.containers[0].startupProbe.failureThreshold
          value: 30
      - equal:
          path: spec.template.spec.containers[0].startupProbe.periodSeconds
          value: 10
      - equal:
          path: spec.template.spec.containers[0].startupProbe.httpGet.path
          value: /api/health
```

**Pattern: topologySpreadConstraints assertion (NEW):**
```yaml
  - it: api Deployment declares topologySpread maxSkew 1 on hostname (SR-20.4)
    template: api-deployment.yaml
    set: { secrets: { mode: eso, external: { storeRef: dummy } } }
    asserts:
      - equal:
          path: spec.template.spec.topologySpreadConstraints[0].maxSkew
          value: 1
      - equal:
          path: spec.template.spec.topologySpreadConstraints[0].topologyKey
          value: kubernetes.io/hostname
      - equal:
          path: spec.template.spec.topologySpreadConstraints[0].whenUnsatisfiable
          value: ScheduleAnyway
```

**Pattern: securityContext assertion (pod + container) — derived from `otel_test.yaml` patterns:**
```yaml
  - it: api Deployment pod runs as non-root with seccomp RuntimeDefault (SR-20.5)
    template: api-deployment.yaml
    set: { secrets: { mode: eso, external: { storeRef: dummy } } }
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
      - equal:
          path: spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem
          value: true
      - equal:
          path: spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation
          value: false
      - contains:
          path: spec.template.spec.containers[0].securityContext.capabilities.drop
          content: ALL
```

**Reuse checklist for helm-unittest:**
- Every test MUST set `secrets.mode: eso` to bypass the helm-values fail gate (precedent: `api_test.yaml:13-16`, `otel_test.yaml:12-15` — every existing test does this).
- Use `equal:` for scalar checks, `matchRegex:` only when a substring/pattern is needed (precedent `api_test.yaml:40-42`).
- Use JSONPath filter `env[?(@.name=="DATABASE_URL")]` syntax (precedent `api_test.yaml:41`) — already supported by helm-unittest 0.7.2.

---

### 2.5 `docker-compose.yml` + all `compose/*.yml` overlays — add `deploy.resources.limits` + `restart:`

**Primary analog (for `deploy.resources.limits` shape):** `/Users/nick/openwhispr-server/compose/docker-compose.load-test.yml` (already declares limits per docs/CONTEXT) — read for canonical format.

**Pattern: `deploy.resources.limits` block (compose-spec v2, NO swarm needed for non-swarm — `docker compose` honors `deploy.resources.limits` since v1.29+):**
```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"
    restart: unless-stopped
```

**Pattern: `restart:` on services — already established in base `docker-compose.yml` services? Verify per service.** Spec mandates additions on Traefik (`compose/docker-compose.ingress.yml:30`), PgBouncer (`compose/docker-compose.pgbouncer.yml`), MinIO (`compose/docker-compose.storage.yml`), 5 LGTM services (`compose/docker-compose.observability.yml:38-`).

**Floors from CONTEXT.md SR-20.1 (lock into `tools/lint-compose-resources.ts` defaults):**

| Service | Memory floor |
|---|---|
| postgres | 2G |
| litellm, api, worker | 512M |
| web | 384M |
| loki, tempo, mimir | 512M |
| grafana | 256M |
| otel-collector | 256M |

---

### 2.6 `charts/openwhispr/templates/api-deployment.yaml` + web/worker/litellm — add startupProbe + topologySpreadConstraints + securityContext

**Primary analog for startupProbe (NEW shape, derived from existing readinessProbe at `api-deployment.yaml:173-178`):**

Insert BEFORE the existing `readinessProbe:` block at line 173:
```yaml
          startupProbe:
            httpGet:
              path: /api/health
              port: 3000
            failureThreshold: 30
            periodSeconds: 10
```
For worker (which uses exec, per `worker-deployment.yaml:105-110`):
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

**Primary analog for `topologySpreadConstraints` (NEW; no Deployment in repo has this yet — pattern from K8s docs, parameterised through values):**

Insert at pod-template level (inside `spec.template.spec`, alongside `serviceAccountName` at `api-deployment.yaml:44`):
```yaml
      {{- with .Values.api.topologySpread }}
      topologySpreadConstraints:
        - maxSkew: {{ .maxSkew | default 1 }}
          topologyKey: {{ .topologyKey | default "kubernetes.io/hostname" }}
          whenUnsatisfiable: {{ .whenUnsatisfiable | default "ScheduleAnyway" }}
          labelSelector:
            matchLabels:
              {{- include "openwhispr.api.selectorLabels" $ | nindent 14 }}
      {{- end }}
```
Reuse `openwhispr.api.selectorLabels` helper (already used at `api-deployment.yaml:38`). For web/worker/litellm use the corresponding selectorLabels helper.

**Primary analog for pod-level `securityContext`:** none on api/web/worker/litellm yet. **Reference precedent: `charts/openwhispr/templates/otel-collector-daemonset.yaml:81-86`** — already has container-level `securityContext` with `runAsUser`, `readOnlyRootFilesystem`, `capabilities.drop: [ALL]`. The new pattern adds the missing fields and also adds pod-level:

```yaml
    spec:
      serviceAccountName: …
      securityContext:
        runAsNonRoot: true
        runAsUser: {{ .Values.api.securityContext.runAsUser | default 1000 }}
        fsGroup: {{ .Values.api.securityContext.fsGroup | default 1000 }}
        seccompProfile:
          type: RuntimeDefault
      …
      containers:
        - name: api
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
```

**OTel Collector partial-hardening update** (`otel-collector-daemonset.yaml:81-86`): add two missing fields to the existing block:
```yaml
          securityContext:
            runAsUser: 0   # documented exception for hostmetrics
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false       # NEW (SR-20.5)
            seccompProfile:                       # NEW (SR-20.5)
              type: RuntimeDefault
            capabilities:
              drop: ["ALL"]
```

**readOnlyRootFilesystem caveat (per CONTEXT.md line 63):** if api/web/worker writes anywhere outside `/tmp` at runtime (Next.js standalone output writes to `.next/cache`; api writes nothing; worker writes nothing), mount an `emptyDir` and reference in `volumeMounts`. Investigate per-image in the planner's verify-as-you-go step.

---

### 2.7 `charts/openwhispr/values.yaml` — add new blocks

**Primary analog (resources nested block):** `charts/openwhispr/values.yaml` lines 118-129 (litellm.resources via `.Values.observability.collector.resources` precedent referenced at `otel-collector-daemonset.yaml:113`).

**Pattern: per-workload `topologySpread` + `securityContext` + `startupProbe` blocks:**
```yaml
api:
  replicas: 2
  topologySpread:
    maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
  securityContext:
    runAsUser: 1000
    fsGroup: 1000
  startupProbe:
    failureThreshold: 30
    periodSeconds: 10
  # … existing api block continues at line 238
```
Repeat for `web` (line 272 — note `runAsUser: 1001` if Dockerfile stays as-is), `worker` (line 279), `litellm` (line ~118).

---

### 2.8 `charts/openwhispr/values.schema.json` — extend schema

**Primary analog:** existing nested blocks at lines 137-200 (`bundledAi`, `valkey`, `minio`, `observability`).

**Pattern: add `topologySpread` + `securityContext` + `startupProbe` properties under each workload object:**
```json
"api": {
  "type": "object",
  "properties": {
    "replicas": { "type": "integer", "minimum": 1 },
    "topologySpread": {
      "type": "object",
      "properties": {
        "maxSkew": { "type": "integer", "minimum": 1 },
        "topologyKey": { "type": "string" },
        "whenUnsatisfiable": { "type": "string", "enum": ["DoNotSchedule", "ScheduleAnyway"] }
      }
    },
    "securityContext": {
      "type": "object",
      "properties": {
        "runAsUser": { "type": "integer", "minimum": 0 },
        "fsGroup": { "type": "integer", "minimum": 0 }
      }
    },
    "startupProbe": {
      "type": "object",
      "properties": {
        "failureThreshold": { "type": "integer", "minimum": 1 },
        "periodSeconds": { "type": "integer", "minimum": 1 }
      }
    }
  }
}
```

---

### 2.9 `.github/workflows/ci.yml` — add `compose-lint` job

**Primary analog:** existing `lint-rls` job at `.github/workflows/ci.yml:204-256` (in-file precedent) AND parallel-structure target `.github/workflows/helm-lint.yml:24-120` (cross-file precedent).

**Pattern: new job block (insert after `lint-english` at `ci.yml:29-41`):**
```yaml
  compose-lint:
    runs-on: ubuntu-24.04
    steps:
      - uses: step-security/harden-runner@a5ad31d6a139d249332a2605b85202e8c0b78450  # v2.19.1
        with: { egress-policy: audit }
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: 11.0.8 }
      - uses: actions/setup-node@v5
        with: { node-version: '24', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - name: lint-compose-resources (vitest with ≥90/90/90/90 coverage)
        run: pnpm test:lint-compose-resources
      - name: lint-compose-resources (CLI run against repo)
        run: pnpm exec tsx tools/lint-compose-resources.ts
      - name: docker compose config — 8 profile combinations (SR-20.6)
        run: |
          for combo in default contract-test observability pgbouncer storage load-test-mock load-test-realistic e2e; do
            echo "--- compose config: $combo"
            # composed -f chain per profile (see compose/docker-compose.*.yml)
            # full matrix expansion in script…
          done
```

**Important:** the SHA-pinned `step-security/harden-runner` is the in-repo convention (`ci.yml:18, 164, 224`). Reuse the same SHA.

---

### 2.10 `Makefile` — add `lint-compose-resources` target

**Primary analog:** `/Users/nick/openwhispr-server/Makefile:25-26` (the `lint-rls` target).
```makefile
lint-rls:
	pnpm exec tsx tools/lint-rls.ts
```

**Pattern: new target (insert near line 26):**
```makefile
lint-compose-resources:
	pnpm exec tsx tools/lint-compose-resources.ts
```

Also: add the target name to the `.PHONY:` list at `Makefile:5-10`.

**Pattern: `package.json` script entry** (precedent `package.json:33` for `test:lint-compose-chart-parity`):
```json
"test:lint-compose-resources": "vitest run tools/lint-compose-resources.test.ts --coverage --coverage.include=tools/lint-compose-resources.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90"
```
Verbatim copy of the existing line at `package.json:33` with the file name swapped.

---

### 2.11 Dockerfile changes — `apps/web/Dockerfile` (CONTINGENT)

**Primary constraint:** `apps/web/Dockerfile:113-118` creates `nextjs` user with uid **1001** (separate from `node` uid 1000 to avoid bind-mount collisions). Phase 20 spec mandates `runAsUser: 1000` cluster-wide.

**Two paths the planner must pick from:**

1. **Rebuild web Dockerfile to use uid 1000** — switch `adduser -u 1001` → `adduser -u 1000` (lines 117-118), accept the documented bind-mount collision risk (irrelevant in K8s where there are no host bind mounts).
2. **Keep web at uid 1001 and parameterise chart** — `values.yaml: web.securityContext.runAsUser: 1001` while api/worker remain at 1000.

Option 2 is lower-risk (no image rebuild + republish needed in this phase). Planner decides.

**Pattern for image rebuild (if option 1):**
```dockerfile
RUN addgroup -S nodejs -g 1000 \
 && adduser  -S nextjs -G nodejs -u 1000
```

`apps/api/Dockerfile:172` (`USER node`, uid 1000) and `apps/worker/Dockerfile:80` (`USER node`, uid 1000) already satisfy `runAsUser: 1000` — no Dockerfile changes needed for those two.

**Verification step the planner MUST include:** after rendering with `securityContext.runAsUser`, run `helm template … | grep runAsUser` and `kubectl run --image=ghcr.io/openwhispr/openwhispr-web:dev --rm -it -- id -u` (or `docker run --rm <image> id -u`) against a live image to confirm uid is reachable. Live-kind verification precedent: Phase 09.1.

---

## 3. Shared patterns (cross-cutting)

### 3.1 SPDX header on every new TS file

**Source:** `tools/lint-traefik-routes.ts:1` (`// SPDX-License-Identifier: FSL-1.1-ALv2`)
**Apply to:** every new `.ts` file in `tools/`. Repo has a lint (`tools/spdx-header.test.ts`) that gates this.

### 3.2 Phase-tag comment

**Source:** `tools/lint-traefik-routes.ts:2` (`// Phase 19b / SR-19b.1 — lint guard against the STRUCT-05 host-split regression.`)
**Apply to:** every new file's header. Phase 20 tag format: `// Phase 20 / SR-20.X — <one-line purpose>`. Repo has `tools/lint-phase-tag-comments.ts` enforcement.

### 3.3 Vitest co-located tests

**Source:** `tools/lint-traefik-routes.test.ts` (next to source under `tools/`, NOT under `tools/__tests__/`).
**Apply to:** `tools/lint-compose-resources.test.ts` lives in `tools/`, not in `tools/__tests__/`. Fixtures DO live under `tools/__tests__/fixtures/<lint-name>/` (precedent: `traefik-routes/` and `dockerfile-tls/`).
**Lint gate:** `tools/lint-colocated-tests.ts` enforces this.

### 3.4 yaml-package usage

**Source:** `tools/lint-traefik-routes.ts:31` + `tools/lint-compose-chart-parity.ts:23` both import `parse` from `yaml`. Already a workspace dep — DO NOT add `js-yaml` (different package).

### 3.5 CLI exit code convention

**Source:** `tools/lint-traefik-routes.ts:313-323` + `tools/lint-dockerfile-tls.ts:17-22`:
- 0 = clean
- 1 = violation(s) found, per-file stderr
- 2 = internal error (unparseable YAML, missing required files)

### 3.6 step-security/harden-runner SHA pin

**Source:** `.github/workflows/ci.yml:18` — `step-security/harden-runner@a5ad31d6a139d249332a2605b85202e8c0b78450  # v2.19.1`. Apply this verbatim SHA in the new `compose-lint` job.

### 3.7 helm-unittest `secrets.mode: eso` bypass

**Source:** every `tests/*.yaml` file uses this pattern (`api_test.yaml:13-16`, `otel_test.yaml:12-15`, `skeleton_test.yaml:6-10`). Required to bypass the `helm-values` mode's render-time `fail` on empty secrets. Apply to every new `tests:` entry.

---

## 4. No-analog files

None. Every Phase 20 file has at least a role-match analog. The closest miss is the `topologySpreadConstraints` field — no Deployment template currently declares it — but the pattern is well-documented in K8s upstream and the values-block shape mirrors the existing `.Values.observability.collector.resources` mapping idiom.

---

## 5. Reuse checklist — DO NOT reinvent

The planner should explicitly reference these existing artefacts and NOT re-implement them:

| Artefact | Reuse for |
|---|---|
| `parse` from `yaml` (npm package, already in workspace) | All compose-YAML reads in `lint-compose-resources.ts` |
| `readYamlSafe(path)` (lint-traefik-routes.ts:53-59) | Copy-paste verbatim |
| `findRepoRoot()` (lint-traefik-routes.ts:304-308) | Copy-paste verbatim |
| `Violation` interface shape (lint-traefik-routes.ts:33-37) | Copy + rename codes |
| `if (import.meta.url === \`file://${process.argv[1]}\`)` CLI guard | Copy verbatim from lint-traefik-routes.ts:313 |
| `tools/__tests__/fixtures/<lint>/{good,bad}/` directory convention | Mirror the traefik-routes layout |
| `secrets.mode: eso` set-block in helm-unittest | Copy from api_test.yaml:13-16 to every new test |
| `openwhispr.api.selectorLabels` / `openwhispr.web.selectorLabels` / etc. helpers | Already in `_helpers.tpl`; reuse in `topologySpreadConstraints.labelSelector` |
| `step-security/harden-runner@a5ad31d6a139d249332a2605b85202e8c0b78450 # v2.19.1` | The SHA-pinned action — copy verbatim into the new compose-lint job |
| `pnpm/action-setup@v4 { version: 11.0.8 }` | Same — used in every CI job |
| `actions/setup-node@v5 { node-version: '24', cache: 'pnpm' }` | Same |
| `test:lint-compose-chart-parity` script in `package.json:33` | Template for the new `test:lint-compose-resources` script (swap file name) |
| `Makefile:25-26` `lint-rls` target shape | Template for `lint-compose-resources` Makefile target |
| Helm-unittest assertion vocabulary: `equal`, `matchRegex`, `hasDocuments`, `isKind`, `contains` | All already in use across `tests/*.yaml` — no new helm-unittest features needed |
| `compose/docker-compose.load-test.yml` `deploy.resources.limits` block | Reference shape for adding limits to base compose services |
| Existing `securityContext` partial on `otel-collector-daemonset.yaml:81-86` | Pattern for the new pod+container blocks on api/web/worker/litellm |
| Existing `readinessProbe` + `livenessProbe` blocks at `api-deployment.yaml:173-184`, `web-deployment.yaml:103-114`, `worker-deployment.yaml:105-120`, `litellm-deployment.yaml:97-113` | Probe shape (httpGet vs exec) — new `startupProbe` copies the probe-target verbatim, only adjusting `failureThreshold` and `periodSeconds` |
| `apps/api/Dockerfile:172` `USER node` (uid 1000) + `apps/worker/Dockerfile:80` `USER node` (uid 1000) | No change needed — already satisfies SR-20.5 |
| `apps/web/Dockerfile:117-118` (uid 1001) | NEW DECISION REQUIRED — see § 2.11 |

---

## 6. Metadata

**Analog search scope:**
- `/Users/nick/openwhispr-server/tools/` (50 entries, focused on lint-* prefix)
- `/Users/nick/openwhispr-server/tools/__tests__/fixtures/` (2 existing fixture trees)
- `/Users/nick/openwhispr-server/charts/openwhispr/templates/` (46 templates)
- `/Users/nick/openwhispr-server/charts/openwhispr/tests/` (22 helm-unittest suites)
- `/Users/nick/openwhispr-server/.github/workflows/` (17 workflows; closest: helm-lint.yml, ci.yml)
- `/Users/nick/openwhispr-server/compose/` (13 compose overlays)
- `/Users/nick/openwhispr-server/apps/{api,web,worker}/Dockerfile`

**Files scanned in full (no re-reads):** 8 source files (lint-traefik-routes.ts, lint-traefik-routes.test.ts, lint-compose-chart-parity.ts[1-299], api_test.yaml[1-120], otel_test.yaml[1-120], api-deployment.yaml[1-192], helm-lint.yml, ci.yml[1-527]).

**Files scanned partially:** values.yaml (lines 1-100, 230-320), values.schema.json (lines 1-200), 3 Dockerfiles (USER + uid lines), 4 compose files (headers + service-name spots), worker/web/litellm-deployment.yaml (probe + resources blocks).

**Pattern extraction date:** 2026-05-16
