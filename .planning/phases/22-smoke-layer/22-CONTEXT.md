# Phase 22 — CONTEXT

**Date:** 2026-05-16
**Mode:** Self-authored from `~/.claude/plans/mellow-watching-hinton.md` + `.planning/qa-audit/2026-05-16-test-layering.md` §L1.
**Phase boundary:** ROADMAP "Phase 22: L1 Smoke layer (HIGH)" — surface broken routes / host-split / auth-gate regressions in < 5 s, before the heavier `make e2e-cjm` 30-60 s cycle.

## Why this phase exists

Memory `feedback_smoke_before_full_e2e`: "lint → build → per-service-up → stack → playwright, in that order, with logs check at each layer." The layer that did not yet exist is the **smoke** step between `docker compose up --wait` (container-health only) and `make e2e-cjm` (heavy Playwright). Without it, a broken route handler is discovered through a Playwright trace.zip 60 s after CI fired up, not through a 2 s synthetic transaction.

The audit doc `.planning/qa-audit/2026-05-16-test-layering.md §L1` rates this HIGH and is the source spec.

## Locked decisions

### D-01 — 5 probes, vitest-driven, sub-5-s total

**Why:** vitest is already the test runner; reusing it avoids a new dependency. Five probes cover the dimensions a single broken handler can surface: API health (boot/migration), API content-type rejection (route wiring), realtime auth (WSS entrypoint), web shell (Next.js reach), Traefik host-split (router config). Each probe is a single round-trip; total < 5 s wall-clock.

### D-02 — Live-stack only (no mocked probes)

**Why:** The smoke layer's job is to prove the LIVE stack works. Mocking defeats the purpose. The probes call real `https://api.localhost` / `https://web.localhost` / `wss://api.localhost:8443` and accept the dev-mkcert self-signed cert via `new Agent({ connect: { rejectUnauthorized: false } })`. The `.env` overrides `SMOKE_BASE_URL` / `SMOKE_WEB_URL` / `SMOKE_WSS_URL` let CI / staging point them at non-localhost endpoints.

### D-03 — `fileParallelism: false`

**Why:** All 5 probes hit the same Traefik instance. Serial is cheaper than tuning parallelism for tiny probes; total wall-clock target is still < 5 s.

### D-04 — CI job dumps `docker compose logs --tail=200` on failure

**Why:** Memory `feedback_check_loki_after_tests`: "after ANY e2e/compose run, FIRST check container logs + traefik routing — don't stare at playwright trace.zip guessing." The CI job uploads the logs as an artifact so the operator's first action on a red `smoke` job is reading the log, not re-running locally.

### D-05 — `smoke` added to required status checks

**Why:** The locker discipline established in Phase 21 only gates code shape. Phase 22 adds the first runtime gate: the smoke job is required for merge. `scripts/branch-protection.json` goes from 21 → 22 required contexts.

## Scope and out-of-scope

In scope:
- 5 `*.smoke.test.ts` files under `tests/smoke/`
- `vitest.smoke.config.ts` (flat suite, no coverage)
- `Makefile` target `smoke` + `pnpm smoke` script
- New CI job `smoke` between `up --wait` and `e2e-cjm`
- `scripts/branch-protection.json` adds `smoke` required context
- README at `tests/smoke/README.md` documenting the layer

Out of scope:
- Replacing the existing `make e2e-cjm` Playwright suite (smoke is a faster gate, not a replacement)
- Wiring smoke into the local `make up` (deliberately separate — operators may want to run `make up` without smoke probes during interactive dev)
- Smoke probes for the BYOK overlays (Phase 14 BYOK CJM scenarios already exercise that surface)

## Cross-references

- Plan source: `~/.claude/plans/mellow-watching-hinton.md` (Phase Q-01 / L1)
- Audit source: `.planning/qa-audit/2026-05-16-test-layering.md` §L1
- Memory invariants: `feedback_smoke_before_full_e2e`, `feedback_check_loki_after_tests`
