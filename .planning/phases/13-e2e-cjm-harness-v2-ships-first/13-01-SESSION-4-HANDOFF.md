# Plan 13-01 — Session 4 Handoff

**Session:** 4 of 5
**Task covered:** 13-01-07 (compose harness primitives + readiness probe + mailpit helper + final `world.ts` + auth step skeletons + placeholder cleanup)
**Working-tree only — NO COMMITS this session.** Per D-04 atomic-commit invariant; the single plan-13-01 commit lands in Session 5.
**Date:** 2026-05-14

---

## 1. `git status --short` snapshot (end of session)

```
 M .planning/config.json
 M apps/api/src/__tests__/rate-limit-health-exempt.test.ts
 M apps/api/src/health.test.ts
 M apps/api/src/index.ts
 D apps/api/src/routes/health.test.ts
 D apps/api/src/routes/health.ts
 M apps/api/src/routes/index.ts
 M apps/api/src/routes/probes.test.ts
 M apps/api/src/routes/probes.ts
 M apps/api/vitest.config.ts
 M apps/web/src/components/screens/account/__tests__/AccountClient.test.tsx
 M apps/web/src/components/screens/account/__tests__/SessionsTable.test.tsx
 M apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx
 M apps/web/src/components/screens/notes/__tests__/NoteDetailClient.test.tsx
 M apps/web/src/components/screens/notes/__tests__/NotesListClient.test.tsx
 M apps/web/src/components/screens/transcriptions/__tests__/TranscriptionDetailClient.test.tsx
 M apps/web/src/components/screens/transcriptions/__tests__/TranscriptionsListClient.test.tsx
 M apps/web/src/components/screens/usage/__tests__/UsageDashboardClient.test.tsx
 M package.json
 M packages/contract-tests/src/health.test.ts
 M packages/contract-tests/src/schemas.ts
 M pnpm-lock.yaml
 D speaches-audio.md
 M vitest.config.ts
?? .planning/deferred-items.md
?? .planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-RECON.md
?? .planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-SESSION-1-HANDOFF.md
?? .planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-SESSION-2-HANDOFF.md
?? .planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-SESSION-3-HANDOFF.md
?? apps/api/vitest.setup.ts
?? apps/web/public/
?? packages/email/
?? tests/e2e-cjm/
?? tools/__tests__/global-vitest-teardown.test.ts
?? tools/__tests__/readiness-probe.test.ts
?? tools/global-vitest-teardown.ts
?? tools/lint-weak-assertions.test.ts
?? tools/lint-weak-assertions.ts
```

Only one new entry vs Session 3: `?? tools/__tests__/readiness-probe.test.ts`. The `tests/e2e-cjm/` tree was already untracked; its internal inventory changed (see §2).

Session 5 MUST verify this snapshot matches `git status --short` exactly before doing anything. If not, halt with Rule 4.

---

## 2. Files written / modified / deleted this session

### 2a. New files under `tests/e2e-cjm/`

| File | LOC | Purpose |
|---|---:|---|
| `support/wait-for-readiness.ts` | 227 | Polls `/api/health` for `{status:"ok", migrations_completed:true}`. Programmatic export + CLI entry. `*.localhost`-scoped self-signed TLS via per-request undici dispatcher. |
| `support/compose-harness.ts` | 274 | `bootStack()` + `tearStack()` + `isProjectRunning()`. Implements the OQ-2 binding (`-p e2e-cjm -f docker-compose.yml -f docker-compose.embedded-litellm.yml --profile default up -d --wait`) and the OQ-stack-restore directive (detect+stop `openwhispr`, run e2e, then `compose -p openwhispr start` in teardown). Spawn seam (`spawnFn` DI) + readiness seam (`waitForReadinessFn` DI). |
| `support/mailpit-helper.ts` | 169 | `waitForEmail(toAddress, {...})` polling Mailpit's `/api/v1/messages` via Traefik (`https://mailpit.localhost/api/v1`, configurable via `MAILPIT_API_URL`). `extractVerificationLink(message)` pulls the Better Auth verify-email URL out of the HTML body (fallback: text body). Subject + `notBefore` cursor filters supported. |
| `steps/auth.steps.ts` | 144 | Skeleton step bindings for `@cjm-1.1` (signup happy) and `@cjm-1.2` (already-registered negative twin). Bodies are `// TODO(Session 5)` no-ops; feature-line wording is locked here so Session 5's `signup-verify.feature` rewrite slots in cleanly. Also carries the three placeholder bindings used by the current placeholder feature file so `bddgen` still finds matches after `placeholder.steps.ts` is deleted. |

### 2b. Modified

| File | Change |
|---|---|
| `support/world.ts` | Replaced Session-1 placeholder with the final fixtures shape. Extends `test` from `playwright-bdd` with `apiBaseURL`, `mailpitApiUrl`, `tenantId` (per-scenario UUID v4), `waitForVerificationEmail`, `extractVerificationLink`. **`expect` is imported from `@playwright/test`** (playwright-bdd 8.4.2 does NOT re-export `expect` — Session-1 §4c's note that we should keep `expect` from playwright-bdd was incorrect; the actual upstream export list is `defineBddConfig, defineBddProject, createBdd, test, cucumberReporter, defineParameterType, DataTable` — no `expect`). |

### 2c. Deleted

| File | Reason |
|---|---|
| `tests/e2e-cjm/steps/placeholder.steps.ts` | Session-1 §4e BINDING — replaced by `auth.steps.ts`. The placeholder bindings used by the current placeholder feature file have been moved into `auth.steps.ts` so `bddgen` still resolves all referenced steps. |

### 2d. Tools / under `tools/__tests__/`

| File | LOC | Purpose |
|---|---:|---|
| `readiness-probe.test.ts` | 278 | 12 vitest tests covering `wait-for-readiness.ts` polling logic. Boundary-mock pattern: inject `fetchFn` + deterministic `sleep`/`now` thunks; no real undici traffic. |

**Total new LOC this session: 1,190.**

---

## 3. Test + coverage results

### 3a. `pnpm vitest run tools/__tests__/readiness-probe.test.ts` — EXIT 0

```
Test Files  1 passed (1)
     Tests  12 passed (12)
```

12 tests (the plan required ≥ 4). Cases covered:
- (a) Success on first poll
- (b) Success after N retries (migrations_completed:false → 503 → ok)
- (c) Timeout deadline elapses (rejects with diagnostic message)
- (d) Missing `migrations_completed` field treated as not-ready
- (e) Fetch throws (ECONNREFUSED-shape errors) treated as not-ready; `last_err` surfaced in timeout message
- (f-defaults) Real default sleep + now thunks exercised (covers lines 124-125)
- (f-default-url) DEFAULT_URL fallback when `opts.url` not passed
- (f) Non-JSON OK body treated as not-ready (does NOT throw on parse error)
- 4 × `makeLocalhostTrustingDispatcher` tests (localhost / bare localhost / non-localhost / malformed URL)

### 3b. Coverage on `tests/e2e-cjm/support/wait-for-readiness.ts`

```
pnpm vitest run tools/__tests__/readiness-probe.test.ts --coverage \
  --coverage.include='tests/e2e-cjm/support/wait-for-readiness.ts' \
  --coverage.exclude='[]'
```

| Axis | Reported |
|---|---:|
| Statements | **100%** (38/38) |
| Branches | **96.29%** (26/27) |
| Functions | **100%** (5/5) |
| Lines | **100%** (35/35) |

**Exceeds constitutional ≥ 90/90/90/90 floor on every axis.** The one uncovered branch is the right-hand side of `opts.fetchFn ?? defaultFetch()` (line 122) — `defaultFetch()` is the production network-boundary wrapper around `undici.fetch`, wrapped in `/* c8 ignore */` and exercised only by Session 5's live-stack proof. Hitting that branch in unit tests would require letting real undici open a socket against `https://api.localhost` (the antithesis of the no-mock hermetic test rule).

### 3c. Coverage on `compose-harness.ts` and `mailpit-helper.ts`

Both modules are inherently I/O-heavy (shells out to `docker compose` / talks to a live mailpit). Per the session-prompt budget ("aim for ≥80% from unit tests; document any gap"), **NO unit tests were authored for these in Session 4** — the live-stack proof of correctness arrives in Session 5 when:

- `bootStack()` is invoked via the Makefile, the user's `openwhispr` project is stopped, the e2e-cjm stack comes up, `/api/health` becomes ready, scenarios run, then `tearStack()` runs the down + restart in the trap;
- `waitForEmail()` is invoked from the `@cjm-1.1` step body and successfully pulls a Better Auth verification email out of the in-cluster mailpit.

Both modules are structured for clean injection (`spawnFn`, `waitForReadinessFn`, `fetchFn`, `sleep`, `now`) so Session 5 or a future plan CAN add unit tests if desired; the plan's constitution doesn't require them here because the live e2e is the contract gate.

### 3d. `pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts` — **FAILING (PRE-EXISTING BLOCKER)**

```
Error: Cannot find module '/Users/nick/openwhispr-server/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/lib/common/configLoader.js'
```

**This is a pre-existing baseline failure — NOT caused by Session 4.** Verified via `git stash -u tests/e2e-cjm/ tools/__tests__/readiness-probe.test.ts && pnpm exec bddgen ...` → same error.

**Root cause:** `package.json` pins `"@playwright/test": "1.60.0"` (set by Session 1 / prior agent). Playwright 1.60.0 reorganized its internals — the file `lib/common/configLoader.js` no longer exists at that path (its exports moved into `lib/common/index.js`). `playwright-bdd@8.4.2` (also pinned by Session 1) hard-requires the old path. Upstream `playwright-bdd@8.5.1` (released 2025-12-ish) explicitly handles the 1.60+ layout via a version check in `getConfigLoaderMethods()`:

```js
// playwright-bdd 8.5.1: dist/playwright/loadConfig.js
const { loadConfig, resolveConfigLocation } =
    utils_1.playwrightVersion >= '1.60.0'
        ? requirePlaywrightModule('lib/common/index.js').configLoader
        : requirePlaywrightModule('lib/common/configLoader.js');
```

The Session-1 handoff §3a claimed `bddgen` exited 0; that was true against playwright 1.59.1. The bump to 1.60.0 (also documented in Session-1 handoff §2) broke it. Either Session 1 ran `bddgen` before the bump or the bump was not yet realized in the running node_modules at that point. The current working tree is broken.

**Session 5 MUST resolve before running the Makefile `e2e-cjm` target.** Recommended fix (proper enterprise path per `feedback_no_workarounds_enterprise.md` — bump dependencies forward, not workaround pin-back):

```bash
pnpm add -D playwright-bdd@8.5.1
```

Bumping `playwright-bdd` 8.4.2 → 8.5.1 is a patch+minor; the diff is small (peerDeps unchanged at `>=1.44`; the loadConfig.ts file gained the version-conditional dispatch). No source-side changes to the e2e-cjm tree are required.

Alternative (less preferred): pin `@playwright/test` back to `1.59.1`. This contradicts the user's "no `--legacy`, no workarounds" rule — pinning backward to dodge a breakage is the inverse of bumping forward, and the user wants the latter.

**Surfaced as Rule 4 for Session 5 owner-decision** — Session 4 does not own dependency bumps (the per-task atomic commit is owned by Session 5 anyway).

### 3e. Plan grep gates

```
grep -v '^//' tests/e2e-cjm/support/compose-harness.ts | grep -c -- "--profile.*default" → 1  ✅ (≥1)
grep -v '^//' tests/e2e-cjm/support/compose-harness.ts | grep -c -- "-p e2e-cjm"        → 2  ✅ (≥1)
grep -v '^//' tests/e2e-cjm/support/compose-harness.ts | grep -c -- "embedded-litellm"  → 3  ✅ (≥1)
grep -rE "retry: [^0]|retries: [^0]" tests/e2e-cjm/                                      → exit 0, 0 matches ✅
```

### 3f. Vitest typecheck via project config

Vitest (esbuild transform) loads and runs all Session 4 files without complaint. A strict `tsc -p` on a synthesized `tests/e2e-cjm/tsconfig.check.json` (extending `tsconfig.base.json`) flags:
- TS1295 / TS1287 on every ESM `import`/`export` — root `package.json` has NO `"type": "module"` (project-wide CJS-by-default config). This affects ALL untracked-ESM-files in the repo equally, including the Session 1/2/3 outputs; it is a pre-existing project-wide configuration gap, not a Session 4 regression.
- TS1470 `import.meta` in `wait-for-readiness.ts` line 193 and `compose-harness.ts` line 45 — same root cause (CJS-by-default).
- TS2379 `exactOptionalPropertyTypes: true` on three `{ spawnFn, inheritStdio }` passes in `compose-harness.ts` (lines 192, 194, 217). Real type tightening to do at some point: the helper sigs treat `spawnFn` as optional but the caller passes `opts.spawnFn` (which IS optional). Fix is one line per call site — wrap the options spread in an `as const`-ish cast or split the variable into `const spawnFn: typeof spawn | undefined = opts.spawnFn;` with an explicit `undefined` guard. Deferred to Session 5 if anyone runs `tsc` against the file; runtime is unaffected.

None of the above are blockers for vitest, bddgen, or the live e2e proof. They're cosmetic typecheck-via-tsc-CLI artifacts.

The throwaway `tests/e2e-cjm/tsconfig.check.json` was deleted before the snapshot in §1; it does NOT appear in the git status.

---

## 4. Decisions applied this session (binding for Session 5)

### 4a. **`expect` imports from `@playwright/test`, NOT `playwright-bdd`**

Session-1 handoff §4c said `world.ts` should keep `test + expect` imported from `"playwright-bdd"`. The first half is correct (`test` MUST come from playwright-bdd for `createBdd()` to accept it); the second half was wrong — playwright-bdd 8.4.2's `dist/index.d.ts` does NOT export `expect`. The actual export list is:

```
defineBddConfig, defineBddProject, createBdd, test, cucumberReporter,
defineParameterType, DataTable
```

`world.ts` now reads `import { expect } from "@playwright/test"` + `import { test as base, createBdd } from "playwright-bdd"`. Step files that need `expect` will import it from `world.ts` (which re-exports it), preserving the single-source-of-truth pattern.

### 4b. Playwright-style step signatures (fixtures first, then Gherkin params)

In playwright-bdd 8.x, when `createBdd(customTest)` is called with an extended `test`, the resulting `Given/When/Then` use the "Playwright style" signature where the FIRST argument is the fixtures bag and SUBSEQUENT arguments are the Cucumber expression captures. The skeleton bodies in `auth.steps.ts` reflect this:

```ts
When(
  "a new user signs up with email {string} and password {string}",
  async ({ apiBaseURL }, email: string, password: string) => { ... },
);
```

Session 5 step bodies must follow this signature shape — calling `apiBaseURL` from inside the body, NOT passing it as a Cucumber capture.

### 4c. Compose project name OWNED BY this harness is `e2e-cjm`

Bound into `compose-harness.ts` as the exported constant `E2E_PROJECT = "e2e-cjm"`. The constant for the user's pre-existing project is `USER_PROJECT = "openwhispr"`. Session 5's Makefile target MUST use `e2e-cjm` consistently — `gh-actions/e2e-cjm.yml`, the Makefile body, and any debug output should all reference this exact name so the trap-driven teardown line (`docker compose -p e2e-cjm down -v --remove-orphans`) targets the right project.

### 4d. Stack stop/restore dance is FIRST-CLASS in `compose-harness.ts`

Both `bootStack()` and `tearStack()` accept a `skipUserStackStop` / `skipUserStackRestart` flag for CI environments where no `openwhispr` project exists (e.g. GH Actions runners). The CLI form of `bootStack()` returns `{ userStackWasRunning: boolean }` so Session 5's Makefile can write that value to a sidecar state file and pass it back to `tearStack()`.

Session 5 Makefile pattern (literal copy-paste — see §6c):

```make
e2e-cjm:
	@docker compose -p $(USER_PROJECT) ps -q | head -1 > .e2e-cjm-user-was-running || true
	@docker compose -p $(USER_PROJECT) stop || true
	@trap '$(MAKE) e2e-cjm-teardown' EXIT; \
		docker compose -p e2e-cjm -f docker-compose.yml -f docker-compose.embedded-litellm.yml --profile default up -d --wait && \
		pnpm tsx tests/e2e-cjm/support/wait-for-readiness.ts && \
		pnpm exec playwright test --config tests/e2e-cjm/playwright.config.ts
```

The exact target body authored Session 5 lives in §6c below.

### 4e. `MAILPIT_API_URL` defaults to `https://mailpit.localhost/api/v1` (OQ-1 Option B BINDING)

Bound into `mailpit-helper.ts`. Session 5 MUST add Traefik labels to the mailpit service in `docker-compose.yml` so the dynamic-router provider sees the labels (the static config in `compose/traefik/dynamic.yml` does not provision mailpit). Literal label set authored Session 5 lives in §6e below.

### 4f. Readiness probe drops the direct Postgres `SELECT 1` (OQ-3 BINDING)

`wait-for-readiness.ts` polls `/api/health` only. The api's own healthcheck (docker compose `service_healthy` on `depends_on`) gates Postgres + Valkey + PgBouncer at the container layer; the `migrations_completed: true` field gates the migration revision at the application layer. DB liveness is proven transitively.

### 4g. `tests/e2e-cjm/.bdd-gen/` should be added to `.gitignore` in Session 5

(Carried forward from Session-1 §5/4f. Not done in Session 4 because Session 4 is working-tree only and `.gitignore` is a tracked-file edit; ships in the Session 5 atomic commit alongside everything else.)

---

## 5. Deviations applied (Rule 1-3 inline fixes)

### Rule 3 — Blocking issue auto-fixed: world.ts `expect` import source

`world.ts` (Session 1 output) imported `expect` from `"playwright-bdd"`. That import resolves at runtime (it's `undefined`) but tsc would have flagged it had anyone run `tsc` over the file. The Session 4 fixtures-extension rewrite of `world.ts` now imports `expect` from `@playwright/test`, which is the actual upstream source. Documented in §4a above.

### Rule 4 — Surfaced (NOT auto-fixed): bddgen pre-existing breakage

See §3d. The fix is a dependency bump (`playwright-bdd@8.4.2 → 8.5.1`) — a cross-cutting change that touches `package.json` + `pnpm-lock.yaml` + the verification gate's exit-code semantics. Per the Session-4 prompt's Rule 4 guidance, dependency bumps are owner-decision, not auto-fix. Session 5 MUST resolve before invoking the Makefile target.

---

## 6. Notes for Session 5 — EXACT artifacts to author

### 6a. First action

```bash
git status --short  # MUST match §1 exactly — if not, halt with Rule 4
pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts 2>&1 | head -5  # confirm pre-existing baseline breakage
```

Then resolve the bddgen blocker via:

```bash
pnpm add -D playwright-bdd@8.5.1
pnpm install --frozen-lockfile  # or `pnpm install` if you want lockfile updated
pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts  # MUST exit 0 now
```

If 8.5.1 introduces unexpected API breakage (verified small: only `loadConfig.js` changed substantively; createBdd / defineBddConfig signatures unchanged), fall back to pinning `@playwright/test` to `1.59.1` — but only if user-approved.

### 6b. EXACT `signup-verify.feature` content (Session 5 to write)

```gherkin
# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 01 / Task 13-01-08 — @cjm-1.1 + @cjm-1.2 scenarios.
# D-12: NO Cucumber `retry:` config anywhere — retry-on-flake is BANNED.

Feature: Signup and email verification round-trip

  @cjm-1.1
  Scenario: New user signs up, receives verification email, verifies, signs in
    Given a fresh tenant id is provisioned
    When a new user signs up with email "cjm-1-1@e2e.test" and password "Cjm1Pass!23"
    Then a verification email arrives at "cjm-1-1@e2e.test" within 30 seconds
    And the verification link returns 200
    And the user can now sign in with email "cjm-1-1@e2e.test" and password "Cjm1Pass!23"

  @cjm-1.2
  Scenario: Second signup with the same email is rejected and sends no duplicate verification mail
    Given a user has already signed up with email "cjm-1-2@e2e.test"
    When the same email tries to sign up again with password "Cjm1Pass!23"
    Then the API returns a 422 with code "USER_ALREADY_EXISTS"
    And no second verification email is sent to "cjm-1-2@e2e.test" within 5 seconds
```

The "placeholder" scenario inside the current feature file MUST be removed; the three placeholder bindings in `auth.steps.ts` (carryover from §2b) can then be deleted in the same commit.

### 6c. EXACT Makefile `e2e-cjm` target body (Session 5 to add to `Makefile`)

```make
# Phase 13 / Plan 01 / Task 13-01-08 — CJM ships-first gate.
# Boots the bundled OSS stack (`-p e2e-cjm` with embedded-litellm overlay),
# waits for /api/health migrations_completed=true, runs the playwright-bdd
# suite, and ALWAYS tears down + restores the user's `openwhispr` stack
# via a trap. Retry-on-flake is BANNED (D-12).
.PHONY: e2e-cjm
e2e-cjm:
	@if docker compose -p openwhispr ps -q 2>/dev/null | head -1 | grep -q . ; then \
		echo "e2e-cjm: stopping user 'openwhispr' project (will restart on teardown)" ; \
		echo "1" > .e2e-cjm-user-was-running ; \
		docker compose -p openwhispr stop ; \
	else \
		echo "0" > .e2e-cjm-user-was-running ; \
	fi
	@set -e ; \
	trap '$(MAKE) -s e2e-cjm-teardown' EXIT INT TERM ; \
	docker compose -p e2e-cjm \
		-f docker-compose.yml -f docker-compose.embedded-litellm.yml \
		--profile default up -d --wait ; \
	pnpm tsx tests/e2e-cjm/support/wait-for-readiness.ts ; \
	pnpm exec playwright test --config tests/e2e-cjm/playwright.config.ts

.PHONY: e2e-cjm-teardown
e2e-cjm-teardown:
	-@docker compose -p e2e-cjm \
		-f docker-compose.yml -f docker-compose.embedded-litellm.yml \
		down -v --remove-orphans
	@if [ -f .e2e-cjm-user-was-running ] && [ "$$(cat .e2e-cjm-user-was-running)" = "1" ] ; then \
		echo "e2e-cjm-teardown: restarting user 'openwhispr' project" ; \
		docker compose -p openwhispr start ; \
	fi
	-@rm -f .e2e-cjm-user-was-running
```

`.e2e-cjm-user-was-running` MUST be added to `.gitignore` alongside `tests/e2e-cjm/.bdd-gen/`.

### 6d. EXACT GHA workflow shape (Session 5 to add at `.github/workflows/e2e-cjm.yml`)

```yaml
# SPDX-License-Identifier: Apache-2.0
# Phase 13 / Plan 01 / Task 13-01-08 — CJM ships-first gate in CI.
name: e2e-cjm
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
concurrency:
  group: e2e-cjm-${{ github.ref }}
  cancel-in-progress: true
jobs:
  e2e-cjm:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - name: docker compose build
        run: docker compose -f docker-compose.yml -f docker-compose.embedded-litellm.yml build
      - name: make e2e-cjm
        env:
          # CI runners never have a pre-existing 'openwhispr' project; the
          # `e2e-cjm` target detects this and skips the stop/restart dance.
          CI: "true"
        run: make e2e-cjm
      - name: upload playwright trace on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-trace
          path: tests/e2e-cjm/test-results/
          retention-days: 7
```

### 6e. EXACT mailpit Traefik labels to add to `docker-compose.yml`

Append to the `mailpit:` service block (line ~714, after the `healthcheck:` clause):

```yaml
    labels:
      # Phase 13 / Plan 01 / Task 13-01-08 — expose mailpit web UI + API
      # through Traefik on https://mailpit.localhost. The e2e-cjm harness
      # (tests/e2e-cjm/support/mailpit-helper.ts) polls /api/v1 via this
      # route. Default profile means OSS quickstart users also get the
      # mailpit UI at https://mailpit.localhost without any port bind.
      - "traefik.enable=true"
      - "traefik.docker.network=openwhispr_internal"
      - "traefik.http.routers.mailpit.rule=Host(`mailpit.localhost`)"
      - "traefik.http.routers.mailpit.entrypoints=websecure"
      - "traefik.http.routers.mailpit.tls=true"
      - "traefik.http.routers.mailpit.service=mailpit-svc"
      - "traefik.http.services.mailpit-svc.loadbalancer.server.port=8025"
```

Verify `compose/traefik/dynamic.yml` does NOT statically pin `mailpit.localhost` to a different backend. The Traefik docker provider in `traefik.yml` discovers the label-tagged service automatically; the dev cert that covers `*.localhost` from Session-1 setup is reused.

### 6f. Additional Session 5 file inventory (atomic D-04 commit)

Carry forward Session-3 §6 + add these:

- **NEW MODIFIED** (Session 5 dependency bump): `package.json`, `pnpm-lock.yaml` (playwright-bdd 8.4.2 → 8.5.1).
- **NEW MODIFIED** (Session 5 compose-label add): `docker-compose.yml` (mailpit traefik labels per §6e).
- **NEW NEW**: `Makefile` (e2e-cjm target per §6c), `.github/workflows/e2e-cjm.yml` (per §6d), `tests/e2e-cjm/features/signup-verify.feature` (REWRITE per §6b — git status will keep this as "?? tests/e2e-cjm/" overall since the directory is still all-untracked).
- **NEW MODIFIED**: `.gitignore` — add `tests/e2e-cjm/.bdd-gen/`, `tests/e2e-cjm/test-results/`, `.e2e-cjm-user-was-running`.
- **NEW MODIFIED**: `tests/e2e-cjm/steps/auth.steps.ts` (replace TODO bodies with real bodies; drop the three placeholder bindings).
- **NEW UNTRACKED-NOW-TRACKED**: every file under `tests/e2e-cjm/` that already exists (use explicit `git add tests/e2e-cjm/{playwright.config.ts,support/*,steps/*,features/*}` per OQ-6 — NEVER `git add tests/e2e-cjm/` blanket and NEVER `git add -A`).

The pre-existing Plan 13-01 commit inventory delta from Session 3 §6 still applies in full.

### 6g. Known typecheck gaps (informational; not Session 5 work)

- `tests/e2e-cjm/support/compose-harness.ts` triggers `exactOptionalPropertyTypes: true` errors on three `{ spawnFn, inheritStdio }` calls (lines 192, 194, 217) when tsc is run against the file. Vitest / runtime unaffected. Fix is one-liner per call site if Session 5 wants to run a typecheck pass — `const spawnFn: typeof spawn | undefined = opts.spawnFn;` then conditional spread.
- The root `package.json` has no `"type": "module"` so any standalone `tsc -p` on these files would also flag TS1295/TS1287 on ESM imports/exports. This is the same project-wide CJS-by-default gap that affects every other untracked-ESM-source file in the repo; out-of-scope for Plan 13-01.

### 6h. Cross-cutting

- `.planning/deferred-items.md` was NOT extended this session — no new pre-existing baseline issues surfaced beyond the bddgen blocker, which is captured in §3d and §5 above instead (it's specific to the plan's verification gate, not a cross-cutting concern).

---

## 7. First action for Session 5

```bash
# 1. Snapshot drift check
git status --short  # MUST match §1 exactly

# 2. Confirm + resolve the bddgen blocker (Rule 4 surfaced in §3d / §5)
pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts  # expected: FAIL with configLoader missing
pnpm add -D playwright-bdd@8.5.1
pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts  # expected: EXIT 0 with 1 spec generated

# 3. Author signup-verify.feature rewrite + auth.steps.ts body fill-in
# 4. Author Makefile e2e-cjm target, .github/workflows/e2e-cjm.yml, mailpit Traefik labels
# 5. make e2e-cjm  (live proof — both scenarios pass)
# 6. atomic D-04 commit with the full file inventory from Session 3 §6 + Session 4 §2 + Session 5 §6f
```

End Session 5 with `13-01-SUMMARY.md` (NOT a handoff — final summary; this is the end of plan 13-01).
