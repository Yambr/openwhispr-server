---
phase: 58-remaining-critical-fixes
status: closed
closed_at: 2026-05-20
closing_commit: 99eae7c6
score: 4/4 Tier-1 worker billing + data:CR-05 closed; data:CR-04 residual dual-auth wiring deferred to Phase 59
verdict: PASS
---

# Phase 58 Summary — Remaining CRITICAL Fixes (Tier-1)

Closed 2026-05-20 via 4 RED→GREEN TDD pairs + audit-hardening + library-adoption sweep + docs.

## Closed CRITICALs (4)

| Finding | Track | Closing commit | Description |
|---|---|---|---|
| `worker:CR-01` | A | `4cb51ee4` | Spend-ingest watermark holds on recoverable skips; new anomaly counters (Tier-1 billing correctness) |
| `worker:CR-02` | B | `1bf1d774` | Rollup + reconciliation now bucket by `event_at` not `created_at` (migration `0027`) |
| `data:CR-04` (partial) | C | `44bba5e1` | `previous_token_fp` population confirmed (review claim was false-positive); residual **dual-auth RLS-pool gap** deferred to Phase 59 |
| `data:CR-05` | D | `7535c88b` | Dead `oauth-state-codec.ts` plaintext fallback removed |

## AUDIT-HARD-01..05 + AUDIT-LIB-01..03 + AUDIT-DOC-01 Sweep

Mechanical fixes paired with the CRITICAL closures (all atomic, TDD-paired where applicable):

```
a8a9bb41  fix(58): add per-route rateLimit to /api/auth/* catch-all          (AUDIT-HARD-01)
39c82208  fix(58): gate mailpit behind dev profile                          (AUDIT-HARD-04)
6de25550  fix(58): remove dead NEXT_PUBLIC_OIDC_PROVIDERS config            (AUDIT-HARD-05)
665ebcf6  docs(58): document EMAIL_FALLBACK_NONFATAL in example env files   (AUDIT-DOC-01)
870ad94f  fix(58): bound rate-limit IP store with lru-cache                 (AUDIT-HARD-02)
28d11ac4  fix(58): add iteration cap to encryption backfill loop            (AUDIT-HARD-03)
691845a9  refactor(58): unify positive-int env parsing on one helper        (AUDIT-LIB-01)
24b39856  refactor(58): move settings-resolver env reads to config/stt-settings Zod schema (AUDIT-LIB-02)
85904845  refactor(58): replace hand-rolled timers with AbortSignal.timeout (AUDIT-LIB-03)
8d4c2b28  test(58): fix slim-core Test 2 for dev-profiled mailpit
251a130a  docs(58): record Phase 57-58 test-suite triage
```

## Verification Gate

- `pnpm lint:lockers` — green (8 lockers active; LOCKER-05/06 from Phase 31 ledger flipped during phase)
- `pnpm typecheck` — 5 pre-existing baseline errors, 0 new
- Per-package: worker 202 green, data 513 green, api 1397 green
- Full-suite triage (`TEST-TRIAGE.md`): v2.4 HEAD vs pre-v2.4 baseline `3b504fa3` → 39 failures at HEAD, ALL pre-existing on main EXCEPT one slim-core-base Test-2 regression (Phase-58 mailpit profile), now fixed. Zero net new test failures vs main.

## Deferred to Phase 59

- `data:CR-04` residual: dual-auth Better Auth bearer session.token resolution on every sync route. Closed by Phase 59 commit `29528220 fix(R20+R19): resolve Better Auth bearer session.token on every sync route` (cross-referenced).

## SUMMARY Reconciliation Note

This SUMMARY.md was authored retroactively 2026-05-25 to close the disk-tracking gap. The closing commit (`99eae7c6 docs(58): close phase 58 — remaining 4 CRITICAL findings resolved` 2026-05-20) annotated `REVIEW-INDEX.md` but did not produce a SUMMARY.md at the time; the gsd-sdk `roadmap.analyze` therefore read phase 58 as `disk_status: planned`. With this file present + ROADMAP `[x]` flip, the phase is fully reconciled.

## Closing Commit Ledger (CRITICAL fixes only)

```
c52257d3  test(58-A): red — worker:CR-01 watermark advances past recoverable skips
4cb51ee4  fix(58-A): green — worker:CR-01 hold watermark on recoverable skips + anomaly counters
f5a69ad1  test(58-B): red — worker:CR-02 rollup buckets by created_at not event_at
1bf1d774  fix(58-B): green — worker:CR-02 bucket rollup + reconciliation by event_at
44bba5e1  test(58-C): data:CR-04 regression lock — previous_token_fp populated on rotation
7535c88b  fix(58-D): remove dead plaintext-fallback from oauth-state-codec — data:CR-05
99eae7c6  docs(58): close phase 58 — remaining 4 CRITICAL findings resolved
```
