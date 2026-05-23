---
slug: helm-lint-dep-build
created: 2026-05-23
status: planned
---

# Quick: add `helm dependency build` step to `helm-lint` workflow

## Problem

The `helm-lint` workflow on main (run 26328041150 on `360e740c`) failed:

```
Error: An error occurred while checking for chart dependencies. You may need
to run `helm dependency build` to fetch missing dependencies: found in
Chart.yaml, but missing in charts/ directory: valkey, minio, cert-manager
```

`charts/openwhispr/Chart.yaml` declares 3 OCI sub-chart deps:
- `valkey` 5.6.5 (Bitnami)
- `minio` 17.0.21 (Bitnami)
- `cert-manager` 1.16.4

On a fresh CI checkout `charts/openwhispr/charts/` is empty; `helm lint` and `helm template` both require deps resolved on disk before render.

## Fix

Insert a `helm dependency build charts/openwhispr` step between `Generate ephemeral CI secrets` and `helm lint` in `.github/workflows/helm-lint.yml`.

## Files

- `.github/workflows/helm-lint.yml` — +6 lines

## Acceptance

- YAML parses
- Next CI run on `helm-lint` reaches the `helm lint` step (no longer aborts on missing-deps)
