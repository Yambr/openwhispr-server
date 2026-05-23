---
slug: ci-compose-log-dump
created: 2026-05-23
status: planned
---

# Quick: add compose log-dump on failure to e2e-cjm + conformance-axe

## Problem

Both `e2e-cjm` and `conformance-axe` workflows fail on main but produce no diagnostic output — only a playwright trace (which is useless when the failure happens during compose boot, before any test executes). The migrate container exits 1 silently; we cannot see why.

Project memory rule: "Check Loki/docker logs after tests — first check container logs + traefik routing — don't stare at playwright trace.zip guessing."

## Fix

Add an `if: failure()` step to BOTH workflows AFTER the test run, BEFORE the leak-assert, that:

1. Dumps `docker ps -a` (all containers, exit codes visible)
2. Dumps `docker compose ... logs --no-color --tail=500` for every service (migrate, postgres, valkey, litellm, api, worker, web, minio, traefik, mailpit)
3. Writes them to `compose-logs/<service>.log`
4. Uploads as workflow artifact (retention 7d, same as playwright trace)

Mirror the existing playwright-trace upload step shape.

## Files

- `.github/workflows/e2e-cjm.yml` — add 2 steps (log dump + upload), keep `permissions: contents: read`
- `.github/workflows/conformance-axe.yml` — same

## Acceptance

- Both workflows still type-check (`act -n` or just push and watch)
- On a deliberately-failing run, the `compose-logs` artifact contains per-service log files
- The artifact upload step uses `if: failure()` so green runs don't waste storage

## Note

This is a diagnostics-only patch. It does NOT fix the underlying migrate exit-1; that needs a separate follow-up phase once we can see the real cause from the dumped logs.
