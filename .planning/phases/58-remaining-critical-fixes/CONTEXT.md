# Phase 58 — Remaining CRITICAL fixes (Tier-1)

## Background

Phase 57 closed 11 of 13 CRITICAL findings from the pre-publication code review (`.planning/review/REVIEW-INDEX.md`). Four CRITICAL findings were explicitly deferred to Phase 58:
- `worker:CR-01` + `worker:CR-02` — Tier-1 billing-correctness (not Tier-0 publication blockers, but real production bugs)
- `data:CR-04` + `data:CR-05` — token-rotation correctness + dead code

This phase closes those 4. After this phase, ALL 13 CRITICAL findings from the review are resolved.

Out of scope: ~38 HIGH, ~49 MEDIUM, ~30 LOW findings — Phase 59+.

## Goal

After this phase:
1. All 4 deferred CRITICAL findings (`worker:CR-01`, `worker:CR-02`, `data:CR-04`, `data:CR-05`) are fixed and verified.
2. Each fix lands via strict TDD (RED→GREEN→REFACTOR), atomic commits.
3. Tests cover the regression-shape — would catch a future revert.
4. `pnpm test` green per-package; `pnpm lint:lockers` green (8 lockers); `pnpm typecheck` no new errors vs the documented 5-error baseline.
5. `.planning/review/REVIEW-INDEX.md` annotated with "Closed by Phase 58" markers.

## CRITICAL track summary

### Track A — Spend-ingest watermark advances past silently-skipped rows
Finding: **`worker:CR-01`**

Problem: `apps/worker/src/jobs/ingest-litellm-spend.ts:329-344` — when a LiteLLM spend row is missing `end_user`, missing tenant mapping, or has an invalid duration, the row is silently skipped, BUT the ingest watermark advances past it. The skipped billable spend is permanently orphaned even after the prerequisite data (the user/tenant mapping) later materializes. Only the duration-skip branch emits a billing-anomaly counter; the user-skip and tenant-skip branches are invisible.

Fix: The watermark must NOT advance past a row that was skipped for a *recoverable* reason (missing user/tenant mapping — these can materialize later). Options to evaluate during planning:
- (a) Dead-letter / retry queue: skipped-recoverable rows go to a side table; watermark advances; a periodic reconciler re-attempts them.
- (b) Watermark holds at the oldest unresolved row: watermark = min(processed-row-time, oldest-skipped-recoverable-row-time).
- (c) Skipped rows get re-queried on each ingest tick within a bounded lookback window.
Invalid-duration is genuinely unrecoverable (bad data) — that one can skip + counter. Missing-user/tenant is recoverable. Emit a billing-anomaly counter for ALL three skip reasons, not just duration.

### Track B — Daily rollup + reconciliation bucket by `created_at`, not `startTime`
Finding: **`worker:CR-02`**

Problem: `apps/worker/src/jobs/usage-rollup-daily.ts` + `apps/worker/src/jobs/reconciliation-daily-check.ts` both bucket `usage_ledger` rows by `created_at` (the ingest timestamp), not by the LiteLLM `startTime` (when the spend actually occurred). A rollup tick running 30 seconds after UTC midnight allocates yesterday's late-arriving spend into today's bucket. Reconciliation reads the same `created_at` column, so its drift gauge reports 0 even though the rollup is wrong — the bug is self-concealing.

Fix: Both jobs must bucket by the LiteLLM `startTime` (the canonical spend-occurrence timestamp). Verify the `usage_ledger` schema actually has a `startTime`-derived column; if it only stores `created_at`, the fix also requires capturing `startTime` at ingest (coordinate with Track A — `ingest-litellm-spend.ts` is the writer). Reconciliation must then bucket by the same column so the drift gauge is meaningful.

### Track C — AUTH-04 5-minute token-rotation overlap broken
Finding: **`data:CR-04`**

Problem: `previous_token_fp` is never populated. The AUTH-04 spec requires a 5-minute overlap window where a just-rotated session token still validates against `previous_token` (so in-flight requests during rotation don't 401). The fingerprint column `previous_token_fp` that enables O(log N) ciphertext lookup is never written, so the overlap-window lookup never matches → the overlap window is non-functional.

Note: Phase 57 Track A.2 (`6133c2b`) added `deriveSidecarAdditionalFields` codegen that registers `previous_token_fp` as a Better Auth `additionalField`, and the lens `encryptInto` now emits both snake+camel `previous_token_fp`. Verify whether Phase 57 Track A already fixed this as a side effect — if `previous_token_fp` IS now populated post-Phase-57, `data:CR-04` may be partially or fully closed; confirm with a test before deciding scope. If still broken, the fix is to ensure the rotation path writes `previous_token` + its fingerprint and the validation path queries `previous_token_fp` within the 5-minute window.

### Track D — Dead plaintext-fallback in oauth-state-codec.ts
Finding: **`data:CR-05`**

Problem: `packages/data/src/encryption/oauth-state-codec.ts` (verify path) contains a dead plaintext-fallback branch that became unreachable after migration 0020 (envelope-encrypt secret columns). Dead code in a security-sensitive codec is a hazard — a future refactor could accidentally re-activate the plaintext path.

Fix: Remove the dead plaintext-fallback branch. Confirm via grep that no caller depends on it. Add/adjust a test asserting the codec only ever emits/accepts encrypted form.

## Constraints

- **Strict TDD** — RED→GREEN→REFACTOR; test + production code atomic.
- **No mocks of internal logic** — DB/worker tests use real Postgres + Valkey via testcontainers.
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` after every track.
- **No production code edited "to make tests pass"** — CLAUDE.md hard rule 1. HALT + deferred-items if a test exposes a deeper constraint.
- **Track order:** C first (verify if Phase 57 already closed it — cheap check), then D (small, isolated), then A, then B (B depends on A if `startTime` capture must be added at ingest).
- **Each track = its own RED+GREEN commit pair.**
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.

## Verification gate

Phase passes when:
1. All 4 findings have RED test + GREEN fix on main (or, for CR-04, proof it was already closed by Phase 57 + a regression test locking it).
2. `pnpm test` green per-package (worker, data).
3. `pnpm lint:lockers` green (8 lockers).
4. `pnpm typecheck` — no new errors vs 5-error baseline.
5. Spot-check every fix: grep fingerprint + regression test references finding ID.
6. `git log --oneline` shows expected commits.
7. `REVIEW-INDEX.md` annotated "Closed by Phase 58".

## Reference

- Code review: `.planning/review/REVIEW-INDEX.md`
- Per-package: `.planning/review/worker.md`, `.planning/review/data.md`
- Phase 57: `.planning/phases/57-pre-publication-critical-fixes/` (PLAN, RESEARCH, DECISIONS)
- CLAUDE.md hard rules: 1, 3, 4
- Phase 57 Track A.2 commit `6133c2b` — relevant to CR-04 (`previous_token_fp` codegen)
