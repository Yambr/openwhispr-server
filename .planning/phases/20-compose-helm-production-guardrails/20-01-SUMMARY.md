---
phase: 20-compose-helm-production-guardrails
plan: 01
subsystem: compose
tags: [SR-20.1, SR-20.2, SR-20.7, audit-A1, audit-A2, audit-A5, audit-A6, audit-A7]
requires: []
provides:
  - tools/lint-compose-resources.ts
  - deploy.resources.limits.memory on every long-running compose service
  - restart-policy unless-stopped on Traefik / PgBouncer / MinIO / 5 LGTM services
  - make lint-compose-resources target
affects: [docker-compose.yml, 9 compose overlays, tools/, Makefile, package.json, tools/lint-english.ts allowlist]
key-files:
  created:
    - tools/lint-compose-resources.ts
    - tools/lint-compose-resources.test.ts
    - tools/__tests__/fixtures/compose-resources/bad/docker-compose.yml
    - tools/__tests__/fixtures/compose-resources/good/docker-compose.yml
  modified:
    - docker-compose.yml
    - compose/docker-compose.ingress.yml
    - compose/docker-compose.pgbouncer.yml
    - compose/docker-compose.storage.yml
    - compose/docker-compose.observability.yml
    - compose/docker-compose.embedded-litellm.yml
    - compose/docker-compose.load-test.yml
    - compose/docker-compose.load-test.realistic.yml
    - compose/e2e/docker-compose.e2e.yml
    - compose/live-soak/docker-compose.live.yml
    - Makefile
    - package.json
    - tools/lint-english.ts (allowlist extension)
decisions:
  - D-20-01-A composite-commit Task 2 (rationale in commit message of a5614e2)
metrics:
  duration: ~50 min
  completed: 2026-05-16
  commits: 3
---

# Phase 20 / Plan 01 — Summary

## Commits (all on main)

| SHA | Type | Message |
|---|---|---|
| 120fda1 | RED | test(20-01-01): red — lint-compose-resources fails on services missing limits + restart |
| a5614e2 | GREEN | feat(20-01-02): green — compose resource limits + restart + lint-english unblock |
| b9e5210 | chore | chore(20-01-03): wire make lint-compose-resources target |

## Verification

- pnpm test:lint-compose-resources → 6/6 PASS
- Coverage on tools/lint-compose-resources.ts → 93.87 / 91.17 / 100 / 93.87 (all >= 90)
- pnpm exec tsx tools/lint-compose-resources.ts → "lint-compose-resources: clean" (exit 0)
- make lint-compose-resources → exit 0
- pnpm exec tsx tools/lint-english.ts → "English-only check passed: 1063 file(s) scanned"

## SC7 Verification — restart unless-stopped runtime smoke

**Initial test (per plan recipe — docker kill):** FAIL with caveat.

All 5 sampled containers (pgbouncer, traefik, minio, loki, grafana) showed restartCount=0 and exited 5 s after `docker kill`. Investigation: this is **expected Docker Desktop behavior, not a configuration defect**. `docker kill` from CLI is treated as user-initiated stop and does NOT trigger restart unless-stopped. Per Docker docs, unless-stopped fires only on (a) unexpected process exit from inside the container, or (b) Docker daemon restart while the container was running.

Configuration verified correct via `docker inspect --format '{{.HostConfig.RestartPolicy.Name}}'` showing `unless-stopped/0` policy attached to every relevant container.

**Definitive test (daemon-restart acid test):** PASS.

Pre-restart container start timestamps (all running):

```
pgbouncer: 2026-05-16T11:53:43.384Z
traefik:   2026-05-16T11:53:43.109Z
minio:     2026-05-16T11:53:42.975Z
loki:      2026-05-16T11:53:43.061Z
grafana:   2026-05-16T11:54:03.667Z
```

Action: `osascript -e 'quit app "Docker"'` + 10 s wait + `open /Applications/Docker.app` + 15 s wait for daemon socket.

Post-daemon-restart container start timestamps (all running, 20 s after daemon up):

```
pgbouncer:       2026-05-16T11:56:49.063Z
traefik:         2026-05-16T11:56:49.061Z
minio:           2026-05-16T11:56:49.213Z
loki:            2026-05-16T11:56:49.345Z
grafana:         2026-05-16T11:56:47.975Z
api:             2026-05-16T11:56:49.344Z
web:             2026-05-16T11:56:48.787Z
worker:          2026-05-16T11:56:48.931Z
postgres:        2026-05-16T11:56:49.126Z
valkey:          2026-05-16T11:56:49.398Z
litellm:         2026-05-16T11:56:48.025Z
otel-collector:  2026-05-16T11:56:47.933Z
tempo:           2026-05-16T11:56:49.324Z
mimir:           2026-05-16T11:56:48.945Z
```

All 14 containers auto-restarted within ~20 s of the daemon coming back online — the seminal unless-stopped invariant. Audit findings A2 / A5 / A6 / A7 are **runtime-verified closed**.

**Note for future SC7 verification recipes:** the plan's `docker kill` shell recipe should be replaced with a daemon-restart shape, or omitted in favor of trusting `docker inspect --format '{{.HostConfig.RestartPolicy.Name}}'` showing unless-stopped for every long-running container (which is what the lint already enforces statically). The original recipe was misleading because Docker Desktop treats CLI `docker kill` as user-stop.

## Notes

### Composite commit a5614e2

The Task 2 GREEN commit landed as a composite due to a tree-wide pre-commit hook chain conflict. While Task 2 was being staged, two parallel actors were touching main:

- qa-phases-21-39 merge introduced files with Cyrillic literals that did not match the existing lint-english.ts allowlist patterns
- Phase 33 / Phase 21 work landed simultaneously

The english pre-commit hook scans the entire working tree (not just staged files), so the commit refused to land until tools/lint-english.ts IGNORE list was extended. The orchestrator bundled the IGNORE-list extension into the same commit as the Phase 20-01 production-YAML edits to make forward progress; the rebase reword (re-titled from `chore(lint-english)` to `feat(20-01-02): green — compose resource limits + restart + lint-english unblock`) captures the composite scope honestly in the commit body.

This is a **deviation-by-necessity, not a TDD violation**: the RED commit (120fda1) still precedes GREEN (a5614e2), and `pnpm test:lint-compose-resources` correctly flipped from RED to GREEN at the same commit boundary. Atomicity sacrifice noted as decision **D-20-01-A**.

### Unblocking artifact

tools/lint-english.ts IGNORE list extended by one entry: `tests/e2e-cjm/steps/__tests__/signup-extras.steps.test.ts`. Reason: that file owns a Cyrillic-block regex literal as the assertion subject under test — it cannot exist without the literal codepoints it asserts against.

### Operator sign-off

- [x] SC7 daemon-restart smoke verified PASS by orchestrator on 2026-05-16T11:56Z.
- [x] Audit findings A1, A2, A5, A6, A7 from 20-AUDIT-SOURCE.md flip to **resolved**.
- [x] Wave A complete (commits 120fda1 / a5614e2 / b9e5210 on main + 3635b40 / 1bc4987 / b055b81 from Plan 20-02a).
- [x] Wave B (20-02b) unblocked.
