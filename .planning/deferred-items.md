# Deferred Items — OPEN ONLY

Items discovered during execution that are still actionable. Closed items
are archived under `.planning/backlog-archive/`.

**Triage convention:** any item below is OPEN. When a fix lands, delete
the entry rather than marking it closed — git history preserves the
record. Keep this file under ~200 lines.

**Bug count: 1.** See BUG-54-PRD-RESET-UI-MISSING below — surfaced by
Plan 54-03 discovery on 2026-05-19, HALTS Plan 54-03 per its own
risk-section directive.

---

## Bugs

### BUG-54-PRD-RESET-UI-MISSING — password-reset UI surface absent

**Surfaced by:** Plan 54-03 Task 1 discovery (2026-05-19).
**Status:** HALT — blocks 54-03 GREEN, no spec landed.

**Evidence:**

- `apps/web/src/components/screens/auth/SignInForm.tsx:247-253` —
  "Forgot password?" is intentionally muted static text (D-UX2
  sentinel), NOT an anchor/button. Source comment says
  "anchor lands with Phase 19.1 reset-mail" but only the API path
  shipped in 19.1; the web-UI anchor was never wired.
- `apps/web/src/locales/en/end-user.json:424` — copy is
  `"Forgot password? — coming soon, contact your operator."`
- `apps/web/src/app/(public)/` — directory listing shows
  `sign-in/ sign-up/ setup/ verify-email/` ONLY; NO
  `forgot-password/` or `reset-password/` route exists.
- `tests/e2e-cjm/steps/password-reset.steps.ts` — proves the API
  endpoint `/api/auth/request-password-reset` exists and mailpit
  receives the reset mail. The wire path is GREEN; the web UI
  surface is missing.
- `apps/web/tests/e2e/support/mailpit.ts:56` —
  `fetchPasswordResetLink` is wired and shipped by 54-01, ready to
  use as soon as the web routes exist.

**Why HALT (not fabricate):**

- Plan 54-03's own risks section (line 187) explicitly mandates
  HALT + BUG-54-* file when neither web route exists.
- CLAUDE.md hard rule 1: NEVER edit production code to make tests
  pass — and conjuring entire `/forgot-password` + `/reset-password`
  Next.js pages, server actions, form handlers, and i18n copy is
  unambiguously production-UI scope-stretch, not test scaffolding.
- D-UX2 is an explicit design decision (Phase 18.1.1) — flipping
  the muted text into a live anchor requires UX sign-off, not an
  executor-agent unilateral decision.

**Required to unblock 54-03 (future plan, NOT this executor):**

1. `apps/web/src/app/(public)/forgot-password/page.tsx` — server
   component shell rendering a `ForgotPasswordForm` client component.
2. `apps/web/src/components/screens/auth/ForgotPasswordForm.tsx` —
   email field + submit; POSTs `/api/auth/request-password-reset`;
   renders enumeration-safe "if your email is registered, we've sent
   you a link" confirmation regardless of outcome (Better Auth
   already anti-enumerates server-side).
3. `apps/web/src/app/(public)/reset-password/page.tsx` — server
   component that parses `?token=…` from the search params and renders
   a `ResetPasswordForm` client component.
4. `apps/web/src/components/screens/auth/ResetPasswordForm.tsx` —
   new-password field + confirm field + submit; POSTs
   `/api/auth/reset-password` with the token from the query string.
5. Flip `SignInForm.tsx:251-253` from muted `<p>` to a real
   `<Link href="/forgot-password">` (or shadcn Button-as-Link); rip
   out the D-UX2 sentinel; update `__tests__/SignInForm.test.tsx:189`
   + `:450` (the two D-UX2 sentinel tests) to assert anchor presence.
6. Update copy in `locales/{en,ru}/end-user.json:422-425` from
   "coming soon" → active CTA.
7. Re-trigger 54-03 to write the e2e spec against the now-real routes.

**Cross-refs:**
- `tests/e2e-cjm/steps/password-reset.steps.ts:71` — wire endpoint
- `apps/web/tests/e2e/support/mailpit.ts:56,99` — helper ready
- `.planning/phases/54-long-form-e2e/plans/54-03-PLAN.md:187` —
  the risk-section HALT directive triggered here.

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

## Historical (pre-Phase 53)

Older items from Phases 14, 18, 20, 31, 33, 51 live in
`.planning/backlog-archive/deferred-items-2026-05-19-archive.md`. Most
are either:
- Closed but not removed when the fix landed
- Subsumed by later phase work
- Still open but cold (no signal in 30+ days)

If a cold item resurfaces (test failure, prod alert, audit hit),
promote it back into this file with current date + repro.
