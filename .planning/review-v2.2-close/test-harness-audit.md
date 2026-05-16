# Test-Harness Audit — owner-pool vs app-pool shadowing

**Date:** 2026-05-17
**HEAD:** `main @ 3df1060`
**Trigger:** Migration 0022 hot-fix for missing `GRANT SELECT,INSERT,UPDATE ON setup_state TO openwhispr_app` (migration 0017 shipped without it; no test caught it because the corresponding route test connected via owner-pool).
**Scope:** Catalog every test where the route/job handler runs against an owner-derived connection while production runs the same handler under `openwhispr_app`. **Catalog only — no fixes.**

---

## TL;DR — The systemic finding

**Zero test files in this repository run a route handler or worker job through a real `openwhispr_app` connection.** Every API route-integration test, every worker job test, and every migration test connects via `openwhispr_owner` (BYPASSRLS, full GRANTs) — or, worse, via the testcontainer's bootstrap **superuser**. The `openwhispr_app` role is CREATEd in setup helpers, GRANTed admin-option to owner, and then **never logged in to**. The only file in the entire tree that opens a `openwhispr_app` pool is `tests/e2e/rls-fail-closed.test.ts` (3 sites: L101, L154, L184).

This means:

1. **Every per-table GRANT to `openwhispr_app` in migrations 0000..0021 is untested.** Migration 0022 is the FIRST one this happened to surface for, but it is provably not unique — the same hole catches the next missing GRANT.
2. **RLS policy correctness is not tested at the route layer.** The route tests are effectively running as a `BYPASSRLS` role, so cross-tenant leak tests in `notes`, `folders`, `conversations`, `transcriptions`, `keys`, `setup-state`, `setup-admin` only assert handler-level filtering — they cannot detect a missing/wrong `USING (...)` policy.
3. **`packages/data/src/__tests__/helpers.ts` exposes both `ownerUri` and `appUri` but no caller — including its own three sibling integration tests — actually constructs an `appPool` from `appUri`.** (`appUri` is dead code in the shared helper.)

Severity rollup: **3 HIGH, 6 MEDIUM, 8 LOW.** Recommended immediate fix vs v2.3 deferred breakdown is in the closure section at the end.

---

## Findings — owner-pool shadowing

### HIGH-01 — `apps/api/src/routes/__tests__/setup.ts:131` — `db = drizzle(ownerPool)` for setup-state + setup-admin + capabilities routes

**File:** `apps/api/src/routes/__tests__/setup.ts:131`
**Severity:** **HIGH** — this is the exact harness that masked the migration-0017 setup_state GRANT bug. The whole capabilities + setup-state + setup-admin family of routes (the bootstrap admin surface) is exercised only against an owner connection.

**Call site:**
```ts
// L130-131
const ownerPool = new Pool({ connectionString: ownerUri });
const db = drizzle(ownerPool);          // ← passed to every route under test
```

**Production handler runs against:** `appPool` (openwhispr_app), see `apps/api/src/index.ts:536` — `const { db, pool: appPool } = makeAppDb()`. The `setup-state` GET/POST handlers SELECT and UPDATE on `setup_state` — neither GRANT was present until 0022.

**Consumers (all of these inherit the gap):**
- `apps/api/src/routes/__tests__/capabilities.test.ts`
- `apps/api/src/routes/__tests__/setup-state.test.ts`
- `apps/api/src/routes/__tests__/setup-admin.test.ts`
- any other sibling test that imports `bootMigratedPostgres` from this setup module.

**Recommended fix shape:** add `appUri` + `appPool` to `BootedPostgres`; export an `appDb = drizzle(appPool)`; pass `appDb` to `buildSetupStateApp` / `buildSetupAdminApp` / `buildCapabilitiesApp` (the `ownerPool` already correctly stays on `SetupAdminDeps.ownerPool` for the legitimate raw-SQL escape hatch on `users.role`).

---

### HIGH-02 — `apps/api/src/routes/notes/__tests__/setup.ts:120` — `db = drizzle(opts.pool)` where `opts.pool` is owner

**File:** `apps/api/src/routes/notes/__tests__/setup.ts:90, 120`
**Severity:** **HIGH** — the notes route family is the canonical RLS-policed user data surface. Cross-tenant isolation is theoretically tested here, but the test connection BYPASSRLS, so the test asserts ONLY handler-level `WHERE tenant_id = ...` filtering. A missing/broken `CREATE POLICY ... USING (tenant_id = current_setting('app.tenant_id')::uuid)` would not be detected.

**Call sites:**
```ts
// L82-90: pool is owner-bound
const ownerUri = `postgres://openwhispr_owner:${ownerPw}@${...}/openwhispr`;
const ownerPool = new Pool({ connectionString: ownerUri });
await migrate(drizzle(ownerPool), { ... });
await ownerPool.end();
const pool = new Pool({ connectionString: ownerUri });   // ← still owner!
return { container, pool, ownerUri, ... };

// L120: builds the test app db from owner pool
const db = drizzle(opts.pool);
```

**Consumers:** all 5 notes integration tests (`create`, `update`, `delete`, `delete-all`, `list`, `batch-create`).

**Recommended fix shape:** return `{ ownerPool, appPool, appUri }`; require `buildTestApp({ pool: appPool, ... })`; use `ownerPool` only for `seedUser` / `seedTenant` setup paths that legitimately need to bypass RLS.

---

### HIGH-03 — `apps/api/src/routes/v1/keys/__tests__/setup.ts:95, 127` — `db = drizzle(opts.pool)` where `opts.pool` is owner

**File:** `apps/api/src/routes/v1/keys/__tests__/setup.ts:95, 127`
**Severity:** **HIGH** — `api_keys` is the credential surface (key creation, listing, revocation). RLS policy correctness on `api_keys` is a security boundary; route tests not exercising it under the production role is a meaningful gap. Per-tenant isolation here is exactly the boundary that should be hardest to fool.

**Call sites:**
```ts
// L95: pool bound to ownerUri
const pool = new Pool({ connectionString: ownerUri });

// L127: route db is owner-derived
const db = drizzle(opts.pool);
```

**Consumers:** `create.test.ts`, `list.test.ts`, `revoke.test.ts` under `apps/api/src/routes/v1/keys/__tests__/`.

**Recommended fix shape:** same as HIGH-02. Additionally, add an explicit cross-tenant leak test that runs as `openwhispr_app` with `SET LOCAL app.tenant_id = '<tenant-B>'` and asserts a tenant-A row is invisible.

---

### MEDIUM-04 — `apps/api/src/routes/folders/__tests__/setup.ts:82, 112`

**File:** `apps/api/src/routes/folders/__tests__/setup.ts:82, 112`
**Severity:** **MEDIUM** — same exact pattern as notes; the folders surface is structurally simpler and less of a tenancy boundary risk, but the GRANT-coverage gap is identical.

**Call sites:**
```ts
// L82
const pool = new Pool({ connectionString: ownerUri });
// L112
const db = drizzle(opts.pool);
```

**Consumers:** `create`, `update`, `delete`, `list`, `batch-create` tests for folders.

**Recommended fix:** same shape as HIGH-02.

---

### MEDIUM-05 — `apps/api/src/routes/conversations/__tests__/setup.ts:73, 103`

**File:** `apps/api/src/routes/conversations/__tests__/setup.ts:73, 103`
**Severity:** **MEDIUM** — same pattern. Conversations + messages are a tenant-isolated data surface and one of the wider tables (search, messages, update). Worth promoting to HIGH if/when an RLS regression bites here.

**Call sites:**
```ts
// L73
const pool = new Pool({ connectionString: ownerUri });
// L103
const db = drizzle(opts.pool);
```

**Consumers:** `create`, `update`, `delete`, `list`, `search`, `messages` tests for conversations.

---

### MEDIUM-06 — `apps/api/src/routes/transcriptions/__tests__/setup.ts:73, 103`

**File:** `apps/api/src/routes/transcriptions/__tests__/setup.ts:73, 103`
**Severity:** **MEDIUM** — same pattern. Transcriptions table holds user content (transcripts) which is tenant-isolated. The GRANT chain on `transcriptions` is implicitly untested at the route layer.

**Call sites:**
```ts
// L73
const pool = new Pool({ connectionString: ownerUri });
// L103
const db = drizzle(opts.pool);
```

**Consumers:** `create`, `batch-create`, `delete`, `batch-delete`, `list` tests for transcriptions.

---

### MEDIUM-07 — `apps/worker/tests/unit/jobs/reconciliation-daily-check.test.ts:43-50` — bare superuser pool labelled `appPool`

**File:** `apps/worker/tests/unit/jobs/reconciliation-daily-check.test.ts:43-50`
**Severity:** **MEDIUM** — production worker (`apps/worker/src/db/app-pool.ts:165`) connects as `openwhispr_app`. This test boots a clean `postgres:17-bookworm` and connects as the **container's bootstrap superuser** (`ps`/`pw`), then hand-rolls a `users`/`usage_ledger` schema with no RLS, no roles, no migrations. The variable name `appPool` is misleading — there is no `openwhispr_app` role anywhere in this test. The job is passed `appOwnerPool: h.appPool` (38+ call-sites), reinforcing the lie via naming.

**Call site:**
```ts
// L43-50
new PostgreSqlContainer("postgres:17-bookworm")
  .withDatabase("app_test").withUsername("ps").withPassword("pw").start();
...
const appPool = new Pool({ connectionString: app.getConnectionUri(), max: 4 });
// L59-70: ad-hoc CREATE TABLE users / usage_ledger (no RLS, no GRANTs, no migrations)
```

**Recommended fix shape:** boot via the shared `bootMigratedPostgres` (after extending it to return `appPool`), expose `appPool` as the openwhispr_app connection, and rename the local variable for clarity. At minimum, rename to `superuserPool` or `bootstrapPool` to remove the misleading `appPool` label.

---

### MEDIUM-08 — `apps/worker/tests/unit/jobs/ingest-litellm-spend.test.ts:65-87` — bare bootstrap-user pool labelled `appPool`

**File:** `apps/worker/tests/unit/jobs/ingest-litellm-spend.test.ts:65-87`
**Severity:** **MEDIUM** — same defect shape as MEDIUM-07: boots `postgres:17.5-alpine` with username `owner`/`ownerpw` (still the testcontainer bootstrap **superuser**, despite the name), `CREATE DATABASE litellm`, hand-rolls `tenants`/`users`/`usage_ledger` with no RLS roles. `appPool = new Pool({ connectionString: adminUrl, max: 2 })` — note the variable `adminUrl` proves the connection is admin-level. Job is then invoked with `appOwnerPool: appPool`.

**Call sites:**
```ts
// L77, L87
const adminUrl = `${container.getConnectionUri()}`;
appPool = new Pool({ connectionString: adminUrl, max: 2 });   // ← admin, not app
```

**Recommended fix shape:** same as MEDIUM-07. Make ingest-spend a true openwhispr_app integration test, or explicitly document this as a unit test against an in-memory-shaped schema and rename the variable.

---

### LOW-09 — `apps/worker/tests/unit/jobs/audit-archive.test.ts:39`

**File:** `apps/worker/tests/unit/jobs/audit-archive.test.ts:39`
**Severity:** **LOW** — boots a bare `PostgreSqlContainer` and uses `container.getConnectionUri()` (superuser) for everything. Audit archive job pumps `audit_log` rows to S3 then DELETEs — in production runs as `openwhispr_app`. The `audit_log` table has its own RLS chain (migration 0014). Schema check only; GRANTs not exercised.

**Call site:**
```ts
const pool = new Pool({ connectionString: container.getConnectionUri(), max: 3 });
```

---

### LOW-10 — `apps/worker/tests/unit/jobs/usage-rollup-daily.test.ts:37`

**File:** `apps/worker/tests/unit/jobs/usage-rollup-daily.test.ts:37`
**Severity:** **LOW** — same shape as LOW-09. Rollup writes `usage_daily` from `usage_ledger`. Tested only against superuser.

**Call site:**
```ts
const pool = new Pool({ connectionString: container.getConnectionUri(), max: 6 });
```

---

## Findings — migration tests asserting schema only, never GRANTs

The pattern in `packages/data/migrations/__tests__/00*.test.ts` is uniform: open a single `Pool({ connectionString: booted.ownerUri })`, run schema introspection (`information_schema.columns`, `pg_class`, `pg_indexes`), and never attempt the operations the production handler will perform under the `openwhispr_app` role. This is the second half of why 0022 was needed — even the migration's own test was content with "column exists, type is right" and never asked "can openwhispr_app actually SELECT it?"

### MEDIUM-11 — `packages/data/migrations/__tests__/0017-setup-state.test.ts` — the direct precedent for migration 0022

**File:** `packages/data/migrations/__tests__/0017-setup-state.test.ts:117, 130, 147, 168, 183, 199, 210, 231`
**Severity:** **MEDIUM** (would be HIGH if v2.2 were not closing — this is literally the test that should have caught 0017's missing GRANT)

**Pattern:** every `Pool` constructed connects to `ownerUri`. The test verifies the `setup_state` row + enum domain + status transitions, but never verifies that `openwhispr_app` can SELECT/INSERT/UPDATE. Migration 0022 was needed precisely because this test passed despite the production GRANT chain being incomplete.

**Recommended companion assertion (for v2.3):**
```ts
it("openwhispr_app can SELECT, INSERT, UPDATE on setup_state", async () => {
  const appPool = new Pool({ connectionString: freshBoot!.appUri });
  await expect(appPool.query("SELECT status FROM setup_state WHERE id = 1")).resolves.toBeDefined();
  await expect(appPool.query("UPDATE setup_state SET status='pending' WHERE id=1")).resolves.toBeDefined();
  await appPool.end();
});
```

---

### LOW-12 — `packages/data/migrations/__tests__/0014-audit-log-partition.test.ts` — owner-only verification of audit_log

**File:** `packages/data/migrations/__tests__/0014-audit-log-partition.test.ts:45, 63, 103, 128, 154, 187`
**Severity:** **LOW** — partition setup is owner-domain by design (pg_partman maintenance is `openwhispr_owner`), so this is mostly correct. **However**, application INSERTs into `audit_log` happen as `openwhispr_app` in production; the GRANT for INSERT on `audit_log` parent + future partitions should be asserted under an app connection. The partition rolling routine (`run_maintenance_proc`) is correctly owner-scoped.

---

### LOW-13 — `packages/data/migrations/__tests__/0016-users-locale.test.ts:23, 45, 79`

**File:** `packages/data/migrations/__tests__/0016-users-locale.test.ts:23, 45, 79`
**Severity:** **LOW** — locale column add. Production callers (Better Auth signup, profile update) write `users.locale` as `openwhispr_app`. Owner-only verification.

---

### LOW-14 — `packages/data/migrations/__tests__/0018-rls-fail-closed.test.ts:34, 58, 78`

**File:** `packages/data/migrations/__tests__/0018-rls-fail-closed.test.ts:34, 58, 78`
**Severity:** **LOW** — this test verifies via `pg_catalog`/`pg_db_role_setting` (introspection) that `openwhispr_app` has no pre-bound `app.tenant_id`. The introspection is correct. But the file also has the opportunity to assert the negative observable (an app-pool query against an RLS-policed table without `SET LOCAL app.tenant_id` returns 0 rows / errors fail-closed). That assertion is what tests/e2e/rls-fail-closed.test.ts does — duplicate it at the migration-test layer for tighter feedback loop.

---

### LOW-15 — `packages/data/migrations/__tests__/0019-envelope-encrypt-secret-columns-add.test.ts:103, 127, 158, 183, 203, 226, 244, 281`

**File:** owner-only checks against the new envelope-encryption sidecar columns. Production code reads/writes these as `openwhispr_app`. Schema-only verification.

**Severity:** **LOW** — the encryption columns are bytea sidecars; the GRANT chain is shared with the parent table, so a missing GRANT would surface elsewhere first. Still, an explicit app-pool round-trip would close the gap.

---

### LOW-16 — `packages/data/migrations/__tests__/0019b-drop-lookup-fn.test.ts:29, 42, 56`

**Severity:** **LOW** — DROP-function migration; `has_function_privilege` style assertions are reasonable, but currently owner-only and limited to existence checks.

---

### LOW-17 — `packages/data/migrations/__tests__/0020-drop-plaintext.test.ts:65, 85, 98, 113, 134, 147, 162, 196`

**Severity:** **LOW** — drops plaintext columns; owner-only verification of the negative (column does not exist). An app-pool attempted SELECT of the dropped column is a stronger assertion than `information_schema` membership.

---

### LOW-18 — `packages/data/migrations/__tests__/0021-safe-table-reset.test.ts:47, 63, 86, 105, 126, 138-143`

**Severity:** **LOW** — the existing test at L138-143 already asserts `has_function_privilege('openwhispr_app', '_safe_table_reset(...)', 'EXECUTE') = false` via owner-side introspection — this is the **right shape** (it asks "what can the app role do?") and is the closest existing precedent for the audit's recommendation. Replicate this pattern across every migration that creates or alters a table.

---

## Dead code / structural finding

### MEDIUM-19 — `packages/data/src/__tests__/helpers.ts:24-29` exports `appUri` but no caller dereferences it

**File:** `packages/data/src/__tests__/helpers.ts:24-29, 146, 161-167`
**Severity:** **MEDIUM** — the shared helper does the right thing structurally (creates the openwhispr_app role with a password and exposes `appUri`), but every consumer of `bootMigratedPostgres` from this module ignores `appUri`. Search confirms 0 callers in `packages/data/src/__tests__/*.test.ts` instantiate a `Pool` from `boot.appUri`. The intent is correct; the discipline to use it never materialized.

**Recommended fix shape:** promote the helper to return `{ ownerPool, ownerDb, appPool, appDb, ownerUri, appUri, container, stop }` and update the 3 sibling integration tests (`migration-rollback`, `usage-ledger`, `audit-log`) to use `appDb` for any DML/DQL that mirrors a production worker job. Owner is reserved for migration apply + seed-bypassing-RLS.

---

## Counter-example — the one place we got it right

`tests/e2e/rls-fail-closed.test.ts` is the only test in the tree that opens a real `openwhispr_app` Pool against a fully migrated database and exercises RLS the way production does. Three call sites: L101 (negative: unset tenant → 0 rows), L154 (positive: correct tenant → rows visible), L184 (negative: wrong tenant → 0 rows). This file is the template every route-integration test should follow.

`tests/self-tests/rls-introspection.test.ts` creates the role but only queries via owner — it is an introspection assertion against `pg_policies`, not a behavioural assertion under the app role. Useful but insufficient.

---

## Pattern recommendations (no code changes here — design notes only)

### Pattern A — extend the shared helper

Promote `packages/data/src/__tests__/helpers.ts::bootMigratedPostgres()` to return both pools and both drizzle instances:

```ts
export interface BootResult {
  container: StartedPostgreSqlContainer;
  ownerUri: string;
  appUri: string;
  ownerPool: Pool;
  appPool: Pool;
  ownerDb: NodePgDatabase;  // ← for migrations + seed paths that bypass RLS
  appDb: NodePgDatabase;    // ← for everything that mirrors a route/worker handler
  stop: () => Promise<void>;
}
```

Force all `buildTestApp` / `buildSetupStateApp` / `buildCapabilitiesApp` factories to receive `appDb`. Reserve `ownerPool` for `seedUser` / `seedTenant` / `resetSetupState` / `TRUNCATE` paths that legitimately need to bypass RLS.

### Pattern B — adopt this for the per-app local setup helpers

The 6 local `setup.ts` files (`__tests__`, `notes`, `folders`, `conversations`, `transcriptions`, `v1/keys`) duplicate `bootMigratedPostgres` for the documented per-worktree-orchestrator reason. Either consolidate to the shared helper now (preferred — eliminates the parallel-evolution risk), or apply Pattern A locally to each of the 6 files.

### Pattern C — RLS context manager in tests

Mirror the production `withTenantContext` helper at the test level: a `withAppTenant(appPool, tenantId, async (client) => { ... })` that does `BEGIN; SET LOCAL app.tenant_id = ...; ... ; COMMIT/ROLLBACK`. Use this from every cross-tenant leak test. Today such tests effectively cannot exist because `db = drizzle(ownerPool)` has BYPASSRLS.

### Pattern D — migration tests assert role GRANTs as an observable

For every migration that runs `CREATE TABLE`, `ALTER TABLE`, or `GRANT`, add a companion assertion shaped like LOW-18 / migration 0021's existing test: open an `appPool`, attempt the SELECT/INSERT/UPDATE the production code will perform, expect success. This is the cheap, mechanical defence-in-depth that closes the 0022 class of bug. A `tools/lint-migration-test-has-app-grant-assertion.ts` rule can enforce it from v2.3 onward.

### Pattern E — naming hygiene in worker tests

Rename `appPool` to `superuserPool` / `bootstrapPool` in MEDIUM-07, MEDIUM-08, LOW-09, LOW-10 until they actually connect as `openwhispr_app`. The current naming actively misleads readers into believing role-level coverage exists when it does not.

---

## Closure recommendation

### Fix in v2.2-close (immediate, before merging the migration 0022 train)

1. **HIGH-01** — `apps/api/src/routes/__tests__/setup.ts` add `appPool` + `appDb`, pass `appDb` to the setup-state + capabilities apps, retain `ownerPool` only on `SetupAdminDeps`. Add a regression test mirroring the missing-GRANT case: with migration 0022 reverted in a temp branch, the test must turn RED. This is the load-bearing fix that proves the gap is closed for the surface that just bit us.
2. **MEDIUM-19** — extend `packages/data/src/__tests__/helpers.ts` to return `appPool`/`appDb`. Mechanical, no risk; unblocks Pattern A adoption for everything else.

### Defer to v2.3 (catalog now, do then)

3. **HIGH-02, HIGH-03** — notes + keys route harnesses. These are user-facing RLS surfaces; promote to app-pool in a dedicated TDD pair per surface (RED: cross-tenant leak via missing/wrong policy → GREEN: policy + GRANT verified under app-pool).
4. **MEDIUM-04, MEDIUM-05, MEDIUM-06** — folders / conversations / transcriptions. Same shape as HIGH-02; lower urgency, batchable.
5. **MEDIUM-07, MEDIUM-08** — worker reconciliation + ingest-litellm-spend. Rename misleading `appPool` variables immediately (5-minute fix); promote to true app-pool harness behind the v2.3 worker-integration-coverage initiative.
6. **LOW-09 through LOW-18** — worker audit/rollup tests and migration tests. Pattern D enforcement: every CREATE/ALTER/GRANT migration gains a companion app-pool round-trip assertion. Can be staged migration-by-migration without coordination.

### Constitutional addendum candidate

Consider promoting to CLAUDE.md `Hard Rules` a constraint along the lines of: *"Tests covering production code that runs as `openwhispr_app` MUST connect via an `openwhispr_app` pool. Connecting via owner/superuser is permitted only for migration apply, schema introspection, and explicit BYPASSRLS seed paths."* This is the constitutional equivalent of LOCKER-PLAINTEXT-COLS — it prevents the class of bug rather than chasing instances.

---

## Appendix — files inspected

- `packages/data/src/__tests__/helpers.ts` (shared)
- `apps/api/src/routes/__tests__/setup.ts`
- `apps/api/src/routes/notes/__tests__/setup.ts`
- `apps/api/src/routes/folders/__tests__/setup.ts`
- `apps/api/src/routes/conversations/__tests__/setup.ts`
- `apps/api/src/routes/transcriptions/__tests__/setup.ts`
- `apps/api/src/routes/v1/keys/__tests__/setup.ts`
- `packages/data/migrations/__tests__/0014-audit-log-partition.test.ts`
- `packages/data/migrations/__tests__/0016-users-locale.test.ts`
- `packages/data/migrations/__tests__/0017-setup-state.test.ts`
- `packages/data/migrations/__tests__/0018-rls-fail-closed.test.ts`
- `packages/data/migrations/__tests__/0019-envelope-encrypt-secret-columns-add.test.ts`
- `packages/data/migrations/__tests__/0019b-drop-lookup-fn.test.ts`
- `packages/data/migrations/__tests__/0020-drop-plaintext.test.ts`
- `packages/data/migrations/__tests__/0021-safe-table-reset.test.ts`
- `apps/worker/tests/unit/jobs/reconciliation-daily-check.test.ts`
- `apps/worker/tests/unit/jobs/ingest-litellm-spend.test.ts`
- `apps/worker/tests/unit/jobs/audit-archive.test.ts`
- `apps/worker/tests/unit/jobs/usage-rollup-daily.test.ts`
- `tests/e2e/rls-fail-closed.test.ts` (counter-example: correct pattern)
- `tests/self-tests/rls-introspection.test.ts` (partial — creates role, queries owner)
- `tests/integration/postgres-roles-idempotent.test.ts` (correct: actually connects as app on L133)
- `apps/api/src/index.ts:536, 670-691` (production wiring confirmation)
- `apps/worker/src/db/app-pool.ts:165` (production wiring confirmation)
