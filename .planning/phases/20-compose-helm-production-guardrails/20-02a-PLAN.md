---
phase: 20-compose-helm-production-guardrails
plan: 02a
type: execute
wave: A
depends_on: []
files_modified:
  - charts/openwhispr/templates/api-deployment.yaml
  - charts/openwhispr/templates/web-deployment.yaml
  - charts/openwhispr/templates/worker-deployment.yaml
  - charts/openwhispr/templates/litellm-deployment.yaml
  - charts/openwhispr/values.yaml
  - charts/openwhispr/values.schema.json
  - charts/openwhispr/tests/api_test.yaml
  - charts/openwhispr/tests/web_test.yaml
  - charts/openwhispr/tests/worker_test.yaml
  - charts/openwhispr/tests/litellm_test.yaml
autonomous: true
requirements: [SR-20.3, SR-20.4, SR-20.7]
must_haves:
  truths:
    - "api/web/worker/litellm Deployments each declare a startupProbe with failureThreshold: 30 and periodSeconds: 10 (300 s startup budget)"
    - "api/web/litellm startupProbe uses httpGet to the same path/port as the existing readinessProbe"
    - "worker startupProbe uses exec pgrep matching the existing readiness/liveness probe"
    - "api/web/worker/litellm Deployments each declare topologySpreadConstraints with maxSkew: 1, topologyKey: kubernetes.io/hostname, whenUnsatisfiable: ScheduleAnyway, labelSelector matching the workload"
    - "values.yaml + values.schema.json declare optional .topologySpread and .startupProbe overrides per workload"
    - "helm-unittest assertions for startupProbe + topologySpread land RED, then production templates flip them GREEN (git log shows RED commit preceding GREEN)"
    - "helm unittest charts/openwhispr exits 0 with all assertions passing"
  artifacts:
    - path: charts/openwhispr/templates/api-deployment.yaml
      provides: "startupProbe block + topologySpreadConstraints block (values-driven)"
      contains: "startupProbe:"
    - path: charts/openwhispr/templates/web-deployment.yaml
      provides: "startupProbe + topologySpreadConstraints"
      contains: "topologySpreadConstraints:"
    - path: charts/openwhispr/templates/worker-deployment.yaml
      provides: "exec-shape startupProbe + topologySpreadConstraints"
      contains: "startupProbe:"
    - path: charts/openwhispr/templates/litellm-deployment.yaml
      provides: "startupProbe + topologySpreadConstraints"
      contains: "topologySpreadConstraints:"
    - path: charts/openwhispr/values.yaml
      provides: "per-workload topologySpread + startupProbe override blocks"
      contains: "topologySpread:"
    - path: charts/openwhispr/values.schema.json
      provides: "JSON-Schema draft-07 entries for topologySpread + startupProbe per workload"
      contains: "topologySpread"
    - path: charts/openwhispr/tests/api_test.yaml
      provides: "Appended `it:` cases asserting startupProbe + topologySpread shape"
      contains: "startupProbe.failureThreshold"
    - path: charts/openwhispr/tests/worker_test.yaml
      provides: "Appended `it:` cases — startupProbe exec pgrep + topologySpread"
      contains: "pgrep"
  key_links:
    - from: charts/openwhispr/templates/api-deployment.yaml
      to: charts/openwhispr/values.yaml
      via: ".Values.api.topologySpread + .Values.api.startupProbe templating"
      pattern: "\\.Values\\.api\\.(topologySpread|startupProbe)"
    - from: charts/openwhispr/templates/api-deployment.yaml
      to: charts/openwhispr/templates/_helpers.tpl
      via: 'include "openwhispr.api.selectorLabels" in topologySpread.labelSelector'
      pattern: 'include "openwhispr\\.api\\.selectorLabels"'
    - from: charts/openwhispr/tests/api_test.yaml
      to: charts/openwhispr/templates/api-deployment.yaml
      via: "helm-unittest template + asserts at spec.template.spec.containers[0].startupProbe.*"
      pattern: "spec\\.template\\.spec\\.containers\\[0\\]\\.startupProbe"
---

<objective>
Land SR-20.3 (Helm `startupProbe` on api/web/worker/litellm with 300 s budget) and SR-20.4 (`topologySpreadConstraints` on the same 4 Deployments) via helm-unittest RED then production-template GREEN. Mechanical YAML, low-risk surface.

Purpose: Close audit findings B1 (slow-start probes misdiagnosing live pods as dead) and B2 (replicas can land on a single node, defeating the 1000-concurrent HA target). DaemonSet is excluded per 20-RESEARCH.md §5 (a DaemonSet's "1 pod per node" is already enforced by the controller — topologySpread is a no-op).

Output: 4 templates patched, 2 values files extended, 4 helm-unittest suites appended. No image changes. No readOnlyRootFilesystem risk (that lands in plan 20-02b).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/20-compose-helm-production-guardrails/20-CONTEXT.md
@.planning/phases/20-compose-helm-production-guardrails/20-RESEARCH.md
@.planning/phases/20-compose-helm-production-guardrails/20-PATTERNS.md

# Pattern source files
@charts/openwhispr/tests/api_test.yaml
@charts/openwhispr/templates/api-deployment.yaml
@charts/openwhispr/templates/web-deployment.yaml
@charts/openwhispr/templates/worker-deployment.yaml
@charts/openwhispr/templates/litellm-deployment.yaml
@charts/openwhispr/templates/_helpers.tpl
@charts/openwhispr/values.yaml
@charts/openwhispr/values.schema.json

<interfaces>
<!-- Existing readiness probe target per workload (source: 20-RESEARCH.md §4) -->
- api      -> httpGet path=/api/health        port=3000  (api-deployment.yaml:173-178)
- web      -> httpGet path=/api/health        port=3001  (web-deployment.yaml:103-114)
- worker   -> exec   "pgrep -f 'node /app/dist/index.js'"  (worker-deployment.yaml:105-120)
- litellm  -> httpGet path=/health/liveliness port=4000  (litellm-deployment.yaml:97-113)

<!-- New values.yaml block shape (per workload api/web/worker/litellm) -->
api:
  topologySpread:
    enabled: true
    maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
  startupProbe:
    failureThreshold: 30
    periodSeconds: 10

<!-- All helm-unittest tests MUST include this set: block to bypass the secrets-mode fail gate.
     Source: charts/openwhispr/tests/api_test.yaml:13-16 -->
set:
  secrets:
    mode: eso
    external:
      storeRef: vault-clusterstore
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — append helm-unittest assertions for startupProbe + topologySpread on all 4 Deployments</name>
  <files>charts/openwhispr/tests/api_test.yaml, charts/openwhispr/tests/web_test.yaml, charts/openwhispr/tests/worker_test.yaml, charts/openwhispr/tests/litellm_test.yaml</files>
  <behavior>
    - 4 it: cases for startupProbe shape (one per workload) — assert spec.template.spec.containers[0].startupProbe.failureThreshold == 30, periodSeconds == 10, plus probe-target equality (httpGet path/port OR exec command).
    - 4 it: cases for topologySpreadConstraints shape — assert maxSkew == 1, topologyKey == kubernetes.io/hostname, whenUnsatisfiable == ScheduleAnyway, labelSelector matches the per-workload component.
    - All 8 new it: cases FAIL at this commit (templates have neither key yet).
  </behavior>
  <action>
For each of the 4 test files (api_test.yaml, web_test.yaml, worker_test.yaml, litellm_test.yaml), append 2 new `it:` entries at the end of the `tests:` list per the assertion shape in 20-RESEARCH.md §9. Each entry MUST include the `set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }` block per 20-PATTERNS.md §3.7.

For api/web/litellm — startupProbe uses httpGet with paths/ports from the `<interfaces>` block above. For worker — startupProbe uses exec form; assert `command[2]` against `matchRegex: "pgrep -f 'node /app/dist/index.js'"` per 20-RESEARCH.md §9 worker example.

For topologySpread — use `lengthEqual: { path: spec.template.spec.topologySpreadConstraints, count: 1 }` then per-field `equal:` assertions. labelSelector key uses quoted JSONPath `."app.kubernetes.io/component"` per 20-RESEARCH.md §10 P15.

Commit RED with message: `test(20-02a-01): red — helm-unittest fails on missing startupProbe + topologySpread on 4 Deployments (SR-20.3+SR-20.4)`.
  </action>
  <verify>
    <automated>cd charts/openwhispr &amp;&amp; ! helm unittest . 2>&amp;1 | tee /tmp/red-02a.log; grep -qE "(FAIL|✗)" /tmp/red-02a.log</automated>
  </verify>
  <done>RED commit on HEAD; `helm unittest charts/openwhispr` exits non-zero; failure messages reference the 8 new it: blocks; no production templates touched in this commit.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — add startupProbe blocks to 4 Deployment templates</name>
  <files>charts/openwhispr/templates/api-deployment.yaml, charts/openwhispr/templates/web-deployment.yaml, charts/openwhispr/templates/worker-deployment.yaml, charts/openwhispr/templates/litellm-deployment.yaml, charts/openwhispr/values.yaml, charts/openwhispr/values.schema.json</files>
  <behavior>
    - Each of the 4 Deployments declares a startupProbe under spec.template.spec.containers[0] immediately preceding the existing readinessProbe.
    - The 4 startupProbe it: cases flip GREEN at this commit; the 4 topologySpread it: cases still FAIL (next task).
    - values.yaml + values.schema.json declare optional .startupProbe.failureThreshold and .periodSeconds per workload with defaults 30 / 10.
  </behavior>
  <action>
For each Deployment, insert the startupProbe block immediately before the existing readinessProbe per 20-RESEARCH.md §4 + 20-PATTERNS.md §2.6. Reuse the existing readiness probe target (path/port for httpGet; exec command for worker — 20-RESEARCH.md §4 verbatim). Wrap in values templating:

api shape:
```
startupProbe:
  httpGet:
    path: /api/health
    port: 3000
  failureThreshold: {{ .Values.api.startupProbe.failureThreshold | default 30 }}
  periodSeconds: {{ .Values.api.startupProbe.periodSeconds | default 10 }}
```

worker shape per 20-RESEARCH.md §4:
```
startupProbe:
  exec:
    command: ["sh", "-c", "pgrep -f 'node /app/dist/index.js' >/dev/null"]
  failureThreshold: {{ .Values.worker.startupProbe.failureThreshold | default 30 }}
  periodSeconds: {{ .Values.worker.startupProbe.periodSeconds | default 10 }}
```

Values.yaml additions per 20-PATTERNS.md §2.7 — add `startupProbe` block under each of api, web, worker, litellm keys (failureThreshold: 30, periodSeconds: 10).

Values.schema.json additions per 20-PATTERNS.md §2.8 — add `startupProbe` property (object with failureThreshold integer min 1, periodSeconds integer min 1) under each workload's `properties:`.

Commit GREEN: `feat(20-02a-02): green — startupProbe on api/web/worker/litellm Deployments (closes B1 / SR-20.3)`.
  </action>
  <verify>
    <automated>cd charts/openwhispr &amp;&amp; helm unittest . 2>&amp;1 | tee /tmp/green-02a-02.log; ! grep -E "FAIL.*startupProbe" /tmp/green-02a-02.log &amp;&amp; helm lint .</automated>
  </verify>
  <done>4 startupProbe it: cases PASS; 4 topologySpread it: cases still FAIL (expected); helm lint exits 0; `helm template . --set secrets.mode=eso --set secrets.external.storeRef=dummy | yq '.spec.template.spec.containers[0].startupProbe.failureThreshold'` returns 30 for each Deployment.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: GREEN — add topologySpreadConstraints to 4 Deployment templates (all remaining assertions pass)</name>
  <files>charts/openwhispr/templates/api-deployment.yaml, charts/openwhispr/templates/web-deployment.yaml, charts/openwhispr/templates/worker-deployment.yaml, charts/openwhispr/templates/litellm-deployment.yaml, charts/openwhispr/values.yaml, charts/openwhispr/values.schema.json</files>
  <behavior>
    - Each of the 4 Deployments declares topologySpreadConstraints at pod-template level (spec.template.spec).
    - Constraint shape: maxSkew 1, topologyKey kubernetes.io/hostname, whenUnsatisfiable ScheduleAnyway, labelSelector reuses per-workload selectorLabels helper.
    - All 8 new it: cases (startupProbe + topologySpread) now PASS.
    - values.yaml + values.schema.json declare optional .topologySpread overrides per workload.
  </behavior>
  <action>
For each Deployment, insert the topologySpread block per 20-PATTERNS.md §2.6 + 20-RESEARCH.md §5. Use `whenUnsatisfiable: ScheduleAnyway` (NOT DoNotSchedule — single-node kind clusters get stuck Pending per 20-RESEARCH.md §10 P12). Reuse the existing per-workload selectorLabels helper (`openwhispr.api.selectorLabels`, `openwhispr.web.selectorLabels`, `openwhispr.worker.selectorLabels`, `openwhispr.litellm.selectorLabels` — already in `_helpers.tpl`).

Templating skeleton (per 20-PATTERNS.md §2.6):
```
{{- with .Values.api.topologySpread }}
{{- if .enabled }}
topologySpreadConstraints:
  - maxSkew: {{ .maxSkew | default 1 }}
    topologyKey: {{ .topologyKey | default "kubernetes.io/hostname" }}
    whenUnsatisfiable: {{ .whenUnsatisfiable | default "ScheduleAnyway" }}
    labelSelector:
      matchLabels:
        {{- include "openwhispr.api.selectorLabels" $ | nindent 10 }}
{{- end }}
{{- end }}
```

Values.yaml additions: add `topologySpread:` block (enabled: true, maxSkew: 1, topologyKey: kubernetes.io/hostname, whenUnsatisfiable: ScheduleAnyway) under each of api, web, worker, litellm keys.

Values.schema.json: add `topologySpread` property (object with `enabled` boolean, `maxSkew` integer min 1, `topologyKey` string, `whenUnsatisfiable` enum [`DoNotSchedule`, `ScheduleAnyway`]) under each workload per 20-PATTERNS.md §2.8.

Per 20-RESEARCH.md §5: OTel Collector DaemonSet is EXCLUDED from topology spread (DaemonSet controller already enforces 1 pod / node — spread is a no-op). This diverges from a literal reading of ROADMAP SR-20.4 wording ("every Deployment + the OTel Collector DaemonSet"). Note the divergence in 20-02a-SUMMARY.md citing 20-RESEARCH.md §5 as authoritative; flag for orchestrator review.

Commit GREEN: `feat(20-02a-03): green — topologySpreadConstraints on 4 Deployments (closes B2 / SR-20.4)`.
  </action>
  <verify>
    <automated>cd charts/openwhispr &amp;&amp; helm unittest . 2>&amp;1 | tee /tmp/green-02a-03.log; ! grep -E "(FAIL|✗)" /tmp/green-02a-03.log &amp;&amp; helm lint . &amp;&amp; helm template . --set secrets.mode=eso --set secrets.external.storeRef=dummy > /dev/null</automated>
  </verify>
  <done>All 8 new it: cases PASS; `helm unittest charts/openwhispr` exits 0; `helm lint` exits 0; `helm template` renders without error; `helm template ... | yq '..|.topologySpreadConstraints? // empty' | head -20` shows the new key on each of the 4 Deployments.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator -> kubelet | startupProbe contract bounds restart-loop blast radius during slow boot |
| scheduler -> nodes | topologySpread reduces single-node-failure DoS surface |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-20a-01 | DoS (self-inflicted) | api/web/worker/litellm slow boot misdiagnosed by livenessProbe | mitigate | startupProbe failureThreshold 30 + periodSeconds 10 = 300 s budget per SR-20.3 |
| T-20a-02 | DoS (node failure) | 2 replicas co-locating on same node, single-node failure = full outage | mitigate | topologySpreadConstraints maxSkew 1 on kubernetes.io/hostname per SR-20.4 |
| T-20a-03 | DoS (single-node kind) | DoNotSchedule blocks pods on 1-node clusters | mitigate | whenUnsatisfiable ScheduleAnyway per 20-RESEARCH.md §10 P12 |
| T-20a-04 | Tampering | operator silently disables guardrails via values override | accept | values blocks are opt-in via `.enabled: true` default; schema validates shape; PR review catches disable |
</threat_model>

<verification>
1. `git log --oneline -3` — 3 commits: test(20-02a-01), feat(20-02a-02), feat(20-02a-03)
2. `cd charts/openwhispr && helm unittest .` — exits 0
3. `cd charts/openwhispr && helm lint .` — exits 0
4. `helm template charts/openwhispr/ --set secrets.mode=eso --set secrets.external.storeRef=dummy | grep -c startupProbe` — at least 4 occurrences
5. `helm template charts/openwhispr/ --set secrets.mode=eso --set secrets.external.storeRef=dummy | grep -c topologySpreadConstraints` — at least 4 occurrences
6. `git status --short` — working tree clean
</verification>

<success_criteria>
- SR-20.3 satisfied: 4 Deployments declare startupProbe with 300 s budget
- SR-20.4 satisfied: 4 Deployments declare topologySpreadConstraints (DaemonSet exempted per 20-RESEARCH.md §5)
- SR-20.7 satisfied: git log shows RED commit (test) preceding GREEN commits (templates)
- Coverage Success Criterion 3 (4 startupProbe + 4 topologySpread helm-unittest assertions added) PARTIAL — securityContext assertions land in 20-02b
- Coverage Success Criterion 6 (kind smoke) PARTIAL — full kind smoke validation is in 20-02b (same chart surface)
</success_criteria>

<output>
Create `.planning/phases/20-compose-helm-production-guardrails/20-02a-SUMMARY.md` with: commit SHAs, helm-unittest output (assertion counts), helm lint output, divergence note for ROADMAP SR-20.4 (DaemonSet exemption per 20-RESEARCH.md §5), and any deferred items observed.
</output>
