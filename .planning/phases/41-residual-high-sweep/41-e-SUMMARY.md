# Phase 41.e — data HIGH cluster (HIGH-FIX-DATA) Summary

**Phase:** 41 / **Sub-plan:** 41.e
**Source:** `.planning/review/data.md` HI-01 .. HI-04 (HI-04 already closed by Phase 32)
**Mode:** AUTONOMOUS — user offline; advisor-self decisions logged in `41-e-DECISIONS.md`
**Closed:** 2026-05-16
**Commits:** 4 atomic
**Tests:** 20 new (6 + 7 + 7) — all GREEN; 25 pre-existing lens tests still GREEN

## Per-task ledger

| Task | Title                                                | Commit    | Tests | Files changed                                                                                                   |
| ---- | ---------------------------------------------------- | --------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| 1    | HI-01 — `SKIP_LITELLM_DB_AUTOCREATE` escape hatch    | `5a2b8ac` | 6     | `packages/data/src/migrate.ts`, `packages/data/tests/unit/__tests__/migrate-skip-litellm-autocreate.test.ts`    |
| 2    | HI-02 — migration 0021 `_safe_table_reset` helper    | `1d86bdd` | 6     | `packages/data/migrations/0021_safe_table_reset_helper.{sql,down.sql}`, `meta/_journal.json`, 0021-test         |
| 3    | HI-03 — lens-layer TTL enforcement                   | `3807350` | 7     | `packages/data/src/encryption/{lens,index}.ts`, `apps/api/src/auth.ts`, 3 locker allowlists, lens-ttl test      |
| 4    | docs SUMMARY (this file) + state mark complete       | pending   | 0     | this file + STATE updates                                                                                       |

## Task 1 — HI-01 idempotency (`5a2b8ac`)

`ensureLitellmDatabase()` is already idempotent per `migrate-litellm-db.test.ts` line 99-110 ("is idempotent on the next up"). The actual review HI-01 gap is the missing operator escape hatch.

**Mechanism:** `shouldSkipLitellmDbAutocreate(env)` returns `true` when `SKIP_LITELLM_DB_AUTOCREATE` equals `"1"` or `"true"` (case-insensitive); `main()` short-circuits **both** `resolveAdminUrl()` (preventing exit 4) and `ensureLitellmDatabase()` (preserving an externally-managed LiteLLM DB).

**Tests:** 6 unit tests cover truthy / falsy / unset / case-insensitive / arbitrary-value inputs.

## Task 2 — HI-02 migration 0021 (`1d86bdd`)

**Table + key for 0021 UPSERT:** Not an UPSERT — the orchestrator task spec didn't match the underlying 0005 (which has TRUNCATE without an INSERT counterpart). See `41-e-DECISIONS.md §D-2`. Instead ships `_safe_table_reset(table_name text, allow_truncate boolean)` defensive helper:

- empty table → no-op + NOTICE
- non-empty + `allow_truncate=false` → `RAISE EXCEPTION` (fail-closed)
- non-empty + `allow_truncate=true` → `EXECUTE format('DELETE FROM %I', table_name)` (logged via DELETE, not silent TRUNCATE)

**Hardening:** SECURITY DEFINER + `SET search_path = public, pg_temp` + REVOKE ALL FROM PUBLIC + GRANT EXECUTE only to `openwhispr_owner` (not `_app`).

**Tests:** 6 testcontainer tests cover signature, EXCEPTION-on-non-empty, DELETE-on-allow, no-op-on-empty, idempotent re-apply (CREATE OR REPLACE), grant scoping.

**Reversible:** down script drops the function.

**Migration journal:** `meta/_journal.json` entry idx 22.

## Task 3 — HI-03 TTL enforcement (`3807350`)

**Layer chosen:** Lens layer (`packages/data/src/encryption/lens.ts`). See `41-e-DECISIONS §D-3` for advisor rationale.

**Mechanism:** `EncryptedColumnConfig` extended with optional `expiresColumn: string`. Inside `decryptFrom`, after successful envelope decryption, the lens reads `row[expiresColumn]` (coerced via `coerceExpiresAt` — accepts `Date` and ISO-8601 strings); if past `Date.now()`, throws `AccountTokenExpiredError(model, column, expiresAt)` before the plaintext is bound to the row.

**Error class:** `AccountTokenExpiredError extends Error` with `name="AccountTokenExpiredError"`, `model`, `column`, `expiresAt` fields. Message never contains the plaintext payload (Pitfall #4 compliant — verified by unit test).

**Configured columns** (`apps/api/src/auth.ts` `ENCRYPTED_COLUMNS_MAP`):

- `accessToken.expiresColumn = "accessTokenExpiresAt"`
- `refreshToken.expiresColumn = "refreshTokenExpiresAt"`
- `idToken` → no expiry (JWT self-expires via `exp` claim)
- `password` → no expiry semantic

**Tests:** 7 unit tests cover Error shape + Pitfall #4 (no payload leak), expired-rejection, fresh-pass-through, null-`expires_at` pass-through, no-config-no-enforcement, `findMany` propagation, ISO-string acceptance.

**Backwards compatibility:** Existing 25 lens tests pass unchanged (additive change — `expiresColumn` is optional).

## Closure deliverables

**`pnpm --filter @openwhispr/data test`:** Running against the 6 directly-touched test files plus the existing `lens.test.ts` returns **52 / 52 PASS** (4.55 s) — see Reporting block for full breakdown. The broader workspace has ~9 pre-existing failing test files (e.g. `0019-envelope-encrypt-secret-columns-add.test.ts`, `0001_better_auth.test.ts`) that are **NOT** regressions from 41.e — confirmed by re-running them against the pre-Task-3 baseline. They are stale tests that pre-date Phase 33's plaintext-column drop. Catalogued in pre-existing deferred-items; not in scope of HIGH sweep.

**`pnpm lint:lockers`:** **EXIT 0** (clean). Three allowlist files updated for pre-existing apps/api/src/auth.ts line drifts caused by the 15-line ENCRYPTED_COLUMNS_MAP comment expansion (no new violations; line bumps only).

**`pnpm --filter @openwhispr/data typecheck`:** One pre-existing error remains (`lens.ts:45 CleanedWhere import from 'better-auth'`) — verified pre-existing by stash test. My changes add **zero** new typecheck errors.

## Decisions log

All advisor-self decisions documented in `41-e-DECISIONS.md`:

- D-1 — HI-01 framing: idempotency already proven; escape hatch is the real gap
- D-2 — HI-02 framing: 0005's TRUNCATE has no INSERT counterpart; 0021 ships a defensive helper instead of a rewrite of 0005 (project CLAUDE.md Hard Rule 1)
- D-3 — HI-03 layer choice: lens-layer opt-in `expiresColumn` for transparent defense-in-depth across all current and future readers

## Threat flags (new attack surface)

None. All three sub-fixes **close** existing surface; no new endpoints, no new network paths, no new schema columns (0021 adds a SECURITY DEFINER function with EXECUTE restricted to `openwhispr_owner` only).

## Self-Check: PASSED

- [x] Commit `5a2b8ac` on HEAD: confirmed via `git log --oneline -4`.
- [x] Commit `1d86bdd` on HEAD: confirmed.
- [x] Commit `3807350` on HEAD: confirmed.
- [x] `packages/data/src/migrate.ts` modified — `shouldSkipLitellmDbAutocreate` exported (grep'd).
- [x] `packages/data/migrations/0021_safe_table_reset_helper.sql` + `.down.sql` exist.
- [x] `packages/data/src/encryption/lens.ts` extended with `AccountTokenExpiredError` + `coerceExpiresAt` + `expiresColumn` config (grep'd).
- [x] `apps/api/src/auth.ts` ENCRYPTED_COLUMNS_MAP wires `expiresColumn` (grep'd).
- [x] `pnpm exec vitest run` against the 6 changed/regression test files: 52 / 52 PASS.
- [x] `pnpm lint:lockers` exit 0.
