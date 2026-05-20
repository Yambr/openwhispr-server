---
phase: 57-pre-publication-critical-fixes
type: execute
mode: serial-tracks
tags: [security, critical, pre-publication, tdd]
requirements:
  - data:CR-01
  - data:CR-02
  - data:CR-03
  - api-routes-rest:CR-01
  - api-routes-rest:CR-02
  - api-routes-rest:CR-03
  - byok:CR-01
  - byok:CR-02
  - api-core:CR-01
out_of_scope:
  - data:CR-04   # AUTH-04 previous_token_fp wiring — deferred to Phase 58
  - data:CR-05   # dead plaintext-fallback in oauth-state-codec.ts — deferred to Phase 58
  - all HIGH/MED/LOW findings from REVIEW-INDEX.md
must_haves:
  truths:
    - "Better-Auth-owned credential columns (account.{password,access_token,refresh_token,id_token}, verification.value, sessions.{token,previous_token}) are NEVER stored as plaintext at rest after Phase 57"
    - "A bare connection (no withTenant) SELECTing from a tenant-scoped table returns ZERO rows, not default-tenant rows"
    - "Every /api/_test/* route returns 404 when NODE_ENV=production regardless of OPENWHISPR_TEST_ROUTES"
    - "BYOK redactUrl masks ghp_, gho_, ghu_, ghs_, ghr_, tvly-, AQVN, y0_, ASIA, and sk-<short> shapes in URLs and log fields"
    - "API refuses to boot (exit 78) when neither INGRESS_BASE_URL nor AUTH_URL is set; req.headers.host is NEVER used as origin"
    - "API refuses to boot (exit 78) when any of OPENWHISPR_DISABLE_RATE_LIMIT, OPENWHISPR_DISABLE_EMAIL_VERIFICATION, OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE, MOCK_DIARIZATION is set AND NODE_ENV=production"
    - "All 8 constitutional lockers pass (pnpm lint:lockers green)"
    - "pnpm test green across the monorepo; pnpm typecheck green"
---

# Phase 57 — Pre-publication CRITICAL fixes

## Phase Goal

Close the 13 CRITICAL pre-publication findings from `.planning/review/REVIEW-INDEX.md` (dated 2026-05-20, branch main @ 6e43588) across 6 fix tracks (A–F). Each fix lands via strict TDD (RED → GREEN → REFACTOR) with regression-shape tests that would catch a future revert. After this phase, the repository is publication-ready on the Tier 0 security/correctness axis (HIGH/MEDIUM/LOW findings deferred to Phase 58+). Eight constitutional lockers pass; `pnpm test`, `pnpm lint:lockers`, and `pnpm typecheck` are green; every CRITICAL finding has a corresponding regression test referencing the finding ID; and `.planning/review/REVIEW-INDEX.md` is annotated with a "Closed by Phase 57" marker next to each closed finding.

## Execution Order

Tracks run serially in this order:

1. **Track A** — `data:CR-01` + `data:CR-03` — populate `ENCRYPTED_COLUMNS_MAP` + revert LOCKER-08 amendment rationale
2. **Track B** — `data:CR-02` — restore fail-closed RLS (forward migration 0027)
3. **Track C** — `api-routes-rest:CR-02` + `CR-03` (+ `api-core:HI-02` opportunistic) — production veto for all `/api/_test/*`
4. **Track D** — `byok:CR-01` + `CR-02` — extend redact regex shapes + lower `sk-` threshold
5. **Track E** — `api-routes-rest:CR-01` — Host header injection: make `INGRESS_BASE_URL`/`AUTH_URL` boot-required
6. **Track F** — `api-core:CR-01` — production safety knob loud-fail wrappers

Rationale: A and B both mutate `packages/data/migrations/`; serializing them prevents migration-number conflicts. A precedes B because B's regression test (bare-connection SELECT returns zero rows) relies on A having a non-empty `ENCRYPTED_COLUMNS_MAP` so the Better-Auth tables continue to function in the integration test that signs up a user. C–F are independent of each other and of A/B; they're serialized only to keep cognitive load manageable and each commit reviewable in isolation.

---

## Track A — `data:CR-01` + `data:CR-03` — Better Auth plaintext credentials at rest

### Pre-conditions

- Working tree clean (`git status --short` empty).
- `pnpm test` is green on `main` @ 6e43588 (baseline).
- `MASTER_KEK` is set to a valid 32-byte base64url value in `.env.test` (verify: `node -e 'console.log(Buffer.from(process.env.MASTER_KEK,"base64url").length)'` prints `32`).
- Read `apps/api/src/auth.ts:120–200` (the `wrapAdapter` + `ENCRYPTED_COLUMNS_MAP` declaration block) and `packages/data/src/encryption/lens.ts` (`encryptInto` + the per-model loop at line 351) to confirm the lens API shape before writing the RED test.
- Read Better Auth's drizzleAdapter source for the column name shape it writes (the `password` column on `account` for credential sign-up; `access_token`, `refresh_token`, `id_token` on OAuth link; `value` on `verification` for email-verification tokens; `token` and `previous_token` on `sessions`).

### RED step

**File:** `apps/api/tests/integration/better-auth-envelope-at-rest.test.ts` (new)

**Test description:** Boot the API with testcontainers Postgres + PgBouncer + Valkey. Sign up a credential user via Better Auth's `/api/auth/sign-up/email`. Sign in via `/api/auth/sign-in/email`. After each call, query the underlying tables directly via the owner pool (BYPASSRLS) and assert:

1. `SELECT password, access_token, refresh_token, id_token FROM account WHERE user_id = $1` — every column IS NULL (Better Auth wrote, lens deleted the plaintext key before INSERT).
2. `SELECT password_value_ciphertext, password_value_iv, password_value_auth_tag, password_dek_wrapped, password_dek_iv, password_dek_auth_tag FROM account WHERE user_id = $1` — every sidecar is non-NULL `bytea`.
3. `SELECT token, previous_token FROM sessions WHERE user_id = $1` — NULL.
4. `SELECT token_value_ciphertext FROM sessions WHERE user_id = $1` — non-NULL bytea.
5. `SELECT value FROM verification WHERE identifier = $1` — NULL after email-verification token write.
6. `SELECT value_value_ciphertext FROM verification WHERE identifier = $1` — non-NULL bytea.
7. **Round-trip**: subsequent sign-in via `/api/auth/sign-in/email` returns 200 (proves the lens decrypts the password hash on read).

**Test name MUST reference** `data:CR-01`: `it("data:CR-01 — Better Auth credentials encrypted at rest via envelope lens", ...)`.

**Why this proves the bug:** before the fix, all six columns at (1) (3) (5) would be non-NULL plaintext and the sidecars at (2) (4) (6) would be NULL. After the fix, the asserts above all hold.

**Verify RED:** `pnpm --filter @openwhispr/api test better-auth-envelope-at-rest` → exit non-zero with assertion failures on (1)–(6). Sign-in at (7) may succeed (it does today via plaintext) — that's the "round-trip" sanity check post-GREEN.

### GREEN step

**Production-code files to edit:**

1. **`apps/api/src/auth.ts:160`** — replace `const ENCRYPTED_COLUMNS_MAP: EncryptedColumnMap = {};` with a populated map:

   ```ts
   const ENCRYPTED_COLUMNS_MAP: EncryptedColumnMap = {
     account: ["password", "access_token", "refresh_token", "id_token"],
     session: ["token", "previous_token"],   // Better-Auth model name; table name "sessions"
     verification: ["value"],
   };
   ```

   Verify the model-name keys match what Better-Auth's `drizzleAdapter` passes to the lens (grep `drizzleAdapter` + `modelName` in `packages/data/src/encryption/lens.ts` to confirm). If Better-Auth uses `sessions` (plural) rather than `session`, use that key.

2. **`apps/api/src/auth.ts:138–157`** — update the comment block that justified the empty map. New comment:

   > Envelope-encryption lens active for all Better-Auth-owned credential
   > columns. The lens (packages/data/src/encryption/lens.ts) deletes the
   > plaintext key from the row payload BEFORE drizzle builds the INSERT SQL,
   > populates the 6 bytea sidecar columns + the optional fingerprint sidecar,
   > and re-hydrates plaintext on SELECT. See data:CR-01 / Phase 57.

3. **`tools/lint-no-plaintext-secret-columns.ts:101–117`** — revert the LOCKER-08 amendment (`LENS_INTROSPECTION_COMPAT` inline allowlist that justified the columns). Restore the pre-amendment text from commit before `13a1547` (use `git log --oneline -- tools/lint-no-plaintext-secret-columns.ts` to find the parent of `13a1547`, then `git show <parent>:tools/lint-no-plaintext-secret-columns.ts` to extract the prior body). The columns themselves remain in schema (migration 0025 stays — they're "compat sentinels"); the linter must enforce LOCKER-08 only against NEW additions, so the allowlist can stay but its **rationale comment** must be replaced with: "Compat-sentinel plaintext columns retained for Better-Auth drizzleAdapter introspection; populated only as NULL post-lens-write. Verified by `apps/api/tests/integration/better-auth-envelope-at-rest.test.ts` (data:CR-01)."

4. **`packages/data/src/schema/accounts.ts:42–49`, `packages/data/src/schema/sessions.ts:34–44`, `packages/data/src/schema/verifications.ts:25–27`** — update the stale comments that claim the lens fires. Replace with: "Plaintext value NEVER lands here at runtime: the envelope-encryption lens (apps/api/src/auth.ts ENCRYPTED_COLUMNS_MAP) intercepts every write and routes plaintext into the bytea sidecars. data:CR-01 / Phase 57."

**Key invariants to preserve:**

- Better Auth password sign-in MUST continue to work. The lens decrypts on read; Better Auth's scrypt verify operates on the decrypted plaintext (which is the scrypt hash, not the user-typed password — Better Auth hashes before INSERT).
- `email_verification` flow MUST continue to work (Better Auth writes the token plaintext into `verification.value`; the lens encrypts it; on `verifyEmail` Better Auth reads it back, the lens decrypts, and the token-equality check succeeds).
- The 5-minute previous-token rotation overlap (AUTH-04) is OUT OF SCOPE for Track A — it's `data:CR-04` deferred to Phase 58. Track A makes `sessions.token` and `sessions.previous_token` non-plaintext; it does NOT wire `previous_token_fp`. The integration test should NOT assert overlap behavior.

**Verify GREEN:** `pnpm --filter @openwhispr/api test better-auth-envelope-at-rest` → exit 0. Re-run with `--reporter=verbose` and confirm all 7 assertions pass.

### REFACTOR step

- Verify `pnpm lint:lockers` green (especially LOCKER-08).
- Verify `pnpm typecheck` green across the monorepo.
- Re-read `packages/data/src/encryption/backfill.ts` — the HI-04 backfill-CLI hazard is NOT in scope for Phase 57, but document it on `.planning/deferred-items.md` with WHY: "backfill.ts will leave plaintext + ciphertext coexisting if re-run while migration 0025 plaintext columns exist; gate the backfill CLI on `ENCRYPTED_COLUMNS_MAP[model].length > 0 ∧ row.<col> IS NULL` before run, OR drop the plaintext columns once the v1 sign-up flow no longer needs them."

### Commit message

```
fix(57-A): data:CR-01 + data:CR-03 — envelope-encryption lens fires for Better Auth credentials

Populate ENCRYPTED_COLUMNS_MAP for account.{password, access_token, refresh_token, id_token},
sessions.{token, previous_token}, and verification.value. Restore the LOCKER-08 rationale
comment to its pre-Plan-51-23/24 truth (the lens deletes plaintext before INSERT — true now,
mechanically false under empty map). Update schema-file comments in accounts.ts / sessions.ts /
verifications.ts to match reality.

Regression test apps/api/tests/integration/better-auth-envelope-at-rest.test.ts boots the real
API + Postgres + PgBouncer + Valkey via testcontainers, signs up a credential user, signs in,
and asserts plaintext columns are NULL while bytea sidecars are populated for all 7 covered
columns. Sign-in round-trip proves the lens decrypts the password hash on read.

CRIT-FIX-02 / Phase 33's at-rest encryption posture is restored. Phase 51-23/24 amendment
rationale (LENS_INTROSPECTION_COMPAT) is corrected — the columns remain as compat sentinels;
the lens now fires.

Closes data:CR-01, data:CR-03.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification

```bash
# (a) commit on HEAD
git log --oneline -1 | grep -q '57-A'

# (b) test green
pnpm --filter @openwhispr/api test better-auth-envelope-at-rest

# (c) production-code fingerprint in place
grep -n 'account: \["password", "access_token", "refresh_token", "id_token"\]' apps/api/src/auth.ts

# (d) lockers green
pnpm lint:lockers

# (e) test name references finding ID
grep -n 'data:CR-01' apps/api/tests/integration/better-auth-envelope-at-rest.test.ts

# (f) clean tree
git status --short
```

---

## Track B — `data:CR-02` — Fail-closed RLS posture restored

### Pre-conditions

- Track A landed on HEAD; `pnpm test` green.
- Migration 0024 is `packages/data/migrations/0024_better_auth_tenant_id_defaults.sql`. Read it end-to-end (78 lines per the data review).
- Read migration 0018 (`0018_rls_fail_closed.sql`) lines 27–42 to recall the exact SQL Phase 32 used.
- Read `packages/data/tests/unit/__tests__/rls-fail-closed.property.test.ts` to understand the existing 128-case property-test shape.
- Read Better Auth's `drizzleAdapter` source paths that INSERT into `users` / `sessions` / `account` / `verification` to confirm whether they supply `tenant_id` explicitly or rely on the column DEFAULT. If they supply it, **option-A** (drop rolconfig + drop column DEFAULTs) is safe. If they don't, **option-B** (wire a Better Auth hook that runs every DB call inside `withTenant(req.tenant)`) is required.
- **Decision**: this plan defaults to **option-A** unless the pre-condition check reveals Better Auth INSERTs lack a `tenant_id` value. The Phase 32 property test passed on the four Better-Auth tables when migration 0018 was in force, which implies Better Auth either supplies `tenant_id` or the test seed-path supplied it on its behalf. If the executor's pre-check reveals option-A breaks sign-up, switch to option-B (document the pivot in the commit message and add a `withTenant` wrapper hook in `apps/api/src/auth.ts`).

### RED step

**File 1:** `packages/data/tests/integration/rls-fail-closed-better-auth.test.ts` (new)

**Test description:** Boot Postgres + PgBouncer via testcontainers. Apply all migrations through 0026 + the new 0027. Open a bare `openwhispr_app`-role connection via PgBouncer **without** issuing `SELECT set_config('app.tenant_id', ...)`. Run:

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM sessions;
SELECT count(*) FROM account;
SELECT count(*) FROM verification;
```

Assert each returns `0` (NOT the default-tenant row count). Then `SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000000'` and confirm rows ARE visible. This proves the rolconfig DEFAULT is gone.

**Test name MUST reference** `data:CR-02`: `it("data:CR-02 — bare connection sees zero rows on Better-Auth tables (fail-closed)", ...)`.

**File 2:** `packages/data/tests/integration/migration-0027-applies.test.ts` (new)

**Test description:** Apply migrations 0000..0026, snapshot `pg_db_role_setting WHERE setrole = 'openwhispr_app'::regrole` and `information_schema.columns WHERE column_name = 'tenant_id' AND column_default IS NOT NULL`. Apply 0027. Re-snapshot. Assert: (a) zero rolconfig entries for `app.tenant_id`; (b) zero column-default entries for `tenant_id` on `users` / `sessions` / `account` / `verification`.

**Verify RED:** `pnpm --filter @openwhispr/data test rls-fail-closed-better-auth migration-0027-applies` → exit non-zero. The bare-connection SELECTs return default-tenant rows.

### GREEN step

**Production-code files to create:**

1. **`packages/data/migrations/0027_fail_closed_rls_better_auth.sql`** (new forward migration):

   ```sql
   -- Migration 0027 — restore fail-closed RLS posture for Better-Auth-owned tables.
   --
   -- Closes data:CR-02 (Phase 57).
   --
   -- Migration 0018 (CRIT-FIX-01) RESET app.tenant_id rolconfig and DROPped tenant_id
   -- column DEFAULTs to make RLS fail closed. Migration 0024 silently re-installed both
   -- to make Better-Auth sign-up green at the cost of a fail-OPEN posture. This
   -- migration reverts 0024's RLS-relevant changes (the column comments and other
   -- additive metadata from 0024 stay).

   -- (1) Drop the rolconfig that binds every backend connection to the default tenant.
   ALTER ROLE openwhispr_app RESET app.tenant_id;

   -- (2) Drop tenant_id column DEFAULTs on the four Better-Auth tables.
   ALTER TABLE users        ALTER COLUMN tenant_id DROP DEFAULT;
   ALTER TABLE sessions     ALTER COLUMN tenant_id DROP DEFAULT;
   ALTER TABLE account      ALTER COLUMN tenant_id DROP DEFAULT;
   ALTER TABLE verification ALTER COLUMN tenant_id DROP DEFAULT;
   ```

2. **`packages/data/migrations/0027_fail_closed_rls_better_auth.down.sql`** (companion, for operator rescue):

   ```sql
   -- Reverse of 0027 — re-installs 0024's fail-OPEN posture. Operator-rescue only;
   -- shipping the reverse intentionally so a rollback path exists.
   ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000';
   ALTER TABLE users        ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid;
   ALTER TABLE sessions     ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid;
   ALTER TABLE account      ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid;
   ALTER TABLE verification ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid;
   ```

3. **If pre-check reveals Better Auth INSERTs lack `tenant_id` (option-B fallback)** — add to `apps/api/src/auth.ts` a `databaseHooks` block that wraps every DB call in `withTenant(req.tenant)`. Better Auth exposes `databaseHooks.session.create.before` / `databaseHooks.account.create.before` / etc. Use the request-scope `tenantId` from a Fastify `requestContext` (already wired). **This branch should ONLY be taken if option-A breaks sign-up.** Document the pivot in the commit message.

**Key invariants to preserve:**

- The existing 128-case `rls-fail-closed.property.test.ts` MUST still pass — extend it (or add to the new test file) to cover the four Better-Auth tables.
- The fail-closed posture MUST be restored at the database layer, not papered over with a route-side `withTenant` discipline that future contributors could forget.
- DO NOT touch migration 0024 itself (CLAUDE.md hard rule 1). Forward-fix via 0027.

**Verify GREEN:** `pnpm --filter @openwhispr/data test rls-fail-closed-better-auth migration-0027-applies` → exit 0. Then `pnpm --filter @openwhispr/api test better-auth-envelope-at-rest` (from Track A) → still exit 0 (sign-up + sign-in continue to work post-0027).

### REFACTOR step

- Extend `packages/data/tests/unit/__tests__/rls-fail-closed.property.test.ts` to add `users`, `sessions`, `account`, `verification` to the table list. The property test should now cover **all** 16 tenant-scoped tables.
- If option-B was needed, document the Better-Auth hook chain in `docs/security.md` § "Multi-tenancy + RLS".

### Commit message

```
fix(57-B): data:CR-02 — restore fail-closed RLS posture for Better-Auth tables

Migration 0027 RESETs the openwhispr_app rolconfig (app.tenant_id) and DROPs the
tenant_id column DEFAULTs on users / sessions / account / verification that 0024
silently re-installed. RLS now fails closed on the four Better-Auth-owned tables:
a bare connection without withTenant sees zero rows, not default-tenant rows.

Regression tests:
- packages/data/tests/integration/rls-fail-closed-better-auth.test.ts asserts the
  bare-connection SELECTs return 0 rows; SET LOCAL app.tenant_id unlocks visibility.
- packages/data/tests/integration/migration-0027-applies.test.ts snapshots pg_db_role_setting
  and column_default state before/after 0027 to lock the schema invariant.

Existing 128-case property test extended to cover all 16 tenant-scoped tables.

[If option-B was needed, append: Better Auth databaseHooks now wrap every DB call
inside withTenant(req.tenant) — see apps/api/src/auth.ts.]

CRIT-FIX-01 / Phase 32's fail-closed posture is restored across all tenant-scoped
tables.

Closes data:CR-02.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification

```bash
pnpm --filter @openwhispr/data test rls-fail-closed-better-auth migration-0027-applies
pnpm --filter @openwhispr/api test better-auth-envelope-at-rest
ls packages/data/migrations/0027_fail_closed_rls_better_auth.sql
ls packages/data/migrations/0027_fail_closed_rls_better_auth.down.sql
grep -n 'data:CR-02' packages/data/tests/integration/rls-fail-closed-better-auth.test.ts
pnpm lint:lockers
git status --short
```

---

## Track C — `api-routes-rest:CR-02` + `CR-03` — Production veto for all `/api/_test/*` (and `/__test/fetch`)

### Pre-conditions

- Tracks A and B landed; baseline tests green.
- Read `apps/api/src/routes/test-only.ts` end-to-end (~500 lines). Identify every route handler: `/api/_test/force-rotate` (line 202), `/api/_test/health-authed` (line 257), `/api/_test/route-list` (line 279), `/api/_test/reset-setup` (line 311), `/api/_test/seed-tenant` (line 372 — already has the veto).
- Read the plugin-registration gate at `apps/api/src/routes/test-only.ts:173–178` (the `enabled` check that allows `NODE_ENV=test OR OPENWHISPR_TEST_ROUTES=true`).
- Read `apps/api/src/index.ts:550–558` — the `/__test/fetch` debug route registration (api-core:HI-02, opportunistic).

### RED step

**File:** `apps/api/tests/integration/test-only-production-veto.test.ts` (new)

**Test description:** Boot the API with `NODE_ENV=production` AND `OPENWHISPR_TEST_ROUTES=true` AND all other production env requirements satisfied (use the existing `bootProductionApi()` test helper, or build one if it doesn't exist — read `apps/api/tests/helpers/boot.ts` for the pattern). Send unauthenticated requests:

- `POST /api/_test/force-rotate` → assert 404
- `POST /api/_test/health-authed` → assert 404
- `POST /api/_test/route-list` → assert 404
- `POST /api/_test/reset-setup` → assert 404
- `POST /api/_test/seed-tenant` → assert 404 (already works; regression-pin it)
- `POST /__test/fetch` → assert 404 (api-core:HI-02 opportunistic close)

Then boot a second instance with `NODE_ENV=test` AND `OPENWHISPR_TEST_ROUTES=true` and assert each of the same routes returns its expected status (not 404). This pins the asymmetry: production-veto ON, test-mode unchanged.

**Test name MUST reference** the finding IDs: `it("api-routes-rest:CR-02 + CR-03 — /api/_test/* refuses on NODE_ENV=production", ...)` and `it("api-routes-rest:CR-02 + CR-03 — /api/_test/* serves on NODE_ENV=test", ...)`.

**Verify RED:** `pnpm --filter @openwhispr/api test test-only-production-veto` → exit non-zero. Today, `force-rotate` / `reset-setup` / `health-authed` / `route-list` / `/__test/fetch` return 200/4xx (not 404) under `NODE_ENV=production + OPENWHISPR_TEST_ROUTES=true`.

### GREEN step

**Production-code files to edit:**

1. **`apps/api/src/routes/test-only.ts:173–178`** — lift the production veto to the plugin-registration gate:

   ```ts
   // BEFORE plugin registers ANY route, refuse on production regardless of OPENWHISPR_TEST_ROUTES.
   if (process.env.NODE_ENV === "production") {
     // Hard refuse: no /api/_test/* surface in production.
     // Closes api-routes-rest:CR-02 + CR-03 (Phase 57).
     return;
   }
   const enabled =
     process.env.NODE_ENV === "test" || process.env.OPENWHISPR_TEST_ROUTES === "true";
   if (!enabled) return;
   ```

   Remove the per-handler `if (process.env.NODE_ENV === "production") return reply.code(404)...` veto from `seed-tenant` at line 372–374 (it's now redundant — the plugin doesn't register at all).

2. **`apps/api/src/index.ts:550–558`** — same lift for `/__test/fetch`:

   ```ts
   if (process.env.NODE_ENV !== "production" &&
       (process.env.NODE_ENV === "test" || process.env.OPENWHISPR_TEST_ROUTES === "true")) {
     await app.register(buildDebugFetchRoutes());
   }
   ```

**Key invariants to preserve:**

- Test-mode (`NODE_ENV=test`) behavior unchanged. Existing test suites that exercise `/api/_test/*` MUST continue to pass.
- Dev-mode (`NODE_ENV=development + OPENWHISPR_TEST_ROUTES=true`) behavior unchanged — the dev-tools compose overlay sets `NODE_ENV=development`, not `production` (per CONTEXT.md risk note).
- Production behavior: `/api/_test/*` and `/__test/fetch` return 404 (route not registered → Fastify default 404). No way for an operator to opt back in via env without setting `NODE_ENV` away from `production`.

**Verify GREEN:** `pnpm --filter @openwhispr/api test test-only-production-veto` → exit 0.

### REFACTOR step

- Re-run the full `apps/api` test suite to confirm no test relied on the per-handler veto pattern: `pnpm --filter @openwhispr/api test`.
- Grep for `OPENWHISPR_TEST_ROUTES` across the codebase; document the plugin-registration gate in `docs/operations.md` § "Test-only routes" with the explicit warning: "Setting `OPENWHISPR_TEST_ROUTES=true` is a no-op in production. NODE_ENV=production is the only safety gate that matters."

### Commit message

```
fix(57-C): api-routes-rest:CR-02 + CR-03 — production veto for /api/_test/* and /__test/fetch

Lift the NODE_ENV='production' veto from per-handler (only seed-tenant had it) to the
plugin-registration gate. Every /api/_test/* route now refuses to register at all when
NODE_ENV=production, regardless of OPENWHISPR_TEST_ROUTES. Same change applied to
/__test/fetch in apps/api/src/index.ts (api-core:HI-02 opportunistic close).

A misset OPENWHISPR_TEST_ROUTES=true in production can no longer (a) re-open the admin
claim window via /api/_test/reset-setup, (b) force a session-token rotation on any
user via /api/_test/force-rotate, or (c) invoke the unauthenticated arbitrary-URL
fetcher /__test/fetch.

Regression test apps/api/tests/integration/test-only-production-veto.test.ts boots the
API with NODE_ENV=production + OPENWHISPR_TEST_ROUTES=true and asserts every /api/_test/*
route + /__test/fetch returns 404. A second boot with NODE_ENV=test pins the
asymmetry — test-mode behavior unchanged.

Closes api-routes-rest:CR-02, api-routes-rest:CR-03. (api-core:HI-02 also closed but
not in Phase 57 scope; flag in REVIEW-INDEX.md as "closed opportunistically.")

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification

```bash
pnpm --filter @openwhispr/api test test-only-production-veto
grep -n 'process.env.NODE_ENV === "production"' apps/api/src/routes/test-only.ts
grep -n 'OPENWHISPR_TEST_ROUTES' apps/api/src/index.ts
pnpm --filter @openwhispr/api test  # full suite — confirm no regression
pnpm lint:lockers
git status --short
```

---

## Track D — `byok:CR-01` + `CR-02` — BYOK redact regex coverage gaps

### Pre-conditions

- Tracks A–C landed; baseline green.
- Read `packages/byok-guard/src/redact-url.ts` end-to-end (~160 lines). Confirm `BEARER_SHAPES` lives at lines 61–70 and is the single source of truth for URL bearer-shape redaction (grep across the monorepo to verify).
- Read existing tests at `packages/byok-guard/src/__tests__/redact-url.test.ts` to confirm the test format.
- **LiteLLM virtual-key minimum length check:** verify against LiteLLM source/docs. The current `sk-[A-Za-z0-9_-]{20,}` lets `sk-…` with ≤19-char bodies through. LiteLLM virtual keys are typically `sk-1234567890abcdef` (16-body) or similar. Set the new threshold to **`{8,}`** (the data review's recommendation) — this is conservative and catches the LiteLLM gap without producing false positives on user-written prose containing `sk-` (the body must be 8+ alphanumeric/`_-` chars, which is rare in English).
- **GitHub PAT shapes confirmed:** `ghp_` (classic PAT), `gho_` (OAuth user-to-server), `ghu_` (user-to-server token from GH apps), `ghs_` (server-to-server GH apps), `ghr_` (refresh). Each has a fixed `[A-Za-z0-9_]{36,255}` body per GitHub docs.
- **Tavily shape:** `tvly-[A-Za-z0-9]{32,40}` (verified against Tavily dashboard sample keys per memory `project_phase5_websearch.md`).
- **Yandex shapes:** `AQVN[A-Za-z0-9_-]{20,}` (folder-scoped IAM) and `y0_[A-Za-z0-9_-]{32,}` (OAuth tokens).
- **AWS STS:** `ASIA[A-Z0-9]{16}` (20-char total).

### RED step

**File:** `packages/byok-guard/src/__tests__/redact-url-shapes.test.ts` (new — separate file to keep the regression-shape suite distinct)

**Test cases** (each MUST reference the finding ID in the test name):

```ts
describe("byok:CR-01 — redactUrl masks provider-specific key shapes in URL paths/fragments", () => {
  it.each([
    ["https://api.example/secrets/ghp_1234567890abcdefghijklmnopqrstuvwxyz123456/rotate", "ghp_"],
    ["https://api.example/secrets/gho_1234567890abcdefghijklmnopqrstuvwxyz123456/rotate", "gho_"],
    ["https://api.example/secrets/ghu_1234567890abcdefghijklmnopqrstuvwxyz123456/rotate", "ghu_"],
    ["https://api.example/secrets/ghs_1234567890abcdefghijklmnopqrstuvwxyz123456/rotate", "ghs_"],
    ["https://api.example/secrets/ghr_1234567890abcdefghijklmnopqrstuvwxyz123456/rotate", "ghr_"],
    ["https://api.tavily.com/search?key=tvly-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "tvly-"],
    ["https://yandex.example/secrets/AQVNabcdefghijklmnopqrstu/rotate", "AQVN"],
    ["https://yandex.example/secrets/y0_AgAAAAAabcdefghijklmnopqrstuvwxyz12345/rotate", "y0_"],
    ["https://s3.amazonaws.com/bucket?X-Amz-Credential=ASIAIOSFODNN7EXAMPLE/...", "ASIA"],
    ["https://litellm.example/v1/chat?key=sk-12345678", "sk-"],   // 8-body — byok:CR-02
  ])("redacts %s containing shape %s", (url, shape) => {
    const redacted = redactUrl(url);
    expect(redacted).not.toContain(shape + "1234");  // not literal
    expect(redacted).not.toMatch(new RegExp(`${shape.replace(/[-]/g, "\\-")}[A-Za-z0-9]{4,}`));
  });
});

describe("byok:CR-02 — redactUrl masks short sk- bodies (≤19 chars)", () => {
  it("masks sk- with 8-char body (LiteLLM virtual-key shape)", () => {
    const redacted = redactUrl("https://litellm.example/v1/chat?key=sk-12345678");
    expect(redacted).not.toContain("sk-12345678");
  });
  it("masks sk- with 19-char body (boundary case)", () => {
    const redacted = redactUrl("https://litellm.example/v1/chat?key=sk-1234567890abcdefghi");
    expect(redacted).not.toContain("sk-1234567890abcdefghi");
  });
});

// Property-test: fuzz key-like strings to catch regressions
describe("byok:CR-01 — property: any URL containing a configured shape is redacted", () => {
  // fast-check generator over (shape × body × placement: path|query-value|fragment)
  // shape ∈ {ghp_, gho_, ghu_, ghs_, ghr_, tvly-, AQVN, y0_, ASIA, sk-, sk-ant-, AIza, AKIA}
  // body ∈ /[A-Za-z0-9_-]{8,40}/
  // placement ∈ {`/p/${shape}${body}/x`, `?k=${shape}${body}`, `#${shape}${body}`}
  // assert redactUrl(url).indexOf(shape + body) === -1
});
```

**Verify RED:** `pnpm --filter @openwhispr/byok-guard test redact-url-shapes` → exit non-zero on all 5 GitHub shapes, Tavily, Yandex, ASIA, and the two short-`sk-` cases.

### GREEN step

**Production-code file to edit:**

1. **`packages/byok-guard/src/redact-url.ts:61–70`** — replace `BEARER_SHAPES`:

   ```ts
   const BEARER_SHAPES: readonly RegExp[] = [
     // OpenAI / OpenRouter / generic sk- (lowered from {20,} to {8,} for LiteLLM virtual keys — byok:CR-02)
     /\bsk-[A-Za-z0-9_-]{8,}\b/g,
     // Anthropic
     /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
     // Google
     /\bAIza[A-Za-z0-9_-]{20,}\b/g,
     // AWS permanent access key
     /\bAKIA[A-Z0-9]{16}\b/g,
     // AWS STS session-key — byok:CR-01
     /\bASIA[A-Z0-9]{16}\b/g,
     // GitHub PAT / OAuth shapes — byok:CR-01
     /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g,
     // Tavily — byok:CR-01
     /\btvly-[A-Za-z0-9]{16,40}\b/g,
     // Yandex IAM folder-scoped — byok:CR-01
     /\bAQVN[A-Za-z0-9_-]{16,}\b/g,
     // Yandex OAuth — byok:CR-01
     /\by0_[A-Za-z0-9_-]{20,}\b/g,
     // JWT three-part (existing)
     /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
   ] as const;
   ```

2. **`packages/byok-guard/src/redact-url.ts:139`** (LO-01 opportunistic) — rename inner `const raw` to `const hashBody` to fix the shadow.

**Key invariants to preserve:**

- Existing tests in `redact-url.test.ts` MUST continue to pass.
- The regex set is `readonly` (LO-02 close).
- Length thresholds are conservative — too-aggressive a threshold (e.g. `{4,}`) would false-positive on English prose. `{8,}` for `sk-` is the documented LiteLLM minimum and is safe per the data-review analysis.

**Verify GREEN:** `pnpm --filter @openwhispr/byok-guard test` → exit 0.

### REFACTOR step

- Confirm no other file in the monorepo defines a bearer-shape regex: `grep -rE 'sk-|ghp_|tvly-|ASIA' --include="*.ts" packages/ apps/ | grep -v 'redact-url.ts\|tests/\|fixtures/\|__tests__/' | grep -E 'RegExp|/\\b' || true`. Should be empty.
- Confirm Pino `REDACT_PATHS` in `@openwhispr/observability` is orthogonal (field-name strings, not regexes) and untouched.

### Commit message

```
fix(57-D): byok:CR-01 + CR-02 — extend BEARER_SHAPES + lower sk- threshold

Add 8 missing provider key shapes to redactUrl's BEARER_SHAPES: ghp_, gho_, ghu_,
ghs_, ghr_ (GitHub PAT / OAuth), tvly- (Tavily — shipped per Phase 5), AQVN and y0_
(Yandex — shipped per Phase 5), ASIA (AWS STS session keys, used by every presigned
S3 URL with temporary creds).

Lower the sk-<body> length threshold from {20,} to {8,}. LiteLLM virtual keys
(shape "sk-1234567890abcdef") fit in the 8–19 char gap; the previous threshold
let them through. {8,} is the LiteLLM virtual-key documented minimum and is
conservative enough to avoid false positives on English prose.

Make BEARER_SHAPES readonly (LO-02 close) and rename inner `raw` to `hashBody`
in the fragment branch to remove the shadow (LO-01 close — opportunistic).

Regression test packages/byok-guard/src/__tests__/redact-url-shapes.test.ts
asserts every new shape redacts in path / query / fragment placement, with a
fast-check property test fuzzing shape × body × placement combinations to catch
future regressions.

Closes byok:CR-01, byok:CR-02.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification

```bash
pnpm --filter @openwhispr/byok-guard test
grep -n 'ASIA\|ghp_\|tvly-\|AQVN\|y0_' packages/byok-guard/src/redact-url.ts
grep -n 'sk-\[A-Za-z0-9_-\]{8,}' packages/byok-guard/src/redact-url.ts
grep -n 'byok:CR-01\|byok:CR-02' packages/byok-guard/src/__tests__/redact-url-shapes.test.ts
pnpm lint:lockers
git status --short
```

---

## Track E — `api-routes-rest:CR-01` — Host header injection (INGRESS_BASE_URL boot-required)

### Pre-conditions

- Tracks A–D landed; baseline green.
- Read `apps/api/src/routes/better-auth-handler.ts:50–100` end-to-end. Confirm the `buildRequestUrl` shape and the two `if`-branch return statements at lines 85 and 89 are identical (the bug).
- Read `apps/api/src/config/auth.ts` — locate `validateAuthBoot()` (the loud-fail pattern referenced by the data review).
- **Default-value decision (per CONTEXT.md risk note):** the OSS quickstart `compose/docker-compose.yml` currently runs without `INGRESS_BASE_URL` in many configs. Check `compose/.env.example`. If `INGRESS_BASE_URL` is not set there, this track MUST add it with a sensible default (e.g. `http://localhost:3000` — the docker-compose-up quickstart URL) AND document it as REQUIRED in `docs/operations.md`. The boot guard exits 78 only if BOTH env vars are unset.

### RED step

**File 1:** `apps/api/tests/unit/validate-ingress-boot.test.ts` (new)

**Test description:** Mock `process.env` with both `INGRESS_BASE_URL` and `AUTH_URL` unset. Call `validateAuthBoot()` (or its new wrapper `validateIngressBoot()`). Assert it throws / exits 78. Then set `INGRESS_BASE_URL=https://example.com`, call again, assert it returns the URL. Then set `AUTH_URL=https://example.com` (INGRESS unset), call again, assert it returns the URL. Set both → INGRESS_BASE_URL wins.

**Test name:** `it("api-routes-rest:CR-01 — boot exits 78 when both INGRESS_BASE_URL and AUTH_URL unset", ...)`.

**File 2:** `apps/api/tests/integration/host-header-injection.test.ts` (new)

**Test description:** Boot the API with `INGRESS_BASE_URL=https://canonical.example.com` set. Send a request with a malicious `Host: evil.example.com` header to `/api/auth/some-endpoint`. Intercept the request URL that Better Auth's `buildRequestUrl` constructs (via a Fastify pre-handler test hook, or by asserting on the Origin / redirect_uri validation outcome). Assert the constructed origin is `https://canonical.example.com`, NEVER `https://evil.example.com`, regardless of allowlist state.

**Test name:** `it("api-routes-rest:CR-01 — req.headers.host is never used as origin (bogus Host → canonical INGRESS_BASE_URL)", ...)`.

**Verify RED:** Both tests fail today. Test 1 fails because there's no `validateIngressBoot` and `auth.ts:376` defaults to `localhost:3000`. Test 2 fails because `better-auth-handler.ts:79` falls through to `req.headers.host`.

### GREEN step

**Production-code files to edit:**

1. **`apps/api/src/config/auth.ts`** — add `validateIngressBoot()` (or extend `validateAuthBoot()`):

   ```ts
   export function validateIngressBoot(): { ingressBaseUrl: string } {
     const ingress = process.env.INGRESS_BASE_URL?.trim();
     const authUrl = process.env.AUTH_URL?.trim();
     const resolved = ingress || authUrl;
     if (!resolved) {
       // Exit 78 (EX_CONFIG) — neither env var set.
       process.stderr.write(
         "FATAL: INGRESS_BASE_URL (preferred) or AUTH_URL must be set. " +
         "req.headers.host is NEVER a safe origin source. " +
         "Closes api-routes-rest:CR-01 (Phase 57).\n"
       );
       process.exit(78);
     }
     // Optional: enforce HTTPS in production
     if (process.env.NODE_ENV === "production" && !resolved.startsWith("https://")) {
       process.stderr.write(`FATAL: INGRESS_BASE_URL/AUTH_URL must be HTTPS in production; got: ${resolved}\n`);
       process.exit(78);
     }
     return { ingressBaseUrl: resolved };
   }
   ```

2. **`apps/api/src/routes/better-auth-handler.ts:50–100`** — rewrite `buildRequestUrl`:

   ```ts
   function buildRequestUrl(req: FastifyRequest): string {
     // Closes api-routes-rest:CR-01 — req.headers.host is NEVER trusted.
     // INGRESS_BASE_URL (or AUTH_URL fallback) is the only allowed origin source.
     // validateIngressBoot() ran at startup; this read cannot fail.
     const base = (process.env.INGRESS_BASE_URL || process.env.AUTH_URL)!;
     return `${base.replace(/\/+$/, "")}${req.url}`;
   }
   ```

   Delete the `AUTH_TRUSTED_ORIGINS_EXTRA` allowlist branch entirely — it was promoting attacker-controlled values, not gating them. If multi-origin support is needed for a future deploy shape, surface it via a separate `getTrustedOrigins()` helper that returns a list to pass to Better Auth's own CSRF allowlist, NOT as a substitute for the canonical origin.

3. **`apps/api/src/auth.ts:376`** — replace `baseURL: process.env.AUTH_URL ?? "http://localhost:3000"` with `baseURL: validateIngressBoot().ingressBaseUrl` (or thread the resolved value through the existing `validateAuthBoot()` call chain).

4. **`apps/api/src/index.ts`** — call `validateIngressBoot()` early in the boot sequence (before Better Auth registration), so the exit 78 fires before any listening.

5. **`compose/.env.example`** + **`docs/operations.md`** — add `INGRESS_BASE_URL=http://localhost:3000` as the documented quickstart default. Document the boot requirement.

**Key invariants to preserve:**

- The OSS quickstart `docker compose up` MUST continue to work. Either ship `INGRESS_BASE_URL` in the `.env.example` (and `compose/docker-compose.yml` env block), or document that operators must `cp .env.example .env` before first boot. The boot-exit-78 must not happen on a fresh `git clone && docker compose up` for any user.
- `validateAuthBoot()`'s existing HTTPS-on-production check is preserved (HI-01 is closed as a side effect, but is not formally in Phase 57 scope).
- No code path reads `req.headers.host` for origin reconstruction.

**Verify GREEN:** `pnpm --filter @openwhispr/api test validate-ingress-boot host-header-injection` → exit 0.

### REFACTOR step

- Grep `req.headers.host` and `req.headers["host"]` across `apps/api/src/`. Should appear only in logging contexts (where it's safe), not in URL-construction contexts. If any other code site uses it for origin, fix here.
- Grep `process.env.AUTH_URL` and `process.env.INGRESS_BASE_URL` — they should be read only in `config/auth.ts`. Per LOCKER-01, no other site may read them.

### Commit message

```
fix(57-E): api-routes-rest:CR-01 — INGRESS_BASE_URL boot-required; Host header never trusted

validateIngressBoot() exits 78 (EX_CONFIG) at startup when neither INGRESS_BASE_URL
(preferred) nor AUTH_URL is set. better-auth-handler.ts buildRequestUrl now reads ONLY
the validated env value; the req.headers.host fallback and the (buggy) allowlist-pass
branch that returned the same attacker-controlled origin both removed.

A request with a malicious Host header (e.g. Host: evil.example.com) is forced through
the canonical INGRESS_BASE_URL origin in Better Auth's CSRF / Origin / redirect-uri
validation. Cookie-signing baseURL in apps/api/src/auth.ts also pinned to the
validated origin (closes HI-01 as a side effect, though not formally in Phase 57 scope).

Quickstart unaffected: compose/.env.example now ships INGRESS_BASE_URL=http://localhost:3000
as the documented default. docs/operations.md documents the requirement.

Regression tests:
- apps/api/tests/unit/validate-ingress-boot.test.ts asserts exit 78 when both env vars
  unset; round-trips when set.
- apps/api/tests/integration/host-header-injection.test.ts boots with INGRESS_BASE_URL
  set, sends Host: evil.example.com, asserts the constructed origin is canonical.

Closes api-routes-rest:CR-01.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification

```bash
pnpm --filter @openwhispr/api test validate-ingress-boot host-header-injection
grep -n 'req.headers.host\|req.headers\["host"\]' apps/api/src/routes/better-auth-handler.ts || echo "ok — host header removed"
grep -n 'INGRESS_BASE_URL' compose/.env.example
grep -n 'INGRESS_BASE_URL' docs/operations.md
pnpm lint:lockers
git status --short
```

---

## Track F — `api-core:CR-01` — Production safety knob loud-fail wrappers

### Pre-conditions

- Tracks A–E landed; baseline green.
- Read the 4 env-knob sites:
  - `apps/api/src/auth.ts:270–273` (anti-abuse limiter)
  - `apps/api/src/auth.ts:430` (`requireEmailVerification`)
  - `apps/api/src/auth.ts:562–565` (`cookieCache`)
  - `apps/api/src/plugins/rate-limit.ts:142–157` (`rateLimitDisabled`)
  - `apps/api/src/index.ts:727` (`MOCK_DIARIZATION`)
- Read `apps/api/src/config/litellm.ts` to see the existing `validateLitellmBoot()` pattern (the loud-fail exemplar).
- **Dev-tools overlay check (per CONTEXT.md risk):** confirm `compose/docker-compose.dev-tools.yml` sets `NODE_ENV=development` (or omits it, defaulting to dev). The veto only fires on `NODE_ENV=production`, so the dev-tools overlay is unaffected.

### RED step

**File:** `apps/api/tests/unit/validate-safety-knobs-boot.test.ts` (new)

**Test cases** (each MUST reference `api-core:CR-01`):

```ts
describe("api-core:CR-01 — production safety knobs exit 78 when set in production", () => {
  it.each([
    ["OPENWHISPR_DISABLE_RATE_LIMIT", "1"],
    ["OPENWHISPR_DISABLE_RATE_LIMIT", "true"],
    ["OPENWHISPR_DISABLE_EMAIL_VERIFICATION", "1"],
    ["OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE", "1"],
    ["MOCK_DIARIZATION", "true"],
  ])("exits 78 when %s=%s and NODE_ENV=production", (knob, val) => {
    process.env.NODE_ENV = "production";
    process.env[knob] = val;
    expect(() => validateSafetyKnobsBoot()).toThrow(/EX_CONFIG.*production/);
  });

  it("returns OK when knob set and NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "1";
    expect(validateSafetyKnobsBoot()).toEqual({ ok: true });
  });

  it("returns OK when knob unset and NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
    expect(validateSafetyKnobsBoot()).toEqual({ ok: true });
  });
});
```

**Verify RED:** `pnpm --filter @openwhispr/api test validate-safety-knobs-boot` → exit non-zero (no `validateSafetyKnobsBoot` exists yet).

### GREEN step

**Production-code files to create/edit:**

1. **`apps/api/src/config/safety-knobs.ts`** (new):

   ```ts
   /**
    * Closes api-core:CR-01 (Phase 57).
    *
    * Safety knobs that disable anti-abuse / verification controls. Each is fine in
    * dev/test/load-test profiles but MUST refuse to boot in production — matching
    * the loud-fail pattern of validateAuthBoot / validateLitellmBoot / validateBetterAuthSecretBoot.
    */
   const KNOBS = [
     "OPENWHISPR_DISABLE_RATE_LIMIT",
     "OPENWHISPR_DISABLE_EMAIL_VERIFICATION",
     "OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE",
     "MOCK_DIARIZATION",
   ] as const;

   function isTruthy(v: string | undefined): boolean {
     return v === "1" || v === "true";
   }

   export function validateSafetyKnobsBoot(): { ok: true } {
     if (process.env.NODE_ENV !== "production") return { ok: true };
     const offenders = KNOBS.filter((k) => isTruthy(process.env[k]));
     if (offenders.length === 0) return { ok: true };
     process.stderr.write(
       `FATAL [EX_CONFIG]: ${offenders.join(", ")} set with NODE_ENV=production. ` +
       `These knobs disable anti-abuse / verification controls and are dev/test-only. ` +
       `See docs/security.md §safety-knobs. Closes api-core:CR-01.\n`
     );
     process.exit(78);
   }
   ```

2. **`apps/api/src/index.ts`** — call `validateSafetyKnobsBoot()` early in the boot sequence, alongside the other validators (`validateAuthBoot`, `validateLitellmBoot`, etc.).

3. **Keep the in-call WARN logs** in `plugins/rate-limit.ts:144`, `auth.ts:430`, etc. They remain as defense-in-depth signals for dev/load-test runs — only the production-boot path now fails loudly.

4. **`docs/security.md`** — add §"Safety knobs" listing the 4 knobs and the loud-fail behavior.

**Key invariants to preserve:**

- Dev / test / load-test profiles continue to honor the knobs (the WARN-and-continue behavior is preserved when `NODE_ENV !== "production"`).
- Test profile MUST NOT trigger the veto — verify the test harness sets `NODE_ENV=test` consistently.

**Verify GREEN:** `pnpm --filter @openwhispr/api test validate-safety-knobs-boot` → exit 0.

### REFACTOR step

- Grep `OPENWHISPR_DISABLE_` and `MOCK_DIARIZATION` across `apps/api/src/`. Confirm each in-handler read is unchanged (WARN-log defense-in-depth retained) and only the boot-time validator is added.
- Verify `pnpm lint:lockers` green (especially LOCKER-01 — the new file `config/safety-knobs.ts` IS on the LOCKER-01 NODE_ENV-allowed-path list, so reading `process.env.NODE_ENV` is fine).

### Commit message

```
fix(57-F): api-core:CR-01 — production safety knobs loud-fail in production

validateSafetyKnobsBoot() (apps/api/src/config/safety-knobs.ts) exits 78 (EX_CONFIG)
at startup when any of OPENWHISPR_DISABLE_RATE_LIMIT, OPENWHISPR_DISABLE_EMAIL_VERIFICATION,
OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE, MOCK_DIARIZATION is truthy AND NODE_ENV=production.
Aligns these knobs with the loud-fail pattern already used by validateAuthBoot,
validateLitellmBoot, validateBetterAuthSecretBoot, validateEncryptionBoot.

In-handler WARN logs preserved for dev / load-test profiles where the knobs are
legitimate. Dev-tools compose overlay (compose/docker-compose.dev-tools.yml) is
unaffected because it runs with NODE_ENV=development.

Regression test apps/api/tests/unit/validate-safety-knobs-boot.test.ts asserts exit
78 for each (knob, value) × NODE_ENV=production combination, and returns OK for
NODE_ENV=development with knob set, and for NODE_ENV=production with knob unset.

docs/security.md §safety-knobs documents the loud-fail behavior.

Closes api-core:CR-01.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Verification

```bash
pnpm --filter @openwhispr/api test validate-safety-knobs-boot
ls apps/api/src/config/safety-knobs.ts
grep -n 'validateSafetyKnobsBoot' apps/api/src/index.ts
grep -n 'api-core:CR-01' apps/api/tests/unit/validate-safety-knobs-boot.test.ts
pnpm lint:lockers
git status --short
```

---

## Closing the phase

### Update REVIEW-INDEX.md

After all 6 tracks land, edit `.planning/review/REVIEW-INDEX.md`:

- Annotate each of the 8 closed CRITICAL findings with `**Closed by Phase 57.**`:
  - `data:CR-01`, `data:CR-02`, `data:CR-03`
  - `api-routes-rest:CR-01`, `api-routes-rest:CR-02`, `api-routes-rest:CR-03`
  - `byok:CR-01`, `byok:CR-02`
  - `api-core:CR-01`
- Leave `data:CR-04`, `data:CR-05`, `worker:CR-01`, `worker:CR-02` unannotated (out of scope; deferred to Phase 58).
- Annotate `api-core:HI-02` with "Closed opportunistically by Phase 57 Track C" (the `/__test/fetch` veto landed alongside `/api/_test/*`).

### Update deferred-items.md

Append entries for items surfaced during Phase 57 that were intentionally out of scope:

- `data:CR-04` — `previous_token_fp` wiring for AUTH-04 5-min overlap. WHY: requires reworking the lens to populate `sessions.token_fp` and `sessions.previous_token_fp` on write for Better-Auth-owned sessions; non-trivial. Phase 58.
- `data:CR-05` — Dead plaintext-fallback in `oauth-state-codec.ts`. WHY: low-risk cleanup, prefer batching with other dead-code purge in Phase 58.
- `data:HI-04` — backfill.ts hazard post-0025 (plaintext + ciphertext coexistence). WHY: backfill CLI is operator-invoked only; gate the CLI on `ENCRYPTED_COLUMNS_MAP[model].length > 0` before run. Phase 58.

### Final verification gate

```bash
# (1) All 6 track commits on HEAD
git log --oneline -10 | grep -E '57-[ABCDEF]' | wc -l   # expect 6

# (2) Full test suite green
pnpm test

# (3) Lockers green
pnpm lint:lockers

# (4) Typecheck green
pnpm typecheck

# (5) Each CRITICAL finding referenced in a regression test
for id in data:CR-01 data:CR-02 data:CR-03 api-routes-rest:CR-01 api-routes-rest:CR-02 api-routes-rest:CR-03 byok:CR-01 byok:CR-02 api-core:CR-01; do
  grep -rn "$id" apps/api/tests packages/data/tests packages/byok-guard/src/__tests__ > /dev/null \
    && echo "ok: $id" || echo "MISSING: $id"
done

# (6) Production fingerprints in place
grep -n 'account: \["password"' apps/api/src/auth.ts
ls packages/data/migrations/0027_fail_closed_rls_better_auth.sql
grep -n 'process.env.NODE_ENV === "production"' apps/api/src/routes/test-only.ts
grep -n 'ASIA\|ghp_\|tvly-' packages/byok-guard/src/redact-url.ts
grep -n 'validateIngressBoot' apps/api/src/config/auth.ts
ls apps/api/src/config/safety-knobs.ts

# (7) REVIEW-INDEX.md annotated
grep -c 'Closed by Phase 57' .planning/review/REVIEW-INDEX.md   # expect ≥ 9

# (8) Clean tree
git status --short
```

If any check fails, the phase is NOT done — fix the gap before marking complete.

---

## Dependency Graph

```
Track A (data:CR-01 + CR-03)
   │   creates ENCRYPTED_COLUMNS_MAP non-empty
   ▼
Track B (data:CR-02)
   │   migration 0027 — depends on A so the integration test (sign-up still works)
   │   passes under the new fail-closed posture
   ▼
Track C (api-routes-rest:CR-02 + CR-03)   ← independent of A/B; serialized for review
   ▼
Track D (byok:CR-01 + CR-02)              ← independent
   ▼
Track E (api-routes-rest:CR-01)            ← independent
   ▼
Track F (api-core:CR-01)                  ← independent
```

**Why A and B are serialized (not parallel):**

- A modifies `apps/api/src/auth.ts` and `tools/lint-no-plaintext-secret-columns.ts` + schema-comment files.
- B adds `packages/data/migrations/0027_*.sql`.
- File-set overlap is zero, but B's regression test (sign-up succeeds under fail-closed RLS) relies on A's lens-population — running B before A risks a false-positive RED on B (sign-up could fail for the wrong reason).

**Why C–F are serialized:**

- They share zero files with each other.
- They could in principle run in parallel.
- We serialize to keep each commit's review surface small and to ensure `pnpm lint:lockers` + `pnpm typecheck` run cleanly between commits (no merge of two parallel branches that each pass independently but conflict on locker counts).

---

## Risk Register

| ID | Risk | Track | Mitigation |
|---|---|---|---|
| R-1 | Populating `ENCRYPTED_COLUMNS_MAP` breaks Better Auth password sign-in if the lens decrypts the wrong column or the model-name key doesn't match drizzleAdapter's expectations | A | The integration test exercises BOTH sign-up AND sign-in in the same suite. Sign-in failure on round-trip = immediate RED. If model-name key is wrong (e.g. `session` vs `sessions`), grep drizzleAdapter source for the exact key and adjust before claiming GREEN. |
| R-2 | Migration 0027 dropping rolconfig + column DEFAULTs breaks Better Auth sign-up if its INSERTs don't supply `tenant_id` | B | Pre-condition check (read drizzleAdapter source) confirms whether INSERTs supply `tenant_id`. If they don't, pivot to option-B (Better Auth `databaseHooks` wrapping every DB call in `withTenant(req.tenant)`). The integration test from Track A re-runs as part of Track B's verification — sign-up failure under 0027 = pivot signal. |
| R-3 | Gating `/api/_test/*` on `NODE_ENV !== 'production'` may break a local docker-compose smoke profile that sets `NODE_ENV=production` for parity testing | C | Per CONTEXT.md risk note. Audit `compose/docker-compose*.yml` env blocks for `NODE_ENV=production`. The OSS quickstart compose runs `NODE_ENV=production` for the API container (per BACKEND_SPEC.md parity). If local smoke runs need `/api/_test/*`, they MUST switch to `NODE_ENV=test` or `NODE_ENV=development` for those profiles. Document in PR description; flag for reviewer. |
| R-4 | Tightened redact regex causes false-positives in logs (e.g. legitimate URL paths containing `sk-1234abcd` substring) | D | Conservative thresholds: `sk-` lowered to `{8,}` (LiteLLM virtual-key minimum, verified). GitHub shapes anchored at `{36,255}` (GitHub-doc spec). `tvly-` at `{16,40}`. `ASIA` is fixed-length `{16}`. Property test fuzzes random body lengths to detect over-match. No regex matches inside English prose (each requires `\b` boundary + provider-prefix + alphanumeric body of meaningful length). |
| R-5 | Requiring `INGRESS_BASE_URL`/`AUTH_URL` at boot breaks `docker compose up` for first-time users | E | `compose/.env.example` ships `INGRESS_BASE_URL=http://localhost:3000` as the documented quickstart default. `compose/docker-compose.yml` env block also sets it directly (defense in depth). Document the boot requirement in `docs/operations.md` § "Required environment variables". CI smoke test: `make compose-smoke` boots with the default `.env.example` and asserts no exit 78. |
| R-6 | Production-knob veto breaks the dev-tools overlay (`compose/docker-compose.dev-tools.yml` may set `OPENWHISPR_TEST_ROUTES=true` etc.) | F | The dev-tools overlay runs with `NODE_ENV=development`, so the veto does not fire (verified per CONTEXT.md). Confirm during Track F pre-condition step: `grep -n NODE_ENV compose/docker-compose.dev-tools.yml`. If the overlay sets `NODE_ENV=production`, the overlay itself is the bug — surface as a separate deferred item. |
| R-7 | LOCKER-08 lint rule rejects the lens-populated columns post-Track A | A | Migration 0025 left the plaintext columns as compat sentinels. The LOCKER-08 allowlist (rewritten in Track A) keeps these specific columns allow-listed for the introspection reason — the lint rule continues to BLOCK any NEW plaintext columns. Verify: `pnpm lint:lockers` green after Track A; no new `lint:no-plaintext-secret-columns` errors. |
| R-8 | A test file inadvertently triggers gitleaks pre-commit hook (Tavily / GitHub / AWS shapes in fixture URLs) | D | Per CLAUDE.md hard rule 4, NEVER `--no-verify`. Test fixtures use clearly-fake bodies (`ghp_1234567890abcdefghijklmnopqrstuvwxyz123456` — too regular to be a real PAT; gitleaks regex requires entropy in the body). If gitleaks fires, extend `.gitleaks.toml` allowlist + add a regression assertion in `tools/lint-gitleaks-config.test.ts` per the documented runbook (`docs/security/secret-leak-runbook.md`). |
| R-9 | Track A LOCKER-08 amendment-revert mis-rewrites `tools/lint-no-plaintext-secret-columns.ts` and silently weakens the linter | A | Track A REFACTOR step explicitly runs `pnpm lint:lockers` and checks the linter still catches a hypothetical NEW plaintext column. Optionally: add a positive regression test that introduces a fake `bad_password text` column in a test schema and asserts the linter rejects it. |

---

## Verification Gate Re-check

| # | Gate | Exact command |
|---|---|---|
| 1 | All 13 CRITICAL findings (in scope: 9 for Phase 57) have RED test + GREEN fix on main | `for id in data:CR-01 data:CR-02 data:CR-03 api-routes-rest:CR-01 api-routes-rest:CR-02 api-routes-rest:CR-03 byok:CR-01 byok:CR-02 api-core:CR-01; do grep -rn "$id" apps/api/tests packages/data/tests packages/byok-guard/src/__tests__ > /dev/null && echo "ok: $id" \|\| echo "MISSING: $id"; done` |
| 2 | `pnpm test` green across the monorepo | `pnpm test` |
| 3 | `pnpm lint:lockers` green (all 8) | `pnpm lint:lockers` |
| 4 | `pnpm typecheck` green | `pnpm typecheck` |
| 5 | Spot-check each CRITICAL fix fingerprint | (see "Final verification gate" block above — 7 grep / ls commands) |
| 6 | `git log --oneline -10` shows the 6 track commits | `git log --oneline -10 \| grep -cE '57-[ABCDEF]'` (expect `6`) |
| 7 | `.planning/review/REVIEW-INDEX.md` updated with "Closed by Phase 57" markers | `grep -c 'Closed by Phase 57' .planning/review/REVIEW-INDEX.md` (expect `≥ 9`) |
| 8 | Clean working tree | `git status --short` (expect empty) |

---

## Out of scope

The following items from `REVIEW-INDEX.md` are explicitly NOT closed by Phase 57:

- **`data:CR-04`** — AUTH-04 `previous_token_fp` never populated. Deferred to Phase 58.
- **`data:CR-05`** — Dead plaintext-fallback in `oauth-state-codec.ts`. Deferred to Phase 58.
- **`worker:CR-01`** + **`worker:CR-02`** — billing correctness (watermark advances past skipped rows; rollup buckets by `created_at` not `startTime`). Deferred to Phase 58 (Tier 1 in REVIEW-INDEX.md).
- **All ~38 HIGH findings** — deferred to Phase 58+ (route-by-route via targeted phases or `/gsd-code-review --fix`).
- **All ~49 MEDIUM findings** — deferred.
- **All ~30 LOW findings** — deferred.

**Opportunistically closed alongside in-scope work:**

- `api-core:HI-02` (`/__test/fetch` opens on `OPENWHISPR_TEST_ROUTES=true` in production) — closed by Track C plugin-registration gate lift.
- `byok:LO-01` (inner `raw` shadow) and `byok:LO-02` (`BEARER_SHAPES` mutable) — closed by Track D refactor step.
- `api-core:HI-01` (`AUTH_URL` default `http://localhost:3000`) — closed as a side effect of Track E (the default is removed; `validateIngressBoot()` is the new source).

These opportunistic closes are flagged in `.planning/review/REVIEW-INDEX.md` with the marker "Closed opportunistically by Phase 57."
