---
phase: 20-compose-helm-production-guardrails
plan: 02b
type: execute
wave: B
depends_on: [02a]
files_modified:
  - apps/api/Dockerfile
  - apps/web/Dockerfile
  - apps/worker/Dockerfile
  - charts/openwhispr/templates/api-deployment.yaml
  - charts/openwhispr/templates/web-deployment.yaml
  - charts/openwhispr/templates/worker-deployment.yaml
  - charts/openwhispr/templates/litellm-deployment.yaml
  - charts/openwhispr/templates/otel-collector-daemonset.yaml
  - charts/openwhispr/values.yaml
  - charts/openwhispr/values.schema.json
  - charts/openwhispr/tests/api_test.yaml
  - charts/openwhispr/tests/web_test.yaml
  - charts/openwhispr/tests/worker_test.yaml
  - charts/openwhispr/tests/litellm_test.yaml
  - charts/openwhispr/tests/otel_test.yaml
  - .planning/deferred-items.md
autonomous: false
requirements: [SR-20.5, SR-20.7]
must_haves:
  truths:
    - "api/web/worker Deployments declare pod-level securityContext (runAsNonRoot: true, runAsUser: 1000, fsGroup: 1000, seccompProfile: { type: RuntimeDefault })"
    - "api/web/worker Deployments declare container-level securityContext (readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { drop: [ALL] })"
    - "api/web/worker Deployments mount an emptyDir at /tmp (api/worker) plus /app/apps/web/.next/cache (web only) to compensate for readOnlyRootFilesystem"
    - "apps/api/Dockerfile, apps/worker/Dockerfile use USER 1000 (explicit numeric or USER node where node uid is 1000); apps/web/Dockerfile uses USER 1000 (formerly 1001)"
    - "LiteLLM Deployment declares relaxed-hardening container-level securityContext (allowPrivilegeEscalation: false, seccompProfile: RuntimeDefault, capabilities: drop ALL) — NO runAsNonRoot / runAsUser / readOnlyRootFilesystem (upstream image runs as root + Prisma writes /app/.prisma)"
    - "OTel Collector DaemonSet container-level securityContext adds allowPrivilegeEscalation: false + seccompProfile: RuntimeDefault on top of existing runAsUser: 0 + readOnlyRootFilesystem: true + capabilities: drop ALL"
    - "Live kind smoke (helm install on a kind cluster) shows all 4 Deployments reach Ready within 90 s — proves new securityContext + readOnlyRootFilesystem do not regress boot"
    - ".planning/deferred-items.md contains an entry 'LiteLLM non-root image fork' tracking the future hardening path"
    - "helm-unittest assertions for pod+container securityContext + emptyDir mounts land RED, then production templates flip them GREEN"
  artifacts:
    - path: apps/api/Dockerfile
      provides: "USER 1000 (explicit numeric uid or verified node-uid-1000) + chown of writable runtime dirs"
      contains: "USER 1000"
    - path: apps/web/Dockerfile
      provides: "USER 1000 (switched from 1001) + chown of /app/apps/web/.next/cache"
      contains: "USER 1000"
    - path: apps/worker/Dockerfile
      provides: "USER 1000 (explicit numeric uid) + chown of writable runtime dirs"
      contains: "USER 1000"
    - path: charts/openwhispr/templates/api-deployment.yaml
      provides: "pod+container securityContext + emptyDir /tmp mount"
      contains: "readOnlyRootFilesystem: true"
    - path: charts/openwhispr/templates/web-deployment.yaml
      provides: "pod+container securityContext + emptyDir /tmp + /app/apps/web/.next/cache mounts"
      contains: "next-cache"
    - path: charts/openwhispr/templates/worker-deployment.yaml
      provides: "pod+container securityContext + emptyDir /tmp"
      contains: "readOnlyRootFilesystem: true"
    - path: charts/openwhispr/templates/litellm-deployment.yaml
      provides: "RELAXED container-level securityContext (allowPrivilegeEscalation: false + seccompProfile + drop ALL) — documented exception, no runAsNonRoot/runAsUser/readOnlyRootFilesystem"
      contains: "allowPrivilegeEscalation: false"
    - path: charts/openwhispr/templates/otel-collector-daemonset.yaml
      provides: "Completion of partial-hardening — adds allowPrivilegeEscalation: false + seccompProfile: RuntimeDefault to existing runAsUser:0 + readOnlyRootFilesystem + drop ALL"
      contains: "seccompProfile"
    - path: .planning/deferred-items.md
      provides: "Tracking entry for future LiteLLM non-root image fork"
      contains: "LiteLLM non-root"
  key_links:
    - from: charts/openwhispr/templates/api-deployment.yaml
      to: charts/openwhispr/values.yaml
      via: ".Values.api.securityContext + emptyDir sizeLimit override"
      pattern: "\\.Values\\.api\\.securityContext"
    - from: charts/openwhispr/templates/web-deployment.yaml
      to: apps/web/Dockerfile
      via: "pod-level runAsUser: 1000 matches Dockerfile USER 1000"
      pattern: "runAsUser: \\{\\{ \\.Values\\.web\\.securityContext"
    - from: charts/openwhispr/templates/litellm-deployment.yaml
      to: .planning/deferred-items.md
      via: "comment in template references the deferred non-root LiteLLM fork"
      pattern: "non-root"
---

<objective>
Land SR-20.5 (Helm `securityContext` hardening on api/web/worker + LiteLLM relaxed-hardening exception + OTel Collector partial-hardening completion). HIGHEST-RISK plan in the phase — touches both Helm templates and Dockerfiles.

Purpose: Close audit finding B3 (pods run as root with no readOnlyRootFilesystem / capabilities drop / seccompProfile). The fix has two failure modes if mismatched:
1. Pod spec mandates `runAsUser: 1000` but image lacks USER 1000 directive → pod start fails with "container has runAsNonRoot and image will run as root" (per 20-RESEARCH.md §10 P6).
2. `readOnlyRootFilesystem: true` collides with a runtime write path that wasn't audited → CrashLoopBackOff after first write (per 20-RESEARCH.md §10 P7).

Per user-prompt directive (and 20-CONTEXT.md SR-20.5):
- **apps/api, apps/worker**: Already `USER node` (uid 1000); ensure explicit `USER 1000` numeric directive and writable emptyDir for /tmp.
- **apps/web**: Switch from uid 1001 (current `nextjs` user) to uid 1000; writable emptyDir for /tmp AND /app/apps/web/.next/cache.
- **LiteLLM**: Relaxed-hardening exception (drop runAsNonRoot/runAsUser/readOnlyRootFilesystem; keep allowPrivEsc=false, seccompProfile RuntimeDefault, capabilities drop ALL). Document "LiteLLM non-root image fork" as deferred item.
- **OTel Collector**: Partial-hardening completion (add allowPrivilegeEscalation=false + seccompProfile=RuntimeDefault to existing runAsUser:0 + readOnlyRootFilesystem + drop ALL).

Output: 3 Dockerfile changes, 5 template changes, 2 values files extended, 5 helm-unittest suites appended, 1 deferred-item entry, live kind smoke verification (per Phase 09.1 precedent).

This plan is `autonomous: false` because of the kind-smoke human-verify checkpoint after image rebuilds.
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
@charts/openwhispr/templates/otel-collector-daemonset.yaml
@charts/openwhispr/values.yaml
@charts/openwhispr/values.schema.json
@apps/api/Dockerfile
@apps/web/Dockerfile
@apps/worker/Dockerfile

<interfaces>
<!-- securityContext shape per workload (per 20-CONTEXT.md SR-20.5 + 20-RESEARCH.md §6) -->

# api / worker — full hardening, uid 1000
pod:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000
  seccompProfile: { type: RuntimeDefault }
container:
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities: { drop: [ALL] }
volumes:
  - name: tmp
    emptyDir: { sizeLimit: 64Mi }
volumeMounts:
  - { name: tmp, mountPath: /tmp }

# web — same pod-level + container-level as api, plus an extra emptyDir for .next/cache
volumes:
  - name: tmp
    emptyDir: { sizeLimit: 64Mi }
  - name: next-cache
    emptyDir: { sizeLimit: 256Mi }
volumeMounts:
  - { name: tmp, mountPath: /tmp }
  - { name: next-cache, mountPath: /app/apps/web/.next/cache }

# litellm — RELAXED (image upstream runs uid 0; Prisma writes /app/.prisma)
container:
  allowPrivilegeEscalation: false
  seccompProfile: { type: RuntimeDefault }      # NB pod-level usually; spec allows container
  capabilities: { drop: [ALL] }
  # NO runAsNonRoot, NO runAsUser, NO readOnlyRootFilesystem
# Helm-unittest assertion uses notExists to PROVE the relaxed shape (20-RESEARCH.md §9).

# otel-collector — complete the partial hardening
container:
  runAsUser: 0                             # existing — documented hostmetrics exception
  readOnlyRootFilesystem: true             # existing
  capabilities: { drop: [ALL] }            # existing
  allowPrivilegeEscalation: false          # NEW (SR-20.5)
  seccompProfile: { type: RuntimeDefault } # NEW (SR-20.5)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — helm-unittest assertions for pod+container securityContext + emptyDir on api/web/worker, RELAXED-shape assertions for litellm, completion assertions for otel</name>
  <files>charts/openwhispr/tests/api_test.yaml, charts/openwhispr/tests/web_test.yaml, charts/openwhispr/tests/worker_test.yaml, charts/openwhispr/tests/litellm_test.yaml, charts/openwhispr/tests/otel_test.yaml</files>
  <behavior>
    - 8 new it: assertions for api/web/worker (per 20-RESEARCH.md §9): pod-level (runAsNonRoot, runAsUser 1000, fsGroup 1000, seccompProfile), container-level (readOnlyRootFilesystem, allowPrivilegeEscalation false, capabilities drop ALL), emptyDir /tmp present + sizeLimit.
    - Extra web assertion: `/app/apps/web/.next/cache` emptyDir mount + sizeLimit 256Mi.
    - LiteLLM relaxed assertion per 20-RESEARCH.md §9 — `notExists` on readOnlyRootFilesystem, runAsNonRoot, runAsUser; `equal` on allowPrivilegeEscalation false, capabilities drop ALL, seccompProfile.
    - OTel completion assertion: existing keys still present + new allowPrivilegeEscalation false + seccompProfile RuntimeDefault.
    - All new it: cases FAIL at this commit.
  </behavior>
  <action>
For each of the 5 test files, append it: blocks per the assertion shapes in 20-RESEARCH.md §9 ("securityContext (pod + container level)", "litellm container documented exception", "emptyDir mount assertion"). Each it: includes the `set: { secrets: { mode: eso, external: { storeRef: vault-clusterstore } } }` block per 20-PATTERNS.md §3.7.

Note for web: assertion uses `runAsUser: 1000` (per the user-directive rebuild path — apps/web/Dockerfile flipping from 1001 to 1000), NOT 1001. This diverges from 20-RESEARCH.md §6 Option-A recommendation (keep uid 1001 + parameterize); the user-prompt direction overrides per CLAUDE.md context-fidelity rules.

Commit RED: `test(20-02b-01): red — helm-unittest fails on missing securityContext + emptyDir + relaxed litellm + otel completion (SR-20.5)`.
  </action>
  <verify>
    <automated>cd charts/openwhispr &amp;&amp; ! helm unittest . 2>&amp;1 | tee /tmp/red-02b.log; grep -qE "(FAIL|✗)" /tmp/red-02b.log</automated>
  </verify>
  <done>RED commit on HEAD; helm-unittest exits non-zero; failure messages reference the new it: blocks; no production code or templates touched.</done>
</task>

<task type="auto">
  <name>Task 2: GREEN — Dockerfile changes for apps/api, apps/web, apps/worker (USER 1000 + chown of writable runtime dirs)</name>
  <files>apps/api/Dockerfile, apps/web/Dockerfile, apps/worker/Dockerfile</files>
  <action>
For each Dockerfile:

**apps/api/Dockerfile** (currently USER node at line 172 — uid 1000): replace `USER node` with explicit `USER 1000` directive (kubelet checks against image.config.User numeric per 20-RESEARCH.md §10 P6). Confirm via `docker run --rm <image> id -u` returns 1000 (record output in summary). If `node` user's uid is already 1000 (standard alpine `node` image), `USER 1000` is functionally identical but more explicit for security scanners.

**apps/worker/Dockerfile** (currently USER node at line 80): same as api — switch to `USER 1000`. Add chown for any runtime-writable dir if BullMQ requires it (per 20-RESEARCH.md §6 image-runtime audit, worker is "pure compute" — emptyDir /tmp covers it).

**apps/web/Dockerfile** (currently adduser nextjs uid 1001 at lines 117-118; USER nextjs at line 132): per user-prompt directive, switch to uid 1000 atomically. Single attempt — no fallback to name-based chown, no conditional logic. Update the adduser invocation per 20-PATTERNS.md §2.11 example:
```dockerfile
RUN addgroup -S nodejs -g 1000 \
 && adduser  -S nextjs -G nodejs -u 1000
```
**Replace every existing `chown` invocation** in apps/web/Dockerfile with **numeric-uid form**: `chown -R 1000:1000 <path>` (NOT `chown -R nextjs:nodejs <path>` — name resolution depends on /etc/passwd which may diverge between build stages; numeric form is authoritative). This MUST cover at minimum: `/app`, `/app/apps/web/.next`, `/app/apps/web/.next/cache` (create the dir with `mkdir -p /app/apps/web/.next/cache` BEFORE the chown so the dir exists and the emptyDir mount in T3 inherits ownership). Final `USER nextjs` → `USER 1000`.

Commit GREEN: `feat(20-02b-02): green — Dockerfile USER 1000 across api/worker/web (precondition for SR-20.5 readOnlyRootFilesystem)`.
  </action>
  <verify>
    <automated>docker build -t openwhispr-api:test apps/api &amp;&amp; docker build -t openwhispr-worker:test apps/worker &amp;&amp; docker build -t openwhispr-web:test apps/web &amp;&amp; \
for img in openwhispr-api:test openwhispr-worker:test openwhispr-web:test; do \
  uid=$(docker run --rm --entrypoint sh "$img" -c 'id -u'); \
  [ "$uid" = "1000" ] || { echo "FAIL $img uid=$uid"; exit 1; }; \
done &amp;&amp; \
# Ownership-verify (closes plan-checker BLOCKER #3): the .next/cache dir MUST be owned by uid:gid 1000:1000 \
# so that the emptyDir mount in T3 doesn't get root-owned remnants that fail under readOnlyRootFilesystem. \
own=$(docker run --rm --entrypoint sh openwhispr-web:test -c 'stat -c "%u:%g" /app/apps/web/.next/cache'); \
[ "$own" = "1000:1000" ] || { echo "FAIL web .next/cache ownership: $own (expected 1000:1000)"; exit 1; } &amp;&amp; \
# Also confirm /app/apps/web/.next dir is writable by uid 1000 \
docker run --rm --entrypoint sh openwhispr-web:test -c 'test -d /app/apps/web/.next/cache &amp;&amp; touch /app/apps/web/.next/cache/.probe &amp;&amp; rm /app/apps/web/.next/cache/.probe' || { echo "FAIL web .next/cache not writable as uid 1000"; exit 1; }</automated>
  </verify>
  <done>3 images build; `docker run --rm <image> id -u` returns `1000` for all three; `docker run --rm openwhispr-web:test stat -c %u:%g /app/apps/web/.next/cache` returns `1000:1000`; the same dir passes a touch+rm probe as uid 1000 (proves no root-owned remnants from earlier build stages); evidence pasted into 20-02b-SUMMARY.md.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: GREEN — Helm template changes for api/web/worker — pod+container securityContext + emptyDir volumes + volumeMounts</name>
  <files>charts/openwhispr/templates/api-deployment.yaml, charts/openwhispr/templates/web-deployment.yaml, charts/openwhispr/templates/worker-deployment.yaml, charts/openwhispr/values.yaml, charts/openwhispr/values.schema.json</files>
  <behavior>
    - api/web/worker pod spec gets pod-level + container-level securityContext per the `<interfaces>` block.
    - api/worker mount emptyDir at /tmp (sizeLimit 64Mi). web additionally mounts emptyDir at /app/apps/web/.next/cache (sizeLimit 256Mi).
    - 8 it: cases (api/web/worker pod+container hardening + emptyDir mounts) flip GREEN.
    - litellm + otel it: cases still FAIL (next tasks).
  </behavior>
  <action>
Per 20-PATTERNS.md §2.6 + 20-RESEARCH.md §"Code Examples" §10 full hardened api example: add pod-level securityContext under `spec.template.spec` (above `containers:`) AND container-level securityContext under `containers[0]`. Wire values via `.Values.api.securityContext.pod.runAsUser | default 1000` etc.

For web: same shape; values.yaml `web.securityContext.pod.runAsUser: 1000` (NOT 1001 — per user-prompt directive; 20-PATTERNS.md §2.11 Option-1).

Volumes + volumeMounts per `<interfaces>` block:
- api/worker: one emptyDir `tmp` mount at `/tmp`, sizeLimit 64Mi.
- web: two emptyDir mounts — `tmp` at `/tmp` (64Mi) and `next-cache` at `/app/apps/web/.next/cache` (256Mi).

values.yaml additions (per 20-PATTERNS.md §2.7):
```yaml
api:
  securityContext:
    pod:
      runAsNonRoot: true
      runAsUser: 1000
      fsGroup: 1000
    container:
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities: { drop: [ALL] }
  emptyDir:
    tmpSizeLimit: 64Mi
```
Same for `web:` (add `cacheSizeLimit: 256Mi` for .next/cache) and `worker:`.

values.schema.json: per 20-PATTERNS.md §2.8, add `securityContext` (object with `pod` and `container` sub-objects, properties per shape) + `emptyDir` block under each workload.

Commit GREEN: `feat(20-02b-03): green — securityContext + emptyDir on api/web/worker (closes B3 / SR-20.5 partial)`.
  </action>
  <verify>
    <automated>cd charts/openwhispr &amp;&amp; helm unittest . 2>&amp;1 | tee /tmp/green-02b-03.log; ! grep -E "FAIL.*(api Deployment|web Deployment|worker Deployment).*securityContext" /tmp/green-02b-03.log &amp;&amp; helm lint .</automated>
  </verify>
  <done>api/web/worker securityContext + emptyDir helm-unittest assertions PASS; litellm + otel assertions still FAIL (expected); helm lint exits 0; `helm template . --set secrets.mode=eso --set secrets.external.storeRef=dummy | grep -c readOnlyRootFilesystem` ≥ 3.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: GREEN — LiteLLM template relaxed-hardening (allowPrivEsc + seccompProfile + drop ALL only)</name>
  <files>charts/openwhispr/templates/litellm-deployment.yaml, charts/openwhispr/values.yaml, charts/openwhispr/values.schema.json</files>
  <behavior>
    - LiteLLM container gets ONLY allowPrivilegeEscalation: false + capabilities drop ALL + seccompProfile RuntimeDefault.
    - NO runAsNonRoot, NO runAsUser, NO readOnlyRootFilesystem on the LiteLLM pod/container (per 20-RESEARCH.md §6 Problem 2 Option A — upstream image runs uid 0 + Prisma writes /app/.prisma).
    - Helm-unittest `litellm relaxed exception` it: case PASSES; uses notExists to assert the omissions.
    - Inline template comment references .planning/deferred-items.md entry.
  </behavior>
  <action>
Add the RELAXED container-level securityContext block under `containers[0]` in `charts/openwhispr/templates/litellm-deployment.yaml`:
```yaml
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
```
Add inline comment immediately above the block:
```yaml
# Documented exception (Phase 20 / SR-20.5): LiteLLM upstream image runs as root
# (uid=0) and Prisma writes /app/.prisma at runtime. Full readOnlyRootFilesystem +
# runAsNonRoot hardening requires a downstream fork — tracked as
# "LiteLLM non-root image fork" in .planning/deferred-items.md.
```

values.yaml: add a `litellm.securityContext.container` block reflecting the relaxed shape; document upstream constraint in comment.

values.schema.json: add `securityContext` property under `litellm` with the relaxed-shape constraints only.

Commit GREEN: `feat(20-02b-04): green — litellm relaxed-hardening documented exception (SR-20.5 / partial)`.
  </action>
  <verify>
    <automated>cd charts/openwhispr &amp;&amp; helm unittest . 2>&amp;1 | tee /tmp/green-02b-04.log; ! grep -E "FAIL.*litellm" /tmp/green-02b-04.log &amp;&amp; helm template . --set secrets.mode=eso --set secrets.external.storeRef=dummy | yq 'select(.kind == "Deployment" and .metadata.name == "*litellm*") | .spec.template.spec.containers[0].securityContext'</automated>
  </verify>
  <done>litellm helm-unittest case PASSES; rendered template shows the relaxed container securityContext (allowPrivilegeEscalation: false + drop ALL + seccompProfile); rendered template does NOT contain readOnlyRootFilesystem or runAsUser on litellm.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: GREEN — OTel Collector partial-hardening completion (allowPrivilegeEscalation + seccompProfile)</name>
  <files>charts/openwhispr/templates/otel-collector-daemonset.yaml</files>
  <behavior>
    - existing securityContext block at otel-collector-daemonset.yaml:81-86 grows two new keys: allowPrivilegeEscalation: false + seccompProfile: { type: RuntimeDefault }.
    - existing keys (runAsUser: 0, readOnlyRootFilesystem: true, capabilities drop ALL) preserved.
    - helm-unittest otel completion case PASSES.
  </behavior>
  <action>
Per 20-RESEARCH.md §7 + 20-PATTERNS.md §2.6 ("OTel Collector partial-hardening update"): extend the existing container-level securityContext block (currently at lines 81-86):
```yaml
securityContext:
  runAsUser: 0                            # existing — documented exception for hostmetrics
  readOnlyRootFilesystem: true            # existing
  capabilities:
    drop: ["ALL"]                         # existing
  allowPrivilegeEscalation: false         # NEW (SR-20.5)
  seccompProfile:                         # NEW (SR-20.5)
    type: RuntimeDefault
```

20-RESEARCH.md §7 confirms compatibility: hostmetrics receiver uses only read syscalls allowed by RuntimeDefault seccomp; allowPrivilegeEscalation: false does not affect read paths.

Commit GREEN: `feat(20-02b-05): green — otel-collector partial-hardening completion (SR-20.5 / partial)`.
  </action>
  <verify>
    <automated>cd charts/openwhispr &amp;&amp; helm unittest . 2>&amp;1 | tee /tmp/green-02b-05.log; ! grep -E "(FAIL|✗)" /tmp/green-02b-05.log &amp;&amp; helm lint .</automated>
  </verify>
  <done>All helm-unittest cases for the phase PASS; helm unittest exits 0; helm lint exits 0; `helm template . --set secrets.mode=eso --set secrets.external.storeRef=dummy | grep -c "allowPrivilegeEscalation: false"` returns at least 4 (api, web, worker, litellm, otel).</done>
</task>

<task type="auto">
  <name>Task 6: Document deferred "LiteLLM non-root image fork" in .planning/deferred-items.md</name>
  <files>.planning/deferred-items.md</files>
  <action>
Append an entry to `.planning/deferred-items.md` (create the file if it does not exist) capturing the LiteLLM non-root fork backlog:

```markdown
## LiteLLM non-root image fork (Phase 20 carry)

**Source:** 2026-05-16 audit B3 / SR-20.5; 20-RESEARCH.md §6 Problem 2 Option B.

**Why deferred:** Upstream `ghcr.io/berriai/litellm:main-v1.83.x-stable` runs as uid=0 with no USER directive. Prisma client writes `/app/.prisma` at runtime, so `readOnlyRootFilesystem: true` requires rebuilding the image with a non-root user + emptyDir mounts on `/app/.prisma` and `/tmp`. Phase 20 closed the BLOCKER on api/web/worker (which had USER directives ready) and documented LiteLLM as a relaxed-hardening exception (allowPrivilegeEscalation: false + seccompProfile RuntimeDefault + capabilities drop ALL).

**Future phase:** Build a downstream image at `ghcr.io/openwhispr/openwhispr-litellm:<tag>` with `USER 1000` + Prisma write paths re-mounted. Image-build pipeline addition + sync burden per upstream version bump. Owner: TBD; trigger: any P0 audit re-run flagging LiteLLM hardening as outstanding.
```

Commit message: `docs(20-02b-06): track LiteLLM non-root image fork as deferred (SR-20.5 carry)`.
  </action>
  <verify>
    <automated>grep -q "LiteLLM non-root image fork" .planning/deferred-items.md</automated>
  </verify>
  <done>.planning/deferred-items.md contains the LiteLLM non-root fork entry with WHY: rationale + future-phase owner placeholder.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 7: Live kind smoke — validate readOnlyRootFilesystem + securityContext on a real cluster</name>
  <what-built>
Helm chart now declares full pod+container securityContext on api/web/worker (uid 1000, readOnlyRootFilesystem: true, drop ALL, seccompProfile, allowPrivilegeEscalation: false) with emptyDir mounts for /tmp and (web only) /app/apps/web/.next/cache. LiteLLM has relaxed hardening (no readOnlyRootFilesystem). OTel Collector partial-hardening completed.

Per Phase 09.1 / 09.2 precedent and 20-RESEARCH.md §6 "Image-runtime smoke gate" + 20-RESEARCH.md §"Assumptions Log" A3/A4, the readOnlyRootFilesystem path needs a live verification because no in-repo test exercises all runtime write paths (Better Auth session caches, multipart temp, ISR cache).
  </what-built>
  <how-to-verify>
1. Build the 3 app images: `make docker-build-all` (or equivalent per repo convention).
2. Start a kind cluster + helm install:
   ```bash
   kind create cluster --name ow-20-02b-smoke
   kind load docker-image openwhispr-api:test openwhispr-web:test openwhispr-worker:test --name ow-20-02b-smoke
   helm install ow ./charts/openwhispr \
     --set secrets.mode=eso --set secrets.external.storeRef=dummy \
     --set api.image=openwhispr-api:test \
     --set web.image=openwhispr-web:test \
     --set worker.image=openwhispr-worker:test \
     --wait --timeout 5m
   ```
3. Observe pod status — within 90 seconds, all 4 Deployments (api, web, worker, litellm) MUST reach Ready:
   `kubectl get pods -w -l app.kubernetes.io/instance=ow`
4. Verify pod securityContext is applied at runtime:
   `kubectl exec deploy/ow-api -- id -u` → expect `1000`
   `kubectl exec deploy/ow-web -- id -u` → expect `1000`
   `kubectl exec deploy/ow-worker -- id -u` → expect `1000`
   `kubectl exec deploy/ow-api -- touch /forbidden` → expect "Read-only file system" error
   `kubectl exec deploy/ow-api -- touch /tmp/ok` → expect success (emptyDir mounted)
5. For web specifically, exercise an ISR write path (request a page; observe `kubectl logs deploy/ow-web` for any "EROFS" / "read-only" errors).
6. If any pod crashloops or any "read-only file system" error surfaces from production code paths, capture the write path in 20-02b-SUMMARY.md and propose a follow-up emptyDir mount addition. Per CLAUDE.md Hard Rule #1, do NOT silently relax securityContext — document and ask user to choose.
7. Tear down: `kind delete cluster --name ow-20-02b-smoke`.
  </how-to-verify>
  <resume-signal>Type "approved — all 4 Deployments Ready within 90 s, no unexpected EROFS errors" OR describe observed write-path failures and propose remediation (additional emptyDir mount OR relaxed-hardening exception for specific workload).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| image build -> kubelet | USER 1000 in Dockerfile must match pod runAsUser: 1000 or kubelet refuses start |
| container -> host kernel | readOnlyRootFilesystem + capabilities drop + seccompProfile defense-in-depth |
| LiteLLM container -> host kernel | Relaxed hardening (no readOnlyRootFS) because upstream image cannot satisfy — exception documented |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-20b-01 | Elevation of Privilege | container escape via setuid binary | mitigate | allowPrivilegeEscalation: false on all 4 + otel; capabilities drop ALL |
| T-20b-02 | Tampering | runtime binary modification to inject malware | mitigate | readOnlyRootFilesystem: true on api/web/worker + emptyDir for known write paths; LiteLLM exception per 20-RESEARCH.md §6 Problem 2 |
| T-20b-03 | Elevation of Privilege | kernel-syscall escape from compromised pod | mitigate | seccompProfile: RuntimeDefault on all 5 |
| T-20b-04 | Spoofing | image impersonates non-root via USER name but uid != 1000 | mitigate | Explicit `USER 1000` numeric directive in Dockerfile; verify task 2 runs `docker run ... id -u` ≡ 1000 |
| T-20b-05 | Tampering | LiteLLM image gets compromised and writes to /app/.prisma | accept | Documented exception; future fork-image phase remediates; relaxed shape still drops ALL capabilities + seccompProfile + allowPrivEsc=false |
| T-20b-06 | Denial of Service | readOnlyRootFilesystem breaks an unaudited write path → CrashLoopBackOff | mitigate | Live kind smoke (Task 7) exercises runtime write paths; per 20-RESEARCH.md §"Assumptions Log" A3/A4 |
| T-20b-07 | Tampering | OTel Collector pod abuses runAsUser:0 elevation | mitigate | Already-documented exception for hostmetrics; this plan adds allowPrivEsc=false + seccompProfile to bound further escalation |
</threat_model>

<verification>
1. `git log --oneline -6` — 6 commits: test(20-02b-01), feat(20-02b-02..05), docs(20-02b-06). The checkpoint task 7 produces no commit.
2. `cd charts/openwhispr && helm unittest .` — exits 0
3. `cd charts/openwhispr && helm lint .` — exits 0
4. `helm template charts/openwhispr/ --set secrets.mode=eso --set secrets.external.storeRef=dummy | grep -c 'readOnlyRootFilesystem: true'` ≥ 4 (api/web/worker/otel — NOT litellm)
5. `helm template charts/openwhispr/ --set secrets.mode=eso --set secrets.external.storeRef=dummy | grep -c 'allowPrivilegeEscalation: false'` ≥ 5 (api/web/worker/litellm/otel)
6. `docker run --rm openwhispr-api:test id -u` → 1000; same for worker + web
7. Kind smoke (Task 7) → 4 Deployments Ready within 90 s
8. `.planning/deferred-items.md` contains the LiteLLM non-root fork entry
9. `git status --short` — working tree clean
</verification>

<success_criteria>
- SR-20.5 satisfied for api/web/worker (full hardening) + LiteLLM (relaxed-hardening exception, documented) + OTel Collector (partial-hardening completion)
- SR-20.7 satisfied: git log shows RED before GREEN
- Coverage Success Criterion 3 (helm-unittest assertions for securityContext) MET
- Coverage Success Criterion 4 (`helm template | yq` shows runAsNonRoot + 3 container-level keys on api/web/worker) MET (litellm exempt per documented exception)
- Coverage Success Criterion 6 (kind smoke shows all 4 Deployments Ready within 90 s) MET via Task 7
- LiteLLM non-root image fork tracked in deferred-items.md per 20-RESEARCH.md §"Open Questions" #3
</success_criteria>

<output>
Create `.planning/phases/20-compose-helm-production-guardrails/20-02b-SUMMARY.md` with: commit SHAs, helm-unittest output (assertion counts), helm template grep counts (readOnlyRootFilesystem / allowPrivilegeEscalation), `docker run id -u` per image, kind smoke result (pods + timings), any unexpected EROFS errors and remediation, and confirmation that the LiteLLM fork deferred-item is filed.
</output>
