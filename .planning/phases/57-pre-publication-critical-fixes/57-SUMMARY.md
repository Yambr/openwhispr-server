---
phase: 57-pre-publication-critical-fixes
status: closed
closed_at: 2026-05-20
closing_commit: bf5fabde
score: 11/13 CRITICALs resolved (Tier-0 publication blockers); 2 deferred to Phase 58 (Tier-1 worker billing correctness)
verdict: PASS
---

# Phase 57 Summary — Pre-publication CRITICAL Fixes (Tier-0)

Closed 2026-05-20 via 14 atomic commits across 6 fix tracks (A–F).

## Closed CRITICALs (9)

| Finding | Track | Closing commit | Description |
|---|---|---|---|
| `data:CR-01` | A.1 + A.2 | `21a9c200`, `554162f9` | Envelope encryption lens wraps Better Auth transaction adapter; `ENCRYPTED_COLUMNS_MAP` populated; account/verification/sessions credentials never plaintext at rest |
| `data:CR-02` (D2) | B | `4901c711` | RLS posture documented as v1 single-tenant accepted debt; 4 Better Auth identity tables resolve to default tenant absent `withTenant()`; durable D3 fix tracked as v2-blocker |
| `data:CR-03` | A.2 | `554162f9` | Codegen `additionalFields` drift test ensures encrypted-column map stays in sync with Drizzle schema |
| `api-routes-rest:CR-01` | E | `c8c0e497` | `INGRESS_BASE_URL`/`AUTH_URL` boot-required; `req.headers.host` never used as origin (host header injection closed) |
| `api-routes-rest:CR-02` | C | `bff292e3` | `/api/_test/*` routes refuse to register under `NODE_ENV=production` regardless of `OPENWHISPR_TEST_ROUTES` |
| `api-routes-rest:CR-03` | C | `bff292e3` | Production veto extended to all 3 `_test` sub-routes |
| `byok:CR-01` | D | `5e7c6c9f` | `redactUrl` masks `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `tvly-`, `AQVN`, `y0_`, `ASIA` shapes |
| `byok:CR-02` | D | `5e7c6c9f` | `sk-` threshold lowered for short opaque-bearer shapes in URLs + log fields |
| `api-core:CR-01` | F | `bb948961` | Production safety knobs (`OPENWHISPR_DISABLE_RATE_LIMIT`, `OPENWHISPR_DISABLE_EMAIL_VERIFICATION`, `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE`, `MOCK_DIARIZATION`) refuse to boot when set under `NODE_ENV=production` |

## Architectural Halts (2)

- **Track A halt** (`7d08e797`): `data:CR-01` lens-bypass-on-transaction — closed on resumption as A.1.
- **Track B halt** (`a1d5e015`): `data:CR-02` Better Auth tenant-context boundary — resolved via D2 documented posture, not a code fix; durable D3 = v2-blocker.

## Deferred to Phase 58

- `worker:CR-01` — spend-ingest watermark hold on recoverable skips (Tier-1 billing correctness)
- `worker:CR-02` — rollup + reconciliation bucket-by-event_at (Tier-1 billing correctness)
- `data:CR-04` — `previous_token_fp` population (later proven false-positive; residual dual-auth RLS-pool gap → Phase 59)
- `data:CR-05` — dead `oauth-state-codec.ts` plaintext fallback (mechanical cleanup)

## Verification Gate

- `pnpm lint:lockers` — green (7 lockers active)
- `pnpm typecheck` — 5 pre-existing baseline errors, 0 new
- Per-package: data 513 green, byok-guard 109 green, api 1393 green
- Monorepo `--filter` graph shows testcontainers/compose parallelism flake unrelated to Phase 57 code

## SUMMARY Reconciliation Note

This SUMMARY.md was authored retroactively 2026-05-25 to close the disk-tracking gap. The closing commit (`bf5fabde docs(57): close phase 57 — 11/13 pre-publication CRITICALs resolved` 2026-05-20) annotated `REVIEW-INDEX.md` with per-finding closure markers but did not produce a SUMMARY.md at the time; the gsd-sdk `roadmap.analyze` therefore read phase 57 as `disk_status: planned`. With this file present + ROADMAP `[x]` flip, the phase is fully reconciled.

## Closing Commit Ledger

```
3bc5d28e  test(57-A): red — data:CR-01 envelope-encryption lens at rest
7d08e797  docs(57-A): halt — log data:CR-01 architectural blocker
a5cc4762  test(57-A.1): red — data:CR-01 lens does not wrap transaction trx
21a9c200  fix(57-A.1): green — data:CR-01 lens wraps transaction trx adapter
fe2f34de  test(57-A.2): red — data:CR-01/CR-03 codegen additionalFields drift test
554162f9  fix(57-A.2): green — data:CR-01/CR-03 envelope encryption at rest for Better Auth
a1d5e015  docs(57-B): halt — log data:CR-02 architectural blocker
4901c711  test(57-B): data:CR-02 D2 — document RLS posture + boundary property test
cb495d6d  test(57-C): red — api-routes-rest:CR-02/CR-03 /api/_test/*
bff292e3  fix(57-C): green — api-routes-rest:CR-02/CR-03 veto /api/_test/*
8857868e  test(57-D): red — byok:CR-01/CR-02 redact misses ghp_/tvly-/AQVN/ASIA/short-sk
5e7c6c9f  fix(57-D): green — byok:CR-01/CR-02 redact extensions
f7d3b2cb  test(57-E): red — api-routes-rest:CR-01 host header injection
c8c0e497  fix(57-E): green — api-routes-rest:CR-01 require INGRESS_BASE_URL/AUTH_URL
1f1c0bc9  test(57-F): red — api-core:CR-01 production safety knobs lack NODE_ENV veto
bb948961  fix(57-F): green — api-core:CR-01 veto production safety knobs at boot
bf5fabde  docs(57): close phase 57 — 11/13 pre-publication CRITICALs resolved
12f65cd1  docs(57): mark Phase 57 closed in STATE.md
e8a0c671  fix(57): restore AUTH-04 previous-token overlap via SECURITY DEFINER lookup
```
