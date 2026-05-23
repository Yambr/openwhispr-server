---
status: resolved
trigger: "CI smoke job (run 26337800406, job 77534390507) failure: `dependency failed to start: container openwhispr-api-1 is unhealthy` on slim-core stack boot. 8th of 9 CI reds. Goal: find_and_fix."
created: 2026-05-23T21:30:00Z
updated: 2026-05-23T21:55:00Z
resolved_commit: pending
---

## RESOLVED 2026-05-23 — IPv4/IPv6 BusyBox wget healthcheck trap

### Root Cause

The `compose/docker-compose.embedded-litellm.yml` overlay (used by the CI
`smoke` job at `.github/workflows/ci.yml:860-865`) declares an api-service
healthcheck that probes `http://localhost:3000/api/health`. The overlay
REPLACES the base `docker-compose.yml` healthcheck (which uses the IPv4
literal `http://127.0.0.1:3000/api/ready`) via standard compose merge
semantics.

Inside the alpine container, Docker injects BOTH `127.0.0.1 localhost`
AND `::1 localhost ip6-localhost ip6-loopback` into `/etc/hosts`. BusyBox
wget calls `getaddrinfo("localhost")` which returns both addresses; the
order depends on the host kernel's `gai.conf` (GHA `ubuntu-24.04`
runners differ from Docker Desktop on macOS). When BusyBox wget receives
the IPv6 `::1` address first, it attempts the connection and gets
`Address not available` because the api Fastify listen call binds
`0.0.0.0:3000` — **IPv4 only**. Fastify does NOT dual-bind for
`0.0.0.0`; the log captures `Server listening at http://127.0.0.1:3000`
+ `http://172.18.0.15:3000` (both v4), with NO IPv6 listener.

BusyBox wget has no happy-eyeballs / address-iteration fallback: with
`--tries=1` it exits non-zero immediately on the first address failure
WITHOUT trying the v4 address. The healthcheck reports `unhealthy` after
3 retries (~60s elapsed from container start), `docker compose up
--wait` aborts with `dependency failed to start: container
openwhispr-api-1 is unhealthy`, and the CI step exits 1.

### Evidence chain

- `litellm.log` shows ZERO `/health/readiness` hits — confirming the api
  never made the upstream probe (consistent with /api/ready handler
  never running)
- `api.log` shows ONLY 3 lines (one realtime warning + two Server-
  listening lines) — NO request log entries despite ~30s of wget probes,
  proving wget never reached fastify
- Both `127.0.0.1` and `172.18.0.15` Server-listening lines confirm api
  bound IPv4-only (no `::1` or `[::]:3000` listener)
- The 7 other unhealthy services would have shown the same fastify
  request log entries on probe arrival; their absence is decisive
- Locally on macOS Docker Desktop the same compose merge produces a
  HEALTHY api in 10s — BusyBox wget on macOS getaddrinfo returns v4
  first; the bug is environment-dependent on the host kernel resolver
  order

### Fix

Replace every `localhost` literal in api/worker/web container
healthchecks (compose `test:` arrays + Dockerfile HEALTHCHECK CMD lines)
with the IPv4 literal `127.0.0.1`. Sites:

- `apps/api/Dockerfile:183` — image-level HEALTHCHECK (redundant under
  compose-level override but fixed for hygiene + standalone `docker
  run` correctness)
- `apps/web/Dockerfile:154` — same as api
- `compose/docker-compose.embedded-litellm.yml:632` — api healthcheck
  (the actual CI failure path)
- `compose/docker-compose.embedded-litellm.yml:763` — web healthcheck
  (latent bug, same shape)
- `compose/docker-compose.load-test.yml:408` — mock-litellm healthcheck
  (latent bug, same shape)

### Test (regression guard)

`tools/lint-compose-healthcheck-target.test.ts` — a vitest unit suite
that parses every `docker-compose*.yml` + every `apps/*/Dockerfile` and
asserts no healthcheck CMD targets `http://localhost:(3000|4000|5000)/`.
Filters out the litellm self-probe (python `urllib`, has happy-eyeballs)
and YAML comments. RED before the fix (4 offenders), GREEN after.

### Live verification (local)

Rebuilt `openwhispr-api` image with the patched Dockerfile, recreated
the api container under the same 4-file compose overlay chain as CI:

```
openwhispr-api-1  Up 10 seconds (healthy)
["CMD","wget","--quiet","--tries=1","--spider","http://127.0.0.1:3000/api/health"]
```

Healthcheck flipped from never-healthy to healthy-in-10s. No other
behavior change.

## Current Focus

n/a — resolved.
