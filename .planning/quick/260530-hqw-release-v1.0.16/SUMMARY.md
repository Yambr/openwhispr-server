---
quick_id: 260530-hqw
slug: release-v1.0.16
date: 2026-05-30
status: complete
commit: 13294999
---

# Summary: Release v1.0.16 (Phase 69 SSO JIT)

## What shipped

Cut the **v1.0.16** application release shipping Phase 69 (OIDC SSO
Just-In-Time provisioning + live-Keycloak e2e), merged to main as
`01ae86b7` (PR #38).

User chose **patch bump** (v1.0.16) following the established 1.0.x cadence
(v1.0.6 → v1.0.15 were all patches, including feature work).

## Changes (chart-YAML-only, mirrors v1.0.15 release commit `ba9f5272`)

- `charts/openwhispr-server/Chart.yaml`: `version` 1.0.18 → **1.0.19**,
  `appVersion` "1.0.15" → **"1.0.16"**
- `charts/openwhispr-server/values.yaml`: image default `tag` "1.0.15" →
  **"1.0.16"** + a 1.0.16 changelog note in the image block
- No application source change (Phase 69 source landed via #38).

## Execution trail

1. Verified PR #38 required checks (lint+typecheck) green on green main →
   merged PR #38 (squash `01ae86b7`).
2. Chart bump commit `13294999` on branch `chore/release-v1.0.16`;
   `helm lint` → 0 charts failed; commitlint pass.
3. Pre-push test-evidence gate fired (chart commit had no fragments yet) →
   ran `pnpm test:all` (NOT --no-verify, per CLAUDE.md hard-rule 4):
   **542 files / 6138 tests passed, 0 failed**; 23/23 evidence fragments
   `passed exit=0`. Re-pushed clean (gate ✅, gitleaks ✅).
4. PR #40 opened → required checks (lint+typecheck) SUCCESS → squash-merged
   (`ea12fc09`).
5. Pushed lightweight tag **`v1.0.16`** on `ea12fc09` → triggered
   `.github/workflows/release.yml` (run 26681189446).

## Release mechanics

Tag push → workflow builds 6 multi-arch (amd64+arm64, provenance+SBOM) GHCR
images `:1.0.16` + creates the GitHub Release via
`softprops/action-gh-release@v2`. Chart OCI publish is decoupled
(`helm-release.yml` on `openwhispr-server-<version>` tags) — same posture as
v1.0.15 (chart release cut separately when desired).

## Verification (own-eyes, all GREEN)

- [x] Release workflow run 26681189446 → **completed: success** (all 6
      build-image jobs + create-image-release green)
- [x] `gh release view v1.0.16` → published "OpenWhispr Server v1.0.16"
      (isDraft=false, isPrerelease=false),
      github.com/Yambr/openwhispr-server/releases/tag/v1.0.16
- [x] GHCR `ghcr.io/yambr/openwhispr-{api,web,worker,test-probe}:1.0.16`
      → all PUBLISHED, multi-arch (amd64+arm64) manifests confirmed via
      `docker manifest inspect`

**Status: Verified. Release v1.0.16 is fully out.**

## Follow-up logged (not part of this release)

While checking CI, found my prior `lint-migrations` fix (squawk pin
`2`→`2.55.0`, commit on PR #39) is GREEN locally but RED on CI: the
`main()` integration tests cold-fetch `npx squawk-cli@2.55.0` on the runner
and the 3 fixture tests get empty diagnostics (binary not warm) → exit 0
instead of 1. NON-required check (required = lint+typecheck only),
pre-existing flake. Proper fix (warm the squawk cache in the workflow
before the test step) deferred to its own quick-task — NOT claimed green.
