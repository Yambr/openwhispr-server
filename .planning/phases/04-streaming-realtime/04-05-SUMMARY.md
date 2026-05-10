---
phase: 04
plan: 05
subsystem: streaming-realtime
tags: [tdd, traefik, ingress, realtime, scale-05, t-04-02]
requires:
  - .planning/phases/04-streaming-realtime/04-CONTEXT.md (D-21, D-26)
  - .planning/phases/04-streaming-realtime/04-RESEARCH.md (§2.3 lines 299-378)
  - .planning/phases/04-streaming-realtime/04-01-SUMMARY.md (Phase 04 placeholder marker)
  - .planning/phases/02-auth-wire-api-skeleton-conformance-harness/02-CONTEXT.md (Phase 02.19 RFC 1918 trust boundary)
provides:
  - compose/traefik/traefik.yml (websecure-realtime entrypoint on :8443, 3600s idleTimeout)
  - compose/traefik/dynamic.yml (api-realtime router bound exclusively to websecure-realtime)
  - docker-compose.yml (host port 8443 published by traefik)
  - tests/integration/traefik-realtime-entrypoint.test.ts (8 structural assertions, all GREEN)
affects:
  - compose/traefik/traefik.yml (entryPoints block now defines two TLS entrypoints; :443 reverted from prior multi-thousand-second timeouts to Traefik 3 defaults)
  - compose/traefik/dynamic.yml (api-realtime router moved off :443; stale Phase 03 comments refreshed)
  - docker-compose.yml (traefik.ports gained "8443:8443"; ordering 80, 443, 8443, 8080)
tech-stack:
  added:
    - "Traefik websecure-realtime entrypoint on :8443 (idleTimeout 3600s)"
  patterns:
    - "Cert reuse via http.tls={} on both entrypoints — shared tls.certificates list in dynamic.yml"
    - "Per-entrypoint ingress isolation: long-timeout regime confined to :8443; short-JSON routes on :443 inherit Traefik 3 defaults"
    - "Phase 02.19 trust-boundary inheritance: forwardedHeaders.trustedIPs replicated on the new entrypoint"
key-files:
  created:
    - tests/integration/traefik-realtime-entrypoint.test.ts
  modified:
    - compose/traefik/traefik.yml
    - compose/traefik/dynamic.yml
    - docker-compose.yml
decisions:
  - "Cert reuse pattern: both entrypoints use http.tls={} so Traefik loads tls.certificates from dynamic.yml's single shared block — no separate ACME, no DNS-01, no entrypoint-specific cert minting (D-21 / RESEARCH §2.3)"
  - "Trust-boundary inheritance: :8443 carries the same RFC 1918 trustedIPs (10/8, 172.16/12, 192.168/16) as :443 so the in-cluster contract-test runner's per-fixture XFF survives the Traefik hop on the realtime path"
  - "Stale Phase 03 comments in dynamic.yml referencing the prior :443 long-timeout regime were rewritten in the same atomic commit — no documentation drift"
metrics:
  duration: ~12m
  tasks_completed: 2
  files_created: 1
  files_modified: 3
  commits: 2
  completed_date: 2026-05-11
---

# Phase 04 Plan 05: Traefik Realtime Entrypoint Split Summary

Split the Traefik static config so long-running WSS realtime sessions live
on a dedicated `:8443` entrypoint (`websecure-realtime`,
`idleTimeout: 3600s`), while `:443` (`websecure`) reverts to Traefik 3
defaults (60s read / 0 write / 180s idle) — eliminating the prior shared
multi-thousand-second regime that exposed every short-JSON route on `:443`
to ingress-pool exhaustion (T-04-02). Closes SCALE-05 ingress isolation
at the config layer.

## Before / After

| Surface | Before | After |
|---------|--------|-------|
| `:443` `respondingTimeouts.readTimeout` | `3700s` | `60s` (Traefik 3 default) |
| `:443` `respondingTimeouts.writeTimeout` | `3700s` | `0` |
| `:443` `respondingTimeouts.idleTimeout` | `180s` | `180s` (unchanged) |
| `:8443` entrypoint | did not exist | `websecure-realtime` — `readTimeout 0 / writeTimeout 0 / idleTimeout 3600s` |
| `api-realtime` router `entryPoints` | `[websecure]` | `[websecure-realtime]` (exclusive) |
| `docker-compose.yml` `traefik.ports` | `80, 443, 8080` | `80, 443, 8443, 8080` |
| `forwardedHeaders.trustedIPs` on realtime path | inherited from `:443` | replicated on `:8443` (RFC 1918) |
| Cert source for both entrypoints | shared via `dynamic.yml tls.certificates` | shared via `dynamic.yml tls.certificates` (unchanged — `http.tls: {}` on both) |

## YAML Diff Highlights

`compose/traefik/traefik.yml` — `entryPoints` block:

```yaml
  websecure:
    address: ":443"
    http: { tls: {} }
    forwardedHeaders:
      trustedIPs: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]
    transport:
      respondingTimeouts:
        readTimeout: 60s        # was 3700s
        writeTimeout: 0         # was 3700s
        idleTimeout: 180s
  websecure-realtime:           # NEW
    address: ":8443"
    http: { tls: {} }
    forwardedHeaders:
      trustedIPs: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]
    transport:
      respondingTimeouts:
        readTimeout: 0
        writeTimeout: 0
        idleTimeout: 3600s
```

`compose/traefik/dynamic.yml` — `api-realtime` router:

```yaml
    api-realtime:
      rule: "Host(`api.localhost`) && PathPrefix(`/v1/realtime`)"
      service: api-realtime-svc
      entryPoints: [websecure-realtime]   # was [websecure]
      priority: 100
      tls: {}
```

`docker-compose.yml` — `traefik.ports`:

```yaml
    ports:
      - "80:80"
      - "443:443"
      - "8443:8443"   # NEW (Phase 04 Plan 05)
      - "8080:8080"
```

## Integration Test Outcome

`tests/integration/traefik-realtime-entrypoint.test.ts` — 8 structural
assertions, pure YAML parse (no Docker required):

| # | Assertion | RED before | GREEN after |
|---|-----------|-----------|-------------|
| 1 | `websecure-realtime` exists on `:8443` with `idleTimeout 3600s` | FAIL | PASS |
| 2 | `:443` has no `3700s` and matches Traefik 3 defaults | FAIL | PASS |
| 3 | `api-realtime.entryPoints == ['websecure-realtime']` exclusively | FAIL | PASS |
| 4 | No other router uses `websecure-realtime` | PASS (vacuously) | PASS |
| 5 | No `buffering` middleware on streaming routers | PASS (no mws) | PASS |
| 6 | `docker-compose` maps `8443:8443` on traefik | FAIL | PASS |
| 7 | Single shared `tls.certificates` block — no per-entrypoint cert | PASS | PASS |
| 8 | `:8443` `forwardedHeaders.trustedIPs` carries the three RFC 1918 CIDRs | FAIL | PASS |

```text
$ pnpm vitest run tests/integration/traefik-realtime-entrypoint.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  125ms
```

## Threat Mitigations Verified

| Threat ID | Component | Verified by |
|-----------|-----------|-------------|
| T-04-02 (ingress-pool DoS) | Traefik `:443` connection pool | Test 1 + Test 2 — long-timeout regime is now confined to `:8443`; `:443` cannot hold ingress-pool slots for an hour |
| T-04-NO-BUFFERING | dynamic.yml streaming routers | Test 5 — static structural assertion that no buffering middleware is attached |
| T-04-TRUST | `forwardedHeaders.trustedIPs` on `:8443` | Test 8 — Phase 02.19 RFC 1918 trust boundary inherited intact |

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 (RED) | `6433b5c` | `test(04-05): RED — assert :8443 realtime-entrypoint split + :443 default timeouts` |
| 2 (GREEN) | `f6305f5` | `feat(04-05): split Traefik realtime to :8443 with 3600s idleTimeout (SCALE-05)` |

## Deviations from Plan

**[Rule 1 — Bug] Refreshed stale Phase 03 documentation comments in dynamic.yml.**
The `api-realtime` router's pre-existing comment block and the
`api-realtime-transport` `serversTransports` comment both referenced the
old `respondingTimeouts.read/writeTimeout: 3700s` on the `:443`
entrypoint. After Task 2's edits those values no longer existed on
`:443`, so the comments were factually wrong. Rewrote both blocks in the
same atomic commit (`f6305f5`) to reference the new `:8443`
`websecure-realtime` topology. No code-level deviation; documentation
correctness only.

This double-purpose was needed for the acceptance criterion
`grep -E '3700s' compose/traefik/traefik.yml returns ZERO matches` —
the original draft of Task 2's traefik.yml comment block also used the
literal `3700s` to describe the prior regime; rewrote that to
"multi-thousand-second" for the same reason.

## Authentication Gates

None. No external services contacted. Pure config-as-code change.

## Known Stubs

None. The split is real and tested.

## Deferred Issues

- `tests/integration/traefik-network-alias.test.ts` fails locally because
  the worktree has no `.env` file (`docker compose config` returns
  non-zero). Pre-existing, environmental — NOT caused by this plan's
  changes. Logged for the next phase that touches docker-compose env
  bootstrap. Recorded in `.planning/phases/04-streaming-realtime/deferred-items.md`.

## Verification

- `pnpm vitest run tests/integration/traefik-realtime-entrypoint.test.ts` → 8/8 GREEN ✅
- `grep -c 'websecure-realtime' compose/traefik/traefik.yml` → 4 (≥ 2 expected) ✅
- `grep -c '3700s' compose/traefik/traefik.yml` → 0 ✅
- `grep -c '3700s' compose/traefik/dynamic.yml` → 0 ✅
- `grep -c '8443:8443' docker-compose.yml` → 1 ✅
- `grep -c 'websecure-realtime' compose/traefik/dynamic.yml` → 4 (≥ 1 expected) ✅
- `git log --oneline -2` shows traefik.yml + dynamic.yml + docker-compose.yml in the same commit (f6305f5) ✅
- `pnpm vitest run tests/integration/traefik-forwarded-headers.test.ts` → still GREEN (Phase 02.19 contract intact) ✅

## Self-Check: PASSED

All claimed files present:
- FOUND: tests/integration/traefik-realtime-entrypoint.test.ts
- FOUND: compose/traefik/traefik.yml (modified — websecure-realtime entrypoint at :8443)
- FOUND: compose/traefik/dynamic.yml (modified — api-realtime bound to websecure-realtime)
- FOUND: docker-compose.yml (modified — 8443:8443 port mapping)

All claimed commits present:
- FOUND: 6433b5c (Task 1 RED)
- FOUND: f6305f5 (Task 2 GREEN)
