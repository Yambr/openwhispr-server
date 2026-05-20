# Data-layer adversarial review — pre-publication

Branch: `main` @ 6e43588. Scope: `packages/data/src/**` and `packages/data/migrations/*.sql`.
Review posture: FORCE — assume every claim in the code comments is a lie until traced to its actual call site.

---

## Summary

The data layer is well-shaped on the surface (canonical `withTenant` chokepoint, fail-closed RLS via `NULLIF(...)::uuid`, two-pool client separation, envelope-encryption library, boot-time KEK gate). However, the Better-Auth integration silently undoes the load-bearing security premise of Phase 33 envelope-encryption at rest, and migration 0024 silently re-establishes a fail-OPEN RLS posture that migration 0018 had explicitly torn down. Both are documented in code comments as deliberate choices, which makes them harder to spot in review but does not change their security impact.

**Top three issues:**

1. **CRITICAL — Plaintext credentials at rest for every Better-Auth-owned column.** `apps/api/src/auth.ts:160` declares `ENCRYPTED_COLUMNS_MAP: EncryptedColumnMap = {}`. The empty map means `wrapAdapter` walks zero columns on the `account` / `session` / `verification` models. Migration 0025 re-added the 7 plaintext columns (`account.password`, `account.access_token`, `account.refresh_token`, `account.id_token`, `verification.value`, `sessions.token`, `sessions.previous_token`) as nullable text, and Better Auth's `drizzleAdapter` writes plaintext into them on every sign-up, OAuth link, password reset, and session rotation. The schema-file comments (e.g. `accounts.ts:42-49`) still claim "Plaintext value NEVER lands here at runtime: the envelope-encryption lens intercepts every write" — this is FALSE post-Plan 51-23/24. The LOCKER-08 linter inline-allowlists these columns on the same false premise (`tools/lint-no-plaintext-secret-columns.ts:101-117`). Net effect: at-rest encryption for credentials, the entire delivered value of CRIT-FIX-02 / Phase 33, is reverted.

2. **CRITICAL — Fail-OPEN RLS posture re-installed by migration 0024.** Migration 0018 (CRIT-FIX-01, Phase 32) explicitly RESETS `ALTER ROLE openwhispr_app ... app.tenant_id` and DROPs the `tenant_id` column DEFAULTs from the four Better-Auth tables, so route code that forgets `withTenant()` produces zero rows / 42501 instead of leaking the default tenant. Migration 0024 RE-INSTALLS both. Now every backend connection from the app role lands with `app.tenant_id` bound to the default tenant via rolconfig, and every Better-Auth `INSERT (default,...)` resolves to that tenant. This silently re-establishes the v1 single-tenant posture documented as DEFERRED-to-v2 in 0003, AFTER Phase 32 had committed the multi-tenant fail-closed posture. The 16-tables × 4-ops × 2-contexts property test that pinned Phase 32's guarantee is now meaningless for the four Better-Auth tables.

3. **CRITICAL — Plan 51-23/24 amendment was driven by test failures.** Per CLAUDE.md hard rule 1 and the commit ledger (`13a1547 fix(51-23+24): better-auth full sign-up flow + locker-08 amendment`, `da674a3 fix(51-21+22): seed-on-boot bundling + better-auth tenant column defaults`), the LOCKER-08 amendment and the column-defaults restoration were both performed to make Better Auth's sign-up flow succeed — i.e. to make tests/E2E green — by mutating production schema and reverting the constitutional rule. The official path for such a decision is a DISCIPLINE amendment with rationale, but the rationale documented inline (`tools/lint-no-plaintext-secret-columns.ts:101-107`, `auth.ts:124-159`) is false: it claims the lens deletes plaintext before INSERT, when in fact `ENCRYPTED_COLUMNS_MAP = {}` means the lens never fires for these columns. The amendment effectively rewrote production SQL/schema to satisfy a Better-Auth-integration test.

---

## Findings

### CRITICAL

#### CR-01 — Plaintext credentials persisted by Better Auth via empty ENCRYPTED_COLUMNS_MAP
`apps/api/src/auth.ts:160`, `packages/data/src/schema/accounts.ts:51-54`, `packages/data/src/schema/sessions.ts:39-40`, `packages/data/src/schema/verifications.ts:28`, `packages/data/migrations/0025_better_auth_account_plaintext_compat.sql:34-46`

Schema declares 7 plaintext credential columns as "compat sentinels never written". Linter LOCKER-08 inline-allowlists them on the premise that `lens.ts::encryptInto()` deletes the plaintext key before Drizzle builds the INSERT. But `auth.ts:160` ships `ENCRYPTED_COLUMNS_MAP = {}` — the lens's per-model loop (`lens.ts:351`) short-circuits on `if (!modelCols) return;` for every Better-Auth-owned model. Plaintext therefore travels straight to the DB. Every OAuth refresh token, ID token, scrypt-hashed password, email-verification token, password-reset token, session bearer, and previous-token bearer is stored as `text` at rest with zero envelope encryption.

The 48 bytea sidecar columns added by migration 0019 sit empty for these models forever; they are not even cleaned up in 0025/0026 — pure schema overhead with no security benefit.

The Better-Auth canonical-security-posture argument in `auth.ts:138-144` is incomplete: it correctly notes that passwords arrive scrypt-hashed, but `access_token`, `refresh_token`, `id_token`, `verification.value`, and `sessions.token` are stored in **plaintext** by Better Auth's drizzleAdapter — those are the columns that envelope-at-rest was designed for in the first place.

#### CR-02 — Fail-OPEN RLS posture re-installed by 0024
`packages/data/migrations/0024_better_auth_tenant_id_defaults.sql:40-59`

Migration 0024 re-issues `ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-...'` and re-installs `ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid` on `users` / `sessions` / `account` / `verification`. Migration 0018 (`0018_rls_fail_closed.sql:27-42`) explicitly removed both because they collapsed RLS to fail-open for the default tenant. With 0024 applied:

- Any code path that touches the four Better-Auth tables WITHOUT `withTenant()` runs against `app.tenant_id = '00000000-...'` — silently visible data from the default tenant, no 42501.
- The PgBouncer transaction-pool reuses physical connections; rolconfig is applied once at backend-connect and stays for the life of the connection. With 0024 the GUC is no longer required-by-route per the fail-closed contract.
- The 128-case property test that pinned CRIT-FIX-01 (`packages/data/tests/unit/__tests__/rls-fail-closed.property.test.ts`, referenced in `tenant-context.ts:88`) covers only tables outside the Better-Auth set under the new posture.

If multi-tenancy ever ships (v2 per the 0003 deferral note), this rolconfig will silently bind every connection to the default tenant regardless of incoming request context — every request leaks the default tenant.

#### CR-03 — LOCKER-08 amendment rationale is false; schema mutation driven by tests
`tools/lint-no-plaintext-secret-columns.ts:101-117`, `packages/data/migrations/0025_*.sql`, `packages/data/migrations/0026_*.sql`, git commits 13a1547 and da674a3

The `LENS_INTROSPECTION_COMPAT` allowlist comment block (lint-no-plaintext-secret-columns.ts:101-107) states that the lens "DELETES the plaintext key from the row payload BEFORE Drizzle builds the INSERT SQL, so the DB column NEVER receives plaintext at runtime." This is mechanically impossible given `auth.ts:160` `ENCRYPTED_COLUMNS_MAP = {}`. The amendment's load-bearing premise is incorrect, but it is what was used to justify both (a) restoring the columns and (b) extending the LOCKER-08 allowlist.

Per CLAUDE.md hard rule 1: production schema and the LOCKER discipline were modified to satisfy a Better-Auth integration failure. The correct discipline path would have been to either (a) wire the wrapAdapter↔Better-Auth `additionalFields` integration (acknowledged in `auth.ts:152-157` as deferred) or (b) document the deferral and surface the security gap in `.planning/deferred-items.md` without mutating production.

#### CR-04 — AUTH-04 5-minute overlap window: `previous_token_fp` never populated by Better Auth
`packages/data/src/sessions/lookup-by-previous-token.ts:58-72`, `packages/data/migrations/0026_better_auth_session_token_fp_nullable.sql:1-26`

The Node-side helper `lookupSessionByPreviousToken` queries `sessions.previous_token_fp` (the SHA-256 fingerprint). Migration 0026's own comment block (lines 1-23) admits: "Better Auth writes the plaintext session token directly via its drizzleAdapter; the lens does NOT fire, so the SHA-256 fingerprint sidecar (`token_fp`) that the lens used to produce on write is never populated." This silently breaks the AUTH-04 5-minute token-rotation overlap contract for every session rotated by Better Auth — `previous_token_fp` is always NULL, the helper always returns null, and a desktop client that retries the previous bearer within the 5-minute window gets a 401 instead of the rotated session.

The contract is preserved on paper by the new partial UNIQUE INDEX on plaintext `sessions.token`, but the dual-token overlap behavior described in `tenant-context.ts:88` references and Phase 33 design docs is no longer behaviorally backed.

#### CR-05 — `decryptCodeVerifierFromRow` plaintext-fallback path is dead AND keeps stale type
`packages/data/src/encryption/oauth-state-codec.ts:62-95`

Type `RowWithSidecars` still declares `code_verifier?: string | null` and the fallback at `oauth-state-codec.ts:94` returns `row.code_verifier` when sidecars are absent. Migration 0020 dropped the plaintext `code_verifier` column from `oauth_state`; the column is gone. Any row that reaches this helper without sidecars (corruption, broken backfill, partial UPDATE) now silently falls through to `undefined` and throws the "missing both plaintext code_verifier and bytea sidecars" message — except the type still encourages callers to fill it. Worse: should anyone ever rehydrate a code_verifier string into a row dict (test scaffolding, route hot-fix, replay), the codec will quietly skip decryption and trust a caller-supplied secret. The fallback path needs to be deleted, not left as an alley.

### HIGH

#### HI-01 — Migration 0005 `TRUNCATE TABLE "sessions"` is destructive on replay
`packages/data/migrations/0005_session_token_plain.sql:33`

Unconditional TRUNCATE of `sessions` in an applied-in-order migration. The comment justifies it as "Phase 02 is dev-only" but the migration journal entry is the same one that will run against any operator's pre-0005 install — including ones with live sessions. Migration 0021 introduced `_safe_table_reset(...)` to prevent recurrence but cannot retroactively fix 0005. Forward-only mitigation is to add a NOTICE/raise-on-non-empty guard, but per CLAUDE.md hard rule 1 the 0005 file must not be touched. Surface in operator runbook as "destructive forward migration" with explicit pre-flight check.

**Status:** CLOSED 2026-05-21 — Phase 67, commit `a2397a62` — `docs/operations.md` gained a "Destructive forward migrations" section naming migration 0005's unconditional `TRUNCATE TABLE "sessions"`, with a pre-flight check for operators upgrading a pre-0005 install (all sessions cleared, no `.down.sql`, schedule a maintenance window). Migration 0005 SQL unchanged (CLAUDE.md hard rule 1).

#### HI-02 — `api_keys.user_id` foreign-key column has no index
`packages/data/migrations/0010_api_keys.sql:10-13, 36-48`

`api_keys.user_id` is a NOT NULL FK with `ON DELETE CASCADE` to `users.id`. The only indexes on `api_keys` cover `key_prefix` (unique), `(tenant_id, name)` partial unique, and the `(tenant_id, created_at DESC, id DESC)` partial keyset. None starts with `user_id`. `DELETE FROM users WHERE id = ?` triggers a sequential scan of `api_keys` to enforce the cascade — fine on tiny instances, expensive at 1000-user load-test scale. Same observation applies to `transcriptions.user_id` (`0009_transcriptions.sql`), `conversations.user_id`, `messages.user_id`, `notes.user_id`, `folders.user_id` — none have a dedicated `user_id` index; only the keyset partial index, which is sufficient for tenant-scoped LIST but not for the FK cascade scan.

**Status:** CLOSED 2026-05-21 — Phase 67, commits `4d15757f` (RED) + `4747b4c8` (GREEN) — new forward migration `0029_fk_user_id_indexes.sql` adds a dedicated leading-`user_id` index on `transcriptions`, `conversations`, `messages`, `notes`, `folders` (5 tables), with a `0029.down.sql` companion and a `_journal.json` idx:30 entry. Plain `CREATE INDEX` (the migration runner wraps each file in a transaction → `CONCURRENTLY` is illegal). A `HI-02`-named migration test boots a fresh testcontainer Postgres and asserts the 5 indexes exist post-apply. **Correction to the review:** `api_keys` is EXCLUDED — migration 0028 (`0028_api_keys_name_scope.sql`) already rescoped `api_keys_active_name_idx` from `(tenant_id, name)` to `(user_id, name)`, a leading-`user_id` index sufficient for the FK cascade scan.

#### HI-03 — Migration 0014 `audit_log` partitioning: legacy rows backfilled into `audit_log_default`, never promoted
`packages/data/migrations/0014_audit_log_partition.sql:118-138`

Migration runs `INSERT INTO "audit_log" SELECT ... FROM "audit_log_legacy"` then drops the legacy table. With `infinite_time_partitions = true` and the migration running inside a transaction (cannot call `run_maintenance_proc()` because it issues COMMIT internally), every legacy row whose `created_at` predates the 4 premade monthly partitions lands in `audit_log_default` — a catch-all. The plan defers promotion to "the daily partman-maintenance BullMQ job", but until that job runs once, the legacy rows live on the default partition and queries scanning specific months miss them. If the BullMQ job is misconfigured or fails to deploy, legacy audit data is silently invisible to month-scoped queries. Surface as runbook step.

**Status:** CLOSED 2026-05-21 — Phase 67, commit `a2397a62` — `docs/operations.md` gained an "Audit-log partition maintenance after upgrade" section: after upgrading through migration 0014 the operator must let the daily `partman-maintenance` BullMQ job run (or run `CALL partman.run_maintenance_proc();` once manually, outside a transaction) to promote legacy `audit_log` rows off `audit_log_default`; until then month-scoped audit queries silently miss legacy rows. Migration 0014 SQL unchanged (CLAUDE.md hard rule 1).

#### HI-04 — `backfill.ts` idempotency predicate is broken post-0020/0025
`packages/data/src/encryption/backfill.ts:108-148`

The backfill SQL is `WHERE "${column}" IS NOT NULL AND "${column}_value_ciphertext" IS NULL`. Designed to run between 0019 (additive bytea) and 0020 (drop plaintext). After 0020 dropped the plaintext columns, the SQL fails with 42703 (undefined column) — that's flagged as expected. But 0025 re-added the plaintext columns as nullable text. Running the backfill CLI now (e.g., as a recovery step or in CI) will:

1. SELECT every row where the column is non-null — these are Better-Auth-written plaintext credentials (CR-01).
2. Encrypt each plaintext into the bytea sidecars.
3. UPDATE the row to set sidecars — but leave the plaintext column populated.
4. Result: plaintext credentials AND ciphertext sidecars coexist in the same row. Next read goes through the lens (also broken per CR-01), but if a future operator wires the lens correctly, the lens sees sidecars and decrypts — silently overwriting the plaintext that Better Auth was actively using.

The backfill module needs an explicit guard: refuse to run if the target column is `account.*` / `verification.value` / `sessions.token` / `sessions.previous_token` while `ENCRYPTED_COLUMNS_MAP` is empty for those models.

**Status:** CLOSED 2026-05-21 — Phase 67, commits `c0837847` (RED) + `15a0095d` (GREEN) — `runBackfill` (`backfill.ts`) gained a static `LENS_MANAGED_COLUMNS` refuse-set; it throws (naming the offending `table.column`) before any SQL for `account.{password,access_token,refresh_token,id_token}`, `session/sessions.{token,previous_token}`, `verification.value`. **Stale-premise correction:** the review's "while `ENCRYPTED_COLUMNS_MAP` is empty" framing is OUT OF DATE — Phase 57 Track A populated `ENCRYPTED_COLUMNS_MAP` (`apps/api/src/auth.ts:172`), so the lens encrypts those columns on write. The guard is therefore a STATIC lens-managed refuse-list (independent of any runtime map emptiness), and matches BOTH the `session` model name and the `sessions` SQL table name (table-name skew). The CLI `DEFAULT_COLUMN_MAP` was narrowed to only `oauth_state.code_verifier` (the sole non-lens-managed column). Defence-in-depth for LOCKER-08; no allowlist change.

#### HI-05 — `audit_log_tenant_id_tenants_id_fk` declared `ON DELETE no action` while children cascade
`packages/data/migrations/0000_initial.sql:78-80`, `0014_audit_log_partition.sql:76-78`

`audit_log.tenant_id → tenants.id` is `ON DELETE NO ACTION`, while every other tenant_id FK is `ON DELETE CASCADE` (notes/folders/conversations/messages/transcriptions/api_keys) or `RESTRICT` (users). `audit_log` is append-only by design, so deleting a tenant fails if any audit row exists — which is correct for the audit posture but is undocumented. Should be a code comment on the table declaration or in `.planning/deferred-items.md` for the operator tenant-delete runbook. Same for `usage_ledger`, `account`, `verification`, `sessions` (all `NO ACTION` on tenant_id by 0000_initial / 0001_better_auth).

**Status:** CLOSED 2026-05-21 — Phase 67, commit `a2397a62` — rationale comments added to the `pgTable` declarations in `audit_log.ts`, `usage_ledger.ts`, `sessions.ts`, `accounts.ts`, `verifications.ts` (the deliberate `ON DELETE NO ACTION` tenant FK; append-only / identity posture; contrast with the sibling `CASCADE` tenant FKs). `docs/operations.md` gained a "Tenant deletion" section: deleting a tenant fails with an FK violation if any of those 5 tables references it; append-only audit/usage rows must be exported, not silently dropped. Comment-only edits to schema TS files — no migration SQL changed (CLAUDE.md hard rule 1).

#### HI-06 — VaultKeyProvider and KmsKeyProvider are stubs but exported from public barrel as production-grade types
`packages/data/src/encryption/index.ts:30,39`, `packages/data/src/encryption/vault-key-provider.ts:13-27`, `packages/data/src/encryption/kms-key-provider.ts:13-27`

`@openwhispr/data/encryption` re-exports `VaultKeyProvider` and `KmsKeyProvider` as if they were complete `KeyProvider` impls. They throw `NOT_IMPLEMENTED` on every method. `validateKeyProviderSelection()` (`boot.ts:104-109`) refuses `OPENWHISPR_KEY_PROVIDER=vault|kms` at boot, which is the intended guard — but a downstream package that imports `KmsKeyProvider` and instantiates it programmatically (outside `selectProvider()`) gets a constructible-but-broken object. CLAUDE.md describes "AWS KMS / GCP KMS / Azure Key Vault / HashiCorp Vault" in docs/security.md §12 as available, implying production support; the code is not. Documentation vs. code drift.

**Status:** CLOSED 2026-05-21 — Phase 67, commits `3835c0b2` (RED) + `20a75949` (GREEN) — approach (a): the two `export { KmsKeyProvider }` / `export { VaultKeyProvider }` lines were removed from the public barrel `encryption/index.ts`; the stubs stay reachable internally via `selectProvider()` (which imports them directly from their own files — no downstream barrel importer existed). `docs/security.md §12` gained §12.1.1 stating v1 supports `OPENWHISPR_KEY_PROVIDER=env` only; `vault`/`kms` are v2-roadmap stubs refused at boot; §12.5 reframed as `MASTER_KEK` byte-sourcing via the `env` provider. Code and docs now agree. A `HI-06`-named module-surface test pins `barrel.VaultKeyProvider`/`barrel.KmsKeyProvider` undefined and `selectProvider` still exported.

### MEDIUM

#### ME-01 — Stale comments in `accounts.ts` / `sessions.ts` / `verifications.ts` claim plaintext "NEVER lands here at runtime"
`packages/data/src/schema/accounts.ts:42-49`, `packages/data/src/schema/sessions.ts:34-44`, `packages/data/src/schema/verifications.ts:25-27`

Comments still describe Phase 33-05 semantics that Plan 51-23/24 reversed. Future maintainers will read these and assume the lens fires — wrong. The comments need to be updated to match `ENCRYPTED_COLUMNS_MAP = {}` reality, or the security gap needs to be closed (CR-01 fix).

#### ME-02 — `seed/conformance.ts` ships `'argon2id$placeholder'` as a key_hash literal
`packages/data/src/seed/conformance.ts:219`

The seeded API key row stores literal `'argon2id$placeholder'` in `key_hash`. Anyone wiring an auth path that ever resolves the seed API key by prefix and tries to verify against the hash gets undefined behavior — Argon2 verification on a non-PHC string throws. Acceptable for a seed-only row that no production code ever Auth-hits, but the literal `placeholder` is a code smell that signals "this row is fictional"; should be a clearly-named constant (e.g. `SEED_API_KEY_DEAD_HASH`) and the route must reject keys with this hash explicitly.

#### ME-03 — `DEFAULT_TENANT_ID` constant is re-declared in `seed/conformance.ts`
`packages/data/src/seed/conformance.ts:35`

`const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";` duplicates the value baked into migration 0000 + 0003 + 0024 + LOCKER-03 allowlist. Risk of drift if the constitutional UUID ever changes (extremely unlikely, but the duplication is unnecessary). Better: a single `export const DEFAULT_TENANT_ID = ...` in the public barrel.

#### ME-04 — `api_keys` lacks an explicit `tenant_id`-only index
`packages/data/migrations/0010_api_keys.sql`

The keyset partial index `(tenant_id, created_at DESC, id DESC) WHERE revoked_at IS NULL` covers most query patterns, but list-all-keys-including-revoked or admin-counts-per-tenant queries miss the index. Marginal at v1 scale.

#### ME-05 — `lookup-by-previous-token.ts` runs on the OWNER pool (BYPASSRLS) by design but is exposed via the public surface
`packages/data/src/sessions/lookup-by-previous-token.ts:18-23,55-72`

The helper acknowledges BYPASSRLS posture in comments and is invoked with the owner pool, but it's NOT exported from `src/index.ts` — callers must reach into `packages/data/src/sessions/lookup-by-previous-token.ts` directly. That's an undocumented public surface that bypasses the data-package's barrel-only public API discipline. Either export it (and surface the BYPASSRLS warning explicitly in the type signature, e.g. `OwnerExecutor`) or move it under `internal/`.

#### ME-06 — `oauth-state-codec.ts` `RowWithSidecars` interface is structurally typed and accepts arbitrary `code_verifier_*` fields
`packages/data/src/encryption/oauth-state-codec.ts:62-70`

The interface uses optional `Buffer | null` for every sidecar, so `decryptCodeVerifierFromRow` does runtime `Buffer.isBuffer` checks but a caller can pass `{ code_verifier_dek_wrapped: <some-string> }` and only fail at the `Buffer.isBuffer` guard. The contract would be tighter as a discriminated union of "row with all sidecars present" vs "row with none".

#### ME-07 — `migrate.ts::ensureLitellmDatabase()` admin pool reuses the owner credentials for the `postgres` maintenance DB
`packages/data/src/migrate.ts:70-95,99-118`

`resolveAdminUrl()` defaults to swapping the path component of `DATABASE_URL_OWNER` to `/postgres`. Implies `openwhispr_owner` has CONNECT on the `postgres` maintenance database — true for stock pg containers, but an operator using a hardened pg cluster where `postgres` DB connect is REVOKED will hit the failure here without context. Operator runbook should mention `POSTGRES_ADMIN_URL` is the cleaner path for production.

### LOW

#### LO-01 — `seed_tenant_settings()` SECURITY DEFINER lacks `SET search_path = pg_temp` in 0006
`packages/data/migrations/0006_tenant_settings.sql:62-73`

Has `SET search_path = public` but not `, pg_temp`. PG SECURITY DEFINER hardening best practice is `public, pg_temp` (mirrored elsewhere — e.g. `_safe_table_reset` in 0021 line 26 has it, `session_lookup_by_token` in 0005 line 89 has it). Defense in depth.

#### LO-02 — `audit_log_action_check` enumeration duplicated between schema and migration
`packages/data/src/schema/audit_log.ts:25-44`, `packages/data/migrations/0014_audit_log_partition.sql:56-75`

Same 18-action enumeration in two places. Schema list is annotated `// D-A6 — canonical 18-action enumeration. The same list is enforced at the database layer via the audit_log_action_check CHECK constraint` so the duplication is known. Single-source by exporting the list constant and using a SQL function or generator to emit the CHECK clause would be cleaner; not blocking.

#### LO-03 — `validateMasterKek` accepts a base64url string that decodes to padded 32 bytes from non-32 input
`packages/data/src/encryption/boot.ts:84-96`

`Buffer.from(raw, "base64url")` silently drops non-alphabet chars and may produce 32 bytes from non-canonical input. The length check catches truncated/over-length input, but an operator who pastes a base64-padded (`=`) value where base64url-unpadded is expected may not realize the input got rewritten. Document the bootstrap.sh output shape in the error message or accept both base64 and base64url explicitly.

#### LO-04 — `client.ts::buildPoolConfig` `rejectUnauthorized: false` default for self-signed certs is the right call but undocumented at call sites
`packages/data/src/client.ts:38-46`

`PGSSL_REJECT_UNAUTHORIZED=1` is the production flip. The signature `makeAppDb()` / `makeOwnerDb()` does not surface this — operators reading just the public API have no breadcrumb to the env-var name. Add to readme/runbook.

#### LO-05 — `withTenant` rejects non-UUID with `String(tenantId)` interpolation
`packages/data/src/tenant-context.ts:96`

`throw new Error(\`withTenant: invalid tenant UUID: ${String(tenantId)}\`);` — if a caller passes a Buffer or a circular ref, `String(...)` may produce `[object Object]` or throw. Tiny but real. Use `JSON.stringify(tenantId)` with a try/catch, or just `typeof tenantId` + a hint.

---

## Migration-specific section

Reviewed every migration in `packages/data/migrations/`. Highlights:

**Hardcoded `"public"` schema in FK references:** Spot-checked all migrations — none use `"public"."tenants"` literal FK references. Schema is implicitly resolved via `search_path`. (CLAUDE.md hard rule 1 reference is preserved — no test-driven schema mutation found of this shape.)

**Idempotency / re-runnability:**
- 0000 — INSERT default tenant uses `ON CONFLICT DO NOTHING`. Safe.
- 0003 — same; idempotent.
- 0005 — **NOT idempotent.** Unconditional TRUNCATE. See HI-01.
- 0006 — backfill uses `ON CONFLICT DO NOTHING`. Safe.
- 0014 — drops legacy table; replay would 42P01 on the rename step. Safe on linear migration but a no-go for partial-rollback replay.
- 0019/0020/0021/0023/0024/0025/0026 — all idempotent via `IF EXISTS` / `ADD COLUMN IF NOT EXISTS` / `ALTER ... SET DEFAULT` (last-write-wins).
- 0019b — `DROP FUNCTION IF EXISTS`. Safe.

**Down-migration gaps:**
- 0005 has NO `.down.sql` companion. Truncated session rows cannot be restored.
- 0014 has a `.down.sql`, but pg_partman state rollback is operationally fragile.
- 0019/0020/0021/0024 each have `.down.sql` companions; status reviewed at the named files (not in scope to validate full reverse semantics in this pass).
- 0023/0025/0026 — companion `.down.sql` not visible in directory listing for 0023/0025/0026. Forward-only is OK per CLAUDE.md hard rule 1 for committed-to-production migrations, but the deferred operator-rollback path should at least exist as a documented rescue script for the new envelope-encryption columns.

**RLS coverage:** Every tenant-scoped table from `TENANT_SCOPED_TABLES` (`schema/index.ts:25-44`) has `ENABLE + FORCE ROW LEVEL SECURITY + tenant_isolation policy` in its source migration:
- users/sessions/audit_log/usage_ledger — 0000
- account/verification — 0001
- oauth_state — 0002
- tenant_settings/user_settings — 0006
- notes/folders — 0007
- conversations/messages — 0008
- transcriptions — 0009
- api_keys — 0010
- audit_log (re-issued on partitioned parent) — 0014
- usage_rollup_daily — 0015
- All thirteen tables had their policy bodies rewritten to NULLIF-cast fail-closed form in 0018 — verified.

Tables without RLS (correct posture):
- `tenants` — root tenant table; documented in `schema/tenants.ts:1-4`.
- `setup_state` — operator-global singleton; documented in `schema/setup_state.ts:3-7`.

**Schema mutations driven by tests (CLAUDE.md hard rule 1 check):**
- 0024 + 0025 + 0026 + the LOCKER-08 amendment together form the Plan 51-22/23/24 push that made Better-Auth sign-up green at the cost of plaintext-at-rest and rolconfig-bound RLS. Commit messages (`fix(51-23+24): better-auth full sign-up flow + locker-08 amendment`) acknowledge "fix" of "Better Auth full sign-up flow" — i.e. fixing tests/E2E by mutating production schema. This is the violation flagged in CR-03.
- No other applied-migration mutation in this codebase visibly fits the "test-driven schema change" pattern. 0021 (`_safe_table_reset`), 0022 (`setup_state` grants), 0023 (drop stale fn) are all forward-additive fixes with non-test rationale.

**FK column-index coverage gaps:** See HI-02. Missing indexes on user_id for api_keys, transcriptions, conversations, messages, notes, folders (only covered indirectly by the leading-`tenant_id` keyset indexes). Account, verification, sessions have explicit user_id indexes (`account_user_id_idx`, etc.).

---

## Dead code

- `packages/data/src/encryption/oauth-state-codec.ts:62-95` — `decryptCodeVerifierFromRow` plaintext fallback is dead post-0020 (the plaintext `code_verifier` column no longer exists in the DB). See CR-05.
- `packages/data/src/encryption/backfill.ts` — `runBackfill` for Better-Auth-owned columns is effectively dead given `ENCRYPTED_COLUMNS_MAP = {}`. Re-running it now (HI-04) actively introduces inconsistency rather than recovering from drift.
- `packages/data/src/sessions/lookup-by-previous-token.ts` — alive but unreachable in practice (CR-04). The fingerprint column is never written by Better Auth.
- `packages/data/src/schema/accounts.ts:57-86` (24 bytea sidecars) + `verifications.ts:33-38` (6 sidecars) + `sessions.ts:47-73` (12 sidecars + 2 fingerprints) — declared, migrated, never populated for Better-Auth-owned writes. Pure schema overhead — about 44 bytea columns persisted as NULL across every Better-Auth row.
- `VaultKeyProvider` + `KmsKeyProvider` — exported from the public barrel; instantiable; every method throws. Stubs are well-marked in source but the public surface is misleading. See HI-06.

## Suppressed warnings

- `apps/api/src/auth.ts:369-373` — uses `as unknown as ReturnType<typeof drizzleAdapter>` and `(factory as (o: unknown) => Parameters<typeof wrapAdapter>[0])(options)` to bridge Better-Auth's factory shape to `wrapAdapter`. Allowed under LOCKER-02 only if these are tracked in the suppression allowlist; otherwise this is a stale double-cast that may have shipped via a Plan 51-23/24 amendment. Should be re-evaluated when CR-01 is fixed.
- `packages/data/src/seed/conformance.ts:74-76, 165-168, 196-205, 218-222, 224-230` — `biome-ignore` for `lint/suspicious/noConsole` are reasonable for one-shot CLI scripts.
- `packages/data/src/bin/seed-conformance.ts:16,32` — `v8 ignore start/stop` band. Acceptable for a CLI entry guard.

No `as any` / `@ts-ignore` / `@ts-nocheck` found in scope.

No raw `sql\`${userInput}\`` injection surface found. Identifier interpolation in `backfill.ts:108-148` uses author-controlled column-map keys (not user input) and is acknowledged in code comments. `migrate.ts::pgIdent` correctly whitelists identifier shape with regex.

---

## TODO / FIXME / HACK scan

`grep -rE "TODO|FIXME|HACK|XXX" packages/data/` returned no markers in source or migrations within scope. Clean.

---

## Hardcoded literals scan

- `DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000'` — present in migrations 0000:26, 0003:38-39, 0024:43, seed/conformance.ts:35. All allowlisted per LOCKER-03 carve-out.
- No `localhost`, `127.0.0.1`, ports `:3000|:4000|:8080` found in `packages/data/src/**` or `packages/data/migrations/**` in scope.
- No `sk-…`, `sk-ant-…`, `AIza…`, `AKIA…`, `Bearer ey…` patterns found in scope.

---

## Required actions before public publication (severity-ordered)

1. **CR-01 + CR-03:** Either wire the lens through Better-Auth's `additionalFields` properly so `ENCRYPTED_COLUMNS_MAP` is non-empty for `account`/`session`/`verification`/`user`, OR revert migrations 0025/0026 + the LOCKER-08 amendment + delete the orphaned bytea sidecars. Shipping the current state publicly means shipping plaintext OAuth tokens and bearer tokens at rest in `text` columns.
2. **CR-02:** Revert migration 0024's `ALTER ROLE ... SET app.tenant_id` and column defaults, OR document explicitly in CLAUDE.md and docs/security.md that v1 single-tenant has rolconfig-bound RLS that fails OPEN to the default tenant. Current code-vs-doc mismatch is a security-posture lie.
3. **CR-04 + CR-05:** Reconcile the broken AUTH-04 fingerprint path and remove the dead `code_verifier` plaintext fallback.
4. **HI-01..HI-06:** Operator-runbook updates + index additions as scoped.
5. **ME-01:** Sync schema comments to reflect actual lens behavior.

---

_Reviewer: gsd-code-reviewer (FORCE adversarial)_
_Reviewed: 2026-05-20T00:00:00Z_
_Scope: packages/data/src/** + packages/data/migrations/*.sql_
_Depth: deep (cross-file: apps/api/src/auth.ts, tools/lint-no-plaintext-secret-columns.ts, git log)_
