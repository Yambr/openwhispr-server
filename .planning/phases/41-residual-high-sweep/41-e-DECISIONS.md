# Phase 41.e — Decisions log (advisor-self / user offline)

## D-1 — Task 1 (HI-01): idempotency already proven; escape hatch is the real gap

**Context:** The orchestrator prompt's Task 1 RED ("call init twice; assert second call is a no-op") is **already proven** by `packages/data/tests/unit/__tests__/migrate-litellm-db.test.ts` line 99-110 ("is idempotent on the next up"). `ensureLitellmDatabase()` uses `SELECT 1 FROM pg_database WHERE datname='litellm'` then conditional `CREATE DATABASE` — first-class idempotent SELECT-then-CREATE pattern.

The review HI-01 actually flags two separate, distinct gaps:
1. Admin pool may leak on async-error paths between `new Pool(...)` and `try`.
2. `migrate.ts:165` exits with code 4 if `resolveAdminUrl()` returns null — operator content with a pre-existing LiteLLM DB cannot run migrate without setting `POSTGRES_ADMIN_URL` or `DATABASE_URL_OWNER`. **No `SKIP_LITELLM_DB_AUTOCREATE=1` escape hatch exists.**

**Decision:** Implement the **`SKIP_LITELLM_DB_AUTOCREATE` escape hatch** in `migrate.ts` per the review's explicit fix recommendation. Add a RED test that asserts `main()` (or its testable extraction) honors the env flag and skips `ensureLitellmDatabase()` + `resolveAdminUrl()` + the exit-4 path. Idempotency tests already exist — adding redundant test is dead-test debt.

**Why:** The orchestrator's task framing is approximate; the review's authoritative HI-01 fix is the escape-hatch. Adding it closes operator UX gap (review HI-01 §Fix) and matches the user-supplied pattern (Phase 19a hot-fix `OPENWHISPR_DISABLE_RATE_LIMIT`, `OPENWHISPR_DISABLE_EMAIL_VERIFICATION`).

## D-2 — Task 2 (HI-02): 0005 TRUNCATE has no INSERT counterpart; 0021 ships a defensive helper

**Context:** Orchestrator Task 2 specifies "replace 0005's TRUNCATE+INSERT with idempotent UPSERT." But `0005_session_token_plain.sql:33` has `TRUNCATE TABLE "sessions"` followed by **DDL (DROP/ADD COLUMN)**, **not** an `INSERT`. The "TRUNCATE+INSERT seed" pattern from the task spec does not exist in 0005. 0005 is already applied — Drizzle's `__drizzle_migrations` bookkeeping prevents replay; we cannot retroactively change 0005's behaviour for already-migrated DBs.

Review HI-02's fix prescribes one of: (a) replace TRUNCATE with `DELETE` wrapped in `IF NOT EXISTS`, (b) guard with `IF (SELECT count(*)) > 0 THEN RAISE NOTICE`, (c) document the breaking-migration boundary in CHANGELOG.

**Decision:** Migration **0021_safe_table_reset_helper.sql** ships a SECURITY-DEFINER helper function `_safe_table_reset(table_name text, allow_truncate boolean)` that:
- Counts rows in the target table.
- If non-empty AND `allow_truncate=false` → `RAISE EXCEPTION` (fail-closed for future migrations that forget the explicit override).
- If empty OR `allow_truncate=true` → `EXECUTE format('DELETE FROM %I', table_name)` (logged via DELETE, not silent TRUNCATE).
- GRANT EXECUTE to `openwhispr_owner` only (DDL-time use).

Migration test asserts: (a) seed 1 row → call `_safe_table_reset('sessions', false)` → EXCEPTION raised, row survives; (b) call with `allow_truncate=true` → row deleted; (c) re-apply 0021 → idempotent (CREATE OR REPLACE FUNCTION).

**Down script:** `DROP FUNCTION IF EXISTS _safe_table_reset(text, boolean)` — fully reversible.

**Why:** Codifies the review's recommended pattern as reusable infrastructure for future migrations; preserves 0005's already-applied state (no rewrite of historical migrations — see project CLAUDE.md Hard Rule 1). The function is **declarative defense-in-depth** for v2 multi-tenant migrations that may touch session data.

## D-3 — Task 3 (HI-03): TTL check at the lens layer via opt-in `expiresColumn` config

**Context:** Phase 33 envelope-encrypted `account.{access,refresh,id}_token`. `expires_at` columns remain plaintext. Review HI-03 notes no read-site filter on expired tokens; recommended fix is a **sweeper worker** (analogous to `oauth_state`). Orchestrator Task 3 instead specifies a **read-time TTL check**.

Layer options:
- **(a) Lens layer:** Extend `EncryptedColumnConfig` with optional `expiresColumn: string`. After successful decrypt, if `row[expiresColumn] < now()`, throw `AccountTokenExpiredError`.
- **(b) Route handler:** Manual `assertAccountTokenFresh(account)` at each consumer site. apps/api currently has no consumer site (`mint-bearer.ts` writes but does not read).
- **(c) Better Auth adapter wrap:** Custom logic on `findOne`/`findMany` outside the lens.

**Decision:** **Option (a) — lens-layer opt-in `expiresColumn` config.**

**Why:**
- **Single chokepoint:** Every read path (Better Auth internalAdapter, future refresh-token consumers, audit/sweep tooling) goes through the lens. Putting the check there gives transparent enforcement for current AND future readers.
- **Defense-in-depth:** Even if a future route handler forgets to call an explicit `assertFresh()` helper, the lens enforces.
- **Opt-in:** Only columns that declare `expiresColumn` get the check — backwards-compatible for `verification.value`, `session.token`, and `account.password` (which have no `expires_at` semantics).
- **Phase 33 architectural fit:** The lens already owns the encrypted-column lifecycle; TTL is the natural sibling concern.

New error class `AccountTokenExpiredError` exported from `@openwhispr/data` (via `encryption/index.ts`). Carries `model`, `column`, `expiresAt` for diagnostic context (no plaintext payload — Pitfall #4 compliant).

Configuration in `apps/api/src/auth.ts` `ENCRYPTED_COLUMNS_MAP`:
```ts
account: {
  accessToken: { sidecarPrefix: "access_token", expiresColumn: "accessTokenExpiresAt" },
  refreshToken: { sidecarPrefix: "refresh_token", expiresColumn: "refreshTokenExpiresAt" },
  // ...
}
```

`id_token` is JWT-self-expiring (carries its own `exp` claim) — no `id_token_expires_at` column exists; not gated. `password` has no expiry. `verification.value` has its own `expiresAt` column but the existing Better Auth verification flow already filters — not in scope for HIGH sweep.

**Sweeper deferral:** Per-row TTL sweep job recommended by the review is deferred to a future operability phase; the read-time check closes the immediate exploit surface (replay of expired token).
