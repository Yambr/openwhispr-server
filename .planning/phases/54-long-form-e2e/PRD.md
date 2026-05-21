# Phase 54 — Long-form acceptance e2e suite with per-step diagnostic gates

## Why

Phase 53 closed many production bugs but the proof was a 69/0/24 slim
sweep of FOCUSED specs (each tests one screen, one state). The user
reported that the live dev-stack OOB experience still has UX gaps:

- OIDC button surfaced 500 (BUG-A, fixed but only after manual click)
- `/api/auth/verify-email` returned a raw 404 JSON for expired tokens
- Web container could be running stale bundle vs source (no smoke that
  caught the divergence)

The 99-cross-screen-smoke spec walks 5 screens but does not exercise
real sign-up + mailpit + verification + sign-in + sign-out as a single
acceptance flow. That gap is why bugs leak: there is no test that fails
exactly when the OOB happy path is broken.

Phase 54 closes the gap with a long-form, end-to-end acceptance suite
that asserts **zero browser console errors at every step** and walks
through every user-facing surface the way a real operator would.

## Functional acceptance criteria

A new Playwright suite under `apps/web/tests/e2e/100-acceptance-*/`
that, against the LIVE dev-tools stack:

1. **Sign-up via UI** — fill the sign-up form, submit, assert the
   "check your email" UI appears OR /sign-in?signed-up=1 redirect.
   `expectNoBrowserErrors` after this step.

2. **Mailpit retrieval** — poll mailpit HTTP API for the verification
   email addressed to the just-registered user. Extract the
   verification link. Timeout 15s.

3. **Verification link click** — visit the link via Playwright
   context.request. Assert 200/302/303 (not 404). `expectNoBrowserErrors`.

4. **Sign-in via UI** — fill the sign-in form with the new credentials.
   Assert redirect to /app. `expectNoBrowserErrors`.

5. **Visit every authed screen** — /app, /app/transcriptions,
   /app/notes, /app/conversations, /app/account. Each navigation
   asserts (a) URL matches, (b) primary heading visible, (c) no
   browser console errors, (d) no network 4xx/5xx (allow the explicit
   diagnostic allowlist patterns only).

6. **Locale toggle** — switch English → Русский, refresh page, assert
   Russian copy renders. Switch back. Verify cookie persistence.
   `expectNoBrowserErrors`.

7. **Theme toggle** — click theme toggle, assert `data-theme` flips
   on `<html>`, refresh, assert persistence. `expectNoBrowserErrors`.

8. **Sign-out** — click sign-out button (not API call). Assert
   redirect to /sign-in. Try to visit /app → guard 302s back to
   /sign-in?from=/app. `expectNoBrowserErrors`.

9. **Sign-in again** — verify the password-reset path is reachable:
   click "Forgot password?", fill email, assert "check your email"
   UI, poll mailpit for reset email, extract link, visit it. Assert
   it lands on `/reset-password?token=...`. (Do NOT actually reset
   the password — just prove the flow is wired.)

10. **Browser-console invariant** — at EVERY step from 1 through 9,
    `expectNoBrowserErrors(page)` must pass. This includes:
    - No `console.error` calls (with allowlist for known dev-mode i18n
      keys that are loaded asynchronously)
    - No uncaught page errors (React errors, Sentry-style crashes)
    - No 4xx/5xx network responses outside the allowlist
    - No CSP violations
    - No requestfailed events outside the allowlist

11. **No flake guard** — run the spec 3 times in CI; all 3 must pass.

## Non-functional acceptance criteria

- The suite runs against the **already-running** dev-tools stack
  (no docker compose down/up). Set `PLAYWRIGHT_SKIP_WEBSERVER=1`.
- Runtime budget: ≤ 60s per full run.
- Uses the EXISTING browser-diagnostics helper at
  `apps/web/tests/e2e/support/browser-diagnostics.ts` — do not
  re-implement.
- Uses the EXISTING mailpit helper pattern from
  `tests/e2e-cjm/steps/signin.steps.ts` — adapt for Playwright
  context.

## Out of scope

- Reset-password flow completion (only assert it's reachable).
- Realtime WSS / transcribe / agent-stream paths.
- BYOK / token management screens.
- WCAG axe scans (existing u-* specs cover those).

## Verification

The phase is DONE when:

- New spec file(s) exist under `apps/web/tests/e2e/`.
- `pnpm exec playwright test --project=slim --reporter=line` passes
  with the new specs included.
- Slim sweep total ≥ 71 / 0 failed / ≤ 24 skipped (≥1 new spec on top
  of the 70 from Phase 53).
- Three consecutive runs of the new spec pass without flake.
- `expectNoBrowserErrors` asserts at every step; spec FAILS on first
  console.error or 4xx/5xx network response outside the allowlist.

## Bugs to surface (if found during e2e run)

Any bug exposed by the new suite gets filed inline in
`.planning/deferred-items.md` with a BUG-54-* tag. Following the
Phase 53 fix-cycle pattern:

1. spec fails red
2. diagnose root cause
3. fix
4. spec passes green
5. commit with the BUG-54-* tag
6. delete the backlog entry

Until the suite goes green, this phase is NOT done.
