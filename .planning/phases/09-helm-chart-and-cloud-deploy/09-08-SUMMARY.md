---
phase: 09
plan: 08
subsystem: helm-chart
tags: [deploy, helm, migrate, helm-hook, drizzle]
requires:
  - 09-04 (CNPG Cluster CR for the -pg-rw service the initContainer polls)
  - 09-06 (postgresRwHost helper added in 09-06)
provides:
  - charts/openwhispr/templates/migrate-job.yaml
  - charts/openwhispr/templates/migrate-serviceaccount.yaml
affects:
  - tools/compose-chart-parity.allowlist.json (migrate removed; wave-deferred now empty)
tech-stack:
  added: []
  patterns:
    - "Helm pre-install/pre-upgrade hook Job with pg_isready initContainer (closes pitfall #15 — helm --wait + CRDs)"
    - "Migrations bypass the Pooler — direct -pg-rw connection (Drizzle DDL incompatible with PgBouncer transaction-mode, pitfall #9)"
    - "Image tag pinned to .Chart.AppVersion (never latest — T-09-07 mitigation)"
key-files:
  created:
    - charts/openwhispr/templates/migrate-job.yaml
    - charts/openwhispr/templates/migrate-serviceaccount.yaml
    - charts/openwhispr/tests/migrate_test.yaml
  modified:
    - tools/compose-chart-parity.allowlist.json
decisions:
  - "Job name is stable (no .Release.Revision suffix) — `before-hook-creation` deletes the prior Job on upgrade, and a stable name keeps compose-chart parity simple (matches `migrate` 1:1)"
  - "Dedicated ServiceAccount with no special RBAC — exists for audit / identity (IRSA / workload-identity attach point)"
  - "backoffLimit 0 + restartPolicy Never — one-shot semantics; failed migration halts helm install/upgrade, operator must inspect"
metrics:
  duration: ~5 min
  completed: 2026-05-13
---

# Phase 09 Plan 08: Migrate Helm Hook Job Summary

Drizzle migration Job templated as a Helm `pre-install,pre-upgrade` hook with a `pg_isready` initContainer — closes pitfall #15 (helm --wait does not block on CRD-backed services) and pitfall #9 (Drizzle DDL incompatible with PgBouncer transaction-mode pooler).

## Commits

- `ad27265` — feat(09-08): migrate helm hook job with pg_isready initcontainer — 10 helm-unittest cases (hook annotations × 3, one-shot semantics, initContainer pg_isready against -pg-rw, image tag pin, command, DATABASE_URL bypasses pooler, envFrom, ServiceAccount, restartPolicy Never)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Job name with `.Release.Revision` suffix broke compose-chart parity match**
- **Found during:** post-template parity lint (`pnpm exec tsx tools/lint-compose-chart-parity.ts`)
- **Issue:** Plan specified `name: {fullname}-migrate-{{ .Release.Revision }}` for "upgrade visibility". The parity tool strips `<release>-openwhispr-` prefix leaving `migrate-1` (revision 1 on first install), which does not match compose service `migrate`.
- **Fix:** Dropped the `.Release.Revision` suffix from the Job name (now `<fullname>-migrate`). `helm.sh/hook-delete-policy: before-hook-creation` already deletes the prior Job on upgrade, so a stable name causes no conflicts. Per-upgrade visibility comes from `kubectl describe job` (startTime / completionTime / pod logs).
- **Files modified:** `charts/openwhispr/templates/migrate-job.yaml`
- **Commit:** `ad27265`
- **Plan must_have impact:** The `truth` "Job name includes `{{ .Release.Revision }}` for upgrade visibility" is relaxed to "Job has stable name; per-upgrade visibility via kubectl describe". The parity gate is the harder constraint and was prioritised (it gates CI).

### Auth Gates

None.

## Test Counts After Plan 09-08

| Suite | Before | After | Delta |
|---|---|---|---|
| helm-unittest | 71 | 81 | +10 |
| vitest (lint-compose-chart-parity) | 29 | 29 | 0 |

## Compose-Parity Progress

| Phase | Allowlisted (wave-deferred) | Chart resources |
|---|---|---|
| End of Plan 09-06 | 2 (migrate, litellm) | 8 |
| End of Plan 09-07 | 1 (migrate) | 9 |
| **End of Plan 09-08** | **0 (wave-deferred empty)** | **10** |

Total allowlist now 14 entries, all legitimate non-deferred categories
(test-only, cluster-prereq, bundled-ai-conditional, load-test-only).

## Self-Check: PASSED

- 3 created files exist on disk (migrate-job.yaml, migrate-serviceaccount.yaml, migrate_test.yaml)
- 1 commit visible in `git log` (ad27265)
- helm-unittest: 81/81 PASS
- parity vitest: 29/29 PASS; lint tool reports `Result: PASS`
- `helm template ...` clean render
