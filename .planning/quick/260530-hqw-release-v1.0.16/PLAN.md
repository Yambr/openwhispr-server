---
quick_id: 260530-hqw
slug: release-v1.0.16
date: 2026-05-30
status: in-progress
---

# Quick Task: Release v1.0.16 (Phase 69 SSO JIT)

## Goal

Cut the `v1.0.16` application release shipping Phase 69 (OIDC SSO JIT
provisioning + live-Keycloak e2e, merged to main as `01ae86b7` / PR #38).

The release pipeline is fully automated: pushing a `vX.Y.Z` lightweight tag
triggers `.github/workflows/release.yml`, which builds 6 multi-arch GHCR
images (`:1.0.16`) and creates the GitHub Release via
`softprops/action-gh-release@v2`.

User chose **patch bump** (v1.0.16), following the established 1.0.x cadence
(v1.0.6 → v1.0.15 were all patches, including feature work).

## Convention (mirrors release commit `ba9f5272`, the v1.0.15 release)

Chart-YAML-only change on `charts/openwhispr-server`:
1. `Chart.yaml`: `version` 1.0.18 → 1.0.19, `appVersion` "1.0.15" → "1.0.16"
2. `values.yaml`: image default `tag` "1.0.15" → "1.0.16"
3. `values.yaml`: add a `1.0.16` changelog note to the image block

Then: merge to main (branch protection requires PR; required checks =
lint + typecheck), then push lightweight tag `v1.0.16` on the merge commit.

## Scope

- NO application source change (Phase 69 source is already on main).
- Chart YAML only — same posture as every prior release bump.

## Verification

- `helm lint charts/openwhispr-server` green.
- PR required checks (lint + typecheck) green → merge.
- Tag `v1.0.16` pushed → Release workflow builds images + creates release.
- Independently verify: `gh release view v1.0.16` exists; GHCR `:1.0.16`
  images published; workflow run succeeded.
