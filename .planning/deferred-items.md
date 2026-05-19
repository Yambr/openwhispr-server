# Deferred Items — OPEN ONLY

Items discovered during execution that are still actionable. Closed items
are archived under `.planning/backlog-archive/`.

**Triage convention:** any item below is OPEN. When a fix lands, delete
the entry rather than marking it closed — git history preserves the
record. Keep this file under ~200 lines.

**Bug count: 0.**

---

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
