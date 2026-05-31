---
quick_id: 260526-pxb
slug: release-page-image-chart-visibility
title: "GitHub Releases page: surface image + chart artifacts per tag (v1.0.10)"
date: 2026-05-26
status: planned
mode: quick
---

<objective>
After this lands, visiting `https://github.com/Yambr/openwhispr-server/releases` shows BOTH (a) a Release per `v*` tag (image releases) with multi-arch GHCR pull commands for all 6 images and a cross-link to the paired chart tag, AND (b) a Release per `openwhispr-server-*` tag (chart releases) with the .tgz attached PLUS an enriched body containing the `helm pull` one-liner, `helm install` snippet, paired-image-tag link, and operator runbook xref — instead of the current state where `v*` tags have no Release object at all and `openwhispr-server-*` Releases show only the raw Chart.yaml description.

Purpose: close the user-visible gap surfaced 2026-05-26 (`gh release view v1.0.8` → "release not found"; `openwhispr-server-1.0.12` body is just the chart description). Operators currently have no single-page discovery path for "what was shipped in v1.0.9 and how do I pull it" — they have to navigate to GHCR packages manually.

Output: 4 file edits, 1 atomic commit, 2 tags pushed on the same SHA (`v1.0.10` + `openwhispr-server-1.0.13`), forward-only (no backfill of v1.0.3..v1.0.9). Pure CI/workflow change — zero runtime behavior delta vs the v1.0.9 codebase.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/quick/260526-pxb-release-page-image-chart-visibility/PLAN.md
@.github/workflows/release.yml
@.github/workflows/helm-release.yml
@charts/openwhispr-server/Chart.yaml
@charts/openwhispr-server/values.yaml

<interfaces>
<!-- Key wire-level invariants the executor must preserve. -->

Workflow trigger gates (DO NOT WIDEN):
- release.yml: `on.push.tags: ['v*']` + `on.workflow_dispatch`
- helm-release.yml `release-server` job: `if: startsWith(github.ref, 'refs/tags/openwhispr-server-')`
- helm-release.yml `release` job (monolith, likely dead): `if: startsWith(github.ref, 'refs/tags/v')` — DO NOT TOUCH

GHCR image namespace (lowercase via shell expansion, established pattern):
- `ghcr.io/yambr/openwhispr-<name>:<version>` for 6 images: api, web, worker, test-probe, postgres-17-pgpartman, cnpg-postgres-17-pgpartman
- pg variants additionally publish `:<pg_minor>-<version>` (e.g. `:17.6-1.0.10`, `:17.5-1.0.10`)

GHCR chart OCI namespace:
- `oci://ghcr.io/yambr/charts/openwhispr-server`

Permissions (current):
- release.yml workflow-level: `contents: read, packages: write` — MUST add `contents: write` at NEW job level only (minimal blast radius)
- helm-release.yml workflow-level: `contents: write, packages: write, pull-requests: write` — already sufficient

Action versioning convention (floating major-version, NOT SHA-pinned):
- `actions/checkout@v4`, `docker/login-action@v3`, `docker/build-push-action@v7`, `azure/setup-helm@v5`
- chart-releaser pinned to minor `@v1.7.0`, peter-evans/create-pull-request to `@v8.1.1`
- → NEW step uses `softprops/action-gh-release@v2` (floating major)

Computed tag value pattern (steps.tag.outputs.value):
- release.yml: `ref="${GITHUB_REF_NAME#v}"` → strips leading v (e.g. `v1.0.10` → `1.0.10`)
- helm-release.yml release-server: `ref="${GITHUB_REF_NAME#openwhispr-server-}"` → strips full prefix (e.g. `openwhispr-server-1.0.13` → `1.0.13`)
</interfaces>
</context>

## Phase Goal

**As a** operator browsing the OpenWhispr Server repo, **I want to** see a Release page entry per image tag AND per chart tag with informative bodies (pull commands, paired-tag links, runbook xref), **so that** I can discover what shipped in any version and copy-paste the install commands without navigating to GHCR packages or grep'ing changelogs.

## Scope

### In scope (verbatim from brief)

1. `.github/workflows/release.yml` — add `create-image-release` job that:
   - `needs: [build-image]` (matrix of 6 must finish green)
   - Runs only on `tags/v*` push (skip `workflow_dispatch`)
   - Uses `softprops/action-gh-release@v2`
   - `tag_name: ${{ github.ref_name }}`, `name: "OpenWhispr Server ${{ github.ref_name }}"`, explicit body, `draft: false`, `prerelease: false`, `generate_release_notes: false`
   - Job-level `permissions: { contents: write }`

2. `.github/workflows/helm-release.yml` `release-server` job — enrich body via follow-up `gh release edit` step (Option A: leave chart-releaser-action's Release create + .tgz upload alone, overwrite body afterward, with create-if-not-exists guard)

3. `charts/openwhispr-server/Chart.yaml` — `version: 1.0.12 → 1.0.13`, `appVersion: "1.0.9" → "1.0.10"`

4. `charts/openwhispr-server/values.yaml` — `image.tag: "1.0.9" → "1.0.10"` + lineage comment block for v1.0.10

### Out of scope (explicit deferrals)

- Backfilling Release objects for past `v1.0.3..v1.0.9` tags — acknowledged that `/releases/tag/v1.0.9` will continue to 404 (R7).
- Tagging scheme redesign — `v*` + `openwhispr-server-*` split stays.
- Monolith `release` job in helm-release.yml — leave untouched (likely dead, do not regress).
- `charts/openwhispr/` legacy chart — yanked, do not touch.
- `apps/api/package.json` version field — confirmed `"version": "0.0.0"` placeholder, workspace-managed; do NOT bump.
- Any `apps/**` or `packages/**` runtime change — pure CI/workflow + chart metadata.
- New tests — workflow changes are verified by actually firing the workflow via tag push.

## Files modified

| Path | Change | LOC estimate |
|---|---|---|
| `.github/workflows/release.yml` | Add `create-image-release` job after `build-image`. Includes `permissions: { contents: write }` at job level, single `softprops/action-gh-release@v2` step with computed body. | +50..70 |
| `.github/workflows/helm-release.yml` | Add step at end of `release-server` job (after chart-releaser) that builds enriched body.md via heredoc, then `gh release edit` or `gh release create` (create-if-not-exists guard). | +35..45 |
| `charts/openwhispr-server/Chart.yaml` | Bump `version: 1.0.12 → 1.0.13`, `appVersion: "1.0.9" → "1.0.10"`. | 2 line edits |
| `charts/openwhispr-server/values.yaml` | Bump `image.tag: "1.0.9" → "1.0.10"` + prepend lineage comment block for v1.0.10 documenting "workflow-only release, no runtime behavior change vs v1.0.9". | +6..10, 1 line edit |

Total expected diff: ~100..130 LOC across 4 files.

## Implementation order

<tasks>

<task type="auto">
  <name>Task 1: Edit release.yml — add create-image-release job</name>
  <files>.github/workflows/release.yml</files>
  <action>
    Append a new top-level job `create-image-release` AFTER `build-image` in the `jobs:` map. Job-level config:
    - `runs-on: ubuntu-24.04`
    - `needs: [build-image]` (all 6 matrix builds must complete green before this fires)
    - `if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')` (skip workflow_dispatch where there's no canonical tag)
    - `permissions: { contents: write }` at job level (workflow-level remains `contents: read, packages: write` — minimum blast radius per R1)

    Steps:
    1. `actions/checkout@v4` (needed to compute paired chart version from `charts/openwhispr-server/Chart.yaml` if we surface it; even if not, checkout is cheap and consistent with other jobs).
    2. `Resolve image tag` step identical to build-image's tag computation: strip leading `v` from `GITHUB_REF_NAME` → `steps.tag.outputs.value`. Reuse the exact pattern from lines 75-84 (no DRY refactor — just duplicate; workflow YAML doesn't support `outputs.<job>.tag` re-use cleanly across jobs without extra plumbing).
    3. `Read chart appVersion for paired-chart xref` step: `yq '.appVersion' charts/openwhispr-server/Chart.yaml` → `steps.chart.outputs.appVersion` (used in body for "see paired chart release `openwhispr-server-X.Y.Z`"). Use `mikefarah/yq` which is preinstalled on `ubuntu-24.04` (verify; if not, install via `pipx install yq` or apt). NOTE: this is a forward-looking link — we link FROM image release TO chart release; if chart hasn't been tagged yet at image-release time, the link 404s briefly until operator pushes the chart tag. Acceptable per R6.
    4. `Build body.md` step using heredoc — see "Body templates" section below. Writes `body.md` to runner workspace.
    5. `softprops/action-gh-release@v2` step with:
       - `tag_name: ${{ github.ref_name }}`
       - `name: "OpenWhispr Server ${{ github.ref_name }}"`
       - `body_path: body.md`
       - `draft: false`
       - `prerelease: false`
       - `generate_release_notes: false`
       - `token: ${{ secrets.GITHUB_TOKEN }}` (implicit, but explicit is clearer)
       - DO NOT use `files:` — image artifacts live in GHCR, not as Release attachments

    Preserve existing `build-image` matrix exactly — no edits there. Owner-lowercase pattern (lines 99-107) is reused inside body computation: `owner=$(echo "${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')`. Concurrency group at workflow level still applies.
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && yq '.jobs.create-image-release.needs' .github/workflows/release.yml | grep -q build-image && yq '.jobs.create-image-release.if' .github/workflows/release.yml | grep -q "refs/tags/v" && yq '.jobs.create-image-release.permissions.contents' .github/workflows/release.yml | grep -q write && yq '.jobs.build-image' .github/workflows/release.yml > /dev/null && echo OK</automated>
  </verify>
  <done>Workflow YAML parses (`yq` succeeds on the file). `create-image-release` job exists with `needs: [build-image]`, the gating `if:` expression, `permissions.contents: write`, and a `softprops/action-gh-release@v2` step. `build-image` job remains byte-identical except for new `needs` consumers downstream (none — only `create-image-release` consumes it). `actionlint` (if available locally — `brew install actionlint`) reports no errors on the file.</done>
</task>

<task type="auto">
  <name>Task 2: Edit helm-release.yml release-server — append gh release edit step</name>
  <files>.github/workflows/helm-release.yml</files>
  <action>
    In the `release-server` job ONLY (not the monolith `release` job), append two new steps AFTER `Run chart-releaser (GitHub Pages index)` (currently line 188-194):

    Step A: `Build enriched chart release body`
    - Runs `yq '.appVersion' charts/openwhispr-server/Chart.yaml` to fetch the image tag the chart pins.
    - Captures `chart_version` = `${{ steps.tag.outputs.value }}` (already computed at line 145-149 — strips `openwhispr-server-` prefix).
    - Owner-lowercase: `owner=$(echo "${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')`.
    - Writes `body.md` via heredoc — see "Body templates" section below.

    Step B: `Publish enriched body to GitHub Release`
    - Create-if-not-exists guard (R3 mitigation): chart-releaser-action SHOULD have created the Release with the .tgz attached, but if it skipped (e.g. `skip_existing: true` matched a prior release), we MUST still create the Release ourselves.
    - Command sequence (single `run:` block, bash):
      ```
      if gh release view "${GITHUB_REF_NAME}" >/dev/null 2>&1; then
        gh release edit "${GITHUB_REF_NAME}" --notes-file body.md
      else
        gh release create "${GITHUB_REF_NAME}" \
          --title "OpenWhispr Server Chart ${GITHUB_REF_NAME}" \
          --notes-file body.md \
          ".cr-release-packages/openwhispr-server-${{ steps.tag.outputs.value }}.tgz"
      fi
      ```
    - `env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }` — `gh` CLI is preinstalled on `ubuntu-24.04`.

    Workflow-level `permissions.contents: write` (line 22) is already set — no permission change needed.

    DO NOT touch the `release` job (monolith, gated on `v*` — would conflict with create-image-release in release.yml if we let it create a Release on the same v* tag; mitigation: monolith `release` job does NOT currently call action-gh-release, chart-releaser-action with `skip_existing: true` will skip creating a Release for the monolith chart since the v* tag's Release will already exist from create-image-release in release.yml. Cross-workflow timing: both workflows fire on `v*` push; `release.yml::create-image-release` waits on 6-image matrix; `helm-release.yml::release` runs chart-releaser immediately. Whichever finishes first creates the Release; the second sees it and either skips or overwrites the body. **Risk**: monolith chart-releaser-action might overwrite our image-release body. Mitigation: monolith chart is yanked, but to be safe, document the ordering in a comment on `create-image-release.if` — note "may race with helm-release.yml monolith release job on v* tags; monolith chart is yanked so this is acceptable; if monolith race becomes a problem, gate monolith release job on a separate tag prefix in a future change.")
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && yq '.jobs.release-server.steps[-1].name' .github/workflows/helm-release.yml | grep -qi "release" && yq '.jobs.release-server.steps[-2].name' .github/workflows/helm-release.yml | grep -qi body && grep -c "gh release edit\|gh release create" .github/workflows/helm-release.yml | grep -q "^[12]$" && echo OK</automated>
  </verify>
  <done>`release-server` job has two new trailing steps (build body, publish body) with create-if-not-exists guard. The `release` (monolith) job is unchanged. Workflow YAML parses. `actionlint` clean. `gh release edit` and `gh release create` both reference `${GITHUB_REF_NAME}` (not a literal tag).</done>
</task>

<task type="auto">
  <name>Task 3: Bump chart metadata to 1.0.13 + appVersion 1.0.10</name>
  <files>charts/openwhispr-server/Chart.yaml, charts/openwhispr-server/values.yaml</files>
  <action>
    Chart.yaml (line 17): `version: 1.0.12` → `version: 1.0.13`
    Chart.yaml (line 18): `appVersion: "1.0.9"` → `appVersion: "1.0.10"`

    values.yaml (line 128): `tag: "1.0.9"` → `tag: "1.0.10"`

    values.yaml: prepend a lineage comment block to the existing image-tag lineage chain (the block currently documenting chart 1.0.7 / 1.0.6 around lines 22-49 and 121-128). Add at the top of that chain:

    ```
      # Chart 1.0.13 + image v1.0.10 — workflow-only release: GitHub
      # Releases page now surfaces a Release object per image tag (v*) with
      # multi-arch pull commands for all 6 GHCR images + paired-chart xref,
      # AND enriches the chart-tag (openwhispr-server-*) Release body with
      # helm pull / install snippets + paired-image xref. NO runtime
      # behavior change vs v1.0.9 — same realtime ?language= query +
      # REALTIME_DEFAULT_LANGUAGE env fallback, same DB schema, same wire
      # surface. Tagging this revision exists solely to fire the modified
      # workflows in CI and verify the Release page output end-to-end.
      # See .planning/quick/260526-pxb-release-page-image-chart-visibility/.
    ```

    Place this block immediately above the existing "Chart 1.0.12 + image v1.0.9" lineage comment (preserve chronological order: newest at top, oldest below).
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && yq '.version' charts/openwhispr-server/Chart.yaml | grep -q "^1\.0\.13$" && yq '.appVersion' charts/openwhispr-server/Chart.yaml | grep -q "^1\.0\.10$" && grep -q 'tag: "1.0.10"' charts/openwhispr-server/values.yaml && grep -q "Chart 1.0.13 + image v1.0.10" charts/openwhispr-server/values.yaml && echo OK</automated>
  </verify>
  <done>Chart.yaml shows version 1.0.13 + appVersion 1.0.10. values.yaml shows tag "1.0.10" + new lineage comment block referencing this quick task slug. `helm lint charts/openwhispr-server` (locally) is green. `helm template charts/openwhispr-server` (with default values) is green and shows api image as `ghcr.io/yambr/openwhispr-api:1.0.10`.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    All 4 files edited. Workflow YAML parses. Chart metadata bumped to 1.0.13 / appVersion 1.0.10. Local `helm lint` + `helm template` green.
  </what-built>
  <how-to-verify>
    Pre-commit local checks (run from repo root, all should be green):
    1. `yq '.' .github/workflows/release.yml > /dev/null && echo "release.yml: YAML OK"`
    2. `yq '.' .github/workflows/helm-release.yml > /dev/null && echo "helm-release.yml: YAML OK"`
    3. `helm lint charts/openwhispr-server` — must be 0 chart(s) failed.
    4. `helm template test-release charts/openwhispr-server | grep "image:" | head -5` — must show `:1.0.10` everywhere.
    5. If `actionlint` is installed (`brew install actionlint` on macOS): `actionlint .github/workflows/release.yml .github/workflows/helm-release.yml` — must be silent.
    6. `git diff --stat` — must show exactly 4 files changed: 2 in `.github/workflows/`, 2 in `charts/openwhispr-server/`.
    7. `git diff charts/openwhispr-server/Chart.yaml` — confirm exactly 2 line edits (version + appVersion).

    If ALL green: type `approved` to proceed to commit + tag.
    If anything fails: describe and we'll fix before tagging.
  </how-to-verify>
  <resume-signal>Type "approved" to proceed to atomic commit + dual tag push, or describe issues.</resume-signal>
</task>

<task type="auto">
  <name>Task 5: Atomic commit + dual tag</name>
  <files>.git/refs/tags/v1.0.10, .git/refs/tags/openwhispr-server-1.0.13</files>
  <action>
    From repo root, after human-verify checkpoint approved:

    1. Stage exactly the 4 modified files (do NOT use `git add -A`):
       ```
       git add .github/workflows/release.yml \
               .github/workflows/helm-release.yml \
               charts/openwhispr-server/Chart.yaml \
               charts/openwhispr-server/values.yaml
       ```

    2. Verify staging:
       ```
       git status --short
       ```
       Must show exactly 4 `M` lines, nothing untracked staged.

    3. Commit (HEREDOC body):
       ```
       git commit -m "$(cat <<'EOF'
       ci(release): surface image (v*) + enrich chart (openwhispr-server-*) Releases (v1.0.10)

       Previously only `openwhispr-server-*` tags created GitHub Release
       objects (via helm/chart-releaser-action's built-in Release create),
       with bodies showing only the raw Chart.yaml description and the
       chart .tgz attached. `v*` image tags created NO Release object at
       all — `gh release view v1.0.8` returned 404, leaving operators
       no single-page discovery for which 6 GHCR images shipped in any
       given image release.

       This patch:

       - release.yml: new `create-image-release` job (needs build-image,
         fires only on tags/v* push, NOT workflow_dispatch) that calls
         softprops/action-gh-release@v2 with an explicit body enumerating
         multi-arch pull commands for all 6 images (api, web, worker,
         test-probe, postgres-17-pgpartman, cnpg-postgres-17-pgpartman),
         the pg-variant :<pg_minor>-<version> extra tags, GHCR packages
         link, and a paired-chart-tag xref. Job-level
         `permissions: { contents: write }` (workflow-level stays
         `contents: read` for minimum blast radius).

       - helm-release.yml release-server: appended two steps after
         chart-releaser-action that build an enriched body.md (helm pull
         + helm install snippets, paired-image-tag xref, operator
         runbook link) and either `gh release edit` if chart-releaser
         already created the Release, or `gh release create` with the
         .tgz attached as a create-if-not-exists fallback. Monolith
         `release` job (yanked chart) untouched.

       - Chart.yaml + values.yaml: bump chart to 1.0.13, appVersion to
         1.0.10, image.tag to 1.0.10. NO runtime behavior change vs
         v1.0.9 — same realtime ?language= query + REALTIME_DEFAULT_LANGUAGE
         env fallback shipped 2026-05-26 in a4eed5ba. This bump exists
         solely to fire the modified workflows and verify end-to-end.

       Forward-only — does NOT backfill Release objects for v1.0.3..v1.0.9.
       Past tag URLs continue to 404; acknowledged scope cut.

       See .planning/quick/260526-pxb-release-page-image-chart-visibility/PLAN.md.
       EOF
       )"
       ```

    4. Verify commit landed:
       ```
       git log --oneline -1
       ```
       Must show the new SHA with the `ci(release):` subject line.

    5. Capture the commit SHA:
       ```
       SHA=$(git rev-parse HEAD)
       echo "Tagging SHA: ${SHA}"
       ```

    6. Tag BOTH on the same SHA (lightweight tags — repo convention; check `git tag -l 'v*' | head -3` and `git for-each-ref refs/tags/v1.0.9` to confirm whether prior releases used annotated `-a` or lightweight; match the convention). Standard pattern:
       ```
       git tag v1.0.10 "${SHA}"
       git tag openwhispr-server-1.0.13 "${SHA}"
       ```

    7. Verify both tags resolve to the same SHA:
       ```
       git rev-parse v1.0.10
       git rev-parse openwhispr-server-1.0.13
       ```
       Both lines must output the identical SHA captured in step 5.

    8. DO NOT PUSH YET. Push is a separate operator decision (next checkpoint).
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && git log --oneline -1 | grep -q "ci(release): surface image" && git rev-parse v1.0.10 > /tmp/sha-img.txt && git rev-parse openwhispr-server-1.0.13 > /tmp/sha-chart.txt && diff -q /tmp/sha-img.txt /tmp/sha-chart.txt && git rev-parse v1.0.10 | xargs -I{} git rev-parse {} | grep -q "$(git rev-parse HEAD)" && echo OK</automated>
  </verify>
  <done>Single commit with `ci(release):` subject on HEAD. Both `v1.0.10` and `openwhispr-server-1.0.13` tags exist locally, resolve to the same SHA, and that SHA matches HEAD. Working tree clean (`git status --short` empty). No push yet.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Atomic commit on HEAD. Two tags on the same SHA, locally. Working tree clean.
  </what-built>
  <how-to-verify>
    1. `git log --oneline -1` — shows new SHA + `ci(release): surface image (v*) + enrich chart...`
    2. `git tag --points-at HEAD` — outputs exactly two lines: `openwhispr-server-1.0.13` and `v1.0.10`.
    3. `git status --short` — empty.
    4. Confirm you actually want to push BOTH tags + main right now (this fires `release.yml` for ~25 min on 6 multi-arch images, AND `helm-release.yml` release-server job, AND helm-release.yml monolith `release` job which may race — see Task 2 note on monolith race).

    If approved, the next step pushes:
    ```
    git push origin main
    git push origin v1.0.10
    git push origin openwhispr-server-1.0.13
    ```
    (Push in this order: main first so the commit reaches origin before tags reference it; tags second/third.)
  </how-to-verify>
  <resume-signal>Type "push" to push main + both tags, "hold" to keep local-only for review, or describe issues.</resume-signal>
</task>

<task type="auto">
  <name>Task 7: Push main + both tags + post-CI verification</name>
  <files>(origin refs only)</files>
  <action>
    Conditional on the prior checkpoint resolving to "push":

    1. Push main first (the commit ref must exist on origin before tags reference it):
       ```
       git push origin main
       ```

    2. Push the image tag:
       ```
       git push origin v1.0.10
       ```
       This fires both `release.yml` (6-image matrix → create-image-release job) AND `helm-release.yml` monolith `release` job (yanked chart, may fail or skip silently).

    3. Push the chart tag:
       ```
       git push origin openwhispr-server-1.0.13
       ```
       This fires `helm-release.yml` `release-server` job → chart-releaser-action creates Release with .tgz → our new `gh release edit` step overwrites body with enriched content.

    4. Wait for both workflows to complete. Track via:
       ```
       gh run watch --exit-status $(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
       gh run watch --exit-status $(gh run list --workflow=helm-release.yml --limit 1 --json databaseId -q '.[0].databaseId')
       ```

    5. Post-CI verification (R1, R2, R3 catch-all):
       a. `gh release view v1.0.10 --json name,body,assets | jq` — must return a Release with:
          - `name == "OpenWhispr Server v1.0.10"`
          - `body` contains "Multi-architecture (amd64 + arm64)" and 6 pull commands
          - `assets == []` (no .tgz on image release — images live in GHCR)
       b. `gh release view openwhispr-server-1.0.13 --json name,body,assets | jq` — must return a Release with:
          - `body` contains "`helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version 1.0.13`" and a link to `/releases/tag/v1.0.10`
          - `assets` includes `openwhispr-server-1.0.13.tgz`
       c. `docker manifest inspect ghcr.io/yambr/openwhispr-api:1.0.10` — confirms multi-arch manifest published (linux/amd64 + linux/arm64).
       d. `helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version 1.0.13 --destination /tmp` — pulls successfully; `tar -xzOf /tmp/openwhispr-server-1.0.13.tgz openwhispr-server/Chart.yaml | yq '.appVersion'` returns `"1.0.10"`.

    6. If any verification fails, capture failure in `.planning/quick/260526-pxb-release-page-image-chart-visibility/POST-MORTEM.md` and pause; do NOT silently rerun.
  </action>
  <verify>
    <automated>gh release view v1.0.10 --json name 2>/dev/null | jq -r .name | grep -q "OpenWhispr Server v1.0.10" && gh release view openwhispr-server-1.0.13 --json body 2>/dev/null | jq -r .body | grep -q "helm pull oci://ghcr.io/yambr/charts/openwhispr-server" && docker manifest inspect ghcr.io/yambr/openwhispr-api:1.0.10 > /dev/null && echo OK</automated>
  </verify>
  <done>Both Releases exist on GitHub with the expected names + bodies. `ghcr.io/yambr/openwhispr-api:1.0.10` manifest is multi-arch. `helm pull` for chart 1.0.13 succeeds and the pulled chart's appVersion is 1.0.10. SUMMARY.md authored at `.planning/quick/260526-pxb-release-page-image-chart-visibility/SUMMARY.md` recording all SHAs, run URLs, and verification commands.</done>
</task>

</tasks>

## Body templates

### Image Release body (release.yml `create-image-release` writes this to body.md)

The executor MUST write this exact template via heredoc, with `${VERSION}` = `${{ steps.tag.outputs.value }}` (the v-stripped version) and `${CHART_APPVER}` = output of `yq '.appVersion' charts/openwhispr-server/Chart.yaml` at checkout time. Computed chart version for the paired link is NOT trivially available (chart version is bumped independently); for the paired-chart xref, link to the search filter rather than a specific tag:

```markdown
# OpenWhispr Server v${VERSION}

Self-hosted OpenWhispr backend — see [README](https://github.com/Yambr/openwhispr-server#readme) and [operations runbook](https://github.com/Yambr/openwhispr-server/blob/main/docs/operations.md).

## Container images

All 6 images are published to **GHCR** (multi-architecture: `linux/amd64` + `linux/arm64`, provenance + SBOM attached).

```bash
docker pull ghcr.io/yambr/openwhispr-api:${VERSION}
docker pull ghcr.io/yambr/openwhispr-web:${VERSION}
docker pull ghcr.io/yambr/openwhispr-worker:${VERSION}
docker pull ghcr.io/yambr/openwhispr-test-probe:${VERSION}
docker pull ghcr.io/yambr/openwhispr-postgres-17-pgpartman:${VERSION}        # also tagged :17.5-${VERSION}
docker pull ghcr.io/yambr/openwhispr-cnpg-postgres-17-pgpartman:${VERSION}   # also tagged :17.6-${VERSION}
```

Browse all OpenWhispr packages: <https://github.com/Yambr?tab=packages&q=openwhispr->

## Helm chart

The matching chart release is published separately on tag `openwhispr-server-<chart-version>` and pulls these images by default. See [chart releases](https://github.com/Yambr/openwhispr-server/releases?q=openwhispr-server-) for the chart version that pins image `${VERSION}` as its `appVersion`.

```bash
helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version <chart-version>
```

## Install

See [docs/operations.md](https://github.com/Yambr/openwhispr-server/blob/main/docs/operations.md) for the canonical installation runbook (single-VM docker-compose, Kubernetes Helm, and corporate-LiteLLM override).
```

### Chart Release body (helm-release.yml `release-server` writes this to body.md, overwriting chart-releaser's default)

`${CHART_VERSION}` = `${{ steps.tag.outputs.value }}` (the openwhispr-server-stripped version). `${APP_VERSION}` = output of `yq '.appVersion' charts/openwhispr-server/Chart.yaml` at checkout time.

```markdown
# OpenWhispr Server Chart openwhispr-server-${CHART_VERSION}

Helm chart for the OpenWhispr Server backend. Ships api/web/worker Deployments, migrate Job, ConfigMap, ServiceAccount. BYOK-first — Postgres / Valkey / S3 / SMTP / LiteLLM / OAuth provided as externally-managed Kubernetes Secrets.

## Pinned image version

This chart pins image **`v${APP_VERSION}`** as its default `appVersion`. See the matching [image release v${APP_VERSION}](https://github.com/Yambr/openwhispr-server/releases/tag/v${APP_VERSION}) for the GHCR pull commands of all 6 images.

## Pull the chart

```bash
helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version ${CHART_VERSION}
```

## Install (BYOK example)

```bash
helm install openwhispr \
  oci://ghcr.io/yambr/charts/openwhispr-server \
  --version ${CHART_VERSION} \
  --namespace openwhispr --create-namespace \
  --values your-values.yaml
```

See [docs/operations.md](https://github.com/Yambr/openwhispr-server/blob/main/docs/operations.md) for the full operator runbook (Secret prerequisites, ingress wiring, cert-manager, observability, corporate-LiteLLM override).

## Chart contents

This Release page exposes the packaged chart as `openwhispr-server-${CHART_VERSION}.tgz` (asset below). The same artifact lives in **GHCR OCI** at `oci://ghcr.io/yambr/charts/openwhispr-server:${CHART_VERSION}` — prefer `helm pull` over the .tgz attachment for production use.
```

## Verification checklist

### Pre-commit (local, before any push)

- [ ] `yq '.' .github/workflows/release.yml > /dev/null` — YAML parses
- [ ] `yq '.' .github/workflows/helm-release.yml > /dev/null` — YAML parses
- [ ] `yq '.jobs.create-image-release.needs' .github/workflows/release.yml` returns `[build-image]`
- [ ] `yq '.jobs.create-image-release.permissions.contents' .github/workflows/release.yml` returns `write`
- [ ] `yq '.jobs.release-server.steps | length' .github/workflows/helm-release.yml` is 2 more than pre-edit count
- [ ] `helm lint charts/openwhispr-server` — 0 chart(s) failed
- [ ] `helm template test charts/openwhispr-server | grep "image:.*openwhispr-api"` contains `:1.0.10`
- [ ] `actionlint .github/workflows/release.yml .github/workflows/helm-release.yml` (if installed) — silent
- [ ] `git diff --stat` shows exactly the 4 expected files
- [ ] No accidental edits to `apps/**`, `packages/**`, or `tests/**` (`git diff --name-only | grep -E '^(apps|packages|tests)/' | wc -l` returns 0)
- [ ] Lefthook pre-commit hooks pass (gitleaks does not flag — no real credentials introduced)

### Post-tag-push (after Task 7)

- [ ] `gh release view v1.0.10` returns a Release object (not 404)
- [ ] Body of `v1.0.10` Release contains all 6 image pull commands
- [ ] Body of `v1.0.10` Release contains the multi-arch note
- [ ] Body of `v1.0.10` Release contains the paired-chart-tag xref link
- [ ] `gh release view openwhispr-server-1.0.13` returns a Release object with .tgz asset
- [ ] Body of `openwhispr-server-1.0.13` Release contains `helm pull` one-liner
- [ ] Body of `openwhispr-server-1.0.13` Release contains link to `/releases/tag/v1.0.10`
- [ ] Body of `openwhispr-server-1.0.13` Release contains `helm install` snippet
- [ ] `docker manifest inspect ghcr.io/yambr/openwhispr-api:1.0.10` shows linux/amd64 + linux/arm64
- [ ] `helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version 1.0.13` succeeds
- [ ] Pulled chart's `Chart.yaml` shows `appVersion: "1.0.10"`

## Risk register

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | `softprops/action-gh-release` requires `contents: write`; current workflow-level is `contents: read`. | Add `permissions: { contents: write }` at JOB level only (`create-image-release`), not workflow-level — minimum blast radius; existing `build-image` matrix keeps `contents: read`. |
| **R2** | `softprops/action-gh-release` major-version pin matches floating-major convention (`@v2`) — must not SHA-pin in violation of repo style. | Confirmed by grep: `actions/checkout@v4`, `docker/build-push-action@v7`, etc. all use floating major. `@v2` it is. |
| **R3** | `gh release edit` for chart Release relies on chart-releaser-action having created the Release first. If chart-releaser ever changes behavior, edit fails on missing Release. | Use create-if-not-exists guard: `gh release view` ? `gh release edit` : `gh release create --notes-file body.md '*.tgz'`. Belt + suspenders. |
| **R4** | body.md template variable expansion across multiple steps — `${{ github.ref_name }}`, `${{ steps.tag.outputs.value }}`, and `yq`-extracted `appVersion` from Chart.yaml. | Use a single `Build body.md` step that does ALL expansion via shell vars in one heredoc (not split across multiple steps); `yq` reads Chart.yaml at runtime (works because `actions/checkout` precedes it). |
| **R5** | If a future operator runs `chart-releaser` standalone (outside this workflow), our `gh release edit` is a one-shot. | Acceptable — the operator-runbook + workflow ARE the contract; ad-hoc standalone chart-releaser runs are out of band. |
| **R6** | At chart-release time, the paired image-release page may not exist yet (chart tag often pushed AFTER image tag). | Operator workflow is documented: push v-tag first, then push chart-tag. If reversed, chart body link 404s until image release lands. Acceptable transient state. |
| **R7** | Past Releases for v1.0.3..v1.0.9 do NOT get backfilled — those URLs continue to 404. | Acknowledged scope cut. Document in SUMMARY.md so users searching for old image versions know to navigate to GHCR packages directly. |
| **R8** | Monolith `release` job in helm-release.yml also fires on `v*` tags. May race with `create-image-release` in release.yml for the SAME Release object on the v* tag. | Monolith chart is yanked (Chart.yaml:11-13 comment confirms). `helm/chart-releaser-action` with `skip_existing: true` skips if Release already exists. `create-image-release` finishes AFTER 6-image matrix (~25 min); monolith chart-releaser runs immediately on tag push (~2 min). Therefore monolith chart-releaser fires FIRST and may create the v* Release with monolith-chart body; then create-image-release fires and softprops/action-gh-release@v2 **overwrites the body** (default behavior is `update` on existing tag). Outcome: image-release body wins on v*. Verified expected behavior; if it regresses, gate monolith release job on a separate tag prefix in a future change. |
| **R9** | Lefthook pre-commit gitleaks hook flags body templates that include literal-looking tokens (e.g., the example `:17.6-${VERSION}` tag could look like a Bearer token to a paranoid scanner). | Body templates contain ONLY `ghcr.io/...:X.Y.Z` image refs and `helm pull oci://...` commands — no `sk-…`, `Bearer ey…`, `AKIA…`, UUID literals, or env-var-named secrets. gitleaks WILL NOT fire. Verified by mental grep against `.gitleaks.toml` defaults. If a false positive occurs, extend allowlist + regression assertion per CLAUDE.md rule §4 — NEVER `--no-verify`. |

## Out-of-scope deferrals

- Backfill of Release objects for `v1.0.3..v1.0.9` — not in this patch.
- Replacing chart-releaser-action with explicit softprops/action-gh-release in `release-server` — Option B; rejected in favor of Option A (less disruptive).
- Phase 63/64 work, monolith `release` job retirement, `charts/openwhispr/` yank cleanup — separate concerns.
- `apps/api/package.json` version bump — confirmed placeholder, not consumed by image-build pipeline.
- Tagging scheme redesign — `v*` + `openwhispr-server-*` split is the established contract.
- Release-body internationalization (en + ru) — runtime localization rule does not extend to GitHub Release body markdown (operator-facing, English-only per source-artifact rule).

## Operator post-merge runbook

After the atomic commit lands on local main (post Task 5 + Task 6 approval):

```bash
# Push commit + both tags (in this order — main first so tags resolve)
git push origin main
git push origin v1.0.10
git push origin openwhispr-server-1.0.13

# Watch both workflows complete
gh run watch --exit-status $(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch --exit-status $(gh run list --workflow=helm-release.yml --limit 1 --json databaseId -q '.[0].databaseId')

# Verify image Release
gh release view v1.0.10 --web

# Verify chart Release
gh release view openwhispr-server-1.0.13 --web

# Verify images are pullable
docker manifest inspect ghcr.io/yambr/openwhispr-api:1.0.10
docker manifest inspect ghcr.io/yambr/openwhispr-cnpg-postgres-17-pgpartman:17.6-1.0.10

# Verify chart is pullable + correct appVersion
helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version 1.0.13 --destination /tmp
tar -xzOf /tmp/openwhispr-server-1.0.13.tgz openwhispr-server/Chart.yaml | yq '.appVersion'
# Expected output: "1.0.10"
```

If `gh release view` returns 404 for `v1.0.10` after release.yml completes green: the `create-image-release` job either skipped (check `if:` expression evaluation) or `softprops/action-gh-release@v2` failed silently due to missing `contents: write` permission. Open the run log; fix forward in a follow-up commit; do NOT silently rerun without diagnosing.

## Tagging discipline

- ONE atomic commit (`ci(release): surface image (v*) + enrich chart (openwhispr-server-*) Releases (v1.0.10)`).
- TWO lightweight tags on the SAME SHA: `v1.0.10` (image release trigger) + `openwhispr-server-1.0.13` (chart release trigger).
- Push order: `main` first, then `v1.0.10`, then `openwhispr-server-1.0.13`.
- DO NOT use `--no-verify` on either commit or push — lefthook hooks (pre-commit gitleaks + pre-push gitleaks) MUST run; per CLAUDE.md rule §4 they are defense-in-depth, never bypassed.
- DO NOT use `--amend` on the commit — if anything is wrong post-checkpoint, create a NEW commit per CLAUDE.md §3.

<verification>
Phase verification = post-tag-push checklist (Verification section above). Live evidence (Release pages on GitHub, GHCR manifest inspect, helm pull) is the canonical proof; the orchestrator MUST re-run those `gh` + `docker` + `helm` commands with their own eyes (per CLAUDE.md §3 trust-but-verify rule) before declaring done. Sub-agent claims like "✅ workflows green" are INPUT, not proof.
</verification>

<success_criteria>
- `gh release view v1.0.10` returns a Release with the image-release body template content (multi-arch note, 6 pull commands, paired-chart xref).
- `gh release view openwhispr-server-1.0.13` returns a Release with the enriched chart-release body template content (helm pull, helm install, paired-image xref) AND the .tgz asset attached.
- `docker manifest inspect ghcr.io/yambr/openwhispr-api:1.0.10` returns a multi-arch manifest (linux/amd64 + linux/arm64).
- `helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version 1.0.13` succeeds; pulled chart's `appVersion` is `"1.0.10"`.
- Working tree clean post-push (`git status --short` empty).
- Past `v1.0.3..v1.0.9` Release URLs still 404 (acknowledged — out of scope).
- ZERO edits in `apps/**`, `packages/**`, `tests/**`, `compose/**` (verified by `git show --name-only HEAD | grep -E '^(apps|packages|tests|compose)/' | wc -l` returning 0).
- Lefthook gitleaks hooks pass on both pre-commit and pre-push (no `--no-verify`).
</success_criteria>

<output>
After completion, create `.planning/quick/260526-pxb-release-page-image-chart-visibility/SUMMARY.md` recording:
- Atomic commit SHA (link to `https://github.com/Yambr/openwhispr-server/commit/<sha>`)
- Both tag refs + Release URLs (`https://github.com/Yambr/openwhispr-server/releases/tag/v1.0.10` and `.../tag/openwhispr-server-1.0.13`)
- Workflow run URLs (release.yml + helm-release.yml run IDs)
- Verification command outputs (one block per item in post-tag-push checklist)
- Any deviations from this PLAN.md (e.g., if the `release` monolith job actually died on the v* tag and required additional handling — capture root cause + decision)
- Forward-pointer to the next operator step (none — this is a self-contained quick patch)
</output>
