---
phase: 53
type: phase-plan
status: pending
opened: 2026-05-18
title: Browser-console scraping in every e2e + fix web→api routing 404 cascade
requirements: [E2E-CONSOLE-01, WEB-API-01, WEB-CSP-01]
must_haves:
  truths:
    - "Every Playwright test + every Cucumber e2e step that drives a real browser page captures: (a) console messages (log/info/warn/error), (b) page errors / uncaught exceptions, (c) network failures (response status ≥ 400 OR request.failure()), (d) CSP violations (SecurityPolicyViolationEvent surfaced via the page.on('console') hook OR an injected listener). All four streams accumulate into a per-test diagnostics array and dump in the test-failure report."
    - "A failed e2e assertion that occurs AFTER a captured browser-side error MUST surface the browser-error before the assertion message — so root cause is visible without re-running."
    - "When the test passes BUT the diagnostics array has any `error`-severity entry, the test FAILS by default. An explicit `allowBrowserErrors([pattern, ...])` escape hatch per-test is the only way to tolerate a known-acceptable browser-side log (e.g., a deliberately-thrown error in a negative-twin scenario)."
    - "Helper lives at `apps/web/tests/e2e/support/browser-diagnostics.ts` AND `tests/e2e-cjm/support/browser-diagnostics.ts` (one source of truth, re-exported from both — OR a single shared file in `packages/` that both consume). Every existing `*.spec.ts` / `*.steps.ts` that uses Playwright's `page` is rewritten in this phase to attach the diagnostics listener in its `beforeEach` / `Before` hook."
    - "POST /api/auth/sign-up/email through web.localhost:3000 returns 200 + the same user JSON the api-direct curl returns. Verified by a new e2e (`tests/e2e-cjm/features/web-signup-ui.feature` with `@cjm-web-signup-1`) that loads the sign-up page in a real browser, fills the form, clicks submit, asserts (a) network success on /api/auth/sign-up/email, (b) ZERO browser-side errors via the diagnostics helper, (c) post-submit UI shows the 'Check your email' success block."
    - "Root cause of the current `/api/auth/sign-up/email` 404 from the web origin is fixed: EITHER Next.js rewrites `/api/auth/*` + `/api/auth/providers` to the backend api (next.config.ts `rewrites()` block keyed on `NEXT_PUBLIC_API_URL`), OR the slim-core compose default layers in the Traefik ingress overlay and Better Auth uses `api.localhost` directly. The decision lives in DISCUSS phase; both options are real."
    - "CSP `'unsafe-inline'` violation on script-src is fixed: the inline script that fires the violation is either nonce'd via Next.js built-in nonce propagation OR rewritten as a static external file."
    - "All 4 browser-diagnostics dimensions are EXERCISED by a sentinel test that deliberately triggers each (console.error / page error / fetch 500 / CSP violation) and asserts the helper captures it — RED → GREEN per constitutional TDD."
  artifacts:
    - path: tests/e2e-cjm/support/browser-diagnostics.ts (new) — shared Playwright/Cucumber listener attach helper
    - path: tests/e2e-cjm/support/browser-diagnostics.test.ts (new) — 4 RED→GREEN sentinel cases (one per dimension)
    - path: tests/e2e-cjm/features/web-signup-ui.feature (new) — @cjm-web-signup-1 end-to-end via real browser
    - path: tests/e2e-cjm/steps/web-signup-ui.steps.ts (new) + __tests__/web-signup-ui.steps.test.ts
    - path: apps/web/next.config.ts (modified) — OR compose default flipped to layer ingress overlay; one of the two
    - path: apps/web/playwright.config.ts (modified) — global setup attaches diagnostics
    - path: docs/customer-journeys.md — new web-signup section
plans:
  - plan: 53-01
    title: "TDD RED — browser-diagnostics helper sentinel tests (4 dimensions)"
    files_new:
      - tests/e2e-cjm/support/browser-diagnostics.ts (stub returning empty arrays — fails all 4 sentinels)
      - tests/e2e-cjm/support/browser-diagnostics.test.ts
    expected_red: "4/4 sentinel cases fail because the helper stub captures nothing"
  - plan: 53-02
    title: "TDD GREEN — implement browser-diagnostics helper"
    files_modified:
      - tests/e2e-cjm/support/browser-diagnostics.ts (real listeners on page.on console/pageerror/requestfailed/response; CSP via injected window listener)
    expected_green: "4/4 sentinel cases pass; per-test diagnostics flush mechanism + allowBrowserErrors escape hatch"
  - plan: 53-03
    title: "Sweep every existing browser-driving e2e to attach the helper"
    discovery_command: "rg -l 'page\\.goto|browser\\.newPage' tests/e2e-cjm/ apps/web/tests/"
    per_file_change: "Add `attachBrowserDiagnostics(page)` in Before hook (Cucumber) or beforeEach (Playwright); assert at After/afterEach that `expectNoBrowserErrors(diagnostics)` unless explicit allowlist"
    expected_outcome: "Some currently-green tests turn RED because of pre-existing browser errors they were hiding (memory hint: web Next.js 404ing /api/auth/* is one such case)"
  - plan: 53-04
    title: "DISCUSS + DECIDE web→api routing — Next.js rewrites vs Traefik host-split default"
    decision_doc: ".planning/phases/53-web-console-scrape-and-api-routing/53-DECISIONS.md"
    candidates:
      - "A. next.config.ts rewrites() — keep slim-core single-port, web proxies /api/auth/* to NEXT_PUBLIC_API_URL"
      - "B. Compose default flips to layer compose/docker-compose.ingress.yml — web.localhost vs api.localhost host-split (production topology); requires mkcert dev-CA per Phase 17"
      - "C. Better Auth client uses absolute NEXT_PUBLIC_API_URL — bypasses the same-origin assumption entirely (drops cookie sharing concerns)"
    blocked_until: "user picks one in /gsd-discuss-phase 53.04"
  - plan: 53-05
    title: "TDD RED — web-signup-ui.feature @cjm-web-signup-1 (negative — currently 404s)"
    files_new:
      - tests/e2e-cjm/features/web-signup-ui.feature
      - tests/e2e-cjm/steps/web-signup-ui.steps.ts
      - tests/e2e-cjm/steps/__tests__/web-signup-ui.steps.test.ts
    expected_red: "Test fails — browser-diagnostics captures 404 on /api/auth/sign-up/email + 404 on /api/auth/providers + CSP violation on inline script"
  - plan: 53-06
    title: "TDD GREEN — implement the chosen 53-04 option"
    expected_green: "@cjm-web-signup-1 passes; browser-diagnostics array is empty post-submit"
  - plan: 53-07
    title: "Fix CSP unsafe-inline violation"
    files_modified:
      - apps/web/src/app/(public)/sign-up/page.tsx (or wherever the inline script lives) — nonce or external file
    expected_outcome: "browser-diagnostics no longer captures the SecurityPolicyViolationEvent"
verification:
  - "make verify exit 0"
  - "make e2e-test-phase6 exit 0 (regression — Plan 51-19 path)"
  - "make e2e-cjm exit 0 with @cjm-web-signup-1 GREEN + every other browser-driving test still GREEN (with diagnostics-allowlist patched as needed for legitimate negative-twins)"
  - "Manual smoke: cp .env.example .env, docker compose up -d --wait, open http://localhost:3000, fill sign-up form, click submit → 'Check your email' success block visible, ZERO 404s in DevTools console, ZERO CSP violations"
---

# Phase 53 — Browser-console scraping in every e2e + fix web→api routing 404 cascade

## Why now

The 2026-05-18 manual smoke (after Plan 11-02/03/03b/03c session shipped Variants
A/B/C scaffolds) surfaced two real bugs that the existing e2e suite did not
catch:

1. **`POST /api/auth/sign-up/email` 404 from the web origin.** UI sign-up form
   on `http://localhost:3000` hits Next.js's own router for `/api/auth/*` (no
   route → 404), not the backend Fastify api on `:4000`. Web `useAuthProviders`
   hook also 404s on `/api/auth/providers`, silently rendering zero OIDC
   providers. The CJM e2e (Cucumber + Playwright) tests sign-up via direct
   api hits, NOT via the rendered web UI — the host-split assumption was
   never load-bearing for that path.

2. **CSP `'unsafe-inline'` script-src violation.** An inline script on the
   sign-up page fires `SecurityPolicyViolationEvent`. The web Playwright suite
   does not assert "zero CSP violations" — a passing test today does not catch
   it.

Both bugs are observable in the operator's DevTools console DURING a manual
smoke but invisible to the e2e suite because no test captures
`page.on('console')` / `page.on('pageerror')` / `page.on('response')` /
`SecurityPolicyViolationEvent`. **Phase 53 closes that blind spot end-to-end
AND fixes the two surfaced bugs as the inaugural sentinel cases.**

## Scope split

| Concern | Plan |
|---|---|
| Browser-diagnostics helper (new infra) | 53-01 RED + 53-02 GREEN |
| Sweep existing e2e to attach the helper (expose latent bugs) | 53-03 |
| Decide web→api routing approach (3 candidates) | 53-04 DISCUSS |
| Sign-up UI e2e RED → GREEN | 53-05 + 53-06 |
| CSP violation fix | 53-07 |

53-04 is the only plan that requires user input. The rest are autonomous TDD.

## Dependencies + ordering

- 53-01 RED → 53-02 GREEN (helper standalone, no other deps)
- 53-03 sweep after 53-02 (helper must exist before being attached)
- 53-04 DISCUSS standalone — produces 53-DECISIONS.md
- 53-05 RED depends on 53-02 (uses helper) AND 53-04 (knows the contract being tested)
- 53-06 GREEN depends on 53-04 decision + 53-05 RED
- 53-07 standalone after 53-06 (CSP fix is independent of the routing fix)

## Constitutional TDD rule

Per CLAUDE.md `Engineering discipline §1`: every Plan 53-XX lands RED → GREEN
in the SAME atomic commit window (RED commit immediately precedes GREEN
commit on the same branch). 53-03's sweep can land as one commit per ~10
files per Phase 15-03 precedent.

## Non-goals

- Not rewriting the entire CJM harness (those tests stay Cucumber+Playwright)
- Not fixing every CSP violation the new diagnostics surface — Phase 53
  fixes the inline-script case that blocks sign-up; other violations are
  cataloged in `.planning/deferred-items.md` for follow-up phases
- Not touching the api-direct e2e tests in `tests/e2e/` (Plan 51-19's
  phase 6 set — those don't drive a browser)
