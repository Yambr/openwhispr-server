# Deferred Items — OPEN ONLY

Items discovered during execution that are still actionable. Closed items
are archived under `.planning/backlog-archive/`.

**Triage convention:** any item below is OPEN. When a fix lands, delete
the entry rather than marking it closed — git history preserves the
record. Keep this file under ~200 lines.

**Bug count: 3.**

---

## BUG-55-SESSIONS-RETRY-SWEEP-CONTAMINATION — sessions-retry.spec.ts fails in full sweep after revoke-sessions.spec.ts

**Surfaced by:** Plan 55-15 final slim sweep (2026-05-19).

**Repro:**
- Run `pnpm playwright test 100-acceptance/sessions-retry --project=slim` in isolation → PASS.
- Run full slim 100-acceptance sweep → sessions-retry FAILS with `getByTestId('session-row-this-device').first()` not visible.
- Page snapshot shows the Active sessions table rendering with N rows but NO `session-row-this-device` badge — `currentSessionId` server-resolved by `getServerSession()` does not match any `row.id` returned by `authClient.listSessions()`.

**Hypothesis:** revoke-sessions.spec.ts (alphabetically earlier in the sweep) uses a DIFFERENT fixture user (alice+55) and overrides storageState to empty — should NOT touch alice+0. But Better Auth's session rotation seam or the api container rebuild during Plan 55-05b may have left alice+0's storage state's cookie pointing at a session_id that's been replaced server-side.

**Impact:** Single flake within the sweep. 26/27 specs pass; the one failure is in a previously-green spec (55-06-b landed clean). No production-code regression.

**Fix candidates:**
- Force alice+0 storage re-provision via global-setup detecting stale-cookie state.
- Add a server-side reconcile step in SessionsTable that drops the badge gracefully if currentSessionId mismatches all row ids (UX fallback).
- Wait on the actual cookie value vs `getServerSession` consistency in spec beforeEach.

**Owner:** unassigned. Re-surface in next phase.

---

## BUG-55-06-a-RSC-FETCH-WALL — `/app` usage Retry button error state unreachable from Playwright

**Surfaced by:** Plan 55-06-a execution on 2026-05-19 (halted before RED commit — plan explicitly forecasts this halt condition).

**Repro intent:** Long-form acceptance spec wants to drive `UsageDashboardClient.tsx:90-92` Retry button by:
1. `page.route('**/api/usage', 500)` → assert Alert + Retry render.
2. Re-route to 200 → click Retry → assert KPI cards populate.

**Why it can't work today (two compounding walls):**
1. **RSC server-side fetch wall** — `apps/web/src/app/(auth)/app/page.tsx:27-51` runs `queryClient.prefetchQuery` server-side via `internalApiUrl()` (api:3000 inside the docker network). The request never crosses the browser boundary, so `page.route()` cannot intercept it. Same root cause as `BUG-53-27` / Phase 41.c `D-c-1` deferred (which already covers the loading-state branch for u4-usage.spec.ts; this entry extends the same defect to the **error** branch).
2. **Empty-defaults fallback masks failure** — `page.tsx:34-43` on `!res.ok` returns `{ wordsUsed: 0, wordsRemaining: 0, plan: "unlimited", limitReached: false }` instead of throwing. The dehydrated cache is therefore always a *success* shape. Combined with `staleTime: 60_000` in `query-client.tsx:34` + `query-client-server.ts:18`, the Client `useQuery` reads from the hydrated cache and **never refetches**, so even a 500 stub on the browser-side route is ignored. `usage.isError` is never true → Alert + Retry button never render.

**UX impact:** ZERO production impact — this is a TEST-INFRASTRUCTURE wall, not a user-visible defect. The Retry button works correctly in real failure scenarios (transient API outage after staleTime expiry, network-level failures the SSR catches). But it is **structurally untestable** under the current RSC + hydration design from a Playwright spec.

**Fix candidates (all out of scope for Plan 55-06-a):**
1. **MSW infra phase** (forecast in the plan) — mount Mock Service Worker at the apps/api container boundary so server-side fetches via `internalApiUrl()` route through interceptor.
2. **Refactor `app/(auth)/app/page.tsx` to `<Suspense>` + `useSuspenseQuery`** — moves the network boundary to the client where `page.route()` can intercept (Phase 41.c `D-c-1` suggested resolution).
3. **Remove the empty-defaults fallback** in `page.tsx:34-43` — let SSR errors propagate so the Client query starts in error state. Production-behavior change; needs design review (current behavior is intentional per UI-SPEC empty-as-N/A).

**Owner:** unassigned. Surface area: 11 Retry/error-state buttons across the app (RESEARCH.md §"Network error → Retry button") are all blocked on the same wall.

---

## BUG-55-03-c-FROM-PARAM-LOST — middleware drops `?from=` on /app guard redirects

**Surfaced by:** Plan 55-03-c spec (`apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts`) on 2026-05-19.

**Repro:**
- Sign out, visit `http://localhost:3000/app` (bare) OR `http://localhost:3000/app/` (trailing slash) OR `http://localhost:3000/app/notes/some-id`.
- Observed: redirect to `/sign-in` (no `?from=` query param).
- Expected per `apps/web/src/middleware.ts:138`: `?from=%2Fapp...`.

**Evidence:**
- `middleware.ts:133` checks `startsWith("/app/")` — should match `/app/` and `/app/notes/...` but apparently next.js's matcher on the slim Next 15 build skips middleware entirely for these paths.
- The `(auth)/layout.tsx` server-side guard then catches the unauthenticated session and `redirect("/sign-in")`s without preserving the original path.
- UX impact: post-sign-in routing cannot recover the target screen — users always land on `/app` after auth instead of the deep link they tried to open.

**Fix candidate:** widen the matcher in `middleware.ts` (line 133) — verify Next 15 matcher config in `next.config.ts`. May also need to move the `from=` capture into the `(auth)/layout.tsx` guard so both paths preserve it.

**Owner:** unassigned. **Not a security bug** (redirect to `/sign-in` always happens). UX regression only.

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
