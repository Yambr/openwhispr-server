---
phase: quick-260528-nof
plan: 01
subsystem: ci
tags: [github-actions, helm, ghcr, release, supply-chain]
requires:
  - charts/openwhispr-server/Chart.yaml (appVersion — pinned image tag)
  - .github/workflows/release.yml (separate v* image-build lane — untouched)
provides:
  - Single-job (release-server only) helm-release workflow
  - Pre-package GHCR image-readiness gate (api/web/worker at appVersion)
affects:
  - .github/workflows/helm-release.yml
tech-stack:
  added: []
  patterns:
    - "docker login --password-stdin + docker manifest inspect exit-code poll for GHCR readiness"
    - "bounded-deadline poll loop (1500s budget, 30s interval) → exit 1 on miss"
key-files:
  created: []
  modified:
    - .github/workflows/helm-release.yml
decisions:
  - "Removed dead monolith `release` job (zero OCI consumers) instead of leaving a noop guard"
  - "Dropped `v*` trigger from this workflow only; release.yml keeps its own v* image-build trigger"
  - "Narrowed permissions: dropped `pull-requests: write` (only the deleted peter-evans PR step needed it)"
  - "GHCR readiness via `docker manifest inspect` (exit-0-iff-exists, multi-arch-aware) over hand-rolled token-exchange"
  - "Bounded timeout → `exit 1` on missing image = fail-loud, never publish a chart pinning a missing image"
metrics:
  completed: 2026-05-28
  tasks: 3
  files: 1
---

# Phase quick-260528-nof Plan 01: Retire monolith helm-release job + fix chart/image publish race Summary

Retired the dead-weight monolith `release` job from `.github/workflows/helm-release.yml` (it published an unconsumed `charts/openwhispr` OCI artifact on every `v*` tag) and added a pre-package image-readiness gate to the surviving `release-server` job so the server chart is never published while it pins `openwhispr-{api,web,worker}` images that the slow (~20 min) `release.yml` build has not yet produced on GHCR (#50).

## What changed

All edits in a single file: `.github/workflows/helm-release.yml`.

### Task 1 — Retire monolith `release` job + drop dead `v*` trigger + rewrite header
- Deleted the entire `release:` job (`if: startsWith(github.ref, 'refs/tags/v')`) and all 11 of its steps (checkout → Resolve chart tag → Setup Helm → Log in GHCR → Helm dependency build → Helm package → Push chart to GHCR OCI → Configure git identity → Run chart-releaser → Update `.chart-versions/previous` → Open follow-up PR).
- Removed the `"v*"` entry from `on.push.tags`, leaving only `"openwhispr-server-*"`. `release.yml` is a separate file with its own `v*` trigger for image builds — untouched — so a `v*` push still builds images; it just no longer matches any job in *this* workflow. `chart-release.yml` (`chart-v*` lane) remains the publisher for the monolith chart's gh-pages/ArtifactHub index.
- Rewrote the header comment (lines 1-16) to describe the surviving server-chart-only behavior and explicitly note the monolith is published via `chart-release.yml`, and that the new pre-package gate waits on the pinned images.
- **Permissions narrowed (least-privilege):** dropped `pull-requests: write` — it was needed only by the deleted `peter-evans/create-pull-request` step. The surviving `release-server` job uses `contents: write` (release commit + chart-releaser gh-pages) + `packages: write` (GHCR OCI push) only. Verified no remaining step opens a PR.

### Task 2 — Wait-for-images gate in `release-server`
Inserted a `Wait for pinned images on GHCR` step positioned AFTER `Log in to GHCR` and BEFORE `Helm lint server chart` / `Helm package server chart`. It:
- Binds `REPO_OWNER`, `GHCR_USER`, `GHCR_TOKEN` via `env:` (no `${{ }}` inlined into shell logic).
- Lowercases the owner via `tr` (GHCR repo-name rule, same pattern used elsewhere in the file).
- Reads the pinned tag via `yq '.appVersion' charts/openwhispr-server/Chart.yaml` (currently `1.0.15`).
- Authenticates with `echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin` (token via stdin, masked).
- Polls all three images `ghcr.io/<owner>/openwhispr-{api,web,worker}:<appVersion>` with `docker manifest inspect "${ref}" >/dev/null 2>&1`, treating exit 0 as present.
- Bounded deadline loop: ~1500s (~25 min) budget, 30s interval. On all-present → prints the three refs and `exit 0`. On deadline with any missing → prints a diagnostic naming the missing image(s) + the polled tag, then `exit 1`.
- `set -euo pipefail` ON, `set -x` deliberately OFF (a tracing comment documents why).

### Task 3 — Structural + no-secret-leak audit
Consolidated audit (no further code changes needed):
- actionlint 1.7.12 clean (`-verbose`: 0 parse errors, 0 total errors; shellcheck ran on the `run:` blocks).
- PyYAML `safe_load` parses.
- Exactly one job: `['release-server']`.
- Triggers: `['openwhispr-server-*']` (no active `v*`).
- Step order confirmed: `Log in to GHCR` (3) → `Wait for pinned images on GHCR` (4) → `Helm lint` (5) → `Helm package server chart` (6).
- No standalone token echo — the only two `echo "<token>" |` lines pipe straight into `--password-stdin` (helm login at line 60-61, docker login at line 90), both masked by Actions.

## actionlint output

```
verbose: Linting .github/workflows/helm-release.yml
verbose: Using project at /Users/nick/openwhispr-server/.claude/worktrees/agent-a7e8ab3a2b761fb64
verbose: Found 0 parse errors in 0 ms for .github/workflows/helm-release.yml
verbose: Rule "pyflakes" was disabled: exec: "pyflakes": executable file not found in $PATH
verbose: Found total 0 errors in 125 ms for .github/workflows/helm-release.yml
```
(`pyflakes` is irrelevant — it only lints embedded Python in `run:` blocks, of which there are none; shellcheck still ran.)

## GHCR-readiness check + failure-posture reasoning trace

**Why `docker manifest inspect` after `docker login --password-stdin` is the correct GHCR readiness check:**
1. **Exit-0-iff-exists semantics.** `docker manifest inspect <ref>` returns exit 0 if and only if the manifest is present and readable, non-zero otherwise. That is exactly the binary signal the gate needs — no JSON parsing, no string-matching on `404` bodies.
2. **Multi-arch-aware.** The images are built `linux/amd64,linux/arm64` (`release.yml` `build-push-action` with `platforms:`), so on GHCR each tag resolves to an OCI **image index**. `docker manifest inspect` reads the index directly; a per-arch-only probe would give false negatives. This is the manifest-list-correct check.
3. **Reuses the established GHCR auth pattern.** The file already does `helm registry login ghcr.io --password-stdin`. Using `docker login --password-stdin` for manifest reads mirrors that exact credential-handling idiom rather than hand-rolling a fragile registry token-exchange against `ghcr.io/token` (which would mean parsing a bearer JSON, scoping `repository:...:pull`, and curling `Accept: application/vnd.oci.image.index.v1+json` — three more failure surfaces, and a place where the token could leak into a logged `-H "Authorization:"` arg).
4. **Runner-native.** Docker is GA on `ubuntu-24.04`; `docker manifest inspect` needs no experimental flag on current runners.

**Why bounded-timeout + `exit 1` on miss is the correct failure posture:**
- The race being fixed: `openwhispr-server-*` (chart) and `v*` (images) are independent tags; the chart pins `appVersion` images. Publishing the chart before the ~20 min image build finishes ships a chart that pins a tag that does not yet exist → operators hit `ImagePullBackOff` and previously had to manually poll GHCR before rolling (the operational step this change removes).
- A **bounded** deadline (~25 min, slightly above the ~20 min build) prevents a hung build from blocking the runner forever (T-nof-04: DoS via infinite poll → mitigated).
- `exit 1` on the deadline (rather than warn-and-continue) means a **genuinely failed** image build *fails the chart publish loudly* instead of silently publishing a broken pin (T-nof-02: chart pinning a non-existent image → mitigated). Fail-loud is the right default for a supply-chain publish gate: a missing image is never an acceptable state to publish through.

## Threat-model mitigations applied
- **T-nof-01 (info disclosure):** Token only via `env` binding + `--password-stdin`; never echoed standalone, never interpolated into a logged command; `set -x` OFF. Audited in Task 3 — no standalone token echo.
- **T-nof-02 (chart pins missing image):** Wait gate blocks publish until all three manifests exist; `exit 1` on timeout.
- **T-nof-03 (over-broad permissions):** `pull-requests: write` removed; surviving job uses `contents` + `packages` only.
- **T-nof-04 (infinite poll DoS):** Bounded ~25 min deadline with explicit `exit 1`.

## Deviations from Plan

None — plan executed exactly as written. The plan offered permission narrowing as optional ("preferred for least-privilege; if uncertain, leave unchanged"); I applied it (removed `pull-requests: write`) since the only PR-opening step was deleted.

## Scope guard (verified)
`git diff --name-only` = `.github/workflows/helm-release.yml` only. `charts/openwhispr-server/Chart.yaml`, `charts/openwhispr-server/values.yaml`, `release.yml`, `chart-release.yml`, `helm-upgrade-matrix.yml`, `helm-lint.yml`, `ci.yml` all confirmed UNCHANGED. No untracked debris. `charts/openwhispr/**` not touched. No `#48` (workflow_dispatch) work done.

## Self-Check: PASSED
- `.github/workflows/helm-release.yml` exists and contains the edits (single job, wait gate, narrowed permissions).
- actionlint exit 0; PyYAML parses; jobs == `['release-server']`; triggers == `['openwhispr-server-*']`.
- Commit: `126a5f7b` (1 file changed, +80 / -112) — `ci(helm-release): retire dead monolith publish job + wait for images before chart publish (#50)`. Confirmed on HEAD via `git log`.
- Pre-commit hooks GREEN: gitleaks (no leaks), english-only check, commitlint (after shortening subject 105→95 chars to satisfy `header-max-length` 100; NOT bypassed).
- Post-commit: no whole-file deletions; only `.github/workflows/helm-release.yml` in the commit; SUMMARY/PLAN intentionally left untracked (not committed, per constraints).
