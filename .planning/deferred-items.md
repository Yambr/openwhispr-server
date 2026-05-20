# Deferred Items — OPEN ONLY

Items discovered during execution that are still actionable. Closed items
are archived under `.planning/backlog-archive/`.

**Triage convention:** any item below is OPEN. When a fix lands, delete
the entry rather than marking it closed — git history preserves the
record. Keep this file under ~200 lines.

**Bug count: 0.**

---

## Phase 57 — data:CR-02 — fail-OPEN RLS posture re-installed by migration 0024 — RESOLVED via D2

**Status:** RESOLVED in Phase 57 Track B via **D2 (document the debt honestly + property-test the documented posture)**. No migration changed. The boundary property test `packages/data/tests/unit/__tests__/rls-posture-boundary.test.ts` + the `docs/security.md` §11.1 posture section + the `CLAUDE.md` item-16 ledger entry land the documented-debt resolution. **D3 (request-scoped per-request Better Auth adapter) is the scheduled v2-blocker successor — see below.** The diagnostic chain is preserved verbatim for the v2 D3 work.

**Why D2 and not D1/D3:**
- **D1 is dead.** D1 proposed a `pool.on('connect', ...)` GUC hook on the Better Auth app pool. Under PgBouncer transaction-mode pooling, `DISCARD ALL` (the default `server_reset_query`) wipes any session-level `SET app.tenant_id` between leased transactions, and `compose/pgbouncer/pgbouncer.ini` carries no `server_reset_query` override. A connect-time session `SET` therefore does not survive to the transaction that actually runs the Better Auth INSERT — D1 cannot work as specified.
- **D2 (chosen, Phase 57).** Keep migration 0024 as-is; document the posture honestly in `CLAUDE.md` + `docs/security.md` §11.1 and lock the cohort boundary with a property test so any future drift is caught by CI. Zero code/migration change. Correct for a single-tenant v1.
- **D3 (scheduled v2-blocker successor).** Replace the module-singleton `betterAuth({...})` adapter binding with a per-request adapter bound to a connection that has `set_config('app.tenant_id', <resolved-tenant>, true)` applied. This is the only option that makes the Better Auth surface genuinely fail-closed + multi-tenant-ready. It is a real Better Auth integration rewrite — out of scope for v1; it is the named v2-blocker.

**WHY — pure option-A breaks Better Auth sign-up, and option-B has no form that does not bake a single-tenant assumption into the wrong layer:**

The plan offered option-A (drop the 0024 rolconfig + 4 column DEFAULTs in a forward migration 0027) and option-B (supply tenant context via `withTenant()` at the request boundary). Investigation proves **neither is viable as a clean fix in v1**:

1. **Better Auth's `drizzleAdapter` is bound to a single `db` at `buildAuth()` time** (`apps/api/src/auth.ts:405-415`). It issues bare `INSERT INTO {users,sessions,account,verification} (tenant_id, ...) VALUES (default, ...)` — no explicit `tenant_id`. The value is resolved 100% by the column DEFAULT `current_setting('app.tenant_id', true)::uuid`, which in turn is only non-empty because migration 0024 re-installed `ALTER ROLE openwhispr_app SET app.tenant_id TO '<DEFAULT_TENANT_ID>'` (rolconfig, applied at backend-connect).

2. **Pure option-A (drop rolconfig + DEFAULTs) breaks sign-up.** With both gone, Better Auth's bare INSERT lands `tenant_id = NULL` → `23502` NOT NULL violation, and the fail-closed RLS `WITH CHECK` (migration 0018) additionally raises `42501`. Confirmed by the standing comment in `apps/api/tests/integration/better-auth-envelope-at-rest.test.ts:93-99` ("Better Auth wiring runs as `openwhispr_app` so the rolconfig-bound `app.tenant_id` GUC supplies the default tenant_id for the four Better-Auth-owned INSERTs").

3. **Option-B cannot use `withTenant()` at the request boundary.** `withTenant()` (`packages/data/src/tenant-context.ts:90`) sets the GUC inside ONE Drizzle transaction *it opens itself* and runs `fn(tx)`. Better Auth's universal `handler()` (`apps/api/src/routes/better-auth-handler.ts:241-291`) runs its own multi-statement flow; sign-up wraps everything in `runWithTransaction(ctx.context.adapter, ...)` → `adapter.transaction(cb)` (documented in deferred-item #14 above, lines 20-22). The Better Auth handler does not accept an injected `tx`, so `withTenant()` cannot envelope it. `better-auth-handler.ts` only uses `withTenant()` for the optional email-enumeration probe — never for the sign-up INSERT path.

4. **The one chokepoint that DOES exist is the wrong layer.** Track A.1 (commit `8377735`, `packages/data/src/encryption/lens.ts:443`) already re-wraps the trx adapter Better Auth binds into AsyncLocalStorage. Issuing `SELECT set_config('app.tenant_id', '<DEFAULT_TENANT_ID>', true)` as the first statement of that wrapped transaction would let migration 0027 drop the rolconfig + DEFAULTs while keeping sign-up green and the GUC transaction-scoped (fail-closed-compatible). BUT: (a) it bakes `DEFAULT_TENANT_ID` — a tenancy concept — into the envelope-**encryption** package, coupling two unrelated subsystems; (b) it does not cover Better Auth DB ops *outside* a transaction (`getSession`, sign-in `findOne`), which still need the GUC; (c) it is exactly the "rewrite Better Auth wiring in a way that smells like a workaround" the Track B brief said to HALT on.

**Diagnostic chain:** `auth.ts:405-415` (bare adapter, no tenant) → `0024_*.sql:40-59` (rolconfig + 4 DEFAULTs supply tenant_id implicitly) → `0018_rls_fail_closed.sql:27-41` (Phase 32 had RESET exactly these) → `better-auth-handler.ts:241` (handler not wrapped) → `tenant-context.ts:90` (`withTenant` cannot envelope a foreign transaction) → deferred-item #14 lines 20-22 (BA sign-up = one BA-owned transaction).

**Unblock proposal — needs a user/architecture decision (one of):**

- **(D1) Per-connection GUC hook on the Better-Auth app pool.** Add a `pool.on('connect', c => c.query("SET app.tenant_id = '<DEFAULT_TENANT_ID>'"))` hook to the *specific* pool Better Auth uses. Functionally identical to the rolconfig but lives in code, is greppable, and is removable in one place when v2 multi-tenancy ships. Still fail-OPEN to the default tenant for the Better Auth surface — but that surface is genuinely single-tenant in v1 (sign-up creates the *first* user; there is no prior tenant context to honor). Migration 0027 then drops the rolconfig + DEFAULTs so *non-Better-Auth* app code stays fail-closed. This is the smallest honest fix: it scopes the fail-open to the four BA tables only, documented, instead of role-wide.

- **(D2) Accept-and-document.** Keep 0024 as-is; amend `CLAUDE.md` + `docs/security.md` §12 to state explicitly that v1 is single-tenant and the four Better-Auth tables have a rolconfig-bound `app.tenant_id` that fails OPEN to `DEFAULT_TENANT_ID` by design. CR-02 then becomes a documentation fix, not a code fix. The property-test still gets added but asserts the *documented* posture (BA tables → default-tenant rows; the other 12 tables → fail-closed).

- **(D3) Full request-scoped tenant for Better Auth (v2-shaped).** Replace the `betterAuth({...})` adapter binding with a per-request adapter constructed inside the `/api/auth/*` handler, each bound to a connection that has `set_config('app.tenant_id', <resolved-tenant>, true)` already applied. This is a real Better Auth integration rewrite (the adapter is currently module-singleton) and is the only option that makes the BA surface genuinely fail-closed + multi-tenant-ready. Out of scope for a pre-publication CRITICAL-fix phase.

**Resolution (Phase 57 Track B):** D2 was chosen by the user over D3. D1 is dead (see "Why D2 and not D1/D3" above — PgBouncer `DISCARD ALL` wipes the session `SET`). D2 lands documentation (`CLAUDE.md` item 16, `docs/security.md` §11.1) + the boundary property test `rls-posture-boundary.test.ts` — NO migration or production-schema change. D3 remains the durable v2-blocker fix and inherits the diagnostic chain above when the v2 Better-Auth multi-tenant rework is scheduled.

**No production code, schema, or migration was changed by Track B.** D2's deliverables are docs + one new test file only.

## Phase 57 — data:CR-01 + data:CR-03 — Better Auth credentials remain at rest as plaintext

**Discovered:** Phase 57 Track A execution attempt, 2026-05-20. **Status:** HALT pending architectural decision.

**WHY:** The plan's `data:CR-01` GREEN step ("populate `ENCRYPTED_COLUMNS_MAP` in `apps/api/src/auth.ts:160`") does NOT, by itself, encrypt Better-Auth credentials at rest. Empirical evidence captured via the RED test (`apps/api/tests/integration/better-auth-envelope-at-rest.test.ts`, commit `c672e1f`) + a tracer on `wrapAdapter.create`:

1. **The lens never sees `model=account` writes during sign-up.** sign-up.mjs:141 wraps the entire flow in `runWithTransaction(ctx.context.adapter, ...)` (better-auth/dist/api/routes/sign-up.mjs). `runWithTransaction` (better-auth/core context/transaction.mjs:52-78) calls `adapter.transaction(cb)`, which in our wrap delegates to `inner.transaction.bind(inner)` (packages/data/src/encryption/lens.ts:443). The inner adapter is the un-wrapped factory output; `als.run({ adapter: trx, ... }, fn)` binds `getCurrentAdapter()` to that un-wrapped adapter for the entire sign-up. Every `createWithHooks` inside the transaction (createUser, linkAccount, createSession) bypasses the lens.

2. **Even if the lens fires (e.g. for the session row outside the transaction in our test), `transformInput` strips the sidecar keys.** Better Auth's adapter-factory `transformInput` (better-auth/core dist/db/adapter/factory.mjs:98-140) iterates ONLY `schema[model].fields` and silently drops any key not declared in the canonical Better Auth model schema. The 6 sidecar keys per encrypted column (`password_dek_wrapped` … plus their camelCase twins) are unknown → dropped before they reach drizzle's INSERT.

So Plan 51-23/24's empty map was correct for *its* set of working assumptions; Plan 57 Track A's "just populate the map" cannot achieve GREEN without two coordinated additional fixes:

**Required follow-ups (Phase 58 candidate):**

- **Fix A — lens transaction wrapping (production change in `packages/data/src/encryption/lens.ts:443`).** Replace `transaction: inner.transaction.bind(inner)` with a wrapper that re-wraps the `trx` adapter:
  ```ts
  transaction: (cb) => inner.transaction((trx) =>
    cb(wrapAdapter(trx, providers, columnMap))
  )
  ```
  This makes the lens fire inside `runWithTransaction` scopes. Add a regression test (real Postgres testcontainer) that signs up + asserts every `createWithHooks`-scoped model goes through the lens.

- **Fix B — declare sidecars as `additionalFields` on every Better-Auth model in `apps/api/src/auth.ts`.** ~44 entries total: 4 account columns × 6 sidecars (24) + 2 session columns × (6 sidecars + 1 fp) (14) + 1 verification column × 6 sidecars (6). Each entry needs `{ type: "string", required: false, input: false }` so Better Auth's `transformInput` accepts them through and routes them to the inner adapter. The 33-04 §D-05 decision rejected this as "heavier than the security benefit"; Phase 57 CR-01 reverses that decision — encryption at rest is a v1 ship-blocker.

- **Fix C — keep migration 0025 compat-sentinel columns (no schema change).** After A+B, the lens DELETES the plaintext key before INSERT, so `account.password` / `sessions.token` / `verification.value` always land NULL. LOCKER-08's `LENS_INTROSPECTION_COMPAT` allowlist (tools/lint-no-plaintext-secret-columns.ts:109-117) stays — it now correctly describes the post-fix reality. The plan's "revert the LOCKER-08 amendment rationale" task is deferred until A+B land, because without them the existing rationale comment ("populated only as NULL post-lens-write") would be a lie.

**Test left in tree:** `apps/api/tests/integration/better-auth-envelope-at-rest.test.ts` is the canonical RED reproduction. It boots Postgres via testcontainers + buildAuth() + lens, signs up a user, and asserts `account.password IS NULL` + 6 bytea sidecars populated + sign-in round-trip works. Currently RED on `main` @ `c672e1f`. Fix A + Fix B together should turn it GREEN; the round-trip assertion validates the lens decrypts correctly on sign-in.

**Why HALT not workaround:** CLAUDE.md Hard Rule 1 + Phase 57 Track A risk-handling block. The required production-code edits (lens.ts transaction wrapper + 44 additionalFields in auth.ts) constitute a non-trivial architectural change that the plan's Track A scope did not anticipate. The lens-transaction-wrap fix in particular changes a fundamental adapter contract and warrants its own RED/GREEN/REFACTOR cycle with full coverage of the transaction-bypass regression test surface.

---

## Coverage debt

### COVERAGE-debt — root vitest workspace Branches coverage 89.31% (lifetime; threshold-passing)

Current `pnpm test` at repo root:
- Statements 95.38% ✅
- Branches  **89.31%** ⚠️ (threshold 80%, target 90%)
- Functions 95.81% ✅
- Lines     96.22% ✅

Threshold-passing. The CLAUDE.md ≥90/90/90/90 rule is **per-phase
on diff**, not lifetime total — lifetime 89.31% is debt, NOT a
blocker. This entry stays open to track the gap, but it's not a
bug; closure requires a coverage-closure phase.

**Progress this session** (2026-05-19):
- Excluded `**/__tests__/**` from coverage (drops phantom branches
  in test-fixture `setup.ts` files).
- Excluded `apps/worker/src/index.ts` (boot wiring, mirrors api).
- Added `packages/data/tests/unit/__tests__/oauth-state-codec.test.ts`
  — 12 cases, covers all hasAllSidecars branches + provider chain.
- Added 5 better-auth-handler URL-fallback tests.
- Added 3 resolveLocalesDir tests.
- Net: 88.12% → 89.31% (+1.19%).

**Remaining gap to 90%:** ~22 covered branches. Highest-leverage
files (per `coverage/coverage-summary.json` sorted by uncovered
desc): `better-auth-handler.ts` (28), `messages.ts` (9),
`ConversationDetailClient.tsx` (9), `agent/stream.ts` (8), several
route `list.ts` (~4-7 each). Most need integration tests
(testcontainers Postgres) or DB-touching route stubs.

**Plan of attack:** open `coverage/lcov-report/index.html` after a
fresh `pnpm test`, sort by Uncovered Branches desc, file targeted
plans for the top 10 files. Each per-file fix is <50 LOC of vitest,
but the totals require ~10 PRs to close.

---

## Phase 54+ ownership

### FEATURE-verify-email-expired-token-UX

`/api/auth/verify-email?token=…` returns Better Auth's 404 JSON envelope
when a token is expired (default exp = 1h after sign-up) or invalid.
That's correct from a security standpoint — no info leak about whether
the token ever existed — but the UX is bad: the user sees a raw JSON
"Ресурс не найден" page with no recovery path.

**Proposed work (Phase 54+):**
- Change Better Auth's verification email URL from `/api/auth/verify-email`
  (direct API) to `/verify-email` (web page). The web page POSTs the
  token to the API and renders friendly success/expired/error UI.
- Add "Request a new verification email" button on the expired-token
  branch of `VerifyEmailClient.tsx` (already exists, just needs a new
  state). Wires through `authClient.sendVerificationEmail({email})`.

Not a bug — token expiry behavior is correct. Just a UX gap.

---

### FEATURE-msw-intercept — server-side fetch intercept (MSW node-server)

24 e2e specs in `apps/web/tests/e2e/` are auto-skipped under the slim
topology because their `page.route()` stubs can't intercept the
RSC server-side fetch wall. Phase 54 should land MSW node-server to
intercept inside the Next.js server runtime; would re-enable the
24 currently-skipped loading/error state specs.


---

## Locker candidates

### LOCKER-AUTH-DELETE-CLIENT — ban `authClient.deleteAccount` / `authClient.deleteUser` when server plugin disabled

**Surfaced by:** Phase 55-01-b advisor decision (Option B), 2026-05-19.

**Repro / evidence:**
- `apps/web/src/components/screens/account/DeleteAccountDialog.tsx` previously called `authClient.deleteAccount({callbackURL})` (Better Auth runtime Proxy → POST `/api/auth/delete-account`).
- Server route `apps/api/src/routes/delete-account.ts` is DELETE-method-only.
- Better Auth `user.deleteUser` plugin is intentionally NOT enabled in `apps/api/src/auth.ts` user block (cascade contract lives in our hand-rolled route).
- Result: the dialog silently 404'd in production until 55-01-b landed the fetch-DELETE migration. RED commit `9c55cac`, GREEN commit (this plan).

**Proposed lint rule:**
- `tools/lint-no-betterauth-delete-when-disabled.ts` — scan `apps/web/src/**` for `authClient.deleteAccount` / `authClient.deleteUser` AST nodes, and `apps/api/src/auth.ts` for an enabled `user.deleteUser` block. If the server plugin is disabled, every client-side reference REFUSES.
- Wire into the LOCKER-series in `tools/run-lockers.ts` + CI security.yml.

**Why deferred:** Plan 55-01-b scope is the wire fix + acceptance e2e; new linters land in their own phase per Strict-TDD discipline (RED for the linter, GREEN linter passing, etc). Suggested home: Phase 36.a (LOCKER-06 flip cohort) or a dedicated mini-plan once the Phase 55-02 wire-contract.md drift register is published — the linter shape may generalise to other `authClient.*` calls whose corresponding server plugin is unwired.

**Owner:** unassigned. Re-surface once Phase 55-02 audit identifies sibling wire mismatches.


---

## Historical (pre-Phase 53)

Older items from Phases 14, 18, 20, 31, 33, 51 live in
`.planning/backlog-archive/deferred-items-2026-05-19-archive.md`. Most
are either:
- Closed but not removed when the fix landed
- Subsumed by later phase work
- Still open but cold (no signal in 30+ days)

If a cold item resurfaces (test failure, prod alert, audit hit),
promote it back into this file with current date + repro.
