---
phase: quick-260528-nof
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .github/workflows/helm-release.yml
autonomous: true
requirements:
  - "QUICK-260528-nof: retire dead monolith release job + fix chart/image publish race (#50)"
user_setup: []

must_haves:
  truths:
    - "On a `v*`-only tag push, helm-release.yml runs NO job (the dead monolith publish is gone); release.yml still builds images on `v*` untouched."
    - "On an `openwhispr-server-*` tag push, release-server waits for all three pinned images (api/web/worker at chart appVersion) to exist on GHCR BEFORE packaging/pushing the server chart."
    - "If any pinned image never appears within the bounded timeout, release-server FAILS with a diagnostic instead of publishing a chart that pins a missing image."
    - "No GITHUB_TOKEN value is echoed or logged by the new wait step (token passed via env + docker login stdin, never interpolated into a logged command)."
    - "The workflow YAML is syntactically valid and actionlint-clean after the edits."
  artifacts:
    - path: ".github/workflows/helm-release.yml"
      provides: "Single-job (release-server only) chart-publish workflow with a pre-package image-wait gate"
      contains: "release-server"
  key_links:
    - from: "release-server job"
      to: "charts/openwhispr-server/Chart.yaml appVersion"
      via: "yq read → image tag used by the wait-for-images poll"
      pattern: "yq.*appVersion.*charts/openwhispr-server/Chart.yaml"
    - from: "wait-for-images step"
      to: "ghcr.io/<owner>/openwhispr-{api,web,worker}:<appVersion>"
      via: "docker manifest inspect exit-code poll loop with bounded timeout"
      pattern: "docker manifest inspect"
    - from: "wait-for-images step"
      to: "Helm package server chart step"
      via: "step ordering — wait runs AFTER login, BEFORE package"
      pattern: "Wait for pinned images"
---

<objective>
Retire the dead-weight monolith `release` job in `.github/workflows/helm-release.yml` and fix the chart↔image publish race in the `release-server` job (#50).

Two coupled changes in ONE workflow file:
1. **Retire** the monolith `release` job (the `if: startsWith(github.ref, 'refs/tags/v')` job, ~lines 31-133) that publishes the unconsumed `charts/openwhispr` OCI artifact + gh-pages index on every `v*` tag. Remove the now-dead `v*` trigger from this workflow (release.yml — a SEPARATE file — keeps its own `v*` trigger). Update the workflow header comment to describe the surviving server-chart-only behavior.
2. **Fix the race** in `release-server`: add a wait-for-images gate that polls GHCR for the three application images the chart pins (`openwhispr-{api,web,worker}:<appVersion>`) and only proceeds once all three exist — preventing the server chart from being published while it pins images that the slow (~20min) release.yml build has not yet produced (which previously forced the k8s operator to manually poll GHCR to avoid ImagePullBackOff).

Purpose: Stop publishing a dead artifact and remove a manual operational step (poll-before-roll) from the operator's release flow.
Output: A single-job (`release-server`-only) helm-release.yml with a structural image-readiness gate, no behavior changes to image builds or chart versions.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.github/workflows/helm-release.yml
@charts/openwhispr-server/Chart.yaml

<interfaces>
<!-- Load-bearing facts the executor needs. No further codebase exploration required. -->

CURRENT helm-release.yml structure (read in full during planning):
- Lines 1-9: header comment (describes the MONOLITH publish behavior — now stale, must be rewritten).
- Lines 11-19: `on.push.tags` = [`v*`, `openwhispr-server-*`].
- Lines 21-28: permissions + concurrency (unchanged).
- Lines 31-133: `release:` job — the MONOLITH publish job to DELETE (guard `if: startsWith(github.ref, 'refs/tags/v')`). Its steps: checkout, Resolve chart tag, Setup Helm, Log in GHCR, Helm dependency build, Helm package, Push chart to GHCR OCI, Configure git identity, Run chart-releaser, Update .chart-versions/previous, Open follow-up PR.
- Lines 134-260: `release-server:` job — KEEP. Guard `if: startsWith(github.ref, 'refs/tags/openwhispr-server-')`. Steps in order: checkout (141), Resolve server chart tag (145, id=`tag`, outputs `value`), Setup Helm (151), Log in to GHCR (156, `helm registry login`), Helm lint (161), Helm package server chart (165), Push server chart to GHCR OCI (173), Configure git identity (183), Run chart-releaser (188), Build enriched chart Release body (196), Publish enriched body (243).

SAFETY (orchestrator-verified, re-confirmed during planning via grep):
- `charts/openwhispr` (monolith) is STILL consumed by CI: helm-upgrade-matrix.yml, helm-lint.yml, ci.yml, AND chart-release.yml (the `chart-v*` gh-pages lane). DO NOT delete chart files. DO NOT touch those workflows.
- The monolith OCI artifact pushed by the `release` job has ZERO consumers; the documented gh-pages/ArtifactHub publish lane for the monolith is `chart-release.yml` (`chart-v*` tags), NOT this job. So retiring the `release` job removes only dead-weight.
- `v*` tags ALSO trigger release.yml (image build) — a SEPARATE file, untouched. After removing the `release` job and the `v*` trigger here, a `v*` push simply matches no job in helm-release.yml. Removing the `v*` trigger from THIS workflow is preferred (cleaner; no dead intentional-noop job).

IMAGE NAMING (confirmed from release.yml build-image matrix, lines 56-67 + taglist lines 99-118):
- Images: `ghcr.io/<owner-lowercase>/openwhispr-<name>:<tag>` where `<name>` ∈ {api, web, worker, ...} and `<tag>` = ref with leading `v` stripped.
- The chart pins images at `appVersion` (currently `"1.0.15"` in charts/openwhispr-server/Chart.yaml line 18). The chart's image tag default = appVersion, so the wait must poll for the THREE app images at `<appVersion>`: api, web, worker. (Postgres/test-probe images are NOT pinned by the chart's default deploy path — only api/web/worker per the task scope.)

OWNER-LOWERCASE pattern (used 3× already in this file + release.yml):
  owner=$(echo "${REPO_OWNER}" | tr '[:upper:]' '[:lower:]')
Pass `github.repository_owner` via an env binding (mirror the "Build enriched chart Release body" step at lines 198-205) — do NOT inline `${{ }}` in the shell body for the new step's logic.

GHCR MANIFEST-EXISTENCE CHECK (decision — see Task 2 action):
Use `docker login ghcr.io` (username `${{ github.actor }}`, password GITHUB_TOKEN via stdin) then `docker manifest inspect ghcr.io/<owner>/openwhispr-<svc>:<appVersion>` checking exit code. `docker manifest inspect` returns 0 iff the manifest / OCI image index exists and is readable (works for multi-arch indices), non-zero otherwise. Docker is GA on ubuntu-24.04 runners (no experimental flag needed). This reuses the existing GHCR-login pattern instead of hand-rolling a registry token-exchange against `ghcr.io/token`, which is more fragile.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Retire monolith `release` job + drop dead `v*` trigger + rewrite header</name>
  <files>.github/workflows/helm-release.yml</files>
  <action>
Delete the entire `release:` job (lines ~31-133, the job guarded by `if: startsWith(github.ref, 'refs/tags/v')`, including all its steps through the "Open follow-up PR" peter-evans step ending at line 132). Leave the `release-server:` job fully intact (do not modify it in this task).

Remove the now-dead `v*` entry (and its associated comment block, lines ~13-14 plus the leading comment if it only documents `v*`) from `on.push.tags`, leaving only `openwhispr-server-*`. Keep the `openwhispr-server-*` entry and its explanatory comment. Rationale: nothing left in THIS workflow keys on `v*`; release.yml is a separate file with its own `v*` trigger, so image builds are unaffected.

Rewrite the workflow header comment (lines 1-9) so it accurately describes the surviving behavior: this workflow now publishes ONLY the `openwhispr-server` chart on `openwhispr-server-*` tags (OCI push to ghcr.io/&lt;owner&gt;/charts + chart-releaser gh-pages index + enriched GitHub Release body). Note that the monolith `charts/openwhispr` chart is published via the separate `chart-release.yml` (`chart-v*`) lane and is no longer published here. English-only.

Do NOT change `permissions:`, `concurrency:`, chart versions, or appVersion. The `pull-requests: write` permission was only needed by the deleted peter-evans PR step; you MAY narrow `permissions:` by removing `pull-requests: write` since no surviving step opens a PR — but ONLY if no remaining step needs it (verified: release-server uses contents+packages only). Narrowing is preferred for least-privilege; if uncertain, leave permissions unchanged and note it in the SUMMARY.
  </action>
  <verify>
    <automated>cd /Users/dev/openwhispr-server && actionlint .github/workflows/helm-release.yml && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/helm-release.yml'))" && test "$(grep -c 'startsWith(github.ref, .refs/tags/v.)' .github/workflows/helm-release.yml | tr -d ' ')" = "0" && grep -q 'startsWith(github.ref, .refs/tags/openwhispr-server-.)' .github/workflows/helm-release.yml && test "$(grep -vE '^\s*#' .github/workflows/helm-release.yml | grep -c '"v\*"' | tr -d ' ')" = "0" && echo OK</automated>
  </verify>
  <done>actionlint passes; YAML parses; the `release` job and its `refs/tags/v` guard are gone; the `release-server` job and its `openwhispr-server-` guard remain; no active (non-comment) `"v*"` trigger entry remains; header comment describes server-chart-only behavior.</done>
</task>

<task type="auto">
  <name>Task 2: Add wait-for-images gate to `release-server` before chart package</name>
  <files>.github/workflows/helm-release.yml</files>
  <action>
Insert a new step named `Wait for pinned images on GHCR` into the `release-server` job, positioned AFTER the existing "Log in to GHCR" step (helm registry login, ~line 156-159) and BEFORE the "Helm lint server chart" / "Helm package server chart" steps (so the gate runs before any packaging/publishing).

The step must:
- Provide env bindings (do NOT inline `${{ }}` secrets/owner into the shell logic): `REPO_OWNER: ${{ github.repository_owner }}`, `GHCR_USER: ${{ github.actor }}`, and `GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Read the token from the env var only; never echo it.
- Lowercase the owner: `owner=$(echo "${REPO_OWNER}" | tr '[:upper:]' '[:lower:]')` (same pattern as the rest of the file).
- Read the chart's pinned image tag from Chart.yaml: `app_version=$(yq '.appVersion' charts/openwhispr-server/Chart.yaml)` (yq preinstalled on ubuntu-24.04; mirror the "Build enriched chart Release body" step at line 209). This is the tag the chart's values default to for api/web/worker.
- Authenticate to GHCR for manifest reads using `docker login`: pipe the token via stdin so it is never on the command line or in logs — `echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin`.
- Poll for ALL THREE application images: `ghcr.io/${owner}/openwhispr-api:${app_version}`, `-web`, `-worker`. For each, use `docker manifest inspect "<ref}" >/dev/null 2>&1` and treat exit 0 as "present" (works for multi-arch OCI image indices). Redirect output to /dev/null so manifest JSON (which is non-secret but noisy) does not clutter logs; the token is never printed by `docker manifest inspect`.
- Loop with a bounded timeout. Use a deadline approach: total budget ~1500s (~25min, since the image build takes ~20min), poll interval ~30s. On each pass, check all three images; once all three are present, print a concise success line (image refs + tag, NO token) and exit 0. If the deadline passes with one or more images still missing, print a clear diagnostic naming WHICH image(s) are missing and the tag polled, then `exit 1` so the job fails loudly (preventing publication of a chart pinning a non-existent image).
- Use a bash construct that does not risk leaking the token via `set -x`; if you enable `set -euo pipefail` for safety, keep `set -x` OFF (or scope tracing away from the login line). Prefer plain `set -euo pipefail` without `-x`.

Do NOT change the chart's appVersion or version. Do NOT alter any other step. Keep the new step's logic in directive shell within the YAML `run:` block (this is the workflow source, not application code; LOCKER-06 governs application source — but still follow its spirit: no credential interpolation into a logged command; token only via stdin/env).
  </action>
  <verify>
    <automated>cd /Users/dev/openwhispr-server && actionlint .github/workflows/helm-release.yml && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/helm-release.yml'))" && grep -q 'Wait for pinned images' .github/workflows/helm-release.yml && grep -q 'docker manifest inspect' .github/workflows/helm-release.yml && grep -q "yq '.appVersion' charts/openwhispr-server/Chart.yaml" .github/workflows/helm-release.yml && grep -q 'password-stdin' .github/workflows/helm-release.yml && python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/helm-release.yml')); names=[s.get('name','') for s in d['jobs']['release-server']['steps']]; w=names.index('Wait for pinned images on GHCR'); p=names.index('Helm package server chart'); assert w<p, f'wait({w}) must precede package({p})'; print('order OK', names[w], '<', names[p])"</automated>
  </verify>
  <done>actionlint passes; YAML parses; a "Wait for pinned images on GHCR" step exists in `release-server`, ordered before "Helm package server chart"; it reads appVersion via yq, polls all three `openwhispr-{api,web,worker}` images via `docker manifest inspect`, uses bounded-timeout-with-exit-1 on missing images, and authenticates via `--password-stdin` (no token interpolation/echo).</done>
</task>

<task type="auto">
  <name>Task 3: Final structural + no-secret-leak audit of the edited workflow</name>
  <files>.github/workflows/helm-release.yml</files>
  <action>
Run a final consolidated audit on the edited file (no code changes unless an issue is found). Confirm:
1. Only ONE job remains (`release-server`); the `release` monolith job is fully removed.
2. `on.push.tags` contains only `openwhispr-server-*` (no active `v*`).
3. The wait gate is present and correctly ordered (before package).
4. No secret-leak pattern: the GITHUB_TOKEN is never echoed to stdout, never interpolated into a `docker manifest inspect` / `curl -H "Authorization: ..."` arg that gets logged, and only flows via `--password-stdin` and env bindings. Scan for any `echo "${{ secrets` or `echo "$GHCR_TOKEN"` (the only legitimate echo of the token is piped directly into `docker login --password-stdin`, which Actions masks; ensure no standalone `echo` prints it to the log).
5. The header comment is accurate (server-chart-only; monolith via chart-release.yml).

If any check fails, fix it in this task. Then provide a short reasoning trace in the SUMMARY explaining WHY `docker manifest inspect` after `docker login --password-stdin` is the correct GHCR readiness check (exit-0-iff-manifest-exists, works for multi-arch indices, reuses the existing GHCR auth pattern, avoids fragile manual token-exchange), and why the bounded timeout + exit 1 on miss is the correct failure posture (a genuinely-failed image build must not silently publish a chart pinning a missing image).
  </action>
  <verify>
    <automated>cd /Users/dev/openwhispr-server && actionlint .github/workflows/helm-release.yml && python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/helm-release.yml')); jobs=list(d['jobs'].keys()); assert jobs==['release-server'], f'expected only release-server, got {jobs}'; print('jobs OK', jobs)" && python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/helm-release.yml')); tags=d[True]['push']['tags'] if True in d else d['on']['push']['tags']; assert all('v*'!=t for t in tags) and any('openwhispr-server' in t for t in tags), f'tags={tags}'; print('triggers OK', tags)" && ! grep -nE 'echo +"\$\{?GHCR_TOKEN' .github/workflows/helm-release.yml | grep -v 'password-stdin' && echo NO_LEAK_OK</automated>
  </verify>
  <done>actionlint clean; exactly one job (`release-server`); triggers = [`openwhispr-server-*`] only; the only `echo` of the token pipes into `--password-stdin` (no standalone token echo); SUMMARY contains the GHCR-check + failure-posture reasoning trace.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GitHub Actions runner → GHCR registry | Authenticated read/write of image manifests + chart OCI artifacts using GITHUB_TOKEN. |
| Workflow logs → public visibility | Job logs are visible per repo settings; any credential printed to stdout is exposure. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-nof-01 | Information Disclosure | new "Wait for pinned images" step (GITHUB_TOKEN) | mitigate | Token flows only via env binding + `docker login --password-stdin`; never echoed, never interpolated into a logged command arg; `set -x` kept OFF. Audited in Task 3 (no standalone token echo). |
| T-nof-02 | Tampering / Denial of Service | chart published pinning a non-existent image | mitigate | Wait gate blocks publish until all three `openwhispr-{api,web,worker}:<appVersion>` manifests exist; bounded timeout → `exit 1` on miss so a failed image build fails the chart publish loudly instead of shipping a broken pin. |
| T-nof-03 | Elevation of Privilege | over-broad workflow permissions | mitigate | `pull-requests: write` (needed only by the deleted PR step) narrowed/removed if no surviving step requires it; surviving job uses contents+packages only. |
| T-nof-04 | Denial of Service | infinite poll hangs the runner | accept→mitigate | Bounded ~25min deadline with explicit `exit 1`; runner is never blocked indefinitely. |
</threat_model>

<verification>
Phase-level checks (run after all tasks):
- `actionlint .github/workflows/helm-release.yml` exits 0.
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/helm-release.yml'))"` succeeds.
- Exactly one job key: `release-server`.
- `on.push.tags` = [`openwhispr-server-*`] only.
- `Wait for pinned images on GHCR` step present, ordered before `Helm package server chart`.
- No standalone echo of GITHUB_TOKEN/GHCR_TOKEN (only `--password-stdin` pipe).
- The OTHER monolith-chart CI files are untouched: `git diff --name-only` shows ONLY `.github/workflows/helm-release.yml` (plus planning artifacts). `charts/openwhispr/**`, `charts/openwhispr-server/Chart.yaml`, `release.yml`, `helm-upgrade-matrix.yml`, `helm-lint.yml`, `chart-release.yml`, `ci.yml` MUST NOT change.
</verification>

<success_criteria>
- Monolith `release` job removed from helm-release.yml; dead `v*` trigger removed from this workflow only.
- `release-server` gains a wait-for-images gate (api/web/worker at chart appVersion) before packaging, with bounded timeout and loud failure on missing images.
- No credential leakage; actionlint + YAML-parse clean.
- No chart version / appVersion / image-build changes; no other workflow touched.
- Single atomic commit: `ci(helm-release): retire dead monolith publish job + wait for images before publishing server chart (#50)`.
</success_criteria>

<output>
After completion, create `.planning/quick/260528-nof-retire-monolith-helm-release-job-fix-cha/260528-nof-SUMMARY.md`.

Commit (single atomic) once all tasks verify green:
`ci(helm-release): retire dead monolith publish job + wait for images before publishing server chart (#50)`
</output>
