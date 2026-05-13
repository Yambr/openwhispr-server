# Pitfalls Research — v2 Production Readiness (Brownfield)

**Domain:** Brownfield production-readiness milestone on an enterprise self-hosted backend (OpenWhispr Server) — adding E2E discovery, admin onboarding, BYOK profiles, repo refactor + FSL relicense, comment audit, trusted TLS, and an SSO SPEC to a repo that already shipped v1.
**Researched:** 2026-05-14
**Confidence:** HIGH (every pitfall is anchored to a real symptom in `.planning/TECH_DEBT.md` from the 2026-05-14 stack-up walkthrough — these are not hypothetical "common mistakes", they already happened to us once).

> This file SUPERSEDES the v1 PITFALLS.md (dated 2026-05-08). The v1 file was an upstream-spec-derived risk list; v2 is a brownfield-symptom-derived case-study list. Treat them as complementary: v1 still describes the wire-shape risks; v2 describes the repair-milestone risks.

---

## Framing

The v1 → v2 walkthrough on 2026-05-14 surfaced ~20 observable symptoms in `.planning/TECH_DEBT.md`. Every one of them shipped through v1's verification gate with 90%+ unit coverage, 100% test-suite green, and explicit phase sign-off. They still slipped because:

1. **Unit tests are wire-shape-only** — `getAllByText(...).toBeGreaterThan(0)` (TD-13.a) is the canonical example: a test that passes for both the correct N=1 and the buggy N=2 case.
2. **The harness for journey-level verification did not exist** — `tests/e2e/` contained only `phase6-scale-dynamic.yml` (k6 perf); zero Playwright/Cucumber (TD-13.e). There was literally no test that could have caught "operator types `https://api.localhost/admin` → 404" (TD-12.a).
3. **Capability drift between layers** — UI renders capability the backend doesn't have (TD-12.c: SSO buttons with 0 providers configured → 404 → 429 cascade). Each layer's tests passed; their contract was never asserted end-to-end.
4. **Brownfield-specific traps** — wizard re-run produces duplicate admins; repo refactor breaks coverage paths; history scrub force-pushes `main` and breaks every clone. None of these exist in greenfield work.

Phase 13 (E2E + CJM) is the gate. **Every pitfall in phases 12, 14, 15, 16, 17, 18 is only catchable via a working Phase 13 harness.** Treat the Phase 13 pitfalls as cross-cutting — they affect every subsequent v2 phase's verification.

---

## Critical Pitfalls

### Pitfall 1: Weak-assertion test patterns ship bugs green

**Case study:** TD-13.a — `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx:147` uses `expect(screen.getAllByText(/already registered/i).length).toBeGreaterThan(0)`. The duplicate-banner bug (the warning renders TWICE because `SignUpForm.tsx` mounts the error component in two places) ships green: N=2 passes the same assertion N=1 passes. The bug was discovered by a human walkthrough, not the test. Same pattern at line 165 for the generic-error case.

**What goes wrong:**
A family of weak-assertion patterns silently accepts the buggy state:
- `getAllByText(...).length.toBeGreaterThan(0)` — accepts duplicates
- `expect(spy).toHaveBeenCalled()` — accepts call count drift (1 vs 5)
- `expect(result).toBeTruthy()` — accepts `{}`, `[]`, `"any string"`
- `expect(response.status).not.toBe(500)` — accepts 400, 401, 403, 404, 200 equally
- `await waitFor(() => expect(...).toBeInTheDocument())` without `{ timeout, interval }` — masks race conditions

**Why it happens:**
Developers write the loosest assertion that passes locally, because tightening it requires asserting exact text / count / status — and exact text changes (i18n!) trigger churn. Loose assertions are *intentionally* future-proof against irrelevant changes; they end up future-proof against bugs too.

**How to avoid:**
- Phase 13 plan MUST include an explicit ban-list (codified as ESLint rule or Vitest plugin):
  - Ban `toBeGreaterThan(0)` on `.length` — replace with `toHaveLength(N)` with an explicit N.
  - Ban `toBeCalled()` — require `toHaveBeenCalledTimes(N)`.
  - Ban `toBeTruthy()` / `toBeFalsy()` on objects — require structural assertions.
  - Ban bare `not.toBe(500)` on HTTP status — require exact `toBe(<code>)`.
  - Require timeout/interval on every `waitFor`.
- Phase 13 plan MUST sweep ALL `apps/web/src/**/__tests__/*.test.tsx` for these patterns BEFORE writing Cucumber features. Tightening reveals which existing tests are gaslighting, which become the first negative-twin scenarios in Gherkin.

**Warning signs:**
- A test file changed at the same time as production code with a different conceptual purpose (test was loosened to match).
- A bug-report PR doesn't have a single failing test in its first commit.
- `git log -p apps/web/src/components/screens/auth/__tests__/` shows assertions becoming looser over time.
- Coverage stays 90%+ while bugs increase.

**Phase to address:**
**Phase 13** — sub-plan: "Weak-assertion sweep + ESLint enforcement". MUST land BEFORE first Gherkin file (otherwise Cucumber inherits the same loose discipline).

---

### Pitfall 2: Happy-path-only coverage (no negative twin)

**Case study:** TD-13.c — sign-in with unverified email returns 403. UI shows a generic error with no resend-verification CTA, no "your verification email was never sent because the worker is broken" hint (TD-mailpit, `apps/worker/src/index.ts:68` `noopSender`). The happy-path "user verifies email → signs in → lands on dashboard" was the only flow tested. Every error branch in Better Auth (`requireEmailVerification`, ratelimit 429, USER_ALREADY_EXISTS, invalid password, unknown email) is an untested happy-path-shaped void.

**What goes wrong:**
Gherkin / Cucumber scenarios default to the happy path. The negative twin ("scenario: sign-in fails for unverified email — operator sees the resend CTA, not a 403 stack trace") is omitted because it feels redundant. The bug is then "the UI behaves correctly when everything works", which is exactly what TD-12.c / TD-12.e / TD-13.b / TD-13.c all exemplify.

**Why it happens:**
- CJM mapping is usually drawn as a linear flow (signup → verify → sign-in → use). Branching error paths aren't on the diagram.
- "Negative test" feels like QA work, not engineering work — easier to defer.
- Mocking the failure modes in unit tests is hard (you'd have to mock the worker not sending the email AND the API returning 403 AND the UI's response to 403).

**How to avoid:**
- Phase 13 MUST produce `CJM.md` artefact FIRST, BEFORE any `.feature` file is written. The roadmapper must enforce this ordering.
- CJM.md must explicitly enumerate, per journey:
  - Happy path
  - Each error branch the journey produces (every non-2xx status the backend can emit on this path)
  - Each "silent failure" mode (worker noop, no email arrives, no observability)
- Gherkin feature files MUST have a 1:1 mapping to CJM nodes. The Phase 13 verifier MUST fail if any CJM error branch lacks a scenario.
- Negative-twin rule: every `Scenario:` with a 2xx outcome must have a sibling `Scenario:` in the same feature file asserting a 4xx/5xx outcome that the UI handles correctly.

**Warning signs:**
- `.feature` files have only "Given valid input ... Then success" structure.
- The word "error" / "fails" / "rejects" doesn't appear in scenario titles.
- Mailpit inbox stays empty during the full E2E run (signal: no failure injection exists).
- A new bug report can be reproduced with a 3-line script but no existing scenario covers it.

**Phase to address:**
**Phase 13** — CJM.md is the deliverable before Gherkin. Roadmap must specify `CJM.md` as a hard prerequisite artefact in the Phase 13 success criteria.

---

### Pitfall 3: Capability drift between UI and backend

**Case study:** TD-12.c — SSO buttons render unconditionally in `apps/web/src/components/screens/auth/*` even when 0 OIDC providers are configured. User clicks Google → POST `/api/auth/sign-in/social` → 404 (`Provider not found`) → repeated clicks → Better Auth ratelimit → 429. The UI rendered a capability the backend doesn't have.

**What goes wrong:**
The same shape recurs anywhere a UI feature is conditional on operator-side env: SSO providers (TD-12.c), realtime endpoints (only if AssemblyAI/Deepgram/OpenAI keys are set per WIRE-13/14/15), observability links (only if `--with-observability`), storage browser (only if `S3_ENDPOINT` set, TD-14.c).

**Why it happens:**
- The UI is tested in isolation with mocks ("when user clicks Google button, sign-in fires"). The "is the Google button supposed to exist?" question is never asked because no test has both UI + real backend in the same process.
- Capability discovery requires a backend endpoint (`GET /api/auth/providers`, `GET /api/capabilities`) that nobody owned in v1.
- "Default to render-all, hide later" is the natural template-coding order.

**How to avoid:**
- Phase 12 MUST add a `GET /api/capabilities` (or per-domain endpoint like `/api/auth/providers`) returning the operator's configured surface. Every conditional UI element queries it at mount.
- Phase 13 MUST add a contract test: for every env permutation in `compose/profiles/*`, the rendered UI must match the configured backend. Specifically:
  - "Scenario: zero OIDC providers configured → no SSO buttons rendered" (negative)
  - "Scenario: Google + GitHub configured → exactly 2 SSO buttons rendered, in alphabetical order" (positive, exact count)
- Phase 14 (BYOK profiles) reuses the same `/api/capabilities` to drive `--with-observability` / `--with-storage` UI affordances.

**Warning signs:**
- A UI component is rendered without a corresponding backend `GET` returning availability.
- Code review finds string literals like `Sign in with Google` hard-coded in JSX with no conditional.
- An operator's first 429 ratelimit is from clicking their own UI button repeatedly (TD-12.c is exactly this).

**Phase to address:**
**Phase 12** primary (introduce `/api/capabilities`). **Phase 13** secondary (contract test enforces no-drift). **Phase 14** reuses the pattern for BYOK flags.

---

### Pitfall 4: Brownfield wizard runs at the wrong time

**Case study:** TD-12.b — `.env` ships `ADMIN_BASIC_AUTH_USERS=admin:$$2y$$05$$<hash>` with no companion plaintext; operators cannot log in. Fix proposal: first-run `/setup` wizard. But: what happens when (a) the wizard runs on a fresh install, fine; (b) on an upgrade of an existing v1 install with a populated `users` table, the wizard MUST NOT execute; (c) on a re-run after partial seed (operator hit refresh mid-wizard), the wizard MUST resume idempotently, not create a second admin user.

**What goes wrong:**
A naive "is `users` table empty?" check is wrong for brownfield (v1 → v2 upgrade). A naive "has wizard ever run?" flag is wrong if seed crashed mid-way (state: 1 admin in `users`, 0 rows in `wizard_runs`). The result: duplicate admins, conflicting `role=admin` rows, broken sign-in.

**Why it happens:**
- Greenfield onboarding wizards assume "empty state OR done" — brownfield needs "empty OR in-progress OR done OR upgrade-from-pre-wizard-era".
- The wizard's success-state is usually a side-effect (admin user created) rather than an explicit transition record.
- The "skip" path leaves the install in a half-configured state nobody can re-enter.

**How to avoid:**
- Phase 12 design MUST include a `setup_state` table with explicit enum (`pending`, `in_progress`, `completed`, `skipped_legacy`) and a migration that backfills existing v1 installs to `skipped_legacy`.
- Wizard entry point MUST gate on `setup_state.status`, not on `users` table emptiness.
- Wizard MUST be idempotent: each step persists its result; refresh resumes from the last persisted step.
- "Skip" path is not allowed unless the install is detectably upgradeable (existing admin in `users` table). Otherwise "skip" is "I want a broken install", which we reject.
- E2E test (Phase 13) MUST cover: fresh install, mid-wizard crash + resume, upgrade-from-v1, double-run (idempotency).

**Warning signs:**
- Wizard has no persisted state machine.
- Migration for `setup_state` table is absent from Phase 12 plan.
- "What if the operator refreshes mid-step?" isn't in the plan's risk section.

**Phase to address:**
**Phase 12** — explicit sub-plan: "Setup wizard state machine + brownfield migration".

---

### Pitfall 5: E2E harness flakes in CI but not locally

**Case study:** TD-13.e — `tests/e2e/` contains only k6 perf. No Playwright harness exists. When one lands in Phase 13, the standard brownfield trap will be: dockerized stack startup races (Postgres ready before PgBouncer ready before Fastify ready before web Next.js ready), Mailpit polling timeout (E2E asserts "verification email arrived in mailpit inbox" but mailpit isn't reachable yet), OAuth provider responses non-deterministic (rate-limit 429 from a test that ran 4 minutes ago), Traefik cert provisioning timing on `*.localhost`.

**What goes wrong:**
The harness passes locally where the developer has a warm Docker cache and runs tests one at a time. CI cold-starts the whole stack and runs scenarios in parallel; race conditions surface as 1-in-20 flakes. The team responds by retrying the suite (3x retry policy) which masks real bugs and burns CI minutes.

**Why it happens:**
- `docker compose up --wait` checks healthchecks, but our healthchecks check process liveness, not readiness (Fastify is listening, but migrations are still running).
- Tests poll Mailpit's HTTP API with no exponential backoff.
- No serial gate for tests that touch shared global state (OAuth provider, ratelimit buckets).

**How to avoid:**
- Phase 13 plan MUST specify readiness probes that go beyond `up --wait`:
  - Postgres: `SELECT 1` from app role.
  - Fastify: `GET /api/health` returns 200 AND `migrations_completed=true` from a status endpoint.
  - Mailpit: `GET /api/v1/messages` returns 200.
  - Web: `GET /` returns 200 (not Next.js dev-mode HMR boot screen).
- Phase 13 must specify per-test database isolation (each scenario gets its own tenant row + dedicated mailpit tag), so parallel runs don't collide.
- Phase 13 must specify a CI-only `docker-compose.test.yml` that fixes test seed data, disables ratelimits for E2E test runs (via a `TEST_MODE` env that the API honours and refuses to set in prod images).
- Ban retry-on-failure in CI for Phase 13 suite. A flake IS a bug.

**Warning signs:**
- Test names like `signin works (flaky)`.
- CI YAML contains `retries: 3` for E2E job.
- `await sleep(2000)` appears anywhere in the test code.
- Healthchecks check liveness (`pidof node`) not readiness (`migrations done`).

**Phase to address:**
**Phase 13** — readiness-probe sub-plan. This pitfall blocks every subsequent v2 phase verification, so it's the single highest-leverage Phase 13 deliverable after CJM.md.

---

### Pitfall 6: testcontainers leak (orphan containers + volumes)

**Case study:** `.planning/deferred-items.md` item 1 — Docker daemon held **13 orphan `postgres:17-alpine` containers** + dozens of hash-named volumes labelled `org.testcontainers.session-id=...` from a single past vitest session. Cumulative leak: ~30 GB volumes + 1 GB containers, enough to exhaust the Docker VM disk so a fresh `docker compose up` fails with `No space left on device` on Postgres init.

**What goes wrong:**
Vitest watch-mode reload or SIGKILL bypasses Ryuk's session cleanup. Each iteration leaves another testcontainer + volume. Three days of TDD = a wedged Docker VM. Phase 13's harness will multiply this 10x because Playwright + testcontainers is the canonical Phase 13 pattern.

**Why it happens:**
- Ryuk is the reaper but it can't reap if the parent process is SIGKILLed and the Ryuk socket is closed before the cleanup signal arrives.
- `TESTCONTAINERS_RYUK_DISABLED=true` is sometimes set in CI for speed and forgotten in local config.
- Vitest's `--watch` reload races the cleanup hook.

**How to avoid:**
- Phase 13 plan MUST include a vitest global `afterAll` teardown that calls `await stoppedContainer.stop()` on every instance, AND a `process.on('SIGINT')` and `process.on('SIGTERM')` handler that runs the same cleanup.
- CI MUST have `docker container prune --filter label=org.testcontainers=true --force` and `docker volume prune --filter label=org.testcontainers=true --force` in the `always()` block of every test job.
- Local dev: a `make test-cleanup` target that operators can run. Document in `apps/api/tests/README.md`.
- Acceptance criteria from deferred-items.md item 1 must be encoded as a CI assertion: after the test job, `docker ps -a --filter "label=org.testcontainers=true"` returns zero rows within 30s.

**Warning signs:**
- `docker ps -a` shows >0 containers labelled `org.testcontainers` after a green test run.
- `docker system df` shows steadily growing volumes over a sprint.
- A new developer's first `docker compose up` fails with `No space left on device`.

**Phase to address:**
**Phase 13** — testcontainers cleanup is a hard prerequisite for harness reliability. Cannot be deferred again.

---

### Pitfall 7: Compose profile semantics inverted

**Case study:** TD-14.f / deferred-items.md item 3a — every service in `docker-compose.embedded-litellm.yml` is `profiles: [default, ...]`. Compose's `default` profile semantic is "services with NO `profiles:` key". So `docker compose -f docker-compose.embedded-litellm.yml up --wait` selects ZERO services and exits with `no service selected`. The bundle README's quickstart copy-paste line is dead-on-arrival for OSS operators.

**What goes wrong:**
Profile-naming convention treats `default` as a tag ("this service is in the default profile"), but Compose treats `default` as the absence of a tag ("this service has no profile, so it runs by default"). Tagging a service with `profiles: [default]` paradoxically REMOVES it from the default-up set.

**Why it happens:**
- Compose profile docs are subtle on this point and the failure is silent (no warning, just zero services).
- The convention "label everything explicitly" feels safer than "label the optional ones" but it breaks here.

**How to avoid:**
- Phase 14 plan MUST adopt the convention: **services that should run on bare `docker compose up` have NO `profiles:` key**. Optional services have `profiles: [observability]` / `profiles: [storage]` / etc.
- Phase 14 verifier MUST run `docker compose -f compose/<file> config --services` and assert the expected universal set is returned with no profile flag.
- Phase 14 E2E test MUST be `docker compose up --wait` (bare, no `--profile`) followed by smoke against the slim-core surface.

**Warning signs:**
- Any compose file has `profiles: [default]` — this is the inversion.
- A README quickstart needs `--profile <something>` to work.
- `docker compose up` exits with `no service selected`.

**Phase to address:**
**Phase 14** — profile naming + universal-on convention. Phase 13 E2E must use bare `docker compose up`.

---

### Pitfall 8: BYOK env silently falls back to wrong default

**Case study:** Phase 14 risk extrapolation from TD-14.c and TD-mailpit — operator wants S3 (AWS, Cloudflare R2), omits `S3_ENDPOINT`, expects an error. Instead the storage adapter silently falls back to a local-disk MinIO that wasn't started (because `--with-storage` is off). Result: uploads succeed locally on the API pod, files vanish on next deploy. Same shape: `OTEL_EXPORTER_OTLP_ENDPOINT` pointed at a wrong URL silently drops all traces. Direct precedent: `apps/worker/src/index.ts:68` `noopSender` returns `{ delivered: true, reason: "no-op-sender" }` for every email job — Mailpit inbox stays empty forever and TD-13.c (sign-in 403) is the user-visible symptom.

**What goes wrong:**
BYOK config patterns default to "fall back to local" or "no-op if not configured". For a production deployment, both defaults are wrong: the operator wanted external S3 and OTEL, didn't get them, and has no signal.

**Why it happens:**
- Adapter code is usually `endpoint = process.env.S3_ENDPOINT ?? "http://minio:9000"`. The fallback feels developer-friendly but is operator-hostile in prod.
- "Silent drop" is the OTel SDK default for OTLP export failures (intentional: don't kill the app over telemetry). Operator can't tell if traces are flowing.
- `apps/worker/src/index.ts:68-92` ships three noop adapters (`noopSender`, `noopLitellmKeyClient`, `noopUserKeyLookup`) directly in the production entrypoint with no env guard.

**How to avoid:**
- Phase 14 MUST adopt a "loud BYOK" pattern:
  - If `--with-storage` is OFF and `S3_ENDPOINT` is unset → API refuses to start with an explicit error: "Configure S3_ENDPOINT or enable --with-storage".
  - If `OTEL_EXPORTER_OTLP_ENDPOINT` is set but the OTel collector returns non-200 on its `/v1/traces` probe at startup → API logs a one-time WARN with the exact URL it tried.
  - If `--with-observability` is OFF and no `OTEL_EXPORTER_OTLP_ENDPOINT` is set → API logs INFO "observability disabled" at startup so operators can grep for it.
- Phase 14 plan MUST sweep for noop defaults: `apps/worker/src/index.ts:68-92` `noopSender`, `noopLitellmKeyClient`, `noopUserKeyLookup` are ALL this anti-pattern in production code paths. Each must be replaced with a real implementation OR a startup assertion that refuses to start with the noop in production env.
- Documentation MUST list every BYOK env, its prod-required vs prod-optional status, and what happens when it's wrong.

**Warning signs:**
- Code contains `noopX` / `nullX` / `disabledX` adapter implementations imported in the production entrypoint.
- Operator says "I configured S3 but I see files under `/var/lib/...`".
- Tracing dashboard is empty and nobody can tell if traces are dropping or just absent.

**Phase to address:**
**Phase 14** primary (BYOK pattern + slim-core noop audit). **Phase 13** verifies via E2E that misconfigured stack refuses to start, doesn't silently degrade. **TD-mailpit specifically** is owned by Phase 13 (the signup→verify→signin E2E forces the fix).

---

### Pitfall 9: Repo refactor breaks coverage/CI/Makefile paths

**Case study:** Phase 15 risk extrapolation from TD-15.a / TD-15.c / TD-15.d — moving tests next to source (or out of source), moving `docker-compose.*.yml` to `compose/`, moving Helm to its own branch. Each move breaks at least one of: vitest's coverage `include` globs, Makefile recipe paths, GitHub Actions `paths-filter`, Dockerfile `COPY` context, ESLint config relative paths, tsconfig path aliases. Concrete precedent: deferred-items.md #2 — `apps/web/Dockerfile` does `COPY --from=build /app/apps/web/public ./apps/web/public` but the dir doesn't exist in-repo, so `docker compose build web` fails — a path that exists in one place and not another silently breaks the build.

**What goes wrong:**
A "just move the files" PR ships and:
- Coverage drops from 92% to 71% (the new path isn't in `include` so files are unscanned and look 0%).
- CI's `paths-filter` no longer triggers the right job on a file change.
- `docker compose -f docker-compose.embedded-litellm.yml up` works in the README but the file is now at `compose/embedded-litellm.yml`.
- Helm chart users on the old branch get no updates; new branch users have no migration notes.

**Why it happens:**
- Path references are scattered (vitest config, Makefile, .github/workflows/*.yml, Dockerfile, eslint.config.js, tsconfig.json, README, every doc that copy-pastes the compose path).
- A single grep for the old path misses Dockerfile `COPY` lines, GitHub `paths:` filters, and external user docs.

**How to avoid:**
- Phase 15 plan MUST start with an exhaustive path inventory: `grep -r '<old-path>' .` covering every config, every doc, every Dockerfile, every workflow. The list goes in `Phase15-MOVE-INVENTORY.md` as a deliverable BEFORE any move PR.
- Each move is a separate atomic commit (move + update-all-references + verify-CI-green).
- Phase 15 verifier MUST run `make verify` (coverage + lint + test + e2e + build) and assert all four pass at the new paths.
- Compose / Helm relocation MUST ship with a deprecation symlink at the old root path for at least one release: `docker-compose.embedded-litellm.yml -> compose/embedded-litellm.yml`. Document the symlink removal in the FSL relicense commit.

**Warning signs:**
- Phase 15 PR is a "rename" PR with a single commit and 200+ file changes.
- Coverage report goes UP after a refactor (suspicious: tests are no longer scanning the right code).
- A README example still says `docker-compose.yml` after the move.

**Phase to address:**
**Phase 15** — explicit `Phase15-MOVE-INVENTORY.md` artefact before any move.

---

### Pitfall 10: History scrub force-push breaks every downstream clone

**Case study:** TD-15.f — `git filter-repo --path speaches-audio.md --invert-paths` + force-push to `main`. Every fork, every developer with a local clone, every CI cache, every signed commit — all break or get unsigned simultaneously. Branch protection on `main` must be temporarily unlocked.

**What goes wrong:**
- Downstream forks freeze on the pre-scrub commit. PRs into the scrubbed `main` won't merge cleanly because the common ancestor no longer exists.
- Developers with local clones see "your branch is N commits ahead, M commits behind, divergent" — `git pull` fails. They must re-clone.
- Signed commits made via `commit.gpgsign=true` lose their signature (filter-repo rewrites SHAs, signatures become invalid).
- `npm` packages tagged at the old SHAs are now unreproducible — `npm ci` against a lockfile pointing at the old commit fails.
- CI cache keys based on commit SHA are all invalidated; first post-scrub CI run is cold-start expensive.

**Why it happens:**
History scrub is treated as a "git operation", not a release event. The downstream-impact analysis is deferred until after the force-push.

**How to avoid:**
- Phase 15 plan MUST stage the scrub as a release:
  1. Announce in CHANGELOG.md and a pinned GitHub issue 7 days before.
  2. Tag the pre-scrub state as `pre-scrub-2026-MM-DD` so old refs are recoverable.
  3. Document exact instructions for downstream re-clone: `git remote set-url origin <url> && git fetch && git reset --hard origin/main`.
  4. Unlock branch protection, force-push, immediately re-lock.
  5. Re-sign HEAD commit explicitly; warn that mid-history signatures are gone.
- Combine with the FSL relicense in the SAME force-push to avoid two disruptive events.
- Phase 15 verifier MUST confirm: tag created, CHANGELOG updated, branch protection re-locked, downstream instructions in `MIGRATING.md`.

**Warning signs:**
- The scrub plan says "just run filter-repo".
- No `MIGRATING.md` deliverable in Phase 15.
- Branch protection on `main` is never mentioned in the plan.

**Phase to address:**
**Phase 15** — pair with FSL relicense to amortise the disruption.

---

### Pitfall 11: License switch (Apache → FSL) misses surface

**Case study:** TD-15.e — every SPDX header in source (`apps/`, `packages/`, `tools/`), every `package.json` `license` field, the root `LICENSE`, every doc that copy-pastes the license badge, the npm registry metadata if any package is published, every Docker image LABEL.

**What goes wrong:**
LICENSE file flips to FSL, but:
- `package.json` files still say `"license": "Apache-2.0"` → npm install warnings, license-checker CI fails, downstream consumers see mixed signal.
- SPDX headers in individual files still say `// SPDX-License-Identifier: Apache-2.0` → file-level license claim contradicts repo-level. Most permissive wins → legal ambiguity.
- Docker images have `LABEL org.opencontainers.image.licenses=Apache-2.0` → published images claim wrong license.
- Existing contributors haven't signed a DCO / CLA for FSL terms. Pre-FSL contributions are Apache; new contributions need explicit consent.

**Why it happens:**
SPDX is per-file; license is repo-wide; npm metadata is per-package; Docker labels are per-image. A single LICENSE-file edit covers ~1% of the surface.

**How to avoid:**
- Phase 15 MUST run a license codemod covering:
  - Root `LICENSE` (text replacement)
  - `package.json` `license` field in every workspace package
  - SPDX headers in every `.ts`, `.tsx`, `.js`, `.sh`, `.py`, `.sql`, `.yaml`, `.yml` file
  - Docker `LABEL org.opencontainers.image.licenses=`
  - README license badges and links
- Phase 15 MUST add a CONTRIBUTING.md DCO sign-off requirement and a one-time existing-contributor consent thread/issue.
- CI MUST add a license-conformance job: `license-checker` against `package.json` AND a custom script that asserts every source file has the new SPDX header.
- Document: contributions BEFORE commit `<sha>` are Apache-2.0; AFTER are FSL. The commit SHA is recorded in CHANGELOG.

**Warning signs:**
- Phase 15 plan mentions only "update LICENSE file".
- No CONTRIBUTING.md update in the diff.
- `grep -rl "SPDX-License-Identifier: Apache-2.0"` returns >0 after the codemod.

**Phase to address:**
**Phase 15** — license codemod + DCO + CI conformance.

---

### Pitfall 12: Comment audit over-aggression removes WHY

**Case study:** TD-16.a — 1642 `// Phase XX / Plan YY / D-ZZ` comments. The phase-tag part is noise (provenance, not logic). But comments often co-locate WHY explanations: `// Phase 06 — workaround for testcontainers Ryuk leak; do not remove without testing watch-mode reload`. A naive codemod that deletes any line matching `^//.*Phase \d+` kills both the noise AND the WHY.

**What goes wrong:**
Codemod regex matches more than intended:
- Strips legitimate WHY comments that happen to start with "Phase".
- Misses comments inside JSDoc blocks (`* Phase 06 — ...`).
- Misses comments inside template strings (`` `// Phase 06 — ...` ``).
- Misses per-file SPDX headers if Phase 15's relicense codemod doesn't run first.
- Splits into 1642 atomic commits and chokes `git log`, GitHub PR rendering, code review.

**How to avoid:**
- Phase 16 plan MUST start with a sample audit: take 50 random matches, classify each as noise / WHY / mixed. Calibrate the codemod heuristic on the sample.
- Codemod MUST be a structured AST transform, not regex line-match. Use `ts-morph` or `babel` to identify single-line comments adjacent to statements; classify by whether removal changes semantic meaning of surrounding code.
- Codemod output MUST be a single PR with the diff reviewable per-file (so a reviewer can spot-check 50 files of 1642).
- Phase 16 MUST NOT ship as 1642 atomic commits. Either one squashed commit OR group-by-file commits with consistent message format. Each grouped commit ≤ 50 files.
- CI MUST add a "no new phase-tag comments" lint rule going forward so the audit doesn't need to recur.

**Warning signs:**
- Phase 16 codemod is a single regex.
- Sample audit isn't a deliverable.
- The "remove" classifier has no false-positive protection.

**Phase to address:**
**Phase 16** — sample-audit-first, AST-based codemod, lint rule for future.

---

### Pitfall 13: mkcert in CI / mkcert in production

**Case study:** TD-17.a — `mkcert -install` requires sudo and modifies the system trust store. CI runners can't (and shouldn't) do this. Production images definitely can't. The dev `*.localhost` cert flow leaks into prod if not carefully separated.

**What goes wrong:**
- `mkcert` files (`rootCA.pem`, `rootCA-key.pem`) accidentally COPY'd into a prod Docker image → operators inherit a dev CA's private key.
- CI fails because `mkcert -install` requires interactive sudo; team responds by disabling TLS in CI; coverage of the TLS path drops to 0.
- `*.localhost` wildcard cert: not all browsers accept wildcard certs for `*.localhost` (RFC 6761 reserves `.localhost` as a special-use domain; browser behaviour varies — Chrome/Edge are lenient, Safari and Firefox handle it differently).

**How to avoid:**
- Phase 17 plan MUST isolate the dev-cert flow:
  - `mkcert` ONLY in `compose/dev/` overlay, never referenced from the prod compose file.
  - Dockerfile production stage MUST NOT COPY anything from a path that contains mkcert artefacts. CI lints this.
  - `.dockerignore` MUST list `**/rootCA*.pem` to prevent accidental inclusion.
- CI test for TLS path uses a self-signed cert generated by `openssl` at job-start, NOT `mkcert -install`.
- Wildcard cert: list each host explicitly (`api.localhost`, `web.localhost`, `traefik.localhost`, `grafana.localhost`) rather than `*.localhost`. Document the host list in CHANGELOG so operators know what to add to `/etc/hosts`.
- Production ACME (Phase 17 prod path): wire Traefik ACME resolver in `--with-ingress` profile; document cert-manager for K8s.

**Warning signs:**
- Dockerfile prod stage references `mkcert` or copies `rootCA*`.
- CI workflow attempts `sudo mkcert -install`.
- A browser cert warning on prod where Let's Encrypt should be configured.

**Phase to address:**
**Phase 17** — dev-cert isolation + explicit host list + prod ACME wiring.

---

### Pitfall 14: SSO SPEC over-engineering

**Case study:** TD-18.a/b — option (a) Keycloak as OIDC frontend over LDAP, option (b) custom Better Auth LDAP plugin. The SPEC artefact itself can balloon: a 2000-line design doc with sequence diagrams, threat models, deployment recipes — when what the team actually needs is "go with Keycloak; here's why; here are the 3 follow-up open questions".

**What goes wrong:**
- SPEC delivers as a thesis. Implementation phase doesn't open because the SPEC keeps expanding to cover edge cases.
- The two options aren't actually evaluated against operator demand — the team picks based on aesthetic preference, not the corporate-ops survey.
- The SPEC commits to LDAP test fixtures (3 different LDAP servers: OpenLDAP, 389DS, AD) that v3 will then be forced to support.
- Option (b) gets picked despite the LDAP-bind-in-request-path performance trap (binds block the auth-pool, p95 degrades catastrophically).

**How to avoid:**
- Phase 18 deliverable is `SPEC.md`, max 200 lines, structured as:
  - Decision: option (a) or (b) with one paragraph of rationale.
  - Open questions for v3 plan: 3-5 max.
  - Operator survey results (even informal): which corp ops want which option.
  - LDAP server scope for v3: pick ONE (recommend OpenLDAP via testcontainers) and document the explicit non-goal "we don't support 389DS / AD until a paying customer asks".
- Phase 18 MUST NOT include implementation. `/gsd-discuss-phase 18` runs to surface the decision, SPEC.md records it, then v3 takes it.

**Warning signs:**
- Phase 18 SPEC.md is >500 lines.
- The SPEC enumerates LDAP server compatibility matrices.
- No operator survey ran before the SPEC.

**Phase to address:**
**Phase 18** — explicit 200-line cap on SPEC; defer implementation to v3.

---

### Pitfall 15: Re-litigating shipped v1 decisions in v2

**Case study:** TD-12.d — "auth pages are this-session's own free-handed design. Not run through `ui-ux-pro-max` skill. Reference patterns: Supabase / Clerk / Linear sign-in." The temptation: Phase 12 is "auth UX redesign" → free design pass → contradicts the locked Phase 07 `UI-SPEC-end-user.md` (1915 lines) / `UI-SPEC-admin.md` (758 lines) / `design-canvas.jsx` (1437 lines) design contract.

**What goes wrong:**
A "fix" phase quietly re-opens a closed decision. Phase 12 was scoped as **conformance audit + remediation** against the existing 1915-line UI-SPEC. If the team treats it as redesign, the new design conflicts with the contract and Phase 07's verification is invalidated retroactively.

**Same shape:**
- Phase 14 BYOK: tempting to revisit "should we use MinIO at all?" — but the v1 decision was MinIO. Phase 14 makes it OPTIONAL, not REPLACED.
- Phase 15 refactor: tempting to revisit "should we use pnpm workspaces?" — but the v1 decision was pnpm. Phase 15 reorganises, not re-platforms.
- Phase 18 SSO: tempting to revisit "should we use Better Auth at all?" — but `.planning/PROJECT.md` locks Better Auth. Phase 18 adds LDAP to Better Auth, not replaces.

**How to avoid:**
- Every v2 phase plan MUST start with a "Locked from v1" section enumerating decisions the phase is NOT allowed to revisit.
- Phase 12 plan MUST cite specific UI-SPEC line numbers as the conformance target; design-canvas drift is "fix the implementation", not "amend the canvas".
- Verifier MUST flag any phase that touches a `.planning/phases/<v1-phase>/` artefact as a contract amendment (requires explicit `/gsd-discuss-phase` re-opening, not silent edit).

**Warning signs:**
- A v2 phase plan modifies a v1 phase's `SUMMARY.md` or `PLAN.md`.
- A v2 plan introduces a new dependency that replaces a v1-locked one.
- The phase deliverable list includes "Update UI-SPEC" rather than "Update implementation to match UI-SPEC".

**Phase to address:**
**Roadmap-level** (every v2 phase). **Phase 12 explicitly** because it's the most exposed to this trap.

---

### Pitfall 16: Visual regression / a11y test bankruptcy

**Case study:** Phase 12 risk extrapolation — UI-SPEC conformance tests can take two forms: (a) pixel-diff visual regression (Percy / Chromatic / Playwright screenshots), (b) a11y assertion (axe-core). Both fail loudly on shadcn/ui defaults: font hinting differences between local Chrome and CI Chromium produce false-positive pixel diffs; axe flags shadcn's default `<button>` colour contrast or focus-ring on components nobody has customised yet.

**What goes wrong:**
- Visual regression suite goes red on every PR because Inter font renders 1 pixel differently in CI's Chromium. Team responds by lowering the diff threshold to 5% → real visual bugs no longer trigger.
- Axe a11y fails on shadcn defaults. Team responds by suppressing the rule globally → real a11y bugs ship.
- Either way: the conformance harness becomes a noise generator and gets ignored, returning the team to "conformance is whatever the implementation does".

**How to avoid:**
- Phase 12 plan MUST NOT adopt pixel-diff visual regression as the conformance gate. Use semantic conformance instead: assert specific component structure (correct shadcn `Button` variant, exact prop set per design-canvas.jsx) via Playwright DOM queries.
- A11y conformance MUST start from a baseline: run axe once, snapshot current violations, only fail on NEW violations. Existing violations get a dated allowlist with a fix-by deadline.
- Design-canvas drift: any time the implementation deviates, the answer is ALWAYS "fix the implementation". Never "amend the canvas" without an explicit `/gsd-discuss-phase 07` re-opening.

**Warning signs:**
- A PR diff lowers the pixel-diff threshold or adds an axe `disable-rule`.
- Phase 12 plan deliverable includes "update design-canvas.jsx".
- A test marked `// flaky on Linux CI` exists in the visual regression suite.

**Phase to address:**
**Phase 12** — semantic conformance, not pixel-diff; baseline+delta for a11y.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `noopSender` / `noopX` adapters in production entrypoint (TD-mailpit, `apps/worker/src/index.ts:68-92`) | Skips wiring real impl during phase scaffolding | Production silently doesn't send email; user verification dies; user-visible "sign-in 403 with no explanation" (TD-13.c) | NEVER in production code paths. Scaffolding allowed only behind a `NODE_ENV !== "production"` guard that crashes on prod boot. |
| `getAllByText(...).toBeGreaterThan(0)` weak assertion (TD-13.a, SignUpForm.test.tsx:147,165) | Test passes "future-proof" against text changes | Bugs ship green; gaslights debugging | Never. Use `toHaveLength(N)` with exact N. |
| `profiles: [default]` on every service (TD-14.f, deferred-items #3a) | "Explicit profile labelling" feels safer | Bare `docker compose up` selects zero services; quickstart README dies | Never. Universal-on services have no `profiles:` key. |
| Render UI capability without backend availability check (TD-12.c) | Ships faster, fewer roundtrips | 404 → 429 cascade, ratelimit lockout, operator can't recover | Never for env-conditional features. Always query `/api/capabilities`. |
| Self-signed `*.localhost` cert (TD-15.h, TD-17.a) | No dev-machine setup required | Browser cert warning on every first-run; operators lose trust signal | Acceptable in CI; never as the documented dev experience for OSS operators. |
| Co-located `*.test.tsx` next to source (TD-15.a) | Easier for grep-driven dev | Inconsistent with `__tests__/` elsewhere; coverage globs scattered | Acceptable IF policy is uniform across repo. Currently inconsistent — Phase 15 must pick one. |
| Phase-tag comments `// Phase 06 Plan 03 D-12` (TD-16.a) | Auditability during execution | 1642 instances of dead provenance; readers skip the WHY they should read | Acceptable in PLAN.md / SUMMARY.md; not in source code. |
| Apache → FSL via `LICENSE` file only (TD-15.e) | One-line PR | SPDX headers + package.json + Docker labels still claim Apache; legal ambiguity | Never. License switch = full codemod. |
| Force-push `main` without staging (TD-15.f) | Removes secret/embarrassment immediately | Every downstream clone breaks; signed commits invalidated; CI cache cold | Acceptable for security-emergency removal; never for tidy-up. Always stage as a release event. |
| Vitest watch-mode without cleanup hooks (deferred-items #1) | Faster TDD feedback | testcontainers leak wedges Docker VM disk in 2-3 days | Never without `SIGINT`/`SIGTERM` cleanup handlers. |
| Free-design "auth UX redesign" ignoring UI-SPEC (TD-12.d) | Feels creative, fast | Contradicts 4110 lines of locked Phase 07 design contract; invalidates v1 verification | Never. Phase 12 is conformance, not redesign. |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Better Auth + 0 OIDC providers (TD-12.c) | Render Google/GitHub buttons unconditionally → 404 → 429 lockout | `GET /api/auth/providers` capability endpoint; render only configured providers |
| Better Auth `requireEmailVerification` + worker noop (TD-13.c, TD-mailpit) | UI shows generic 403 when verification email never arrived | Replace `noopSender`; surface "verification email not received? resend" CTA on 403 screen |
| Traefik `Host(api.localhost) && PathPrefix(/api)` shadows Next.js API routes (TD-15.g) | Both backend and web have `/api/*`; Traefik routes everything to Fastify; Next.js routes return 404 (e.g. `apps/web/src/app/api/locale/route.ts`) | Either separate hosts (`web.localhost` vs `api.localhost`), delete Next.js API routes (use server actions), or move Next API under `/_next/api/` |
| Docker Compose `profiles: [default]` (TD-14.f) | Tagging every service as `default` profile inverts compose semantics → zero services selected | Universal-on services have NO `profiles:` key |
| testcontainers + vitest watch-mode (deferred-items #1) | Watch-mode reload SIGKILLs node; Ryuk doesn't reap; orphans accumulate | Explicit `afterAll` + SIGINT/SIGTERM handlers; CI `docker prune --filter label=org.testcontainers` in `always()` |
| Mailpit polling in E2E (Phase 13 risk) | Test polls Mailpit before container ready → false failure | Readiness probe `GET /api/v1/messages` returns 200 before scenarios run |
| OTel exporter to wrong endpoint (Phase 14 risk) | OTel SDK silently drops on export failure; observability appears "quiet" | Startup probe to OTLP endpoint; one-time WARN with exact URL if non-200 |
| S3 BYOK with no `S3_ENDPOINT` (TD-14.c) | Silent fallback to local MinIO; files vanish on next deploy | Refuse to start if `--with-storage` off AND `S3_ENDPOINT` unset |
| mkcert in production Dockerfile (TD-17.a) | `COPY` accidentally bundles `rootCA-key.pem` → prod inherits dev CA private key | `.dockerignore` `**/rootCA*.pem`; mkcert files only under `compose/dev/` |
| LDAP via `ldapjs` bind in request path (TD-18.a option b) | LDAP binds block auth-pool, p95 latency degrades catastrophically | Use Keycloak as OIDC frontend; LDAP stays inside Keycloak's connection pool |
| Bcrypt `$` in `.env` shell-interpolation (TD-12.f) | Operator copies `ADMIN_BASIC_AUTH_USERS=admin:$2y$05$...`, shell expands `$2y` to empty, hash corrupts silently | Wizard creates admin via UI; documented bcrypt example uses single-quoted env value |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| E2E suite serial because of shared state | Phase 13 suite takes 45+ min on every PR | Per-scenario tenant + per-scenario mailpit tag; parallel runner | Beyond ~20 scenarios (Phase 13 ships with ~50) |
| Retry-on-flake masks bugs | "Flaky test" issues never close; same scenario retried 3x in CI | Ban retries on Phase 13 suite; flake IS a bug; fix readiness probes | Immediately on first CI flake |
| testcontainers leak fills Docker VM disk | `No space left on device` on Postgres init (deferred-items #1, 30GB volumes) | Vitest cleanup hooks + CI `always()` prune | 2-3 days of TDD on a developer machine |
| BullMQ noop workers (`noopSender`, `noopLitellmKeyClient`, `noopUserKeyLookup` at `apps/worker/src/index.ts:68-92`) | Jobs complete "successfully" in <1ms; queue depth stays 0; user-visible features fail silently | Replace noops or refuse-to-start in prod env | Immediately on first real operator deploy |
| LDAP bind in auth request path (Phase 18 option b) | p95 auth latency 200ms → 2s under load | Keycloak-as-OIDC-frontend (option a) | At ~50 concurrent auth requests |
| 1642 phase-tag comments split into 1642 commits (Phase 16 risk) | `git log` paginates 30+ pages of trivial commits; PR review impossible | Grouped commits ≤ 50 files; single squashed commit alternative | Immediately on PR open |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Bcrypt admin hash in `.env` with no plaintext path (TD-12.b) | Operators can never log in to `/admin`; "break glass" doesn't break the glass; bootstrap is dead-on-arrival | First-run wizard creates admin via Better Auth `users` table; htpasswd documented as break-glass only |
| mkcert `rootCA-key.pem` in production image (TD-17.a) | Adversary with the image extracts the dev CA private key; can MITM any operator's dev environment | `.dockerignore`; CI lint that prod Dockerfile doesn't reference mkcert paths |
| Force-push `main` without re-locking branch protection (TD-15.f) | Window where any maintainer can push unsigned commits to `main` | Lock/unlock/lock sequence in Phase 15 plan; verifier confirms protection re-enabled |
| FSL relicense without DCO sign-off (TD-15.e) | Existing contributors' Apache-licensed work can be challenged as not-FSL-consented; legal ambiguity | CONTRIBUTING.md DCO requirement + one-time consent thread; CI sign-off check on new commits |
| Open-by-default BYOK config (TD-14.c, Phase 14 risk) | Operator omits `S3_ENDPOINT`, files land on ephemeral local disk, lost on next deploy | Refuse to start on misconfigured prod env; log INFO on disabled-by-design |
| `speaches-audio.md` in git history (TD-15.f) | (User-specific) embarrassment/concern surface persists in clones forever | `git filter-repo --invert-paths` staged as release event; CHANGELOG; pre-scrub tag for recovery |
| LDAP credentials in env file (Phase 18) | Bind password readable in `.env`; container image / process listing | Pull from secret store (Docker secret / K8s Secret); Keycloak option keeps LDAP creds out of OpenWhispr's process entirely |
| Ratelimit lockout via own UI (TD-12.c) | UI repeatedly POSTs to `/api/auth/sign-in/social` which 404s, then 429s; operator locked out of their own install | Capability endpoint gate; ratelimit excludes self-induced 404s |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| SSO buttons render with 0 providers (TD-12.c) | Click → 404 → click again → 429 ratelimit; user is locked out | Capability endpoint + conditional render |
| Generic "Invalid input" on Zod validation (TD-13.b) | Operator cannot tell which field failed or what the rule was | Per-field message; localized; "must be at least 8 chars" specifics |
| Sign-in 403 with no resend-verification CTA (TD-13.c, TD-12.e) | User assumes account is broken; abandons | 403 screen surfaces resend CTA + "check spam" + status of verification email job |
| `/admin` returns 404 (TD-12.a) | Operator types the obvious URL, sees 404, assumes admin surface doesn't exist | Index page or redirect to `/admin/config` or `/setup` |
| Bcrypt `$` escape requirement (TD-12.f) | Operator copies the example `.env` line, `$2y$05$` interpolates as shell variable, hash corrupts silently | Wizard creates admin via UI; documented bcrypt example uses quoted env value with explicit escape note |
| Browser cert warning on first `https://*.localhost` (TD-15.h, TD-17.a) | First impression: "this software is unsafe" | mkcert local CA in dev profile; documented one-line setup |
| Compose quickstart that returns "no service selected" (TD-14.f, deferred-items #3a) | OSS operator's first command fails; abandons within 60s | Bare `docker compose up` must work; profiles only on optional services |
| Wizard "skip" path leaves install broken (Phase 12 risk) | Operator skips, can't sign in, can't re-enter wizard | "Skip" only allowed when detectable v1-upgrade; otherwise no skip |
| Duplicate banner rendered twice (TD-13.a, `SignUpForm.tsx`) | Form looks cluttered, untrustworthy; suggests sloppy engineering | Tightened unit test catches it; CJM scenario asserts exact count |

---

## "Looks Done But Isn't" Checklist

For every v2 phase verification, the verifier MUST check:

- [ ] **E2E suite (Phase 13):** Real `docker compose up` (bare, no `--profile`)? Or only `--profile default` invocation? — verify `make e2e-test` boots the stack with no profile flag.
- [ ] **E2E suite (Phase 13):** Every CJM node has both happy-path AND error-path scenarios? — grep `.feature` files for `Then ... 4` / `Then ... 5` status codes; assert count > 0 per feature.
- [ ] **Weak assertion sweep (Phase 13):** `grep -rn "toBeGreaterThan(0)\|toBeTruthy()\|toBeCalled()\b" apps/*/src/**/*.test.*` returns zero?
- [ ] **Capability endpoint (Phase 12):** `GET /api/capabilities` (or per-domain equivalent) exists? UI auth screens query it before rendering SSO buttons?
- [ ] **Wizard idempotency (Phase 12):** E2E test covers fresh install, mid-wizard refresh, upgrade-from-v1, double-run?
- [ ] **Wizard brownfield (Phase 12):** Migration backfills `setup_state.status='skipped_legacy'` for existing v1 installs?
- [ ] **UI-SPEC conformance (Phase 12):** Conformance via semantic Playwright DOM queries, NOT pixel-diff? `design-canvas.jsx` unmodified?
- [ ] **Compose profiles (Phase 14):** `docker compose -f compose/<file> config --services` (no flag) returns the universal-on set?
- [ ] **BYOK loud-fail (Phase 14):** With `--with-storage` off AND `S3_ENDPOINT` unset, API refuses to start with explicit error?
- [ ] **Noop adapter audit (Phase 14):** `grep -rn "noop[A-Z]" apps/worker/src/` returns zero (or each remaining noop has a `NODE_ENV !== "production"` guard)?
- [ ] **Path inventory (Phase 15):** `Phase15-MOVE-INVENTORY.md` exists and CI green at new paths?
- [ ] **License conformance (Phase 15):** `grep -rl "Apache-2.0" apps/ packages/` returns zero; every `package.json` `license` field is FSL?
- [ ] **History scrub (Phase 15):** Pre-scrub tag exists? `MIGRATING.md` updated? Branch protection re-locked?
- [ ] **Comment audit sample (Phase 16):** 50-file sample audit ran before codemod? Codemod is AST-based?
- [ ] **TLS isolation (Phase 17):** `.dockerignore` excludes `rootCA*.pem`? Prod Dockerfile doesn't reference mkcert paths?
- [ ] **SSO SPEC (Phase 18):** `SPEC.md` ≤ 200 lines? Decision (option a/b) recorded? Open questions for v3 listed?
- [ ] **testcontainers cleanup:** After test job, `docker ps -a --filter label=org.testcontainers=true` returns zero?
- [ ] **No re-litigation:** No v2 phase modifies a v1 phase's `SUMMARY.md`/`PLAN.md`/`UI-SPEC*` without explicit `/gsd-discuss-phase` re-opening?

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Weak assertion shipped (TD-13.a recurrence) | LOW | Add the negative-case test (e.g. assert exactly 1 banner), watch it fail RED, fix prod, watch GREEN, ship as one atomic commit |
| testcontainers leak wedged Docker VM | LOW | `docker rm -f $(docker ps -aq --filter "label=org.testcontainers=true"); docker volume prune -af` — restore disk; THEN fix the cleanup hook |
| Compose profile inversion shipped (TD-14.f recurrence) | LOW | Remove `profiles:` from universal services; verify `docker compose config --services` returns expected set |
| Capability drift shipped (TD-12.c recurrence) | MEDIUM | Add capability endpoint; gate UI render; add contract test asserting "0 providers → 0 buttons" |
| Wizard duplicate-admin shipped | MEDIUM | DB cleanup script to dedupe admin rows; `setup_state` migration backfill; release note |
| Repo refactor broke coverage paths | MEDIUM | Restore old paths via symlink; fix vitest `include` globs; re-run coverage; verify against pre-refactor baseline |
| `mkcert` bundled in prod image | HIGH | Rotate the dev CA (any operator who pulled the image has the key); rebuild + republish image; security advisory; document compromise window |
| History scrub force-pushed without staging | HIGH | Apologize publicly; provide explicit re-clone instructions in pinned issue; reach out to known downstream forks; accept that some forks will diverge permanently |
| FSL relicense without DCO | HIGH | Pause acceptance of new contributions; run retroactive DCO consent thread; relicense formally with all consents; document consent timeline in CHANGELOG |
| LDAP via in-request bind shipped (Phase 18 option b regret) | HIGH | Stand up Keycloak in parallel; migrate auth to OIDC via Keycloak; deprecate `ldapjs` plugin over 2 releases |
| Free-design redesign shipped contradicting UI-SPEC | HIGH | Roll implementation back to UI-SPEC; re-do Phase 12 as actual conformance audit; or open `/gsd-discuss-phase 07` to amend the canvas formally |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Weak-assertion patterns (TD-13.a, TD-13.d) | Phase 13 | ESLint rule + grep sweep returns zero matches |
| Happy-path-only Gherkin (TD-13.e) | Phase 13 | CJM.md exists; every CJM error branch has a `.feature` scenario |
| E2E harness flake (deferred-items #1, Phase 13 risk) | Phase 13 | CI runs E2E 10x consecutively; zero retries, zero flakes |
| testcontainers leak (deferred-items #1) | Phase 13 | Post-test `docker ps -a --filter label=org.testcontainers` is empty |
| Capability drift (TD-12.c) | Phase 12 | Contract test "0 providers → 0 SSO buttons" green; capability endpoint exists |
| Bcrypt-in-env (TD-12.b, TD-12.f) | Phase 12 | Wizard E2E covers fresh+upgrade+resume+double-run |
| `/admin` 404 (TD-12.a) | Phase 12 | E2E asserts `GET /admin` redirects or returns index, not 404 |
| Sign-in 403 with no CTA (TD-13.c, TD-12.e) | Phase 12 + Phase 13 | E2E scenario "unverified user signs in" asserts resend CTA visible |
| Zod "Invalid input" (TD-13.b) | Phase 12 | E2E scenario asserts per-field message text for password<8 |
| Free-design redesign (TD-12.d) | Phase 12 | Plan cites UI-SPEC line numbers; `design-canvas.jsx` unmodified |
| Visual regression / a11y bankruptcy (Phase 12 risk) | Phase 12 | Semantic Playwright DOM queries, not pixel-diff; baseline+delta for axe |
| `noopSender` in prod (TD-mailpit, `apps/worker/src/index.ts:68`) | Phase 13 (E2E forces fix) + Phase 14 (loud-fail audit) | E2E signup→verify→signin green; `grep noopX apps/worker` returns zero in prod path |
| Compose profile inversion (TD-14.f, deferred-items #3a) | Phase 14 | `docker compose up --wait` (no flag) starts universal services |
| BYOK silent fallback (TD-14.c, plus extrapolations to OTEL) | Phase 14 | Startup test: missing required env → refuse to start with explicit error |
| Mailpit in prod (TD-14.a) | Phase 14 | `compose/prod.yml` does not include mailpit; `compose/dev.yml` does |
| Traefik `/api/*` shadowing (TD-15.g) | Phase 15 | E2E hits Next.js API routes successfully OR routes are deleted |
| Tests interleaved (TD-15.a) | Phase 15 | Policy doc + uniform layout across repo |
| Repo path-refactor breaks CI (Phase 15 risk) | Phase 15 | `Phase15-MOVE-INVENTORY.md` deliverable; CI green at new paths |
| License surface miss (TD-15.e) | Phase 15 | `grep -rl Apache-2.0` returns zero across all artefact types |
| History scrub downstream-break (TD-15.f) | Phase 15 | Pre-scrub tag + MIGRATING.md + branch-protection lock sequence verified |
| `apps/web/public/` missing (deferred-items #2) | Phase 15 | `.gitkeep` committed OR Dockerfile COPY conditional |
| Comment audit over-aggression (TD-16.a) | Phase 16 | Sample audit + AST codemod + reviewer-friendly PR |
| mkcert in prod (TD-17.a) | Phase 17 | `.dockerignore` excludes `rootCA*`; prod Dockerfile lint passes |
| `*.localhost` wildcard non-RFC | Phase 17 | Explicit host list documented; browser smoke on Chrome+Firefox+Safari |
| SSO SPEC bloat (TD-18.b) | Phase 18 | SPEC.md ≤ 200 lines; decision recorded; no implementation in scope |
| Re-litigating v1 decisions (cross-cutting) | Every v2 phase | Plan has "Locked from v1" section; verifier flags any v1-artefact edits |

---

## Cross-phase Pitfalls

These pitfalls block multiple downstream phases. Roadmapper must order accordingly.

1. **Phase 13 harness flake = every subsequent phase verification is unreliable.** Without trustworthy E2E, Phases 12/14/15/16/17/18 cannot prove their fixes work. Phase 13 readiness-probe sub-plan is the highest-leverage v2 deliverable after CJM.md.

2. **testcontainers leak = developer machines unusable within 2-3 days.** Once Phase 13 ships Playwright + testcontainers heavily, the leak compounds 10x. Must be fixed in Phase 13, not deferred again.

3. **`/api/capabilities` endpoint (Phase 12) feeds Phase 14 BYOK UI.** If Phase 12 doesn't establish the capability-query pattern, Phase 14 has to re-invent it for `--with-observability` / `--with-storage` UI gates.

4. **Repo refactor (Phase 15) invalidates path references in Phase 13's E2E harness.** Order: Phase 13 ships first with current paths; Phase 15 includes "update E2E paths" as part of the move inventory.

5. **FSL relicense (Phase 15) + history scrub (Phase 15) should ship as one release event** to amortise the downstream-clone disruption to one moment, not two.

6. **Comment audit (Phase 16) MUST run AFTER Phase 15** because Phase 15's relicense codemod rewrites every SPDX header. Running Phase 16 first means re-doing the comment sweep after Phase 15.

7. **Trusted TLS (Phase 17) interacts with `--with-ingress` (Phase 14).** Phase 14 establishes the ingress-on/off flag; Phase 17 wires ACME into the on-path. Order: 14 then 17.

8. **SSO SPEC (Phase 18) depends on `/api/capabilities` (Phase 12)** because OIDC providers are exactly the kind of conditional UI capability that drove TD-12.c. Phase 18's SPEC must reference the Phase 12 endpoint.

---

## Sources

- `.planning/TECH_DEBT.md` — primary input; every TD-XX.y entry is a case study cited inline.
- `.planning/deferred-items.md` — items 1, 2, 3a, 3b — testcontainers, web/public dir, compose profile, hygiene.
- `.planning/PROJECT.md` — engineering-discipline rules 1-10 (TDD, 90% coverage, E2E mandatory, no internal mocks) — the floor every pitfall prevention must clear.
- `apps/worker/src/index.ts:66-92` — `noopSender`, `noopLitellmKeyClient`, `noopUserKeyLookup` — three concrete noop-in-prod-path instances.
- `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx:147,165` — `toBeGreaterThan(0)` weak-assertion case studies.
- `.planning/phases/07-frontend-ui-spec/UI-SPEC-end-user.md` + `UI-SPEC-admin.md` + `design-canvas.jsx` — the locked design contract Phase 12 conforms to (cited via TD-12 framing).
- 2026-05-14 stack-up smoke walkthrough session — the empirical source for all symptoms.

---
*Pitfalls research for: v2 production-readiness on a brownfield repo*
*Researched: 2026-05-14*
