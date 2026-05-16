# Phase 22 — SUMMARY (closed 2026-05-16)

## Status

**CLOSED 2026-05-16** — all success criteria PASS. Phase ready for merge to `main`.

## Success criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | 5 smoke probes under `tests/smoke/` | ✅ | health, transcribe-415, realtime-handshake, web-root, traefik-host-split |
| 2 | `vitest.smoke.config.ts` discovers all 5 | ✅ | `pnpm exec vitest list --config vitest.smoke.config.ts` reports 5 / 5 |
| 3 | `make smoke` target wired | ✅ | Makefile lines 449-456 + `.PHONY` updated |
| 4 | `pnpm smoke` script | ✅ | `package.json` scripts |
| 5 | CI job `smoke` boots compose, dumps logs on failure, uploads artifact | ✅ | `.github/workflows/ci.yml` appended job |
| 6 | `smoke` added to `scripts/branch-protection.json` | ✅ | 22 required contexts total (was 21 after Phase 21) |
| 7 | Phase 21 lockers still GREEN | ✅ | playwright-config / steps-have-unit-tests / gherkin-tags all pass |

## Commits

```
<phase-22-commit-SHA> feat(22-01): smoke layer — 5 synthetic-transaction probes (SR-22.1)
<phase-22-doc-SHA>    docs(22): add phase artefacts — context + summary
```

## What landed

### New files
- `tests/smoke/README.md` — operator doc
- `tests/smoke/health.smoke.test.ts`
- `tests/smoke/transcribe-415.smoke.test.ts`
- `tests/smoke/realtime-handshake.smoke.test.ts`
- `tests/smoke/web-root.smoke.test.ts`
- `tests/smoke/traefik-host-split.smoke.test.ts`
- `vitest.smoke.config.ts`
- `.planning/phases/22-smoke-layer/22-CONTEXT.md`
- `.planning/phases/22-smoke-layer/22-SUMMARY.md` (this file)

### Edited files
- `Makefile` — `smoke` target + `.PHONY` updated
- `package.json` — `smoke` script
- `.github/workflows/ci.yml` — new `smoke` job (boots slim-core + ingress, runs probes, dumps logs on failure)
- `scripts/branch-protection.json` — `smoke` added to required contexts (→ 22 total)

## Known follow-ups

1. **Operator action — apply branch-protection update.** Re-run `tools/sync-branch-protection.ts` to push the new required context to GitHub.
2. **Probe expansion at Phase 23 + 24 land.** As more user-visible routes ship (cross-tenant RLS, agent stream, web-search CJMs), add corresponding sub-second smoke probes to keep the < 5 s target.
3. **Local-dev integration.** `make up` does NOT chain `make smoke` by design (operators want fast interactive boot). The chain lives in CI only. Document this expectation in `docs/operations.md` at Phase 41 closure.

## Memory invariants enforced

- `feedback_smoke_before_full_e2e` — encoded as the `smoke` CI job between `up --wait` and `e2e-cjm` (which already exists in `.github/workflows/e2e-cjm.yml`).
- `feedback_check_loki_after_tests` — encoded as the `Dump container logs on failure` step + artifact upload.

## Phase status

```
status: CLOSED
closed: 2026-05-16
verified_by: self (Claude Opus 4.7)
commits: 2
production_fixes: 0
new_required_ci_checks: 1 (smoke)
total_required_checks: 22
```
