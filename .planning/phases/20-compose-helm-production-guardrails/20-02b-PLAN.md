---
phase: 20-compose-helm-production-guardrails
plan: 02b
type: execute
wave: B
depends_on: [20-02a]
files_modified:
  - apps/api/Dockerfile
  - apps/worker/Dockerfile
  - apps/web/Dockerfile
  - charts/openwhispr/templates/api-deployment.yaml
  - charts/openwhispr/templates/web-deployment.yaml
  - charts/openwhispr/templates/worker-deployment.yaml
  - charts/openwhispr/templates/litellm-deployment.yaml
  - charts/openwhispr/templates/otel-collector-daemonset.yaml
  - charts/openwhispr/tests/api_test.yaml
  - charts/openwhispr/tests/web_test.yaml
  - charts/openwhispr/tests/worker_test.yaml
  - charts/openwhispr/tests/litellm_test.yaml
  - charts/openwhispr/tests/otel-collector_test.yaml
  - charts/openwhispr/values.yaml
  - charts/openwhispr/values.schema.json
  - .planning/deferred-items.md
autonomous: false  # Task 7 is live-kind smoke human-verify checkpoint
requirements: [SR-20.5, SR-20.7]
must_haves:
  truths:
    - "api/web/worker Deployments declare pod-level securityContext (runAsNonRoot, runAsUser: 1000, fsGroup: 1000, seccompProfile: RuntimeDefault)"
    - "api/web/worker container-level securityContext: readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities.drop: [ALL]"
    - "api/web/worker emptyDir mounts: /tmp on all three; /app/apps/web/.next/cache on web (256Mi sizeLimit)"
    - "LiteLLM relaxed shape: NO runAsNonRoot/runAsUser/readOnlyRootFilesystem; YES allowPrivEsc=false + seccompProfile + drop ALL"
    - "OTel Collector securityContext gains allowPrivilegeEscalation: false + seccompProfile: RuntimeDefault (keeps runAsUser: 0)"
    - "apps/{api,worker}/Dockerfile USER 1000 (explicit numeric)"
    - "apps/web/Dockerfile: addgroup -S nodejs -g 1000 + adduser -S nextjs -G nodejs -u 1000; mkdir -p /app/apps/web/.next/cache BEFORE chown -R 1000:1000 /app; USER 1000"
    - "docker run --rm openwhispr-web:test stat -c '%u:%g' /app/apps/web/.next/cache returns 1000:1000"
    - "docker run --rm openwhispr-web:test sh -c 'touch /app/apps/web/.next/cache/.probe && rm /app/apps/web/.next/cache/.probe' succeeds"
    - "helm-unittest adds 12+ new assertions across 5 test files; total helm-unittest count >= 183 (171 baseline + 12 net new)"
    - ".planning/deferred-items.md gains LiteLLM-non-root-image-fork entry"
    - "Live kind smoke (Task 7) shows all 14 pods 1/1 Ready within 90 s"
  artifacts:
    - path: apps/web/Dockerfile
      provides: "USER 1000 + writable /app/apps/web/.next/cache owned 1000:1000"
      contains: "addgroup -S nodejs -g 1000"
    - path: charts/openwhispr/templates/api-deployment.yaml
      provides: "pod+container securityContext (full hardening) + emptyDir /tmp"
      contains: "readOnlyRootFilesystem: true"
    - path: charts/openwhispr/templates/litellm-deployment.yaml
      provides: "container securityContext (relaxed-hardening Option A)"
      contains: "allowPrivilegeEscalation: false"
    - path: .planning/deferred-items.md
      provides: "LiteLLM non-root image fork entry"
      contains: "LiteLLM non-root image fork"
---

<objective>
Land SR-20.5 (Helm securityContext + Dockerfile USER 1000 normalization). Atomic per-file commits with TDD RED+GREEN where helm-unittest assertions apply; Dockerfile changes commit GREEN-only after `docker build` + `docker run id -u` + ownership-stat verify pass. Live kind smoke after all 6 code commits land.

In a 16-worktree concurrency environment, atomic small commits + branch isolation (work happens on `phase-20-wave-bc` branch, merged to main only at PR close) is the safety pattern. NO `git push origin phase-20-wave-bc` (origin/main is stale `9f2de60`; the real `main` lives only locally and is shared across worktrees). Branch isolation IS the protection.
</objective>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — helm-unittest asserts api/web/worker full securityContext + LiteLLM relaxed + OTel completion</name>
  <files>charts/openwhispr/tests/api_test.yaml, charts/openwhispr/tests/web_test.yaml, charts/openwhispr/tests/worker_test.yaml, charts/openwhispr/tests/litellm_test.yaml, charts/openwhispr/tests/otel-collector_test.yaml</files>
  <behavior>
    - api/web/worker test files add cases asserting pod-level runAsNonRoot=true, runAsUser=1000, fsGroup=1000, seccompProfile.type=RuntimeDefault
    - api/web/worker test files add cases asserting container-level readOnlyRootFilesystem=true, allowPrivilegeEscalation=false, capabilities.drop=[ALL]
    - api/web/worker test files add cases asserting emptyDir mount at /tmp; web adds case for emptyDir at /app/apps/web/.next/cache
    - litellm test file adds RELAXED-shape case: container has allowPrivilegeEscalation=false + seccompProfile + drop ALL; pod LACKS runAsNonRoot/runAsUser/fsGroup; container LACKS readOnlyRootFilesystem
    - otel-collector test file adds completion-shape case: container has allowPrivilegeEscalation=false + seccompProfile=RuntimeDefault (preserves existing runAsUser=0, drop ALL, readOnlyRootFS)
    - helm unittest run shows new cases FAILING
  </behavior>
  <action>
Use helm-unittest matchers per `charts/openwhispr/tests/migrate_test.yaml` precedent (bracket-quoted JSONPath for keys with dots). Example case shape:
```yaml
- it: api pod runs as non-root uid 1000
  template: api-deployment.yaml
  asserts:
    - equal:
        path: spec.template.spec.securityContext.runAsNonRoot
        value: true
    - equal:
        path: spec.template.spec.securityContext.runAsUser
        value: 1000
```

For LiteLLM relaxed, use `notExists` matchers to assert absence of runAsNonRoot/runAsUser/readOnlyRootFilesystem.

Commit: `test(20-02b-01): red — helm-unittest fails on missing pod+container securityContext`
Verify: `helm unittest charts/openwhispr/` exits non-zero with 12+ new failing cases
  </action>
  <verify>
    <automated>helm unittest charts/openwhispr/ 2>&amp;1 | tail -10 | grep -E "Test Suites:|FAIL"</automated>
  </verify>
  <done>RED commit on HEAD; helm unittest shows new cases FAILING</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — apps/{api,worker}/Dockerfile USER 1000 (explicit numeric)</name>
  <files>apps/api/Dockerfile, apps/worker/Dockerfile</files>
  <behavior>
    - apps/api/Dockerfile: replace existing `USER node` with `USER 1000`
    - apps/worker/Dockerfile: same
    - `docker build` succeeds; `docker run --rm openwhispr-api:test id -u` returns `1000`; same for worker
  </behavior>
  <action>
Find existing USER directive in each Dockerfile (currently `USER node` — node user is uid 1000 in alpine, so the change is functionally identical but explicit for security scanners and matches K8s `runAsUser: 1000`).

Commit: `feat(20-02b-02): green — api/worker Dockerfile USER 1000 (explicit numeric uid for SR-20.5)`
Verify: docker build both images + `docker run id -u` = 1000
  </action>
  <verify>
    <automated>docker build -t openwhispr-api:test20-02b apps/api &amp;&amp; docker build -t openwhispr-worker:test20-02b apps/worker &amp;&amp; [ "$(docker run --rm --entrypoint sh openwhispr-api:test20-02b -c 'id -u')" = "1000" ] &amp;&amp; [ "$(docker run --rm --entrypoint sh openwhispr-worker:test20-02b -c 'id -u')" = "1000" ]</automated>
  </verify>
  <done>2 images build; id -u returns 1000 on both</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: GREEN — apps/web/Dockerfile uid 1001→1000 + chown numeric + writable .next/cache</name>
  <files>apps/web/Dockerfile</files>
  <behavior>
    - addgroup/adduser switched to uid 1000 / gid 1000
    - `mkdir -p /app/apps/web/.next/cache` BEFORE chown
    - All chown invocations use numeric form `chown -R 1000:1000` (NOT name form)
    - `USER 1000` (numeric, explicit)
    - `docker run --rm openwhispr-web:test stat -c "%u:%g" /app/apps/web/.next/cache` returns `1000:1000`
    - `docker run --rm openwhispr-web:test sh -c 'touch /app/apps/web/.next/cache/.probe && rm /app/apps/web/.next/cache/.probe'` exits 0
  </behavior>
  <action>
Replace adduser block:
```dockerfile
RUN addgroup -S nodejs -g 1000 \
 && adduser  -S nextjs -G nodejs -u 1000 \
 && mkdir -p /app/apps/web/.next/cache \
 && chown -R 1000:1000 /app
```
Replace final `USER nextjs` → `USER 1000`.
Audit every existing `chown nextjs:nodejs` in the file → replace with `chown 1000:1000`.

Commit: `feat(20-02b-03): green — web Dockerfile uid 1000 + writable .next/cache (SR-20.5 precondition)`
  </action>
  <verify>
    <automated>docker build -t openwhispr-web:test20-02b apps/web &amp;&amp; \
own=$(docker run --rm --entrypoint sh openwhispr-web:test20-02b -c 'stat -c "%u:%g" /app/apps/web/.next/cache') &amp;&amp; \
[ "$own" = "1000:1000" ] &amp;&amp; \
docker run --rm --entrypoint sh openwhispr-web:test20-02b -c 'touch /app/apps/web/.next/cache/.probe &amp;&amp; rm /app/apps/web/.next/cache/.probe'</automated>
  </verify>
  <done>web image: id -u = 1000, .next/cache owned 1000:1000, writable</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: GREEN — Helm api/web/worker Deployments + values: full hardening + emptyDir</name>
  <files>charts/openwhispr/templates/api-deployment.yaml, charts/openwhispr/templates/web-deployment.yaml, charts/openwhispr/templates/worker-deployment.yaml, charts/openwhispr/values.yaml, charts/openwhispr/values.schema.json</files>
  <behavior>
    - 3 Deployments gain pod-level securityContext + container-level securityContext + emptyDir volumes + volumeMounts
    - values.yaml exposes `<service>.securityContext.{pod,container}` blocks with the SR-20.5 defaults; operators can override per environment
    - values.schema.json gains schema for the new blocks
    - Task 1 RED cases flip to GREEN for api/web/worker
  </behavior>
  <action>
Add to each Deployment template under `spec.template.spec`:
```yaml
securityContext:
  {{- toYaml (.Values.<svc>.securityContext.pod | default $defaultPodSec) | nindent 8 }}
```
Add to each container under `spec.template.spec.containers[0]`:
```yaml
securityContext:
  {{- toYaml (.Values.<svc>.securityContext.container | default $defaultContainerSec) | nindent 10 }}
volumeMounts:
  - { name: tmp, mountPath: /tmp }
  # web only:
  - { name: next-cache, mountPath: /app/apps/web/.next/cache }
```
Add volumes:
```yaml
volumes:
  - { name: tmp, emptyDir: { sizeLimit: 64Mi } }
  # web only:
  - { name: next-cache, emptyDir: { sizeLimit: 256Mi } }
```

values.yaml defaults: see CONTEXT.md SR-20.5 block.

Commit: `feat(20-02b-04): green — api/web/worker Helm securityContext + emptyDir mounts`
  </action>
  <verify>
    <automated>helm unittest charts/openwhispr/ 2>&amp;1 | tail -5 | grep -E "Test Suites:.*passed"</automated>
  </verify>
  <done>helm unittest exits 0; Task 1 RED cases for api/web/worker now PASS</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: GREEN — LiteLLM relaxed-hardening (Option A)</name>
  <files>charts/openwhispr/templates/litellm-deployment.yaml, charts/openwhispr/values.yaml</files>
  <behavior>
    - LiteLLM container gains ONLY: allowPrivilegeEscalation=false, seccompProfile=RuntimeDefault, capabilities.drop=[ALL]
    - LiteLLM pod does NOT get runAsNonRoot/runAsUser/fsGroup
    - Container does NOT get readOnlyRootFilesystem
    - Task 1 RED relaxed-shape case flips to GREEN
  </behavior>
  <action>
Add container securityContext block (relaxed subset) to litellm-deployment.yaml. Do NOT add pod securityContext.

Commit: `feat(20-02b-05): green — LiteLLM relaxed-hardening (Option A; runAsRoot retained per upstream Prisma path)`
  </action>
  <verify>
    <automated>helm unittest charts/openwhispr/tests/litellm_test.yaml 2>&amp;1 | grep -E "passed|FAIL"</automated>
  </verify>
  <done>LiteLLM relaxed-shape case PASS</done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: GREEN — OTel Collector partial-hardening completion + deferred-items entry</name>
  <files>charts/openwhispr/templates/otel-collector-daemonset.yaml, .planning/deferred-items.md</files>
  <behavior>
    - OTel Collector container securityContext gains allowPrivilegeEscalation=false + seccompProfile=RuntimeDefault (preserves runAsUser=0, drop ALL, readOnlyRootFS)
    - .planning/deferred-items.md gains "LiteLLM non-root image fork" entry
    - Task 1 RED OTel completion case flips to GREEN
  </behavior>
  <action>
Add allowPrivilegeEscalation: false + seccompProfile.type: RuntimeDefault to the existing container securityContext block. Do NOT change runAsUser: 0 (intentional — hostmetrics receiver needs root access to /proc and /sys per existing comment).

Append deferred-items.md entry:
```markdown
### LiteLLM non-root image fork
Phase 20-02b adopted Option A (relaxed hardening) for `ghcr.io/berriai/litellm:main-v1.83.14-stable` because:
1. Upstream image runs as uid 0
2. Prisma client writes to `/app/.prisma` at startup — incompatible with readOnlyRootFilesystem
Future hardening phase may revisit by either (a) building a fork with `USER 1000` + writable PVC for Prisma cache, or (b) waiting for upstream to add non-root support. Tracking issue: TBD.
```

Commit: `feat(20-02b-06): green — OTel partial-hardening completion + LiteLLM deferred fork entry`
  </action>
  <verify>
    <automated>helm unittest charts/openwhispr/ 2>&amp;1 | tail -5 | grep "Test Suites:.*passed"; grep -q "LiteLLM non-root image fork" .planning/deferred-items.md</automated>
  </verify>
  <done>OTel completion case PASS; all helm-unittest suites green; deferred-items entry exists</done>
</task>

<task type="checkpoint:human-verify" tdd="false">
  <name>Task 7: HUMAN-VERIFY — live kind smoke (SC6 from ROADMAP)</name>
  <files>(none — runtime observation)</files>
  <action>
Operator runs (per Phase 09.1 kind-bootstrap precedent):
```bash
# In an environment with kind + helm + a kind cluster
helm install ow-test ./charts/openwhispr \
  -f charts/openwhispr/examples/values-helm-secrets-mode.yaml \
  --set tls.enabled=false \
  --wait --timeout=120s

# Verify all pods 1/1 Ready
kubectl get pods --all-namespaces | grep ow-test

# Verify uid 1000 on app pods
for d in api web worker; do
  echo "--- $d ---"
  kubectl exec deploy/ow-test-openwhispr-$d -- id -u
done

# Verify securityContext applied
kubectl get deploy ow-test-openwhispr-api -o yaml | yq '.spec.template.spec.securityContext'
kubectl get deploy ow-test-openwhispr-api -o yaml | yq '.spec.template.spec.containers[0].securityContext'

# Teardown
helm uninstall ow-test
```

Operator pastes evidence into 20-02b-SUMMARY.md `## SC6 Live-kind Verification` block. If any pod fails to reach Ready within 90 s, capture pod logs + describe; common failure is uncovered write path needing additional emptyDir mount (per RESEARCH §A4 explicit assumption-validation step).
  </action>
  <verify>
    <human>All app pods Ready within 90 s; uid 1000 on api/web/worker; securityContext shape matches spec; operator signs off in SUMMARY</human>
  </verify>
  <done>SC6 evidence captured + signed off; Wave B complete</done>
</task>

</tasks>

<wave_protocol>
After each task: `git status --short`, verify clean staging, commit with the exact message shape above. NO `git push` (origin is stale; branch isolation IS the protection). NO `git pull --rebase main` between tasks (main is shared across 16 worktrees and advances every few minutes; rebasing onto a moving target is the failure mode advisor warned against — stay on `phase-20-wave-bc` branch, merge to main only at PR close).

If `helm unittest` fails mid-Wave-B due to a Phase 33/42 cascade landing a conflicting test file: stop, report; the orchestrator decides whether to rebase or carry-forward.
</wave_protocol>
