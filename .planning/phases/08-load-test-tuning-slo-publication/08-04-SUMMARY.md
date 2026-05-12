---
phase: 08-load-test-tuning-slo-publication
plan: 04
subsystem: infra
tags: [docker, fd-limit, ulimit, regression-guard, traefik, fastify, entrypoint, d-tune-2]

# Dependency graph
requires:
  - phase: 08-load-test-tuning-slo-publication
    provides: "plan 02 — fd-probe contract harness (tools/load-test/scripts/fd-probe.test.sh)"
provides:
  - "apps/api/scripts/fd-probe.sh — sh probe that refuses boot when soft `ulimit -n` < 65535"
  - "compose/traefik/fd-probe.sh — byte-identical duplicate for the traefik container"
  - "Dockerfile ENTRYPOINT chain prepending the probe ahead of the existing default-secrets gate"
  - "Co-located unit tests for both probes (ulimit simulation + Dockerfile positional assertion + drift detector)"
affects:
  - "08-05 — Wave 1 docker-compose ulimits + traefik entrypoint/Dockerfile wiring"
  - "08-load-test — D-TUNE-2 regression guard for 1000-concurrent-user soak"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ENTRYPOINT exec-chain: probe (fd-limit) -> entrypoint.sh (default-secrets) -> CMD (node)"
    - "Byte-identical duplicate + diff-based drift test as the cross-context single-source-of-truth pattern (vs. unsupported COPY-through-symlink)"
    - "Co-located shell unit tests with subshell ulimit simulation + graceful skip on hosts that cannot relower/raise ulimit -n"

key-files:
  created:
    - apps/api/scripts/fd-probe.sh
    - apps/api/scripts/fd-probe.test.sh
    - compose/traefik/fd-probe.sh
    - compose/traefik/fd-probe.test.sh
  modified:
    - apps/api/Dockerfile

key-decisions:
  - "ENTRYPOINT chained via the existing entrypoint.sh rather than inlined as a flat array — preserves the Phase-2 default-secrets gate and minimises Dockerfile churn (`[fd-probe.sh, entrypoint.sh]` then CMD)."
  - "Duplicate over symlink for the traefik copy — Docker build contexts are per service; symlink across apps/api and compose/traefik would not survive `COPY`. Drift is policed by a `diff -q` test."
  - "Byte-identity header comment lives inside the probe itself (shipping in BOTH copies) so the duplication invariant is self-documenting without breaking byte-identity."
  - "Docker smoke executed via a minimal alpine wrapper image rather than the full multi-stage api build — same `--ulimit` mechanism, two-second feedback loop vs. multi-minute pnpm install."

patterns-established:
  - "fd-limit startup probe pattern (D-TUNE-2): coordinated `ulimits:` block + ENTRYPOINT gate — regression-loud by construction."
  - "Cross-context duplicate-with-drift-test pattern for files that must appear in multiple Docker build contexts."

requirements-completed: [SCALE-07]

# Metrics
duration: 23min
completed: 2026-05-12
---

# Phase 08 Plan 04: file-descriptor startup probe Summary

**Boot-time fd-limit gate (`ulimit -n >= 65535`) wired into the api ENTRYPOINT and shipped for traefik, with co-located shell tests and a `diff -q` drift detector enforcing the two copies stay byte-identical.**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-05-12T14:06Z
- **Completed:** 2026-05-12T14:29:20Z
- **Tasks:** 2 (each RED -> GREEN)
- **Files created:** 4
- **Files modified:** 1

## Accomplishments
- POSIX-sh probe rejects boot with descriptive stderr ("[fd-probe] soft fd limit N < 65535 — refusing to start (D-TUNE-2)") when `ulimit -n` < 65535, exec-chains otherwise.
- `apps/api/Dockerfile` ENTRYPOINT now runs the probe BEFORE the existing default-secrets gate (`[fd-probe.sh, entrypoint.sh]` -> CMD `node /app/dist/index.js`).
- Byte-identical traefik duplicate ships under `compose/traefik/` ready for plan 05 to wire via `entrypoint:` override + bind-mount, OR a thin wrapping Dockerfile.
- Two co-located shell test files (`apps/api/scripts/fd-probe.test.sh`, `compose/traefik/fd-probe.test.sh`) — 7 + 4 assertions respectively, with graceful skip on hosts that cannot retune ulimit -n.
- Plan-02 harness (`tools/load-test/scripts/fd-probe.test.sh`) green for BOTH probe paths via `FD_PROBE_PATH=…`.

## Task Commits

1. **Task 1: apps/api fd-probe.sh + Dockerfile wiring** — RED `3f2f2fe` (test), GREEN `5e60b2d` (feat).
2. **Task 2: compose/traefik fd-probe.sh** — RED `4ebb3ec` (test), GREEN `4e4a545` (feat).

## Files Created/Modified
- `apps/api/scripts/fd-probe.sh` — created. POSIX-sh fd-limit gate with exec-chain and self-documented duplication invariant.
- `apps/api/scripts/fd-probe.test.sh` — created. 7 bash assertions (4 ulimit simulations, executability, Dockerfile reference, positional precedence).
- `apps/api/Dockerfile` — modified. Adds `COPY --chmod=0755 apps/api/scripts/fd-probe.sh /app/scripts/fd-probe.sh` and updates ENTRYPOINT to `["/app/scripts/fd-probe.sh", "/app/entrypoint.sh"]`.
- `compose/traefik/fd-probe.sh` — created. Byte-identical duplicate of the api probe.
- `compose/traefik/fd-probe.test.sh` — created. 4 bash assertions including the `diff -q` drift detector.

## Decisions Made
- See `key-decisions` in frontmatter.
- Notable: the plan's literal "[…] Document inside the script via a header comment" instruction conflicted with the codified T4 byte-identity test. Resolved by placing the comment *inside* the api probe (so it ships in BOTH copies via the duplication step) — keeps byte-identity while still self-documenting. Documented here per Rule 1 (preserve codified contract).

## Deviations from Plan

### Adjustments (not auto-fixes — required by codified test contract)

**1. Header comment placed in the source probe (shipped in both copies) rather than added uniquely to the traefik copy**
- **Found during:** Task 2 GREEN (writing the traefik copy).
- **Issue:** Plan body suggested a traefik-only header comment (`# Duplicate of apps/api/...`), but the plan's frontmatter must_have plus the codified T4 assertion both require `diff -q` to return clean. A traefik-only comment would fail T4.
- **Fix:** Added the duplication-invariant comment to `apps/api/scripts/fd-probe.sh` itself. Because the GREEN step duplicates this file to `compose/traefik/fd-probe.sh`, the comment automatically appears in both copies and byte-identity holds.
- **Files modified:** `apps/api/scripts/fd-probe.sh` (header expanded in Task 2 GREEN commit before the copy).
- **Verification:** `diff -q apps/api/scripts/fd-probe.sh compose/traefik/fd-probe.sh` returns empty; T4 green; the invariant is self-documenting in both physical locations.
- **Committed in:** `4e4a545` (Task 2 GREEN).

**2. ENTRYPOINT shape: `[fd-probe.sh, entrypoint.sh]` instead of inlining the secrets check on the ENTRYPOINT line**
- **Found during:** Task 1 GREEN (reading the actual Dockerfile).
- **Issue:** Plan's BEFORE/AFTER snippet assumed `ENTRYPOINT ["node", "/app/check-default-secrets.cjs", …]`. The real Dockerfile uses `ENTRYPOINT ["/app/entrypoint.sh"]` + `CMD ["node", "/app/dist/index.js"]`, where `entrypoint.sh` runs `node /app/dist/scripts/check-default-secrets.cjs` then `exec "$@"`.
- **Fix:** Prepended the probe to the ENTRYPOINT array (`["/app/scripts/fd-probe.sh", "/app/entrypoint.sh"]`). Chain order remains: probe (fd-limit) -> entrypoint.sh (secrets) -> node — semantically identical to the plan's spec.
- **Files modified:** `apps/api/Dockerfile`.
- **Verification:** Test T7 explicitly accepts either a direct `check-default-secrets` token or `/app/entrypoint.sh` as the secrets-gate position; T7 green (`probe@2, gate@3`).
- **Committed in:** `5e60b2d` (Task 1 GREEN).

---

**Total deviations:** 2 plan/reality adjustments (none security-relevant, none scope-creep). Both preserve the codified must_have invariants.
**Impact on plan:** Zero — must_have truths and codified tests all green; chain semantics unchanged; future plan-05 wiring (Wave 1) unaffected.

## Issues Encountered
- None blocking. The host (macOS, soft ulimit 1048576) happened to support both the 1024 lower-bound and 70000 upper-bound simulations, so all 7 api assertions executed concretely (no skips).

## Verification (final)

```
apps/api fd-probe: 7 pass / 0 fail / 0 skip
compose/traefik fd-probe: 4 pass / 0 fail / 0 skip
plan-02 harness vs apps/api/scripts/fd-probe.sh: 3 pass / 0 fail
plan-02 harness vs compose/traefik/fd-probe.sh: 3 pass / 0 fail
diff -q apps/api/scripts/fd-probe.sh compose/traefik/fd-probe.sh: identical
Docker smoke (alpine wrapper):
  --ulimit nofile=1024:1024  -> exit 1, stderr "[fd-probe] soft fd limit 1024 < 65535 — refusing to start (D-TUNE-2)"
  --ulimit nofile=65535:65535 -> exit 0, exec-chains CMD
  exec-chain test (CHAINED_OK echo) -> exit 0
```

## User Setup Required
None — operator-facing surface unchanged. Plan 05 will surface the `ulimits:` block in docker-compose.

## Next Phase Readiness
- **Plan 05 (Wave 1)** can now wire `ulimits: nofile: { soft: 65535, hard: 65535 }` onto api + traefik, and decide between (a) bind-mounted probe + `entrypoint:` override for traefik or (b) a thin wrapping Dockerfile. Both options compile against the artifact this plan ships.
- D-TUNE-2 regression guard is live for the api image as soon as `docker compose build api` re-rolls.

## Self-Check: PASSED

Files verified to exist:
- FOUND: apps/api/scripts/fd-probe.sh
- FOUND: apps/api/scripts/fd-probe.test.sh
- FOUND: compose/traefik/fd-probe.sh
- FOUND: compose/traefik/fd-probe.test.sh
- FOUND: apps/api/Dockerfile (modified; contains "/app/scripts/fd-probe.sh")

Commits verified present in git log:
- FOUND: 3f2f2fe (test red — apps/api fd-probe)
- FOUND: 5e60b2d (feat green — apps/api fd-probe + Dockerfile)
- FOUND: 4ebb3ec (test red — compose/traefik fd-probe)
- FOUND: 4e4a545 (feat green — compose/traefik fd-probe byte-identical)

---
*Phase: 08-load-test-tuning-slo-publication*
*Completed: 2026-05-12*
