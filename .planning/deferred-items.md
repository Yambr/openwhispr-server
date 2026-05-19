# Deferred Items — OPEN ONLY

Items discovered during execution that are still actionable. Closed items
are archived under `.planning/backlog-archive/`.

**Triage convention:** any item below is OPEN. When a fix lands, delete
the entry rather than marking it closed — git history preserves the
record. Keep this file under ~200 lines.

**Bug count: 1.**

---

## BUG-55-18-LEGACY-ADMIN-AUTH-ANTIPATTERN — remove Traefik basic-auth + edge-auth gates

**Surfaced by:** user feedback on 2026-05-19 after Phase 55-18 landed. Quote: "Все должно работать из без Траефика че за антипаттернты назуярил".

**Antipatterns currently in the codebase:**

1. `apps/web/tests/e2e/a2-observability.spec.ts:36` + `a3-config.spec.ts:21` — Playwright `httpCredentials: { username: ADMIN_BASIC_USER, password: ADMIN_BASIC_PASS }` for basic-auth challenge.
2. `apps/web/tests/e2e/00-infra.spec.ts:9` — references `admin:testpw123` basic auth in a smoke comment.
3. `ADMIN_BASIC_AUTH_USERS` env (compose warning when not set).
4. `ADMIN_EDGE_AUTH_ENFORCED` env read in `apps/web/src/app/(admin)/layout.tsx`.
5. Any Traefik `admin-basicauth` middleware in `compose/traefik/*`.

**Correct model (memory `feedback_no_traefik_antipatterns`):** self-host must work WITHOUT Traefik. Admin = regular user with `users.role='admin'`. Auth = Better Auth cookies. No basic-auth challenge, no edge gates, no ingress-level auth coupling.

**Why it persists:** Phase 13.x ingress work introduced Traefik basic-auth as a defense-in-depth layer for production. Tests inherited the pattern. Slim topology was added later as an OSS-friendly fallback but the admin-flow specs were never migrated off basic-auth.

**Fix plan (separate phase 57+):**
1. Drop `httpCredentials` from `a2-observability` + `a3-config` specs; sign in as a regular user with `users.role='admin'` (mirror the Phase 55-18 pattern using `storageStatePath(workerIndex)` with the existing fixture admin-role grant).
2. Remove `ADMIN_EDGE_AUTH_ENFORCED` branch from `(admin)/layout.tsx` — role check via `getServerSession` IS the gate. Defense-in-depth is fine but ENV flag should not gate primary access.
3. Drop `ADMIN_BASIC_AUTH_USERS` from compose. If Traefik basic-auth middleware still exists, remove it.
4. Update docs / SELF_HOSTING.md / BACKEND_SPEC.md if they reference basic-auth.

**Phase 55-18's `apps/web/tests/e2e/100-acceptance/admin-pages.spec.ts` already follows the correct model** — it does NOT use httpCredentials, only the role-on-fixture pattern. It serves as the reference for the migration.

**Owner:** unassigned. Surface to Phase 57+ ingress-decoupling work.

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
