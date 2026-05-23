---
slug: ci-compose-log-dump
created: 2026-05-23
completed: 2026-05-23
status: complete
---

# Summary — compose log-dump on failure in e2e-cjm + conformance-axe

## What

Both workflows were failing without diagnostics: the migrate container exits 1 during boot, the playwright trace artifact is empty (no test ran), and we cannot see why without re-running locally or sshing into the runner.

## Fix

Added two new steps to each workflow, BEFORE the existing leak-assert + playwright-trace upload:

1. **Dump compose logs on failure** (`if: failure()`) — runs `docker ps -a` + per-service `docker compose -p e2e-cjm -f docker-compose.yml -f compose/docker-compose.embedded-litellm.yml logs --no-color --tail=500 <svc>` for all 16 services into `compose-logs/<svc>.log`.
2. **Upload compose logs on failure** (`if: failure()`) — uploads the `compose-logs/` directory as an artifact (retention 7d). Artifact names differ between workflows (`compose-logs` vs `compose-logs-conformance-axe`) so simultaneous runs don't collide.

YAML validated via `python3 yaml.safe_load`. No permission changes (still `contents: read`).

## Files

- `.github/workflows/e2e-cjm.yml` — +20 lines
- `.github/workflows/conformance-axe.yml` — +20 lines

## Acceptance

- YAML parses
- On the next failing run, the `compose-logs` artifact is downloadable and contains per-service log files

## Follow-up

Once the next failing run uploads logs, open the artifact and read `migrate.log` + `postgres.log` to identify the real cause of the migrate exit-1 → separate fix phase.

## Commit

`<set after commit>`
