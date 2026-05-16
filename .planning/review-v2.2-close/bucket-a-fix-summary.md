# Bucket A Fix Summary — Phase-33 plaintext-column test regressions

Worktree branch: `worktree-agent-a546bf91cb99c90fa`
Base: `main @ 81401a0`
Scope: `pnpm --filter @openwhispr/data test` regressions traced to Phase 33
migrations 0019 / 0019b / 0020 (envelope encryption rollout) + Phase 41.f
migration 0022 (setup_state grants).

All 9 files were investigated. **6 required edits, 3 were already green** at the
time of investigation (likely fixed elsewhere upstream of this worktree base).
**No production code or migrations were touched.**

| # | File | Commit | Test-count delta | Rewrite-or-skip rationale |
|---|------|--------|------------------|---------------------------|
| 1 | `packages/data/tests/unit/__tests__/0001_better_auth.test.ts` | `6df92bc` | 2 fail → 17/17 pass | **Rewrite.** `account` / `verification` assertions pinned the pre-0020 plaintext columns (`password`, `access_token`, `refresh_token`, `id_token`, `value`). Replaced with assertions on the 6-bytea envelope sidecar tuple per credential (`<cred>_dek_wrapped`, `_dek_iv`, `_dek_auth_tag`, `_value_iv`, `_value_auth_tag`, `_value_ciphertext`) AND a negative assertion that the plaintext columns are absent. |
| 2 | `packages/data/tests/unit/__tests__/0002_oauth_state.test.ts` | `6f6cf7d` | 1 fail → 4/4 pass | **Rewrite.** Same shape as #1 for `oauth_state.code_verifier`. |
| 3 | `packages/data/migrations/__tests__/0017-setup-state.test.ts` | `413b443` | 1 fail → 6/6 pass | **Rewrite (test infrastructure).** `bootLegacyPreMigration()` stripped only the 0017 entry from the temp journal, so drizzle.migrate() reached migration 0022 (Phase 41.f forward-fix that GRANTs on `setup_state`) before 0017 had created the table — crashed with 42P01. Fix: strip every tag-prefix ≥ 0017 from journal + filesystem; `applyZeroSeventeen()` still replays only 0017 by hand to exercise the v1-upgrade `status='skipped_legacy'` branch. |
| 4 | `packages/data/migrations/__tests__/0019-envelope-encrypt-secret-columns-add.test.ts` | `116c2b2` | 12 fail → 64/64 pass | **Rewrite via pinned boot (option a).** Suite asserts the additive-only invariants of 0019 (sidecars added, plaintext + indexes untouched, .down restores pre-0019 shape). `bootMigratedPostgres()` replays through 0022 — already dropped plaintext. Introduced `bootPostZeroNineteen()` that copies migrations to a tmp dir, strips 0019b/0020/0021/0022, and runs drizzle.migrate() against the trimmed folder. Mirrors the pattern used in 0017 test. All original assertions kept verbatim. |
| 5 | `packages/data/tests/unit/__tests__/lookup-by-previous-token.test.ts` | `90af875` | 2 fail → 4/4 pass | **Rewrite (seed shape).** `seedSession()` INSERTed plaintext `sessions.token` + `sessions.previous_token` — both dropped by 0020. Rewrote the INSERT to bind only `token_fp` (NOT NULL UNIQUE post-0020), `previous_token_fp`, and `previous_token_expires_at`. The bytea envelope sidecars (`token_dek_*`, `token_value_*`) stay NULL — they're nullable and aren't exercised by the fingerprint-only lookup path the Node helper tests. |
| 6 | `packages/data/tests/unit/__tests__/backfill-cli.test.ts` | `56a2009` | 2 fail → 15/15 pass | **Rewrite via pinned boot.** The backfill CLI is forward-only between 0019 and 0020 by design (operator runbook in CLI header). Its idempotency predicate `"<col>" IS NOT NULL AND ...` 42703s post-0020. Introduced `bootPreZeroTwenty()` (same pattern as #4) that strips 0019b/0020/0021/0022. The CLI runs against the operator-intended snapshot. |
| 7 | `packages/data/tests/unit/__tests__/migrate-litellm-db.test.ts` | (no edit) | already green (5/5) | Not affected by Phase 33; user's note suspected Phase 41.e drift, but the test passes against current HEAD. |
| 8 | `packages/data/migrations/__tests__/0014-audit-log-partition.test.ts` | (no edit) | already green (6/6) | Partman child handling test passes at this worktree base. |
| 9 | `packages/data/tests/unit/__tests__/worker-rls-property.test.ts` | (no edit) | already green (2/2) | The Phase-32 fail-open ledger entry the user referenced does not match the current state of the test — it now passes. No skip needed. |

## Discipline notes

- **No production code touched.** Every fix is scoped to a `*.test.ts` file
  under `packages/data/tests/` or `packages/data/migrations/__tests__/`. No
  `as any`, `@ts-ignore`, or `@ts-nocheck` were added.
- **No `--no-verify` used.** Every commit passed the lefthook commitlint hook
  cleanly.
- **Test isolation.** Each fix re-ran with `pnpm exec vitest run <single file>`
  immediately after the edit; final verification re-ran all 9 in sequence
  (every file GREEN, full results above).
- **No coverage degradation.** All rewrites either add assertions (post-0020
  sidecar shape) or replace the boot fixture with a more accurate
  pinned-snapshot helper. No `it.skip`, no `expect.toBeTruthy()` placeholders.
- **Boot-fixture pattern.** Three suites (#3, #4, #6) now use the same
  copy-migrations-strip-tags-replay pattern. This pattern was already
  established in `0017-setup-state.test.ts` pre-edit and is the project's
  idiomatic way to assert pre-migration schema states without invading
  `bootMigratedPostgres()`.

## What I did NOT do (and why)

- I did NOT modify `helpers.ts` to expose a generic "stop-at-tag-N" boot
  helper, even though three suites now do similar work. Reason: the user's
  hard rule #1 forbids editing production code paths to make tests pass, and
  `helpers.ts` is the canonical helper imported across every data-package
  test. A future refactor phase can extract the shared shape if desired;
  surfacing that as a deferred item is the discipline-aligned move.
- I did NOT push, merge, or rebase. The worktree branch carries 6 atomic
  commits ready for collection.

## Followups (for collector to decide)

- **Optional refactor:** lift `bootPostZeroNineteen` / `bootPreZeroTwenty` /
  `bootLegacyPreMigration` into a shared `helpers-pinned.ts` to dedupe the
  ~80-line journal-strip block. Out of scope for bucket A.
- The `BootResult` import was removed from `backfill-cli.test.ts` (replaced
  by inline pinned-boot type). The linter reordered imports immediately
  after the edit — confirmed intentional, no functional change.
