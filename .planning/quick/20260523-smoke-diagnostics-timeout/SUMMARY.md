---
slug: smoke-diagnostics-timeout
created: 2026-05-23
completed: 2026-05-23
status: complete
---

# Summary — smoke + embedded-smoke: per-service log dump + 600s wait knob

## What

Two CI smoke jobs were failing without enough diagnostics to root-cause:

- `smoke` (slim-core): `dependency failed to start: container openwhispr-api-1 is unhealthy`; api healthcheck targets `/api/ready` (R25 cloud-plane readiness), which 503s on missing SSRF marker / unconstructed LiteLLM client / unreachable upstream — but the single concatenated `smoke-logs.txt` (truncated `--tail=200`) buried the api boot lines among 15 other services.
- `embedded-smoke`: bare `up -d --wait` with no `--wait-timeout` override, so it relied on the docker compose default 5-min ceiling — exactly the litellm `prisma migrate deploy` cold-start window.

## Fix

1. **`smoke` job log dump (ci.yml ~832):** replaced single `docker compose logs --tail=200 > smoke-logs.txt` with a `compose-logs/<svc>.log` directory loop covering 16 services at `--tail=500`. Uploaded as the existing `smoke-logs` artifact.
2. **`embedded-smoke` boot (ci.yml ~888):** added `--wait-timeout 600` to match slim-core smoke's already-proven knob, with the same comment rationale.

YAML validated via `python3 yaml.safe_load`. No permission changes.

## Files

- `.github/workflows/ci.yml` — 2 edits

## Acceptance

- YAML parses
- Next failing `smoke` run uploads per-service logs in `smoke-logs` artifact
- `embedded-smoke` no longer trips 5-min default on cold litellm

## Follow-up

After the next failing CI run downloads, read `api.log` from the artifact to identify the real `/api/ready` 503 driver (likely SSRF dispatcher marker or LiteLLM client construction in production mode with hermetic config). File targeted fix.

## Commit

`<set after commit>`
