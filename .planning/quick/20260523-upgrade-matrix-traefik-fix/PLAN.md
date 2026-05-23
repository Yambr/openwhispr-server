---
slug: upgrade-matrix-traefik-fix
status: in-progress
created: 2026-05-23
description: Fix helm-upgrade-matrix CI failure — traefik install hits 5m timeout AND diagnostic step is broken
---

# Plan: upgrade-matrix-traefik-fix

## Problem

`helm-upgrade-matrix.yml` CI job fails consistently:
1. `helm upgrade --install traefik traefik/traefik --wait --timeout 5m` exits with `Error: context deadline exceeded` after exactly 5 minutes (run 26331965866, job 77519410532).
2. The post-failure diagnostic step at `helm-upgrade-matrix.yml:158` runs `kubectl -n openwhispr describe pods` — but Traefik installs to namespace `traefik`, not `openwhispr`. So we have **zero kubectl evidence** of what blocks the Traefik pod.

Without (2), we cannot root-cause (1).

## Root-cause hypothesis (unverified — needs (2))

`Error: context deadline exceeded` after 5min in `helm install --wait` means pods never reach Ready. Plausible causes:
- Image pull stall (kind cluster, slow registry, or pull-secret missing)
- Webhook init crashloop (Traefik 3 chart 32.1.1 admission webhooks)
- ServiceAccount/RBAC missing
- Wrong `wsrealtime` port collision with kind's NodePort range
- `kubernetesCRD` provider waiting for CRDs that never install

Cannot pick without `kubectl describe pods -n traefik` + `kubectl events -n traefik`.

## Approach

Two atomic commits:

### Commit 1: fix diagnostic step (makes #2 actionable)
- Edit `.github/workflows/helm-upgrade-matrix.yml` "Helm install N-1 / Probe N-1 / Helm upgrade to HEAD chart" failure-diagnostic blocks.
- Replace `kubectl -n openwhispr describe pods` with a multi-namespace dump covering `openwhispr`, `traefik`, `cert-manager`, `cnpg-system`.
- Add `kubectl -n <ns> get events --sort-by='.lastTimestamp'` for each namespace.
- Add `kubectl -n <ns> logs --all-containers --tail=200 --prefix=true` for traefik + cert-manager pods.
- Keep `if: failure()` gating — only runs on red.

### Commit 2: actual traefik root-cause fix (decided after seeing commit-1 logs)
- Push a no-op trigger (or wait for next dependabot bump) → CI runs → diagnostic dump now shows the real pod failure.
- Apply minimal config fix based on actual evidence (e.g., bump `--timeout 10m` if it's just slow image pull on a cold kind cluster; pin chart subver; tweak `traefik-values.yaml`; etc.).
- NOT a blind `--timeout 10m` bump — only after the diagnostic step proves slowness IS the actual cause vs a crash loop or webhook failure.

## Out of scope

- The other 2 red CI jobs (#6 smoke api unhealthy, #7 test 10 integration regressions). Tracked separately in task list.
- Adjusting Traefik chart version or migrating to v33 — would mask the diagnostic blind spot.

## Acceptance

- `kubectl describe pods -n traefik` output visible in CI artifact on any future helm-upgrade-matrix red.
- `helm-upgrade-matrix.yml` CI run on main turns GREEN.
