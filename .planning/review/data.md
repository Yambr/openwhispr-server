# Review: data
Branch: main @ 13f0864
Files reviewed: 34 source files (20 schema, 10 encryption, 4 root incl. migrate/client/tenant-context/index) + 24 forward migrations + 2 init scripts.

## Summary
- CRITICAL: 0 / HIGH: 3 / MEDIUM: 5 / LOW: 6
- Top 3 production risks:
  1. **Stale `session_lookup_by_token(text)` SECURITY DEFINER function** (migration 0005) still exists in production DB with `GRANT EXECUTE … TO openwhispr_app`, but references the dropped plaintext `sessions.token` column (dropped in 0020). Invoking it raises `42703 column "token" does not exist`. Dead-code attack surface on an app-grantable SECDEF.
  2. **`packages/data/src/sessions/lookup-by-previous-token.ts` exports `lookupSessionByPreviousToken` but no production caller imports it.** `apps/api/src/lib/token-rotation.ts:111-127` inlines the fp-lookup SQL directly. The documented "Node-side replacement helper" is dead in production and only exercised by unit tests — risk of drift between the helper and the inlined SQL.
  3. **No TLS posture on either pg `Pool`.** `client.ts` and `migrate.ts` build connection pools with `new Pool({ connectionString })` only; nothing forces `sslmode=require` for cloud / corp deploys. An operator who omits `?sslmode=require` from `DATABASE_URL` ships plaintext credentials + RLS-protected rows over the wire.

## Findings

### [HIGH] HI-01 — Dangling SECDEF function `session_lookup_by_token(text)` references dropped column
**File:** `packages/data/migrations/0005_session_token_plain.sql:84-98`, not subsequently dropped.
Migration 0019b drops `lookup_session_by_previous_token(text)`. Migration 0020 drops the plaintext `sessions.token` column. But `session_lookup_by_token(text)` (also created in 0005, lines 84-98) is never dropped — it lives on with `GRANT EXECUTE … TO openwhispr_app` and a body of `SELECT s.user_id, s.tenant_id FROM sessions s WHERE s.token = p_token AND s.expires_at > now()`. After 0020 the column is gone, so any call raises 42703. No production code path invokes it today (grep apps/ packages/ excluding migrations/tests yields zero hits), but:
- It is an app-role-EXECUTE-grantable SECDEF that still exists.
- A future regression that wires it back will fail loudly only at runtime, not at deploy time.
- It signals migration debt — the symmetry expected from 0019b is missing.

**Fix:** Ship a follow-up migration `0023_drop_stale_session_lookup_by_token.sql`:
```sql
DROP FUNCTION IF EXISTS session_lookup_by_token(text);
```
(REVOKE is implicit on DROP.)

### [HIGH] HI-02 — Dead exported helper `lookupSessionByPreviousToken`
**File:** `packages/data/src/sessions/lookup-by-previous-token.ts:55-72` (whole file).
Header comment claims this is the Node-side replacement for the dropped SECDEF function. Inspection shows:
- No production importer (`grep -rn lookupSessionByPreviousToken apps/ packages/` excluding `__tests__`, `.test.ts`, and the data package itself yields zero hits).
- `apps/api/src/lib/token-rotation.ts:111-127` re-inlines the same fp-lookup SQL via drizzle's `sql` template instead of calling this helper.
- Only test files import it.

This is a half-finished feature: the carefully-documented contract (BYPASSRLS pool, partial-index lookup, 5-minute window filter) lives in two places. Drift risk: a future security fix to `token-rotation.ts` may forget the helper, or vice versa.

**Fix:** Either (a) replace the inlined SQL in `apps/api/src/lib/token-rotation.ts:111-127` with a call to `lookupSessionByPreviousToken(ownerPool, plaintext)` — preferred, single source of truth; or (b) delete `packages/data/src/sessions/lookup-by-previous-token.ts` outright and drop the unit-test file. Pick one — current state ships both paths.

### [HIGH] HI-03 — No TLS opt-in on pg `Pool` construction
**File:** `packages/data/src/client.ts:38, 63`; `packages/data/src/migrate.ts:74, 210`; `packages/data/src/encryption/cli/backfill-encrypt-credentials.ts:132`.
All pools are built as `new Pool({ connectionString: url, max: N })` with no `ssl` field. `pg` honors `?sslmode=require` if present in the URL but does NOT enforce it. For a "1000 concurrent users, enterprise-grade, self-hosted" project where corp operators replace LiteLLM with internal endpoints, sending DB credentials + tenant rows over plaintext TCP on first-boot misconfig is a real failure mode.

**Fix:** Add an `ssl` discriminator that requires opt-out, not opt-in. Example:
```ts
function poolSsl(url: string): { ssl: false | { rejectUnauthorized: boolean } } {
  const u = new URL(url);
  if (u.hostname === "postgres" || u.hostname === "pgbouncer") return { ssl: false }; // compose
  return { ssl: { rejectUnauthorized: true } };
}
const pool = new Pool({ connectionString: url, max: 20, ...poolSsl(url) });
```
Plus boot-time check that refuses non-loopback hosts without `sslmode=require`.

### [MEDIUM] MD-01 — `migrate.ts` does not validate `MASTER_KEK` despite seed/CLI peers doing so
**File:** `packages/data/src/migrate.ts` (whole `main()`).
The encrypt-backfill CLI (`packages/data/src/encryption/cli/backfill-encrypt-credentials.ts:113`) calls `validateEncryptionBoot(process.env)` and exits 78 on missing MASTER_KEK. The migrate runner does not. Operationally this means an operator can `make migrate` against a fresh DB whose MASTER_KEK env is missing/short, then crash on the first runtime request that touches encryption. The cheap defense is to fail at deploy-time, not request-time.

**Fix:** Add `validateEncryptionBoot(process.env)` at the top of `main()` before opening any pool. (Migrate-time encryption is not strictly required, but failing-fast preserves the "fresh `docker compose up` works or fails loudly" invariant.)

### [MEDIUM] MD-02 — Asymmetric `NOBYPASSRLS` enforcement in `init/00-roles.sql.tpl`
**File:** `packages/data/migrations/init/00-roles.sql.tpl:35-39`.
The CREATE branch for `openwhispr_app` is `CREATE ROLE openwhispr_app WITH LOGIN PASSWORD …` — no `NOBYPASSRLS` clause. The ALTER branch (line 38) DOES include `NOBYPASSRLS`. The defensive `RAISE EXCEPTION` block (line 47-49) catches an inherited BYPASSRLS, but the asymmetric DDL is confusing and one Postgres role-default change away from breaking the invariant.

**Fix:** Add explicit `NOBYPASSRLS` to the CREATE branch:
```sql
EXECUTE 'CREATE ROLE openwhispr_app WITH LOGIN NOBYPASSRLS PASSWORD ' || quote_literal('${POSTGRES_APP_PASSWORD}');
```

### [MEDIUM] MD-03 — `FIXTURE_PASSWORD` literal lives in production-shipped seed module
**File:** `packages/data/src/seed/conformance.ts:24`.
`export const FIXTURE_PASSWORD = "test-PW-12345!"`. While the seed runs only under the contract-test compose overlay, the constant is exported from a production-shipped package (`packages/data/src/seed/`), not from `tests/`. Per LOCKER-03 the location is allowed (`test-PW-12345!` doesn't match the locker's secret-shape regex), but the design risk is real: a future operator who runs `pnpm seed:conformance` against prod with `DATABASE_URL_OWNER` set will idempotently INSERT live users carrying a publicly-known password. The seed has no env-flag refuse-on-prod guard.

**Fix:** Move the seed under `tests/` (or gate behind an explicit `OPENWHISPR_SEED_ALLOW=true` env var that refuses if absent). Document the refusal in the README's "self-host quickstart" section.

### [MEDIUM] MD-04 — `seedPhase5Resources` writes invalid `argon2id$placeholder` into `api_keys.key_hash`
**File:** `packages/data/src/seed/conformance.ts:219`.
The seed inserts a row into `api_keys` with `key_hash = 'argon2id$placeholder'`, which is NOT a valid Argon2id digest. If the contract-test fixture path ever feeds this row to the bearer-resolution flow (e.g. an operator tests `pak_seed…` against the live API), Argon2id verification would throw on parse, not on mismatch, which yields a 500 instead of a clean 401.

**Fix:** Compute a proper Argon2id digest of a fixed plaintext at seed time (or skip the api_keys row in this seed and move to a dedicated key-fixture seeder).

### [MEDIUM] MD-05 — `withTenant` comment header references non-existent `withSystemContext()`
**File:** `packages/data/src/tenant-context.ts:84-86`.
The header comment says: "Calling code MUST flow through `withTenant()` (this function) or `withSystemContext()` for system-scoped jobs that explicitly opt out of tenant isolation via BYPASSRLS roles." But `withSystemContext` does not exist in this package — it lives in `apps/worker/src/lib/with-system-context.ts`. Operator/developer reading data-layer code finds a dangling reference.

**Fix:** Either re-export `withSystemContext` from this package (preserve the docs claim) or amend the comment to point at `apps/worker/src/lib/with-system-context.ts` explicitly.

### [LOW] LO-01 — `_safe_table_reset(text, boolean)` (migration 0021) has no callers
**File:** `packages/data/migrations/0021_safe_table_reset_helper.sql`.
The helper is defined and GRANT EXECUTE'd to `openwhispr_owner`, but no migration calls it. Header says "future reset-style migrations MUST call this helper" — that's a guardrail without enforcement. Per LOCKER-04 every exported symbol MUST have a non-test importer.

**Fix:** Either add a tools/lint-migrations.ts rule that refuses `TRUNCATE TABLE` outside `_safe_table_reset(…)` calls, or document the helper as "available for future use" in the architecture docs so its lifecycle is explicit.

### [LOW] LO-02 — `MASTER_KEK` validator does not entropy-check the decoded key
**File:** `packages/data/src/encryption/boot.ts:84-96` and `env-key-provider.ts:27-37`.
`Buffer.from(raw, "base64url")` silently drops invalid characters and returns whatever bytes it could decode. The validator only asserts `decoded.length === 32`. A KEK like `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` (32 zero bytes after base64url decode) passes both validators. This is theoretical (operators using `openssl rand 32` will not hit it), but the comment in `env-key-provider.ts:31` claims the value is "produced by tools/bootstrap.sh" with no runtime enforcement.

**Fix:** Add a min-entropy check (count distinct bytes ≥ 16, or reject all-zero/all-same byte runs) in `validateMasterKek`.

### [LOW] LO-03 — `as any` suppressions in seed conformance CLI detection
**File:** `packages/data/src/seed/conformance.ts:241, 246`.
Two `as any` casts on `import.meta` / `require` for the dual ESM/CJS entry-point check. The biome ignore comments justify them. Per DISCIPLINE Rule 12, `as any` is REFUSED in production code, but the same rule allows pre-existing debt allowlists. These two casts ship in the conformance seed.

**Fix:** Replace with the typed pattern used in `packages/data/src/migrate.ts:230-249` (`isCliEntry()`) which avoids `as any` via `typeof import.meta?.url === "string"` narrowing. Same dual-mode detection, no suppression.

### [LOW] LO-04 — `0001_better_auth.sql` SECDEF function (bytea variant) shipped without `SET search_path` hardening
**File:** `packages/data/migrations/0001_better_auth.sql:117-128` (historical).
The original `lookup_session_by_previous_token(p_hash bytea)` SECURITY DEFINER function was created without `SET search_path = public, pg_temp` — the PG SECDEF best practice. It was replaced by the text variant in 0005 (which DOES set search_path), and finally dropped by 0019b. So the vulnerable function existed in the DB between 0001 and 0005's apply time. No production install can be exposed today, but the migration history shows the hardening lesson was learned mid-stream.

**Fix:** No action — historical. Note as engineering lesson for future SECDEF migrations.

### [LOW] LO-05 — `process.exit` codes in `migrate.ts` are not POSIX-meaningful past 78
**File:** `packages/data/src/migrate.ts:163, 182, 204`.
Exits use `2`, `3`, `4` for distinct failure modes (URL missing, PgBouncer host, admin URL missing). These conflict with POSIX `sysexits(3)` (`2 = EX_USAGE`, `3` is unassigned, `4` is unassigned). The encryption-boot module uses BSD-correct `EX_CONFIG = 78`. Convention is inconsistent across the data package.

**Fix:** Pick one convention and document it. Either:
- All exits use BSD sysexits codes (`EX_USAGE=64`, `EX_CONFIG=78`, `EX_DATAERR=65`), or
- Document the migrate-specific codes (2/3/4) in a top-of-file comment + the operator runbook.

### [LOW] LO-06 — `pgIdent` is only used for the `litellm` DB owner identifier — risk of pretentious surface
**File:** `packages/data/src/migrate.ts:43-48`.
The exported `pgIdent` function is internal scaffolding for `ensureLitellmDatabase`. Exported because of unit tests (LOCKER-04 requires a non-test importer; the test counts). Not a bug — but the exported surface is misleading. A code reviewer may believe `pgIdent` is a general-purpose identifier sanitizer.

**Fix:** Either narrow the JSDoc to "internal helper for litellm-DB autocreate; not a general-purpose escaper" or move it to a private `_helpers/` file with `@internal` tag.

## Dead code
- `packages/data/src/sessions/lookup-by-previous-token.ts` — exports `lookupSessionByPreviousToken`; no production importer (only tests). See HI-02.
- `session_lookup_by_token(text)` SECURITY DEFINER function in DB (created by migration 0005) — no production caller; references dropped column. See HI-01.
- `_safe_table_reset(text, boolean)` SQL function (migration 0021) — defined but never invoked. See LO-01.
- `AccountTokenExpiredError` class (lens.ts:90) — thrown by the lens but no caller catches by class; only mentioned in comments in `apps/api/src/auth.ts:112`. Acceptable as a defense-in-depth signal that propagates to Better Auth's error envelope.

## Suppressed warnings
- `packages/data/src/seed/conformance.ts:241, 246` — two `as any` casts on `import.meta` / `require` for CLI dual-mode detection. See LO-03.
- No `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` found in any production file under `packages/data/src/`. Clean against DISCIPLINE Rule 12 modulo LO-03.

## Notes

### `packages/data/src/schema/users.ts` (currently `M` in git status)
**Status: SAFE for first publication.** The uncommitted edit adds:
- `name: text("name")`, `emailVerified: boolean("email_verified").notNull().default(false)`, `emailVerifiedAt: timestamp(...)`, `image: text("image")`, `passwordHash: text("password_hash")`, `locale: text("locale").notNull().default("en")`, `role: text("role")`.

Checked against LOCKER-08:
- `password_hash` is NOT in the locker regex (`/^(access_token|refresh_token|id_token|password|value|token|previous_token|code_verifier)$/`). The regex matches the bare `password` column, which the schema does NOT declare (it's on `account`, envelope-encrypted via 6 bytea sidecars). The `password_hash` column stores an Argon2id digest, not a reversible secret — correct treatment per Better Auth's adapter contract.
- `email`, `name`, `image`, `locale`, `role` are not credential-shape columns. No envelope encryption required.
- `tenantId` is NOT NULL with `onDelete: "restrict"` — correct.
- `(tenant_id, lower(email))` functional unique index — correct case-insensitive uniqueness, matches migration 0004.

Conclusion: the uncommitted edit is schema-shape-correct and clears LOCKER-08. Recommend committing as-is before publication.

### RLS posture
All 16 tenant-scoped tables enumerated in `TENANT_SCOPED_TABLES` (`packages/data/src/schema/index.ts:25-44`) have RLS ENABLE + FORCE + fail-closed policy from migration 0018. Verified by grepping migrations 0000, 0001, 0002, 0006-0010, 0014-0017 for `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + canonical `current_setting('app.tenant_id', true)::uuid` policy. Migration 0018 explicitly reshapes every policy to `NULLIF(current_setting(...), '')::uuid` for fail-closed semantics and DROP DEFAULTs the role-default escape from 0003. **No tenant-scoped table is missing FORCE RLS.**

### GRANT integrity
Migration 0017 originally forgot to GRANT `setup_state` to `openwhispr_app`; migration 0022 retroactively added it (correctly forward-only per Hard Rule 1). All other migrations that CREATE TABLE include the canonical `GRANT SELECT, INSERT, UPDATE, DELETE … TO openwhispr_app` block. The audit_log partitioned-parent (0014) correctly re-grants after the parent is rebuilt. No `BYPASSRLS` is granted to `openwhispr_app` — both the CREATE/ALTER DDL paths and the defensive `RAISE EXCEPTION` block in `init/00-roles.sql.tpl:47-49` enforce this.

### Envelope encryption
- `createCipheriv("aes-256-gcm", ...)` appears in exactly two production files: `packages/data/src/encryption/envelope.ts:56` (value layer) and `packages/data/src/encryption/env-key-provider.ts:50` (DEK-wrap layer). No other production code uses createCipheriv — module boundary is clean.
- 12-byte IVs from `randomBytes(12)` on every encrypt — no counter, no reuse risk under GCM.
- Auth-tag mismatch propagates via `cipher.final()`/`decipher.final()` throws — verified.
- `validateEncryptionBoot()` is called by the backfill CLI and (per the docstring) is wired into api+worker boot via Plan 33-04 — exits 78 on missing/short MASTER_KEK or non-`env` provider selection. Stubs (`VaultKeyProvider`, `KmsKeyProvider`) throw on every method, refusing silent miswire.

### Schema vs migrations consistency
- Drizzle journal `meta/_journal.json` has 24 entries matching 24 forward SQL files. No drift.
- Drizzle schema declarations exhaustively cover the 16 tenant-scoped tables + 2 operator-global (`tenants`, `setup_state`).
- `TENANT_SCOPED_TABLES` const in `schema/index.ts` includes all 16; matches the 16 fail-closed policies in 0018.

### Hardcode posture
- `localhost` literals: 1 in production code at `packages/data/src/seed/conformance.ts:123` (`http://api.localhost` as AUTH_URL default). The seed is contract-test fixture tooling, but ships in the production package tree. See MD-03.
- `127.0.0.1` / `:3000` / `:4000` / `:8080` / `:5432` — all `:5432` references are in comments only.
- UUID literals: only `'00000000-0000-0000-0000-000000000000'` (the canonical `DEFAULT_TENANT_ID`, allowlisted by LOCKER-03) and the `SEED_*_ID` constants (`11111111-0000-4000-…`) in `seed/conformance.ts:29-34` — bound to the fixture seeder.
- No real plaintext credentials in seed beyond `FIXTURE_PASSWORD = "test-PW-12345!"` (see MD-03).

### Migration runner posture
- `migrate.ts` correctly refuses to run as the app role (insists on `DATABASE_URL_OWNER`).
- Refuses to run DDL through a pgbouncer host (exit code 3) — correct anti-pattern guard.
- LiteLLM database auto-create has a documented opt-out (`SKIP_LITELLM_DB_AUTOCREATE=1`).
- `CREATE DATABASE litellm OWNER ${safeOwner}` interpolates `safeOwner` after `pgIdent(...)` whitelist — safe.
- Logger redaction is N/A here — the migrate runner uses bare `console.log/error` with short status messages; no connection strings, MASTER_KEK values, or row payloads are logged.

### CLI entry-point detection
Both `migrate.ts:232-250` and `seed/conformance.ts:238-247` carry dual ESM/CJS entry-point detection. `migrate.ts` uses a typed pattern (no suppressions); `conformance.ts` uses `as any` casts (LO-03). The migrate pattern should be the template.
