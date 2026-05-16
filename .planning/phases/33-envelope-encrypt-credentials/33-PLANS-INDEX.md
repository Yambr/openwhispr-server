# Phase 33 — Sub-plans Index

**Phase:** Envelope encryption wired to Better Auth credential columns (CR-8 closure).
**Source:** ROADMAP Phase 33 + `.planning/review/data.md` CR-02 + 33-CONTEXT.md + 33-RESEARCH.md (937 lines, authoritative).

## Dependency graph

```
                    ┌──────────┐
                    │  33-01   │  Migration 0019 (additive 48 bytea + 2 fp + indexes)
                    │  wave 1  │  + ROADMAP/REQ filename correction (0018 → 0019/0020)
                    └────┬─────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
       ┌──────────┐              (parallel candidate, but kept sequential
       │  33-02   │               in wave 2 because 33-03 reuses
       │  wave 2  │               validateMasterKek + selectProvider)
       │ lens.ts  │
       │ boot.ts  │
       └────┬─────┘
            │
            ▼
       ┌──────────┐
       │  33-03   │  Node-side backfill migrator + CLI
       │  wave 3  │  (real PG testcontainer integration test)
       └────┬─────┘
            │
            ▼
       ┌──────────────────────────────────────────────────────┐
       │  33-04                                               │
       │  wave 4                                              │
       │  - apps/api/src/auth.ts wraps drizzleAdapter         │
       │  - apps/api + apps/worker boot-time validateMasterKek│
       │  - oauth_state.code_verifier manual lens hooks       │
       │  - lookup_session_by_previous_token REWRITE          │
       │  - end-to-end Better Auth integration test           │
       │  - 33-04-DECISIONS.md (password_hash empirical etc.) │
       └────┬─────────────────────────────────────────────────┘
            │
            ▼
       ┌──────────────────────────────────────────────────────┐
       │  33-05                                               │
       │  wave 5                                              │
       │  ★ ATOMIC CLOSURE COMMIT (LOCKER-07 precedent) ★     │
       │  - Migration 0020 (drop plaintext + flip indexes)    │
       │  - Drizzle schema declarations → bytea-only          │
       │  - tools/lint-no-plaintext-secret-columns.ts (NEW)   │
       │  - DISCIPLINE Rule 15 + CLAUDE.md mirror             │
       │  - lefthook/Makefile/CI wiring                       │
       │  - docs/security.md §12                              │
       │  - tests/e2e/encryption-at-rest.test.ts              │
       │  - Delete 5 obsolete tests (Phase-32 DEFERRED)       │
       │  - 33-SUMMARY.md + 33-COVERAGE.md                    │
       └──────────────────────────────────────────────────────┘
```

## Plan summary table

| Plan | Wave | Title | Tasks (RED+GREEN pairs) | Atomic commits | Depends on |
|---|---|---|---|---|---|
| 33-01 | 1 | Migration 0019 additive — 48 bytea sidecars + 2 fingerprint cols + 2 indexes + ROADMAP filename fix | 4 (1R+1G+1G+1R) | 4 | none (Phase 32 landed) |
| 33-02 | 2 | Lens (`lens.ts`) + boot validator (`boot.ts`) + envelope.ts coverage fill | 5 (R+G+R+G+R) | 5 | 33-01 |
| 33-03 | 3 | Node-side backfill migrator + CLI + idempotency stress test | 4 (R+G+G+R) | 4 | 33-01, 33-02 |
| 33-04 | 4 | apps/api+worker wiring + oauth_state hooks + lookup-by-previous-token rewrite + Better Auth integration test | 5 (R+G pairs ×4 + 1 decisions doc) | 9 | 33-01..03 |
| 33-05 | 5 | **ATOMIC** — 0020 drop-plaintext + schema flip + LOCKER-PLAINTEXT-COLS + Rule 15 + docs §12 + e2e + obsolete-test cleanup + SUMMARY/COVERAGE | 9 sub-tasks bundled | **1** (LOCKER-07 precedent) | 33-01..04 |

**Total atomic commits expected:** 4 + 5 + 4 + 9 + 1 = **23 commits** (estimate; some refactor commits may collapse on review).

## Hard order

Sequential: 33-01 → 33-02 → 33-03 → 33-04 → 33-05. Each plan reads files written by the previous (`bootMigratedPostgres` consumes journal; lens unit tests are DB-shape-aware via column map; backfill exercises the 0019 sidecars; 33-04 integration tests need backfilled data; 33-05 closure cannot land until 33-04's lens is wired in production).

## DISCIPLINE inheritance

Every plan inherits `.planning/DISCIPLINE.md` Rules 1-14. Plan 33-05 INTRODUCES Rule 15 (LOCKER-PLAINTEXT-COLS / LOCKER-08).

- **Rule 1 (Strict TDD):** every task is RED → GREEN; refactor commits permitted only after GREEN. 33-05 atomic-bundle is the ONLY exception per LOCKER-07 precedent.
- **Rule 2 (≥ 90/90/90/90 coverage on diff):** enforced per plan; verification gates explicit.
- **Rule 3 (E2E mandatory):** 33-04 ships `apps/api/src/__tests__/better-auth-encryption.integration.test.ts` (real PG + Better Auth + raw-DB ciphertext assertion); 33-05 ships `tests/e2e/encryption-at-rest.test.ts` (full compose stack).
- **Rule 4 (no internal mocks):** lens unit tests in 33-02 mock the Better Auth `Adapter` interface — this is an EXTERNAL boundary (Better Auth's contract), not internal logic — permitted. All integration paths in 33-03/04/05 use real PG + real Better Auth.
- **Rule 5 (real services):** every DB-touching test uses `bootMigratedPostgres` from Phase 32.
- **Rule 14 / LOCKER-07 atomic invariant:** explicitly inherited by 33-05's closing commit.

## Inherited safety rails

- **CLAUDE.md Hard Rule 1:** Never edit production code purely to pass a test. If a Phase-33 integration test fails for a NON-Phase-33 reason (e.g. a pre-existing oauth-callback quirk), log to a new `33-DEFERRED.md` and continue — do NOT mutate unrelated production code.
- **CLAUDE.md Hard Rule 2:** Surface costly architectural decisions as deferred-items; if a constraint forces simplification of a Phase-33 sub-task, escalate via `gsd-advisor-researcher` and record in the plan's DECISIONS file.
- **CLAUDE.md Hard Rule 3:** Never report "✅ done" based on a sub-agent's claim alone — orchestrator independently verifies commits + tests + grep + working-tree state.
- **Phase 31 lockers active:** every commit passes `pnpm lint:lockers`.
- **Phase 32 D-1 (NULLIF pattern):** Phase 33 touches NO RLS policy bodies; if a future Phase-33 sub-task ever does, it must reuse NULLIF.
- **User OFFLINE:** any grey-area decision is auto-routed to `gsd-advisor-researcher` and recorded in `33-NN-DECISIONS.md`.

## Authoritative corrections incorporated (research §15)

| Correction | Origin | Where applied |
|---|---|---|
| 6-bytea sidecars per credential (NOT 4 as CONTEXT says) | research §Q2 + envelope.ts:37-44 | 33-01 column matrix |
| Lens architecture (c) — wrap Adapter; (a) customType + (b) middleware rejected | research §Q6 | 33-02 architecture lock |
| `sessions.token_fp` SHA-256 sidecar to preserve `sessions_token_unique` index | research §Q4 / pitfall #3 | 33-01 + 33-05 schema flip |
| `lookup_session_by_previous_token(text)` SECURITY DEFINER fn dies under ciphertext → REWRITE | research §Q5 | 33-04 Task 4 + migration 0019b |
| `oauth_state.code_verifier` lens is OUTSIDE the Better Auth adapter — manual hooks at sql-fragment sites | research §Q6 sub-finding | 33-04 Task 3 |
| Better Auth 5-min cookie-cache bypasses adapter — tests use raw DB reads | research §Q12 + pitfall #6 | 33-04 Task 1 |
| `users.password_hash` empirical check (NOT silently expand scope) | research §Q7 | 33-04 Task 1 pre-flight grep |
| KMS/Vault providers refuse at BOOT (validateMasterKek), not at first DB read | research §Q8 + key-provider.ts:49-61 | 33-02 Task 4 |
| boot.ts location + exit 78 (BSD EX_CONFIG) | research §Q9 | 33-02 + 33-04 wiring |
| Phase 32 DEFERRED 5 cases break further under Phase 33 → delete in 33-05 | research §Q13 + 32-DEFERRED.md | 33-05 Task 8 |

## Open questions resolved without escalation

- Migration filename collision (CONTEXT says 0018 — taken). → 0019/0020 split confirmed (Phase 32 took 0018).
- LOCKER-PLAINTEXT-COLS allowlist policy. → Day-one BLOCKING, no allowlist (CONTEXT preferred-option matches research recommendation).
- KEK derivation. → MASTER_KEK is the AES-256 key directly; no KDF. Matches `env-key-provider.ts` actual behavior.
- Migration of `users.password_hash`. → Out of scope (grep confirms zero application writes; Better Auth uses `account.password`).
- E2E boundary. → 33-05 ships compose-stack E2E + raw-DB ciphertext assertion + locker-exit-non-zero-on-broken-fixture.
