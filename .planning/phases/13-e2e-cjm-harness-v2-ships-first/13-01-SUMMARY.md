# Phase 13 Plan 01 — Summary

**Plan:** 13-01 — e2e-cjm Harness v2 ships-first
**Atomic commit:** `17c603e` (`feat(13-01): ship e2e-cjm harness + worker EmailSender + /api/health migrations_completed`)
**Date:** 2026-05-14
**Sessions:** 5 of 5 (this doc closes the plan)

---

## must_have truths against the live codebase

| # | Truth | Verification | Result |
|---|---|---|---|
| 1 | `make e2e-cjm` (E2E_CJM=1) runs @cjm-1.1 + @cjm-1.2 to green | **Partial.** Per Session-5 D2 binding, the live proof ran `pnpm exec playwright test --config tests/e2e-cjm/playwright.config.ts` against the **existing user openwhispr stack** rather than booting a fresh `-p e2e-cjm` project. Both scenarios are GREEN in isolation. The Makefile target body matches Session-4 §6c (stop openwhispr → up e2e-cjm with embedded-litellm overlay → trap teardown → restart openwhispr) and the .github/workflows/e2e-cjm.yml wires it for CI. Live `make e2e-cjm` invocation is deferred to first CI run on a fresh clone. | ⚠ partial |
| 2 | apps/worker wires real `createEmailSender`, not `noopSender` | `grep -c 'noopSender' apps/worker/src/index.ts` = 0; `grep -c '@openwhispr/email' apps/worker/src/index.ts` ≥ 1; live worker logs `worker started` and processes the email-delivery queue when the api enqueues a verification mail | ✓ |
| 3 | `/api/health` returns `{status: "ok", migrations_completed: true}` against a fully-migrated stack | `curl -fsS -k https://api.localhost/api/health` → `{"status":"ok","migrations_completed":true}` | ✓ |
| 4 | `tools/lint-weak-assertions.ts` exit 0 on apps/web | `pnpm tsx tools/lint-weak-assertions.ts apps/web` → "Weak-assertion check passed: 41 file(s) scanned" exit 0 | ✓ |
| 5 | Testcontainers leak fix: no containers with `label=org.testcontainers=true` survive after a vitest run | `docker ps --filter label=org.testcontainers=true` returned empty after each vitest invocation in Sessions 1-5; CI canary in `.github/workflows/e2e-cjm.yml` asserts this | ✓ |
| 6 | bddgen exit 0 with at least 1 spec | `pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts` → "Generating Playwright test files (1): tests/e2e-cjm/.bdd-gen/features/signup-verify.feature.spec.js" exit 0 | ✓ |
| 7 | `@openwhispr/email` enforces prod loud-fail when `SMTP_HOST` is unset (NODE_ENV=production) | `packages/email/src/EmailSender.test.ts` 8 unit tests, including `throws when SMTP_HOST unset in production`, all green; coverage ≥ 90/90/90/90 on EmailSender.ts | ✓ |
| 8 | Better Auth signup → mailpit verification mail → click link → 200 → sign in 200 | `@cjm-1.1` scenario GREEN against running stack; mailpit captured `Verify your OpenWhispr email address` mail with rendered `verification_url` (not literal placeholder); GET on the link returned 302 (Better Auth's `verify-email` route redirects to the callbackURL on success — accepted alongside 200 in the harness assertion) | ✓ |
| 9 | Duplicate-signup attempt returns 422 with `USER_ALREADY_EXISTS` and sends no second verification mail | `@cjm-1.2` scenario GREEN; the duplicate-protection preHandler in `routes/better-auth-handler.ts` short-circuits before sendVerificationEmail fires | ✓ |

---

## Deviations from Plan

### Auto-fixed Issues (Rule 1 — real product bugs surfaced)

**1. [Rule 1] `sendVerificationEmail` was wired under the wrong Better Auth key (Phase 10 bug)**
- **Found during:** @cjm-1.1 live execution — signup returned 200 but no email was ever sent.
- **Root cause:** `apps/api/src/auth.ts` placed `sendVerificationEmail` under `emailAndPassword.sendVerificationEmail`. Better Auth 1.6.9's `api/routes/sign-up.mjs:239` reads from `ctx.context.options.emailVerification.sendVerificationEmail` (top-level), NOT from `emailAndPassword`. The closure had been dead code since Phase 10.
- **Fix:** Moved the closure to a top-level `emailVerification: { sendVerificationEmail: ... }` block. Updated `auth-send-verification-email.test.ts` and `auth-locale-and-enqueue.test.ts` to read from `opts.emailVerification?.sendVerificationEmail`.
- **Files modified:** `apps/api/src/auth.ts`, two test files.
- **Commit:** `17c603e`

**2. [Rule 1] Worker email-template variables key mismatch (Phase 10 bug)**
- **Found during:** @cjm-1.1 live execution after fix #1 — email arrived but body was literal `Hello {name}` / `<a href="{verification_url}">{verification_url}</a>` placeholders.
- **Root cause:** `apps/worker/src/i18n/locales/en/email/email_verification/body.{txt,html}` template uses `{verification_url}` and `{name}` placeholders. `apps/api/src/auth.ts` was passing `variables: { url }` (key = `url`, not `verification_url`).
- **Fix:** Send `variables: { verification_url: url, url, name: user.email }` so both canonical worker-side keys are populated. `url` retained as a back-compat alias.
- **Files modified:** `apps/api/src/auth.ts`, `auth-locale-and-enqueue.test.ts` (variable assertion updated to `toMatchObject` with `verification_url` + `name`).
- **Commit:** `17c603e`

**3. [Rule 1] `migrationsCheck` used wrong pool (Session-3 wiring bug)**
- **Found during:** First live `/api/health` curl after rebuild — `migrations_completed: false` even with 17 rows in `_meta.__drizzle_migrations`.
- **Root cause:** Session-3 wired the probe against `appPool` (role: `openwhispr_app`). That role does NOT have `USAGE` on the `_meta` schema (RLS isolation; the schema is owner-only). The probe's `SELECT count(*) FROM _meta.__drizzle_migrations` returned a permission-denied error that the try/catch swallowed as `false`.
- **Fix:** Construct a small dedicated owner pool (`new Pool({connectionString: DATABASE_URL_OWNER, max: 1})`) inside the entrypoint and use it for the migrations probe. Cleaner than granting `_meta` USAGE to the app role (which would have required a new migration touching DDL).
- **Files modified:** `apps/api/src/index.ts` (entry-point block).
- **Commit:** `17c603e`

### Auto-fixed Issues (Rule 1-3 — harness / infra)

**4. [Rule 3] bddgen blocker — `playwright-bdd@8.4.2` is incompatible with `playwright@1.60.0`**
- **Surfaced by:** Session-4 §3d/§5.
- **Fix:** Bumped `playwright-bdd` 8.4.2 → 8.5.1 (root devDep). 8.5.1 dispatches on `playwrightVersion >= 1.60.0` and loads `lib/common/index.js` directly instead of the renamed `lib/common/configLoader.js`. Also bumped `apps/web/package.json`'s `@playwright/test` from 1.59.1 → 1.60.0 so pnpm dedupes the `playwright` runtime resolution (without this, playwright-bdd was still resolving `playwright@1.59.1` from a sibling node_modules tree).
- **Commit:** `17c603e`

**5. [Rule 3] Mailpit was not host-bound on the existing stack**
- **Surfaced by:** Session-5 D1 binding.
- **Fix:** Added `ports: ["127.0.0.1:8025:8025"]` to mailpit in both `docker-compose.yml` and `docker-compose.embedded-litellm.yml`. Restarted only the mailpit container with `docker compose -p openwhispr -f docker-compose.embedded-litellm.yml up -d --no-deps mailpit` (did NOT stop the rest of the stack per the user binding).
- **Note:** The pre-existing Traefik route at `https://mailpit.localhost/api/v1/messages` (provisioned via `compose/traefik/dynamic.yml` since Phase 2 Plan 02) is unchanged and remains the harness's default mailpit URL via `MAILPIT_API_URL` env. The host-port binding is a redundant reach path for CI / fresh-clone scenarios where Traefik may not be wired.
- **Commit:** `17c603e`

**6. [Rule 3] Better Auth CSRF gate rejects requests with no `Origin` header**
- **Surfaced by:** First live @cjm-1.1 run — undici POST to `/api/auth/sign-up/email` returned 403 with `MISSING_OR_NULL_ORIGIN`.
- **Fix:** Step bodies set `Origin` header to the request's own URL origin (always trusted because `AUTH_URL=https://api.localhost` is in `trustedOrigins`). Curl had been working because curl never sends `Origin`; Better Auth's gate exempts the no-Origin-header case — but undici's fetch fills in `Origin: null` which trips the strict gate.
- **Commit:** `17c603e`

**7. [Rule 3] bddgen step-file glob accidentally loaded compose-harness as a step module**
- **Surfaced by:** Initial bddgen run after the 8.5.1 bump — `compose-harness.ts` failed to load (CJS/ESM interop).
- **Fix:** Narrowed `tests/e2e-cjm/playwright.config.ts` `steps:` glob from `["support/**/*.ts", "steps/**/*.ts"]` to `["support/world.ts", "steps/**/*.ts"]`. The world is the only file in `support/` that registers steps; the other support files are internal helpers loaded transitively.
- **Commit:** `17c603e`

**8. [Rule 3] Better Auth's internal rate-limit window carries over between sequential scenarios**
- **Surfaced by:** Running @cjm-1.1 immediately followed by @cjm-1.2 — the @cjm-1.2 Given got 429.
- **Fix:** Step bodies retry on 429 with 2s linear backoff for up to ~30s (`Given a user has already signed up` and `When the same email tries to sign up again`). This is a harness-side correctness fix, not a workaround — Better Auth's rate-limit is a real product behavior; the harness must tolerate it in CI without resorting to `OPENWHISPR_DISABLE_RATE_LIMIT=1` (which would distort the SUT).
- **Commit:** `17c603e`

**9. [Rule 3] Dockerfile builds (api + worker) need `packages/email`**
- **Surfaced by:** First `docker compose build api` after adding `@openwhispr/email` to apps/api/package.json — `pnpm install` failed with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.
- **Fix:** Added `COPY packages/email/package.json packages/email/` + `COPY packages/email packages/email` to both api and worker Dockerfiles. tsup's `noExternal: [/^@openwhispr\//]` then inlines `createEmailSender` into the bundle.
- **Commit:** `17c603e`

### No deviations: lint sweep + harness

The plan's lint-weak-assertions sweep target was apps/web; recon expected 8 occurrences across 3 files. The actual scan after Sessions 3/4 reports `0 offenders / 41 files scanned` — Session 3 already rewrote all flagged assertions during its weak-assertion pass.

---

## TDD Gate Compliance

Plan 13-01 frontmatter is `type: tdd`. Gate sequence assertion:

- **RED:** Working-tree-only sessions 1-4 authored failing tests + scaffolding (no commits per D-04 atomic-commit invariant). The plan-level RED gate is implicit in the per-session handoff snapshots (Session 1-4 HANDOFFs document `failing-then-green` cycles for each module).
- **GREEN:** The single atomic commit `17c603e` lands the implementation + green tests as one operation.
- **REFACTOR:** Not separately committed — refactors during Sessions 2-5 (e.g., Logger interface narrowing, owner-pool migration) land inside the same atomic commit.

**Gate compliance note:** The atomic D-04 commit mode is documented in the plan as a deliberate trade-off. The conventional `test(...) → feat(...) → refactor(...)` triplet is collapsed because Phase 13 owns the harness end-to-end; partial-state commits would leak `noopSender`-still-wired snapshots into git history. A future Phase-13 follow-up may split this into three commits if the plan's invariants change.

---

## Known Stubs / Deferred Items

- **Makefile e2e-cjm target not live-executed.** Per D2 binding the live proof used the existing stack. First CI run will exercise the Makefile path end-to-end.
- **No unit tests for `compose-harness.ts` and `mailpit-helper.ts`.** Both are I/O-heavy boundary modules; coverage is delegated to the live e2e (Session 4 §3c). Future plan may add boundary-mocked unit tests if regressions warrant.
- **playwright trace artifacts** are left in `tests/e2e-cjm/test-results/` (.gitignore'd) from the live proof; can be inspected via `pnpm exec playwright show-trace <path>`.

---

## Threat Flags

None new. The duplicate-signup gate, CSRF Origin enforcement, rate-limit window, and email loud-fail in production are all pre-existing trust boundaries that the harness now exercises (rather than introduces).

---

## Self-Check

- [x] `apps/worker/src/index.ts` — 0 occurrences of `noopSender`; ≥1 occurrence of `@openwhispr/email`
- [x] `curl https://api.localhost/api/health` returns `migrations_completed: true`
- [x] `docker ps --filter label=org.testcontainers=true` empty after vitest
- [x] `pnpm tsx tools/lint-weak-assertions.ts apps/web` exit 0
- [x] `pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts` exit 0
- [x] `.github/workflows/e2e-cjm.yml` references `label=org.testcontainers=true`
- [x] `Makefile` `e2e-cjm` target contains `--profile` AND `-p e2e-cjm`
- [x] `tests/e2e-cjm/features/signup-verify.feature` contains `@cjm-1.1` AND `@cjm-1.2`
- [x] Atomic commit `17c603e` exists in `git log --oneline -3`
- [x] User's openwhispr stack still running: 15/15 containers up (verified via `docker compose -p openwhispr ps`)

## Self-Check: PASSED
