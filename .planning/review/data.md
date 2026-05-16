# Review: data (packages/data)

Branch: main @ 1832f28 (verified HEAD is `9ff5040` on local main, descendant of 1832f28 by 2 commits)
Scope: packages/data/src/** + packages/data/migrations/**
Working tree note: `git status` at review time shows NO uncommitted changes to `packages/data/src/schema/users.ts`. The initial gitStatus snapshot in the prompt showed `M users.ts`, but the change was committed in `adf0e09 fix(19a): wire users.role column into Drizzle schema (SERVER-ERRORS Entry 9)`. **No commit-or-revert action needed.**

## Summary
- Files reviewed: 24 TypeScript source files (src/**), 18 SQL migrations, 1 seed module
- Findings: CRITICAL=2 HIGH=4 MEDIUM=5 LOW=2 (total 13)
- Top 3 production risks before public GitHub release:
  1. **CRITICAL — RLS posture silently degraded from "fail-closed" to "fail-into-default-tenant"** by `0003_better_auth_tenant_defaults.sql` (`ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'`). Any route handler that forgets `withTenant()` (or any tx-mode connection that runs queries between two `withTenant()` blocks before reset) hits the **default tenant** instead of being denied. The hand-augmented RLS comment in 0000_initial.sql ("Fail-closed by design") is materially false post-0003. This is a multi-tenant-leak fuse waiting to be lit when v2 multi-tenant ships (TODO embedded in the migration comment), and a defense-in-depth degradation in v1.
  2. **CRITICAL — Better Auth OAuth credentials + session bearers + reset tokens stored plaintext.** `account.access_token`, `refresh_token`, `id_token`, `password` (text), `verification.value` (password-reset token, text), `sessions.token` + `previous_token` (text), `oauth_state.code_verifier` (text). The shipped envelope-encryption module (`encryption/envelope.ts`, `EnvKeyProvider`) is fully implemented but **NOT wired to any schema column** — it is dead code. 0005 explicitly defers "at-rest hardening to v2" — incompatible with a public release that ships RLS as the marquee security feature. A DB dump = full credential theft (incl. third-party OAuth provider tokens).
  3. **HIGH — `account.access_token` / `refresh_token` / `id_token` are not just plaintext, they're tenant-scoped OAuth tokens for upstream IdPs (Google/GitHub/Microsoft).** If any single route forgets `withTenant()` and the `ALTER ROLE` default tenant fallback fires, those rows leak to every other tenant under the default. Multiplies risk #1 × risk #2.

## Findings (by severity)

### CRITICAL

#### CR-01: ALTER ROLE app.tenant_id default defeats fail-closed RLS
**File:** `packages/data/migrations/0003_better_auth_tenant_defaults.sql:46`
**Also affects (via column DEFAULT):** lines 51, 53, 55, 57
**Issue:** `ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'` pre-binds the canonical RLS GUC on every backend connection at connect-time. The canonical RLS policy comment in `0000_initial.sql:122-124` claims "When the GUC is unset we get '' instead of an error, '' ::uuid throws inside the policy expression, and the row is denied. Fail-closed by design." After migration 0003 runs, the GUC is **never unset for `openwhispr_app`** — every query that bypasses `withTenant()` (a) silently succeeds against the default tenant, (b) **reads, writes, and grants access to all default-tenant rows**, (c) leaves zero audit signal.

The migration's own comment acknowledges this is "single-tenant v1 only" and DEFERS removal to v2 — but the codebase is being prepared for public release, and there is no compile-time / runtime guard that fails the boot if (a) a tenant_settings or future row crosses tenant boundaries, or (b) someone ships a v2 multi-tenant build that forgot to drop the ALTER ROLE. Additionally `withTenant`'s `set_config(..., true)` is transaction-LOCAL; outside any explicit transaction the rolconfig default applies — so **every bare `db.select(...)` not wrapped in `withTenant()` hits the default tenant**, the opposite of what the comments document.

**Fix:**
1. Drop the `ALTER ROLE` line; instead rely on a Fastify `onRequest` hook that ALWAYS calls `set_config('app.tenant_id', $tenant, true)` inside a transaction.
2. Add a startup assertion in `apps/api` boot that connects with a fresh app-role connection and `SELECT current_setting('app.tenant_id', true)` MUST return `''` (empty) — refuses to start if rolconfig is set.
3. Make the column DEFAULTs explicit literal — or drop them entirely; let the application supply tenant_id explicitly so RLS WITH CHECK is the enforcement boundary.
4. If the v1 "single-tenant" rolconfig is intentional, then **document at the package barrel** with an export named `IS_SINGLE_TENANT_DEFAULT_TENANT_ROLCONFIG_PRESENT = true` and gate the v2 phase boot on flipping it.

#### CR-02: Bearer / OAuth / password-reset tokens stored plaintext; envelope module is dead code
**Files:**
- `packages/data/src/schema/accounts.ts:24-30` — `access_token / refresh_token / id_token / password` all `text` (plaintext)
- `packages/data/src/schema/verifications.ts:17` — `value text NOT NULL` (password-reset / email-verify token plaintext)
- `packages/data/src/schema/sessions.ts:34,42` — `token text` + `previous_token text` (plaintext session bearer)
- `packages/data/src/schema/oauth_state.ts:20` — `code_verifier text NOT NULL` (PKCE secret plaintext)
- `packages/data/migrations/0005_session_token_plain.sql:1-9` — comment self-documents the deferral
- `packages/data/src/encryption/envelope.ts:46-87` — `encryptValue` / `decryptValue` fully implemented but no production caller (verified by grep — only test imports, no apps/api or apps/worker import)

**Issue:** The package ships a production-grade AES-256-GCM envelope (random 12-byte IV per call, per-row DEK wrapped under MASTER_KEK, GCM auth-tag verified on decrypt — all crypto primitives correct). It is **never used.** Meanwhile every credential and bearer surfaced through Better Auth is text in plaintext columns. A single backup leak, replica snapshot, or DB-tier compromise yields: (a) all live session bearers for active impersonation, (b) all upstream IdP OAuth access+refresh tokens (cross-service compromise), (c) all unconsumed password-reset values, (d) all PKCE code_verifiers (auth-flow replay).

**Fix (minimum for public release):**
1. Wire `encryption/envelope.ts` to at least `accounts.access_token / refresh_token / id_token / password` and `verifications.value` via a new migration adding 6 bytea columns per encrypted field (per `EncryptedRow` shape) + drop the plaintext column in the same transaction.
2. Either: ship Better Auth with a custom Drizzle adapter that wraps `encryptValue/decryptValue` on read/write, OR (faster) document this as a known LIMITATION with a public THREAT-MODEL.md disclosing exactly which columns are plaintext and why. The current state is a silent footgun for self-hosters.
3. For session.token: pgcrypto column-level encryption or migrate to a token-prefix + Argon2id-hash storage (same shape as `api_keys`).

### HIGH

#### HI-01: migrate.ts does NOT enforce idempotency of init-side concerns (LiteLLM DB), but DOES exit-2 on missing env
**File:** `packages/data/src/migrate.ts:65-90, 129-183`
**Issue:** `ensureLitellmDatabase()` is correctly idempotent (SELECT-then-CREATE). However, `migrate.ts:74` opens a fresh admin pool, never sets a timeout, and the `admin.end()` in the `finally` block can leak the connection on async-error paths where `admin.query` throws before `try`. Minor robustness gap. More importantly:

- `migrate.ts:165` exits with code 4 if `resolveAdminUrl()` returns null. This means an operator who is content to use a pre-existing LiteLLM database CANNOT run `migrate` without setting `POSTGRES_ADMIN_URL` or `DATABASE_URL_OWNER` — no escape hatch. A clean public-release toggle (`SKIP_LITELLM_DB_AUTOCREATE=1`) is missing.

**Fix:** Add `if (process.env.SKIP_LITELLM_DB_AUTOCREATE === '1') { /* skip ensureLitellmDatabase + log */ }` before line 159. Document in README.

#### HI-02: TRUNCATE TABLE in migration 0005 (non-idempotent destructive DDL)
**File:** `packages/data/migrations/0005_session_token_plain.sql:33`
**Issue:** `TRUNCATE TABLE "sessions"` runs unconditionally during 0005. Comment claims "Phase 02 is dev-only; no production data exists." After public release, any operator who upgraded through phase 02 with live sessions will have **every live session terminated** on migrate. Drizzle's `__drizzle_migrations` bookkeeping prevents replay, but anyone forking from an early commit or replaying the migration chain on a hot DB loses session state.

**Fix:** Replace `TRUNCATE TABLE sessions` with `DELETE FROM sessions` (logged, not silent) wrapped in `IF NOT EXISTS (...)` — or guard with `IF (SELECT count(*) FROM sessions) > 0 THEN RAISE NOTICE`. Better: document the breaking-migration boundary in CHANGELOG, refuse to apply if there are non-empty sessions.

#### HI-03: account.access_token / refresh_token / id_token in addition to plaintext, lack any `expires_at` enforcement check
**File:** `packages/data/src/schema/accounts.ts:27-28`
**Issue:** Columns `access_token_expires_at` + `refresh_token_expires_at` exist but no CHECK or partial-unique enforces expiration on read. Application code must remember to filter expired rows. Combined with CR-02, expired tokens linger in plaintext indefinitely (no TTL sweep job exists for this table — grep shows BullMQ sweepers only for oauth_state).

**Fix:** Add `oauth_token_sweeper` worker analogous to `oauth_state` sweeper (10-minute job) that nulls/deletes expired access_token/refresh_token rows. Document.

#### HI-04: tenant_id column DEFAULT bound to GUC swallows `withTenant` invariant violations
**File:** `packages/data/migrations/0003_better_auth_tenant_defaults.sql:51-57`
**Issue:** `ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid` means a Better Auth INSERT that doesn't supply tenant_id resolves to the rolconfig default. This was a deliberate workaround for Better Auth's bare INSERTs. Combined with CR-01, this means a v2 multi-tenant route handler that forgets to call `withTenant()` before a Better Auth sign-up gets the **default tenant** row inserted on behalf of a paying tenant. The WITH CHECK clause of the canonical RLS policy WILL block the cross-tenant write — but only if the GUC was set to a tenant DIFFERENT from default. If GUC remains default-bound, the write goes through silently.

**Fix:** see CR-01. Alternatively, change the DEFAULT to a function that RAISES when `app.tenant_id` is empty/unset, so Better Auth INSERTs without a transaction-local GUC fail loudly.

### MEDIUM

#### MD-01: encryption module is dead code (no production import)
**File:** `packages/data/src/encryption/{envelope,env-key-provider,key-provider,vault-key-provider,kms-key-provider}.ts`
**Issue:** Verified by repo-wide grep — only `tools/lint-compose-chart-parity.ts` (a tool, not app code) references `EnvKeyProvider` in a comment. Other consumers are tests only. Exported through `packages/data/src/index.ts` line 8. Dead-export burden + misleads readers that secrets are encrypted.
**Fix:** Either wire CR-02 fix OR mark exports as `@experimental` in JSDoc, and add an integration test that asserts at least one production schema column uses the envelope shape.

#### MD-02: VaultKeyProvider / KmsKeyProvider stubs export "production-grade" surface but throw on every call
**File:** `packages/data/src/encryption/{vault,kms}-key-provider.ts`
**Issue:** `selectProvider()` in `key-provider.ts:49-61` dispatches to these on `OPENWHISPR_KEY_PROVIDER=vault|kms`. Instantiation succeeds; every method throws "not implemented in v1". An operator who sets the env var and tests with a non-encrypted code path (i.e. all of them today, per CR-02) sees no error — looks like Vault/KMS are wired. Once CR-02 lands, the first encryptValue() call fails loudly.
**Fix:** Either make `selectProvider()` throw at startup when the provider is a known stub (defense in depth) or remove the stubs and gate selection behind `OPENWHISPR_KEY_PROVIDER=env` only.

#### MD-03: schema field `client.ts:38, 63` hardcodes pool max (20 / 2) without env override
**File:** `packages/data/src/client.ts:38, 63`
**Issue:** `max: 20` (app pool) and `max: 2` (owner pool) are hardcoded. The CLAUDE.md target is 1000 concurrent users; the operator cannot tune pg pool size without forking code. This is an operability concern, not a security one.
**Fix:** `max: Number(process.env.DB_APP_POOL_MAX ?? 20)` and analogous for owner. Document in `.env.example`.

#### MD-04: seed/conformance.ts hardcodes `FIXTURE_PASSWORD = "test-PW-12345!"`
**File:** `packages/data/src/seed/conformance.ts:24`
**Issue:** Hardcoded fixture password is **exported**. It is a test fixture, not a production seed (CLI gated behind `pnpm -F @openwhispr/data run seed:conformance`), but it is exported from the package barrel via `seed/conformance.ts` re-exports — there's no barrel re-export, so the constant is reachable only via the seed module path. Still: the password is committed to a public repo. If any operator ever runs the seed against production accidentally (the seed creates users via the public sign-up endpoint), production has 5 known-credential admin-grade fixture users.
**Fix:** Gate `seedConformanceFixtures()` at entry on `process.env.NODE_ENV !== 'production'` AND require `OPENWHISPR_ALLOW_CONFORMANCE_SEED=1`. Move `FIXTURE_PASSWORD` to a randomly-generated value per-run, printed to stdout once.

#### MD-05: deterministic hardcoded UUIDs in seed (SEED_FOLDER_ID, …, SEED_API_KEY_ID, DEFAULT_TENANT_ID)
**File:** `packages/data/src/seed/conformance.ts:29-35`
**Issue:** `DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000"` is constitutional (single-tenant v1) — fine. But `SEED_FOLDER_ID = "11111111-0000-4000-8000-000000000001"` etc. are exported. Combined with MD-04, a production accidental seed run lands well-known UUIDs that an attacker can probe for. Marginal information leak.
**Fix:** keep DEFAULT_TENANT_ID; gate or randomize the SEED_*_ID family at production runtime.

### LOW

#### LO-01: SECURITY DEFINER function `session_lookup_by_token(text)` returns rows on token-only match without RLS
**File:** `packages/data/migrations/0005_session_token_plain.sql:84-96`
**Issue:** The function is SECURITY DEFINER and GRANTed only to `openwhispr_app`, with `SET search_path = public, pg_temp` (correct hardening). It returns `(user_id, tenant_id)` for any matching unexpired bearer. Combined with CR-02 (plaintext token storage), an SQL-injection vector elsewhere in the codebase could call this function to enumerate active sessions. Low because of REVOKE FROM PUBLIC and the tight signature, but worth a defense-in-depth note: emit an audit row on each call.
**Fix:** Optionally INSERT an audit_log row inside the function body (with the actor_user_id of the row found). Higher overhead; defer if perf-sensitive.

#### LO-02: schema/index.ts TENANT_SCOPED_TABLES literal can drift silently from migration DDL
**File:** `packages/data/src/schema/index.ts:25-45`
**Issue:** This is the auto-discovery hook for the RLS lint. There is no test that asserts every entry has a matching `ENABLE + FORCE + CREATE POLICY` block in a migration file. The lint exists (per file comment) but is not surfaced in CI for the reviewer to verify. `tenants` is correctly absent (root table, not tenant-scoped) and `setup_state` is correctly absent (D-02 operator-global). Other tables in scope all check out via the grep I ran.
**Fix:** Add a vitest test that parses `migrations/*.sql` and asserts: for every entry in `TENANT_SCOPED_TABLES`, there exists `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + at least one `CREATE POLICY ... ON "<table>" ... USING (...current_setting('app.tenant_id'...)`.

## Dead code

- `packages/data/src/encryption/envelope.ts`, `env-key-provider.ts`, `vault-key-provider.ts`, `kms-key-provider.ts`, `key-provider.ts` — fully exported, fully implemented (or stubbed), zero production callers in `apps/` or other `packages/`. See MD-01.
- `EnvKeyProvider.id`, `VaultKeyProvider.id`, `KmsKeyProvider.id` — declared but never read by any caller (used in tests only for assertion strings).
- `packages/data/src/index.ts:9` exports `TenantScopedTable` type — used by lint tooling but no runtime production import; harmless.

## Suppressed warnings

All suppressions in `packages/data/src/` reviewed; all justified and scoped:
- `migrate.ts:69, 132, 149, 161, 178, 214` — `biome-ignore lint/suspicious/noConsole` for one-shot CLI script. **OK**.
- `migrate.ts:195` — `biome-ignore lint/style/noNonNullAssertion` for CJS context guarantee. **OK** (the comment correctly explains require.main check.)
- `seed/conformance.ts:240, 245` — `biome-ignore lint/suspicious/noExplicitAny` for `import.meta as any` and `require as any` to handle dual ESM/CJS detect. **OK** narrowly scoped.
- `seed/conformance.ts:255, 258, 263` — `eslint-disable-next-line no-console` in CLI tail. **OK**.

No `@ts-ignore`, no `@ts-expect-error`, no `as unknown as` patterns in src/.

## Disabled tests near scope

Did not find any `it.skip`, `describe.skip`, `it.todo`, or `xit` in `packages/data/src/__tests__/`. Test coverage for the data package is per CLAUDE.md ≥90% threshold and the test list in helpers.ts results JSON (22 test files) appears comprehensive.

## Notes

### What's done well (worth keeping)
- **AES-256-GCM with `randomBytes(12)` per call** — `envelope.ts:55, 73` and `env-key-provider.ts:49`. IV uniqueness invariant correctly preserved. Auth tag verified on decrypt via Node crypto's built-in `final()` throw path.
- **`withTenant` uses parameterized `set_config(..., $1, true)`** — `tenant-context.ts:80`. No SQL injection surface. UUID regex pre-check (line 73) is defense in depth, not the load-bearing check (Drizzle binds the param).
- **FORCE RLS on every tenant-scoped table** — confirmed across all 11 migrations that add tenant-scoped tables. Owner-bypasses-RLS pitfall is correctly defended.
- **GRANTs are surgical** — `openwhispr_app` gets `SELECT, INSERT, UPDATE, DELETE` per-table only after the RLS policy is attached. No blanket `GRANT ALL ON SCHEMA public`.
- **SECURITY DEFINER functions correctly set `search_path = public, pg_temp`** (0005:89, 0005:106) — the PG SECDEF hardening best practice.
- **drizzle migration runner refuses to run through pgbouncer host** (`migrate.ts:148-154`) — CONTAINER-A1 invariant enforced.
- **Two-pool factory keeps BYPASSRLS off the request hot path** (`client.ts:33-66`) — RESEARCH-DB Pattern 1 honored.
- **migrate.ts auto-creates the litellm DB idempotently** (`ensureLitellmDatabase`, lines 65-90) — operator UX win for upgraders.
- **pg_partman 5.2.4 partition migration (0014) is the most carefully-written migration in the package** — proper rename-and-rebuild pattern, RLS re-attached, retention configured, legacy data preserved into the catch-all partition.

### What's not in scope but adjacent
- The `apps/api` consumer of `withTenant` was not reviewed here. CR-01's severity depends on whether `apps/api` actually wraps EVERY query in `withTenant`. Verifying that requires a code-review pass on `apps/api/src/plugins/` and route handlers — outside this scope but follow up.
- `packages/byok-guard` is **infrastructure** BYOK (env vars for storage/observability/ingress/SMTP), NOT user-supplied LLM API keys stored in DB. The codebase has no provider-API-key storage table at all — operators must wire upstream LLM creds via LiteLLM env at deploy time. This is fine architecturally but means the "BYOK" terminology in the prompt was a false flag for me to chase; clarifying for future reviewers.

### Out of scope
Per prompt: performance issues (O(n²), memory leaks, inefficient queries) — none observed anyway. The `keyset_idx` partial indexes on (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL look right for the LIST pagination pattern.

---
Reviewed: 2026-05-16
Reviewer: gsd-code-reviewer (Opus 4.7, 1M ctx)
Depth: deep (full read of src/** + migrations/** + cross-reference of imports and grants)
