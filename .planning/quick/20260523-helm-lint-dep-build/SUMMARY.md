---
slug: helm-lint-dep-build
created: 2026-05-23
completed: 2026-05-23
status: complete
---

# Summary — `helm dependency build` step in helm-lint workflow

## What

`helm-lint` workflow was failing on main with "missing in charts/ directory: valkey, minio, cert-manager" — Chart.yaml declares 3 OCI sub-chart deps but the workflow never resolved them before `helm lint`.

## Fix

Added `helm dependency build charts/openwhispr` step to `.github/workflows/helm-lint.yml` between the secret-generation step and `helm lint`.

YAML validated. No permissions change.

## Files

- `.github/workflows/helm-lint.yml` — +6 lines

## Commit

`0594a6d5` — `ci(helm-lint): add helm dependency build step before helm lint`
