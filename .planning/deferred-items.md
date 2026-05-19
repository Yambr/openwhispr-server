# Deferred Items — OPEN ONLY

Items discovered during execution that are still actionable. Closed items
are archived under `.planning/backlog-archive/`.

**Triage convention:** any item below is OPEN. When a fix lands, delete
the entry rather than marking it closed — git history preserves the
record. Keep this file under ~200 lines.

**Bug count: 2.**

---

## BUG-55-05-SETUP-ADMIN-ROUTE-UNWIRED — `POST /api/setup/admin` is 404 in every deployed api binary

**Surfaced by:** Plan 55-05 spec (`apps/web/tests/e2e/100-acceptance/setup-wizard-happy-path.spec.ts`) on 2026-05-19.

**Repro:**
- Bring up dev-tools stack: `make up-with-dev-tools`.
- POST `/api/_test/reset-setup` to flip `setup_state` back to `pending`.
- POST `/api/setup/admin` with the valid wizard payload.
- Observed: HTTP 404 `{"error":"Not found"}`.
- Expected: 201 (fresh) or 200 with `alreadyCompleted:true` (race-loser) per the handler at `apps/api/src/routes/setup-admin.ts:201,324`.

**Root cause:**
- `apps/api/src/routes/index.ts:391-400` registers `buildSetupAdminRoutes` only when `deps.setupAdmin` is supplied.
- `apps/api/src/index.ts:492-505` (the production bootstrap call to `buildAllRoutes`) NEVER passes `setupAdmin`. The handler exists but is never registered.
- The wizard UI (`SetupForm.tsx`) POSTs to `/api/setup/admin`, gets a 404 envelope, falls into its `setErrorKind("generic")` branch, and never redirects to `/admin` — the operator sees the canonical "Setup failed" alert with no way forward.

**Impact:**
- The /setup wizard is **fully dead-ended** in every dev / staging / production deploy of openwhispr-server. The slim docker instance only "appears" to have completed setup because the row is inserted by migration 0017 + manual UPDATE; the UI path that's supposed to create the first admin user has never worked end-to-end against the deployed binary.
- Blocks 1 of the 8 MISSING UCs from Plan 55-05 (UC-SETUP-WIZARD-SUBMIT-201 + UC-SETUP-WIZARD-REDIRECT-ADMIN). The remaining 6 UI-layer UCs (load, identity-fill, stepper-advance, workspace-fill, review-mirror, zero-browser-errors) are covered by the Plan 55-05 spec without crossing the submit boundary.

**Proposed fix (NEEDS A DEDICATED PLAN — production change, NOT a Phase 55-05 deviation):**
1. Wire `setupAdmin` in `apps/api/src/index.ts` alongside the existing `litellm` / `redis` / `mockDiarization` deps:
   - Provide an `ownerPool` (the postgres pool with owner-role grants needed to bypass RLS for the singleton UPSERT).
   - Provide a `signUpEmail` callable — likely `auth.api.signUpEmail.bind(auth.api)`.
   - Optionally provide `renameTenant` (best-effort tenant rename — UICONF warning surfaces on failure).
2. Add a build-app integration test asserting `app.printRoutes()` contains `POST /api/setup/admin` whenever the production wiring is exercised (defense in depth — same pattern as `build-app-diarization-wiring.test.ts`).
3. Re-enable Plan 55-05's step 6 (submit) + step 7 (redirect) in the long-form acceptance spec once GREEN.

**Why deferred:**
- Production server code change (route wiring + dep plumbing). CLAUDE.md hard rule #1 forbids editing production code "to make tests pass." The wiring decision involves architectural choices (ownerPool naming, signUpEmail binding, renameTenant adapter) that warrant their own phase-level decision register, not a quick patch buried in an acceptance spec.
- Suggested home: a dedicated Phase 55-05.b plan ("wire /api/setup/admin in production bootstrap") with full TDD coverage: RED (build-app integration test asserting the route is registered), GREEN (wire in index.ts), refactor as needed, then re-enable the Plan 55-05 spec's submit + redirect steps.

**Owner:** unassigned. Re-surface in next phase planning cycle.

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
