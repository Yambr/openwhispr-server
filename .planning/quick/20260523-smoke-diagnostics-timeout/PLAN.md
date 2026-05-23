---
slug: smoke-diagnostics-timeout
created: 2026-05-23
status: planned
---

# Quick: stabilise CI `smoke` + `embedded-smoke` — timeout + log-dump

## Problem

The `smoke` job on `main` (run 26326357759) failed with `dependency failed to start: container openwhispr-api-1 is unhealthy`. Investigation against the uploaded `smoke-logs.txt` artifact shows:

- `litellm-1` reached `Application startup complete` at 07:04:30 (UP for ~30 s before api healthcheck began)
- `api-1` listened on 127.0.0.1:3000 at 07:04:59 with `realtime.direct.key.missing` warning (`REALTIME_BACKEND=direct but OPENAI_API_KEY is unset`)
- api healthcheck targets `/api/ready` (R25 cloud-plane readiness), not `/api/health` — and `/api/ready` 503s when (a) SSRF dispatcher marker missing, (b) LiteLLM client not constructed, or (c) LiteLLM upstream unreachable
- After `start_period: 30s` + `3 × 10s retries`, api was marked unhealthy; downstream `dependency failed to start` killed the smoke job

Root cause of the 503 cannot be confirmed without per-service logs (the current `Dump container logs on failure` step only writes a single `smoke-logs.txt` containing all services concatenated, truncated at `--tail=200`).

The embedded-smoke job (separate from slim-core smoke) uses bare `up -d --wait` without `--wait-timeout`, so it relies on the docker compose default 5-minute ceiling — exactly the litellm cold-start window.

## Fix (two diagnostic + stability knobs)

1. **`smoke` job (ci.yml line ~832) — split log dump per-service.** Replace the single `docker compose logs --tail=200 > smoke-logs.txt` with per-service log files written to a `compose-logs/` directory and uploaded as the existing `smoke-logs` artifact (same name, same `if: failure()` gate). Use `--tail=500` per service so we capture more of the api boot log (currently the warning + listen lines are visible but later 503-driving state is truncated).
2. **`embedded-smoke` job (ci.yml line ~888) — add `--wait-timeout 600`.** Matches slim-core smoke's already-proven knob for litellm cold-start. Same comment block.

Both knobs are diagnostics + headroom. They do NOT fix the underlying `/api/ready` 503 cause — but they capture per-service evidence on the next failure so a targeted follow-up quick can close it definitively.

## Files

- `.github/workflows/ci.yml` — two edits (smoke log-dump + embedded-smoke --wait-timeout)

## Acceptance

- YAML parses
- The next `smoke` failing run uploads `smoke-logs` artifact containing one file per service (api.log, litellm.log, postgres.log, etc.) with up to 500 lines each
- `embedded-smoke` no longer trips the 5-min default ceiling on litellm cold-start

## Follow-up

After the next failing CI run, download `smoke-logs`, read `api.log`, grep for `/api/ready` or `byok` or `ssrf` or `litellm.client.not_constructed` to identify the real 503 driver, then file the targeted fix.
