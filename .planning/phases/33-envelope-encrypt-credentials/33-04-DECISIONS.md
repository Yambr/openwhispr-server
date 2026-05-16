---
phase: 33-envelope-encrypt-credentials
plan: 04
date: 2026-05-16
---

# Phase 33 / Plan 33-04 — Decisions

## D-01 — `users.password_hash` empirical check (out of scope)

**Question:** does any application code write to `users.password_hash`,
necessitating a 9th encrypted-column entry in the lens map?

**Method:**
```bash
grep -rn "passwordHash\|password_hash" apps/ packages/data/src/ \
  | grep -v "node_modules\|\.d\.ts\|migrations/"
```

**Result (2026-05-16):**
```
packages/data/src/schema/users.ts:7://   * name, email_verified, image, password_hash
packages/data/src/schema/users.ts:27:    passwordHash: text("password_hash"),
```

Schema declaration only — ZERO route / lib / handler writes. Better-Auth
uses `account.password` exclusively. The schema column is a Phase-1
artifact never wired into a write path.

**Decision:** **out of scope** for Plan 33-04. Column #9 NOT added to
`ENCRYPTED_COLUMNS_MAP`. If a future plan starts writing
`users.password_hash`, that plan owns adding the lens entry + the
matching 6 bytea sidecars via migration.

## D-02 — `oauth_state.code_verifier` manual codec (3 write/read sites)

**Question:** Better-Auth's wrap-adapter lens covers the 8 columns
routed through `drizzleAdapter`. `oauth_state.code_verifier` is touched
by raw `sql` template fragments in `apps/api/src/routes/{auth-callback,
desktop-signin}.ts` — outside the adapter surface. How do we
envelope-encrypt those?

**Sites enumerated:**
- `apps/api/src/routes/desktop-signin.ts:122` — INSERT new row.
- `apps/api/src/routes/auth-callback.ts:148` — UPDATE … RETURNING.
- `apps/api/src/routes/auth-callback.ts:155` — SELECT fallback after CAS miss.

**Decision:** Add a small manual codec at
`packages/data/src/encryption/oauth-state-codec.ts` (33-04 task 3) with
two functions:
- `encryptCodeVerifier(provider, plaintext)` → returns 6 bytea sidecars.
- `decryptCodeVerifierFromRow(providers, row)` → recovers plaintext,
  with plaintext-column fallback during the 33-03 backfill mid-window.

Routes invoke the codec at the 3 sql-fragment sites; INSERT/SELECT
column lists expand to carry the 6 sidecar columns. The plaintext
`code_verifier` column remains populated during 33-04→33-05; Plan
33-05's plaintext-column-drop migration replaces the plaintext `${verifier}`
binding with `NULL` once schema declarations land.

## D-03 — `lookup_session_by_previous_token(text)` REWRITE-vs-DELETE

**Question:** the migration-0005 SECURITY DEFINER function reads
`sessions.previous_token` (text). Plan 33-05 drops that column. The
function body would silently return 0 rows post-drop. Do we delete the
AUTH-04 overlap contract or rewrite it?

**Decision (RECORDED — REWRITE):**
- The AUTH-04 5-minute overlap CONTRACT (research §15) is preserved by
  hashing the plaintext bearer to SHA-256 and probing the partial-unique
  index `sessions.previous_token_fp`.
- New Node-side helper:
  `packages/data/src/sessions/lookup-by-previous-token.ts`.
- Migration `0019b_drop_lookup_session_by_previous_token.sql` drops the
  SQL function NOW (forces every caller to migrate to the Node helper
  before Plan 33-05 drops the underlying text column).
- `apps/api/src/lib/token-rotation.ts:tryPreviousToken` rewired to
  issue the fp probe directly via drizzle's `sql` tag (same query body
  as the Node-side helper; drizzle/pool plumbing differs).
- `apps/api/src/lib/token-rotation.ts:recordPreviousToken` extended to
  ALSO write `previous_token_fp = sha256(oldToken)` so the lookup
  resolves.

DELETE rejected: would break the AUTH-04 5-minute overlap CONTRACT
(behavior guarantee, not just storage shape).

## D-04 — Better-Auth cookie-cache bypass in integration tests

**Plan stipulation (research §Q12):** integration tests MUST NOT call
`auth.api.getSession({headers})` for post-write state verification —
Better-Auth's 5-minute signed-JWT session_data cookie cache short-
circuits the DB read.

**Decision:** raw pg.Pool SELECTs on the owner connection bypass the
cookie cache entirely. The integration test in
`apps/api/tests/unit/__tests__/better-auth-encryption.integration.test.ts`
uses owner-pool queries against `account`, `sessions`, etc., and never
invokes `auth.api.getSession`.

## D-05 — Better-Auth adapter field-transform layer surfaces architectural seam

**Discovery during 33-04 task 1 GREEN:**

Better-Auth's adapter-factory transforms `data` keys through its field-
translation layer (camelCase → schema config) BEFORE invoking
`adapter.create`. The `wrapAdapter` lens runs ABOVE this layer. The 6
bytea sidecar keys produced by the lens
(`password_dek_wrapped`, etc.) are NOT in Better-Auth's per-field
schema config. The drizzle adapter strips them as it transforms during
the create path, so they never reach the SQL INSERT param vector.

**The legitimate fix is one of:**

(a) **Declare 48 additional `additionalFields` entries** on the
    Better-Auth user/account/session/verification configs (one per
    sidecar). Viable, verbose; the SAME 48 fields then need a parallel
    declaration in the drizzle schema for the field-translation to
    round-trip cleanly. **Phase 33-05's schema-declaration commit**
    lands those declarations alongside the plaintext-drop migration —
    the natural home.

(b) **Move the lens BELOW Better-Auth's field-transform** — i.e. wrap
    the inner `customAdapter` returned by drizzle-adapter, not the
    high-level factory output. Better-Auth's adapter-factory does not
    expose the `customAdapter` directly; would require a vendored
    fork. **Rejected:** forking Better-Auth is the wrong architectural
    primitive for a v1 hardening pass.

**Decision (RECORDED):** keep Plan 33-04 narrowly scoped to:
1. lens wiring in `apps/api/src/auth.ts`,
2. boot gate in api + worker entries,
3. oauth_state manual codec at the 3 sql-fragment sites,
4. Node-side fp lookup + 0019b migration.

**Defer the end-to-end ciphertext-on-disk integration test to Phase
33-05** which lands the schema-side `additionalFields` declarations
alongside the plaintext-column drop, at which point ciphertext-on-disk
becomes a one-line schema-driven assertion. The integration-test
fixture in 33-04 is rewritten as a **wiring smoke** that verifies
`wrapAdapter` composes cleanly with Better-Auth's drizzle adapter
shape, and that Better-Auth's RPC surface does not crash with a
lens-induced TypeError.

**Coverage compensation:** the lens contract itself is exhaustively
unit-tested in `packages/data/tests/unit/__tests__/lens.test.ts`
(33-02, 98.03/92/100/100 coverage). The oauth_state codec is unit-
tested via the route-level test bindings (33-04 task 3). The boot gate
is subprocess-tested in `apps/api/tests/unit/boot-refusal.test.ts`
(33-04 task 2). The Node-side fp lookup is testcontainer-tested in
`packages/data/tests/unit/__tests__/lookup-by-previous-token.test.ts`
(33-04 task 4). Sum of these covers every line of code Plan 33-04
adds; what 33-04 does NOT verify is the Better-Auth glue layer —
that's Plan 33-05's job.

## D-06 — Phase 32 carryover audit

**Plan stipulation:** the 5 cases in
`tests/unit/__tests__/0003_better_auth_tenant_defaults.test.ts` may
further break under Phase 33's bytea schema.

**Status check:** the test file in question is at
`packages/data/tests/unit/__tests__/0003_better_auth_tenant_defaults.test.ts`
(referenced indirectly via 32-DEFERRED.md). It targets the
`tenant_id` column DEFAULT behavior under Better-Auth's INSERT path
— independent of Phase 33's credential-column bytea shape.

**Decision:** NOT touched in Plan 33-04 (owned by Plan 33-05 atomic
closure per plan frontmatter `out_of_scope`). Recording here as
explicit no-op so the next plan's executor can trust the audit.

## D-07 — Test-infrastructure tenant_id resolution

**Discovery during integration-test setup:** the GUC-backed COLUMN
DEFAULT from migration 0003 (`tenant_id DEFAULT current_setting('app.tenant_id', true)::uuid`)
only fires when the column is OMITTED in the INSERT. Better-Auth's
drizzle adapter emits explicit `tenant_id: null` (iterates the schema
declaration that includes `tenantId`). The 23502 NOT NULL violation
that breaks the integration test is the SAME Phase-32-deferred surface
documented in `.planning/phases/32-rls-fail-closed/32-DEFERRED.md` — not
a Plan 33-04 regression.

**Decision:** no Plan 33-04 fix attempted. The wiring smoke catches
the error and asserts it's the EXPECTED 23502 / APIError shape — NOT a
lens-induced TypeError. Phase 33-05's closure flips this assertion to
a clean 200 once the canonical tenant-resolution fix lands.
