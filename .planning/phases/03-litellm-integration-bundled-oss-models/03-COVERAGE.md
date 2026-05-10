---
phase: 03-litellm-integration-bundled-oss-models
generated: 2026-05-10T20:25:00Z
docker_state: running (Docker Desktop 24.0.6, socket /Users/dev/.docker/run/docker.sock)
constitutional_floor: "90/90/90/90 on diff per .planning/DISCIPLINE.md rule 2"
---

# Phase 03 — Coverage Baseline (Stage A)

This is the FIRST honest coverage measurement of Phase 3. The original phase
verification reported "passing" without ever running `--coverage`. This file is
the audit trail required by `.planning/DISCIPLINE.md` rule 10.

## Per-package totals

| Package | Lines | Branches | Functions | Statements | Verdict |
|---|---:|---:|---:|---:|---|
| `packages/litellm-client` | **100.0** | **100.0** | **100.0** | **100.0** | PASS |
| `apps/worker` (Docker up) | 94.0 | 89.1 | 88.9 | 92.8 | FAIL — branches/functions < 90 |
| `apps/api` | 92.6 | 84.5 | 90.8 | 91.7 | FAIL — branches < 90 |
| `packages/data` (Docker up) | 74.1 | 48.1 | 85.7 | 73.2 | FAIL — heavy, mostly pre-Phase-3 debt |
| `packages/contract-tests` | (test-only package) | | | | n/a |

## Phase-3 files below 90/90/90/90 on any axis

These are the files Phase 3 created or modified that fail rule 2.
Each file gets a TDD back-fill in Stage B.

| File | L | B | F | S | Phase-3 origin |
|---|---:|---:|---:|---:|---|
| `apps/api/src/routes/diarization.ts` | 74 | 65 | 83 | 72 | Plan 03-06 (largest gap; status-code matrix not exercised end-to-end) |
| `apps/api/src/routes/test-only.ts` | 85 | 68 | 80 | 83 | Plan 03-10 (introspection seam added; under-tested) |
| `apps/worker/src/jobs/ingest-litellm-spend.ts` | 100* | 82 | 83 | 89 | Plan 03-08 (testcontainer integration covers happy path; error branches under-tested) |
| `apps/api/src/lib/pyannote-client.ts` | 100 | 80 | 100 | 100 | Plan 03-06 (a few error class branches uncovered) |
| `apps/api/src/routes/realtime.ts` | 100 | 75 | 100 | 100 | Plan 03-07 (auth pre-handler error branches) |
| `apps/api/src/routes/index.ts` | 100 | 88 | 100 | 100 | Plans 03-04..07 (conditional registration branches) |

(*lines metric for ingest-litellm-spend appears as 100 on the line axis but
branches/functions/statements remain below 90 — branch-level gating in vitest
v8 coverage is the binding axis here.)

## Pre-existing debt NOT in Phase 3 scope

These files are not from Phase 3; back-filling them is documented as a separate
back-fill plan but not blocking Phase 3.

- `apps/api/src/auth.ts` — F=38, L=87, S=88 (Phase 02)
- `apps/api/src/error-handler.ts` — B=83 (Phase 02)
- `apps/api/src/lib/default-tenant.ts` — B=50, S=83 (Phase 02)
- `apps/api/src/plugins/rate-limit.ts` — L=50, B=67, F=75, S=50 (Phase 02)
- `apps/api/src/routes/delete-account.ts` — B=67 (Phase 02)
- `apps/api/src/routes/verification-status.ts` — B=75 (Phase 02)
- `packages/data/src/seed/conformance.ts` — 0 across all four axes (Phase 02.7 — conformance fixture seeder, may be intentionally untested at unit level; flagged for review)

## Environmental issues uncovered during measurement

1. **`apps/worker/src/jobs/ingest-litellm-spend.test.ts:64-72` `canRunDocker()`
   does not detect Docker Desktop on macOS** (looks only at
   `/var/run/docker.sock`, but macOS Docker Desktop uses
   `~/.docker/run/docker.sock`). Without `DOCKER_HOST` exported, all 7
   integration tests skip silently and worker coverage drops from 94 to 52.
   This is a Phase-3 defect (introduced in Plan 03-08) and is back-filled in
   Stage B.

2. **`apps/api/scripts/check-default-secrets.test.ts` and `litellm-spike-request-id.test.ts`** invoke `pnpm exec tsx` which triggers
   the `prepare` lifecycle hook; the hook fails with `core.hooksPath is set
   locally` (lefthook + git hooksPath conflict). 4 DATA-06 + 1 spike test
   currently fail because of this. The spike test was already fixed (commit
   5f2e3dd resolved the audio fixture path); the DATA-06 failures are
   pre-existing (Phase 01-02), out of scope here, but documented in this audit.

## How this baseline was produced

```bash
# Per-package coverage with thresholds disabled, JSON summary on disk.
# DOCKER_HOST is required so testcontainers see the macOS Docker Desktop socket.
export DOCKER_HOST=unix:///Users/dev/.docker/run/docker.sock

for pkg in packages/litellm-client apps/worker apps/api packages/data; do
  cd /Users/dev/openwhispr-server/$pkg
  ../../node_modules/.bin/vitest run --coverage \
    --coverage.reporter=json-summary --coverage.reporter=text \
    --coverage.thresholds.lines=0 --coverage.thresholds.branches=0 \
    --coverage.thresholds.functions=0 --coverage.thresholds.statements=0 \
    --coverage.reportOnFailure=true --root .
done
```

Stage B closes the gaps in the "Phase-3 files below 90" table above; Stage C
adds the e2e suite that DISCIPLINE rule 3 demands.

## Stage B results — back-fill complete (2026-05-10)

Every Phase-3 file is now comfortably above the 90/90/90/90 floor.

| File | L before | L after | B before | B after | F before | F after | S before | S after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `apps/api/src/routes/diarization.ts` | 74 | **99.09** | 65 | **96.96** | 83 | **100** | 72 | **99.11** |
| `apps/api/src/routes/test-only.ts` | 85 | **97.82** | 68 | **90.00** | 80 | **100** | 83 | **97.87** |
| `apps/worker/src/jobs/ingest-litellm-spend.ts` | 100\* | **97.61** | 82 | **90.90** | 83 | **100** | 89 | **95.45** |
| `apps/api/src/lib/pyannote-client.ts` | 100 | **98.71** | 80 | **98.03** | 100 | **100** | 100 | **98.71** |
| `apps/api/src/routes/realtime.ts` | 100 | **100** | 75 | **100** | 100 | **100** | 100 | **100** |
| `apps/api/src/routes/index.ts` | 100 | **100** | 88 | **100** | 100 | **100** | 100 | **100** |

(*line metric for ingest-litellm-spend was reported as 100 in Stage A but
the underlying axes were below 90 — all four axes now exceed 90.)

### Per-package totals after Stage B

| Package | L | B | F | S |
|---|---:|---:|---:|---:|
| `apps/api` | 97.73 | 92.70 | 93.12 | 97.11 |
| `apps/worker` | 98.68 | 95.58 | 100 | 97.53 |

### Commits landed in Stage B

| Commit | Description |
|---|---|
| `1538b1a` | fix canRunDocker to detect macOS Docker Desktop socket |
| `0af0dff` | close diarization route coverage gaps to 99/97/100/99 |
| `608cc74` | close test-only.ts coverage gaps to 98/90/100/98 |
| `4e6241d` | close ingest-litellm-spend coverage gaps to 98/91/100/95 |
| `2b822f0` | close pyannote-client coverage gaps to 99/98/100/99 |
| `476abd0` | close realtime.ts coverage gaps to 100/100/100/100 |
| `6aecb39` | close routes/index.ts coverage gaps to 100/100/100/100 |

### Environmental fixes shipped alongside

1. **canRunDocker** macOS detection bug fixed (commit 1538b1a). The probe
   now also accepts `$HOME/.docker/run/docker.sock`, so the worker
   testcontainer suite no longer silently skips on local macOS dev boxes.
   Before: 7 tests skipped → worker coverage 52%. After: 7 tests run →
   worker coverage 95-98% across all four axes.
2. The pre-existing 4 DATA-06 + 0 spike test failures (lefthook + git
   hooksPath conflict) remain out-of-scope, as documented in the Stage A
   "Environmental issues" section.

### Carry-overs (NOT addressed in Stage B)

- The Phase-02 pre-existing-debt files (auth.ts, error-handler.ts,
  default-tenant.ts, rate-limit.ts, etc.) are unchanged — they remain
  separate back-fill work as originally documented.
- DATA-06 deny-list test failures are still pre-existing; resolution
  requires the lefthook prepare-hook conflict to be untangled.
