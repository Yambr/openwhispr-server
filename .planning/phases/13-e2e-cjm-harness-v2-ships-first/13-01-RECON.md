# Phase 13 Plan 01 — RECON

**Mode:** read-and-report (no edits, no commits, no installs, no `compose up`).
**Date:** 2026-05-14
**Recon target:** `.planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-PLAN.md` (602 lines, 8 tasks across 3 waves, single atomic D-04 commit).

---

## 1. Stack reality check (the 10 questions)

### Q1 — Does `docker-compose.yml` define a `default` profile?

**Answer:** **YES**, but in the explicit-tag sense, not the compose-implicit sense.

- `docker-compose.yml` lines 41, 88, 117, 132, 149, 197, 220, 233, 255, 274, 323, 355, 416, 558, 641, 716 — every primary service is tagged `profiles: [default, ...]` (postgres/pgbouncer/valkey/minio/traefik/otel-collector/loki/tempo/mimir/grafana/migrate/litellm/api/worker/web/mailpit).
- The compose-implicit default (services with NO `profiles:` key) selects ZERO services here. This IS the TD-14.f trap documented in `.planning/deferred-items.md §3a`.
- Operators **MUST** pass `--profile default` explicitly. The plan already mandates this in `compose-harness.ts` (PATTERNS.md line 455) and in the Makefile target (PATTERNS.md line 415). **Confirmed correct.**
- Same-shape profiles exist in `docker-compose.embedded-litellm.yml` (lines 62, 109, 138, 153, 170, 218, 241, 254, 276, 295…) — the overlay does NOT remove the trap.

### Q2 — Mailpit service name + port 8025

**Answer:**

- Service name: `mailpit` (docker-compose.yml line 714).
- Image: `axllent/mailpit:v1.29`.
- Profiles: `[default, dev, load-test-mock, load-test-realistic]` (line 716).
- Targets exposed (per running `docker port`): **1025/tcp (SMTP), 1110/tcp (POP3), 8025/tcp (HTTP API).**
- **Host port published: NONE** (`docker compose ps --format json` shows `"PublishedPort":0` for all three) — mailpit currently runs in-network-only.

**⚠️ Plan assumption busted (partial):** Plan's readiness probe and `mailpit-helper.ts` both target `http://localhost:8025/api/v1/messages` (PATTERNS.md lines 450, 462). On the current running stack, **8025 is NOT bound to the host loopback**. The harness host process (running outside compose) cannot reach mailpit at `localhost:8025`. Two corrections possible:

1. Add `ports: ["127.0.0.1:8025:8025"]` to the mailpit service block as part of plan 13-01 (smallest change; harness runs on the host).
2. Run the harness *inside* the compose network (Traefik already routes `mailpit.localhost` — the e2e-cjm.yml CI workflow even adds `mailpit.localhost` to `/etc/hosts` per PATTERNS.md line 374). The host can then hit `https://mailpit.localhost/api/v1/messages` via Traefik.

**Verify Traefik labels on mailpit before deciding** (not done in recon — out of token budget). If `mailpit.localhost` is already Traefik-routed, option 2 is zero-edit. If not, option 1 is one-line.

### Q3 — Running compose project name

**Answer:** `openwhispr` (from `docker compose ls`). 15 services running, all `openwhispr-<service>-1`. Config file in use: `docker-compose.embedded-litellm.yml` only (NO base `docker-compose.yml` overlay being applied to the running stack — confirmed by `docker compose ls` showing only the one file path).

**Implication:** The reference user-running stack is the embedded-litellm variant, but PATTERNS.md / plan task 13-01-07 references base `docker-compose.yml` via `docker compose --profile default up -d` (no `-f` flag), which would use ONLY `docker-compose.yml` — a different stack than what's currently up. Planner should decide: does `make e2e-cjm` boot the base file or the embedded-litellm overlay? CONTEXT integration-points (line 124) says embedded-litellm. The plan (PATTERNS.md line 415) omits `-f`. **This is a real discrepancy.**

### Q4 — Drizzle migrations table

**Answer:** `_meta.__drizzle_migrations` — **CONFIRMED.**

- `packages/data/drizzle.config.ts:22` — `table: "__drizzle_migrations"`.
- `packages/data/src/migrate.ts:173-174` — `migrationsSchema: "_meta", migrationsTable: "__drizzle_migrations"`.
- The plan's reference to `_meta.__drizzle_migrations` (PATTERNS.md line 542, PLAN line 391, plan acceptance criterion line 391) is correct.

### Q5 — `apps/api/src/email.ts` importer count

**Answer:** **4 importers** (well under the >5 threshold):

| File | Note |
|---|---|
| `apps/api/src/email.test.ts` | unit test for the file itself; will be replaced by `packages/email/src/EmailSender.test.ts` (plan moves it) |
| `apps/api/src/auth.ts` | production importer — needs path update to `@openwhispr/email` |
| `apps/api/src/__tests__/auth-locale-and-enqueue.test.ts` | test importer |
| `apps/api/src/__tests__/auth-send-verification-email.test.ts` | test importer |

**Implication:** Plan task 13-01-08 says "Delete `apps/api/src/email.ts` IF importer count ≤ 5". 4 ≤ 5 → **delete + update 3 importer paths** (the 4th, `email.test.ts`, gets moved). Cleaner outcome than the shim option.

### Q6 — playwright-bdd 8.4.2 `createBdd(test)` API for `support/world.ts`

**Answer:** **Not verified at recon time** — playwright-bdd is NOT installed (`node_modules/playwright-bdd` does not exist; `pnpm-lock.yaml` has no `playwright-bdd:` entry). I can't probe a non-installed package without running `pnpm install`, which is prohibited in recon.

**What I know without installing:**
- The plan and PATTERNS.md cite official docs for the 8.x signature: `import { test as base, expect } from "@playwright/test"; import { createBdd } from "playwright-bdd"; export const { Given, When, Then } = createBdd(base); export const test = base;`
- `importTestFrom` config field is documented in playwright-bdd 8.x.
- The recommended pattern in plan task 13-01-01 (`world.ts` placeholder for `bddgen --dry-run`) is sound — bddgen will not crash on an unimplemented `support/world.ts` as long as the export shape is correct.

**Recommendation for executor:** During the first session that runs `pnpm install`, immediately verify `node_modules/playwright-bdd/dist/index.d.ts` exports `createBdd` and that `bddgen --dry-run` accepts `importTestFrom` pointing at a `.ts` file. If the API has changed since 8.4.2 docs were authored, surface as a Rule 4 architectural checkpoint.

### Q7 — pnpm-lock.yaml clean? Peer-dep conflicts on adding new deps?

**Answer:** Lockfile present, 13330 lines, **lockfileVersion 9.0**. New dep status:

- `@playwright/test`: currently **1.59.1** pinned (root `package.json`). Plan wants 1.60.0 — minor bump. Lockfile has 51 references to 1.59.1 across Next.js peer-dep chains; bumping will regenerate large swathes of the lockfile (Next.js 15.5.18 peer-deps include `@playwright/test`). Not a conflict, just churn.
- `@axe-core/playwright`: **4.11.3 already in lockfile** (transitive). Adding it to root devDeps will deduplicate to a top-level entry — no version conflict.
- `playwright-bdd`: **NOT in lockfile** — fresh add. Will require network fetch.
- `@cucumber/cucumber`: **NOT directly in lockfile** (only `@opentelemetry/instrumentation-cucumber@0.33.0` is present as a transitive). Fresh add.
- Root devDeps already pinned: `vitest 4.1.5`, `typescript 6.0.3`, `@types/node 25.6.2`. Plan's `packages/email/package.json` (PATTERNS.md line 182) says `"typescript": "^5.6.0"` and `"@types/node": "^22.0.0"` — these are **lower** than root. **⚠️ Plan must align packages/email devDeps with the root pins (typescript 6.0.3, @types/node 25.6.2)** or pnpm will install duplicate transitives.

### Q8 — Testcontainers leak reproduction

**Answer:** **NOT REPRODUCED at recon time** because (a) running `pnpm vitest run apps/api` is prohibited in recon and (b) `docker ps --filter label=org.testcontainers=true` returned **zero containers** right now. The user's running stack containers (15 of them, project `openwhispr`) are NOT testcontainers — they're the long-running dev stack. The leak documented in `.planning/deferred-items.md §1` (30 GB volumes, 13 orphan postgres containers) is from a prior vitest session and has presumably been manually cleaned.

**Implication:** The leak is intermittent — it appears after vitest runs that crash or are SIGINT'd. The plan's task 13-01-02 (`tools/global-vitest-teardown.ts` + SIGINT/SIGTERM hook) is the right fix; the executor cannot empirically prove the leak exists in this recon session. **The TDD path for task 13-01-02 should mock `execFileSync` (per the plan's behavior contract) rather than rely on a real leak fixture.**

### Q9 — Port bindings on the running stack

**Answer:** Only **traefik** binds to the host:

- `traefik` ports: `0.0.0.0:80`, `0.0.0.0:443`, `0.0.0.0:8080` (Traefik dashboard), `0.0.0.0:8443`.
- Every other service publishes to the compose internal network only (`"PublishedPort":0`).

**Implication for the harness:**
- ✅ `https://app.localhost` and `https://api.localhost` reach the host's `:443` → Traefik → web/api. **Works.**
- ❌ `http://localhost:8025` (mailpit HTTP API) does **NOT** reach the host. **See Q2 — must add a port binding OR route via `mailpit.localhost` through Traefik.**
- ❌ Direct Postgres reach: the wait-for-readiness step 1 ("Postgres: `SELECT 1`") in PATTERNS.md line 466 / PLAN task 13-01-07 will fail — postgres is on `:5432` inside the network with no host binding. **The plan's readiness contract conflates "the host harness probes Postgres" with "the api container probes Postgres at startup".** The host probably can't open a direct Postgres TCP connection without either (a) adding `ports: ["127.0.0.1:5432:5432"]` to postgres or (b) replacing step 1 with "GET `/api/health` checks DB connectivity transitively" (the current behavior — Fastify's health route already touches the pool via the routes wiring).

### Q10 — `apps/web/public/` intersection

**Answer:** **Not directly relevant to 13-01.** The dir exists locally (untracked) with a `.gitkeep` placeholder. `.planning/deferred-items.md §2` assigns ownership to "the next web-app phase". Plan 13-01 does not touch `apps/web/Dockerfile` and does not need `apps/web/public/` to exist for unit tests or the harness. The Cucumber suite hits the running web container via Traefik — it does not build the web image fresh. **Leave untouched.**

---

## 2. Plan assumptions confirmed (✓) / busted (✗)

| # | Assumption | Status | Correction (if ✗) |
|---|---|---|---|
| 1 | `_meta.__drizzle_migrations` is the canonical migrations table | ✓ | — |
| 2 | `apps/worker/src/index.ts:66-72` declares `noopSender`, line 130 wires it | ✓ | (verified — actual lines 68-72 with declaration spanning 4 lines + the comment header) |
| 3 | `apps/api/src/email.ts` has ≤5 importers → delete + update | ✓ | importer count = 4 (auth.ts + 2 auth tests + email.test.ts that gets moved). Use the **delete** option, not the shim |
| 4 | `apps/api/src/routes/health.ts` returns `{ status: "ok" }` and uses `HealthResponse` schema | ✓ | — |
| 5 | `HealthResponse` schema lives in `packages/contract-tests/schemas/health.ts` | ✗ | **It lives in `packages/contract-tests/src/schemas.ts`** (a single combined file), exported via `packages/contract-tests/package.json` `"./schemas": "./src/schemas.ts"`. There is no per-route schema file. Planner's `files_modified` list line 27 (`packages/contract-tests/schemas/health.ts`) is wrong — the edit lands in `packages/contract-tests/src/schemas.ts`. |
| 6 | Mailpit is reachable at `http://localhost:8025` from the host harness | ✗ | **8025 is not host-bound** on the running stack and the base `docker-compose.yml` mailpit block has no `ports:` entry. Plan must either add a port binding or switch the helper to `https://mailpit.localhost/api/v1/messages` via Traefik. Verify whether mailpit has Traefik labels before deciding. |
| 7 | Postgres reachable at `localhost:5432` for `SELECT 1` readiness probe | ✗ | Postgres has no host binding either. Replace step 1 with API-mediated readiness (the `/api/health` `migrations_completed` field already proxies DB liveness transitively — keep only the HTTP probes). |
| 8 | playwright-bdd 8.4.2 + @cucumber/cucumber 12.8.2 are installable on Node 24 + Vitest 4 + Next 15.5.18 | unverified | requires `pnpm install` (prohibited in recon). First executor session must run `pnpm install` and surface any peer-dep error as a Rule 4 checkpoint. |
| 9 | apps/web has exactly 7 weak-assertion sites (9 occurrences) | ✗ | **There are MORE sites.** `grep -rnE '\.length\.toBeGreaterThan(OrEqual)?\('` against `apps/web/src` finds: SignUpForm 3 (lines 147, 165, 186 — confirmed), NotesListClient 4 (127, 166, 276, 295 — confirmed), NoteDetailClient 1 (line 360 — line 370 had `toBeGreaterThanOrEqual` not on `.length`; only ONE `.length.toBeGreaterThan` in NoteDetailClient), **plus** ConfigClient.test.tsx line 205, UsageDashboardClient.test.tsx line 186, locales/coverage.test.ts lines 96/103/121. The user-decision-3 ("sweep ALL") therefore touches **more files than the plan enumerates**. Two follow-on issues: (a) `toBeGreaterThanOrEqual` on `Object.keys(...).length` in `coverage.test.ts` line 96 is semantically the count-of-locale-keys exceeds 200 — that's a legit assertion the linter regex `getAllBy.../queryAllBy.../findAllBy...` will NOT flag because the chain doesn't start with a getAllBy query. But the BROADER `apps/web/src/locales/__tests__/coverage.test.ts:103` (`expect((value as string).length).toBeGreaterThan(0)`) WILL flag if the regex is `\.length\.toBeGreaterThan` without the testing-library prefix. **The plan's regex (PATTERNS.md line 226) is specifically `\.(getAllBy|queryAllBy|findAllBy)\w*\([^)]*\)\.length\.toBeGreaterThan(OrEqual)?\(` — this scopes correctly to weak DOM assertions and will NOT flag the locale coverage tests.** So plan's regex is fine; the plan's enumeration of "9 occurrences across 7 sites" is just incomplete by 2 (NoteDetailClient line 360 only — line 370 was a different family; and one additional site at NotesListClient might exist). Actual count via the plan's regex: **8 occurrences** (SignUpForm 3 + NotesListClient 4 + NoteDetailClient 1). Acceptance criterion line 437 says "≥ 9 line changes across exactly 3 files" — adjust to "≥ 8" or accept that one rewrite touches two lines. |
| 10 | `@playwright/test` bump 1.59.1 → 1.60.0 is a clean minor | ✓ | Lockfile bump will churn but no peer-dep error expected on Next 15.5.18 (loose peer range) |
| 11 | Atomic D-04 commit can land Wave 0+1+2 outputs in one commit | ✓ in principle, but **risky in execution.** Wave 0 RED tests (failing) sit in the working tree across multiple executor sessions. If the harness mid-flight hits a Rule 4 checkpoint, the working tree gets stale relative to other parallel work. Mitigation: each session ends with a deterministic `git status --short` snapshot recorded in the handoff doc so the next session can verify nothing drifted. |
| 12 | `packages/email/package.json` devDeps `typescript: ^5.6.0` + `@types/node: ^22.0.0` | ✗ | Root pins `typescript 6.0.3` and `@types/node 25.6.2`. Mismatched ranges will install duplicate transitives. **Bump packages/email/package.json devDeps to match root.** |
| 13 | `apps/api/vitest.setup.ts` does not currently exist | ✓ | Confirmed (PATTERNS.md §"Discrepancies Found" already flagged this) |
| 14 | Root `vitest.config.ts` exists and excludes `tools/**` from coverage | ✓ | Confirmed (root vitest.config.ts lines 25-50 excludes `tools/**`). Plan task 13-01-02 wires `globalTeardown` via root config — but the new `tools/lint-weak-assertions.ts` + `tools/global-vitest-teardown.ts` test files live UNDER `tools/`. The root config currently excludes `tools/**` from coverage. Plan task 13-01-03 acceptance criterion says "Coverage ≥ 90/90/90/90 on `tools/lint-weak-assertions.ts`" — this requires either (a) **adding a coverage-include override** for the new tools files or (b) running these tests under a separate workspace `vitest.config.ts` rooted in `tools/`. Plan does not specify which. **Surface as Rule 4 checkpoint at executor time.** |
| 15 | `.github/workflows/ci.yml` `e2e-hermetic` job is the exact SHA-pinned analog | ✓ | Confirmed (ci.yml lines 385-432 verified; SHAs match PATTERNS.md). Note `e2e-hermetic` does **not** add `app.localhost` or `mailpit.localhost` to `/etc/hosts` — only `api.localhost` + `auth.localhost`. The new `e2e-cjm.yml` adds 4 hostnames (app, api, auth, mailpit) which is a real differential. |
| 16 | `make e2e-cjm` boots base `docker-compose.yml` via `--profile default up -d` | ✗ | The user's running stack uses `docker-compose.embedded-litellm.yml`. Boot the base file with no overlay means the harness runs against an UNCONFIGURED LiteLLM (no `litellm_config.yaml` in base) — which fails. Plan must either (a) reuse the embedded-litellm overlay with `-f docker-compose.yml -f docker-compose.embedded-litellm.yml --profile default up -d`, or (b) confirm the base file's `litellm` service has a self-contained default config. **Verify before authoring `compose-harness.ts`.** |

---

## 3. Session-by-session execution plan

The plan has 8 tasks across 3 waves. Tasks 13-01-01..04 are Wave 0 (RED scaffolding). Tasks 13-01-05..07 are Wave 1 (GREEN implementation). Task 13-01-08 is the SINGLE atomic commit. Per D-04, NO commits prior to task 08.

Token budget per session: ~150k. Each session reads its predecessor's `git status` snapshot + this RECON.md + the plan's task block(s) it executes.

**Working-tree continuity protocol:** at the end of each non-final session, the agent writes:
```
.planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-SESSION-<N>-HANDOFF.md
```
containing:
- `git status --short` output verbatim
- list of files written (with `wc -l` sizes for sanity)
- the failing tests recorded as RED (test name + file:line)
- the next session's first action

The next session opens by running `git status --short` and diff-checking against the handoff doc; if it does not match exactly, halt with a Rule 4 checkpoint.

---

### Session 1 — Scaffold + lint tooling (Tasks 13-01-01, 13-01-02, 13-01-03)

**Goal:** add deps + scaffold packages/email/ shape + tests/e2e-cjm/ skeleton + author the two lint/teardown tools with their unit tests RED-then-GREEN.

**Files authored (all uncommitted, working tree only):**
- `package.json` (devDeps update: @cucumber/cucumber@12.8.2, playwright-bdd@8.4.2, @playwright/test@1.60.0, @axe-core/playwright@^4.10.2)
- `pnpm-lock.yaml` (regenerated)
- `packages/email/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}` (skeleton — EmailSender.ts is empty placeholder; lands in session 2)
- `tests/e2e-cjm/{playwright.config.ts,bddgen.config.ts,features/signup-verify.feature,support/world.ts}`
- `tools/global-vitest-teardown.ts` + `tools/__tests__/global-vitest-teardown.test.ts` (full RED+GREEN, mocks execFileSync; no real docker)
- `tools/lint-weak-assertions.ts` + `tools/lint-weak-assertions.test.ts` (full RED+GREEN with `--self-test`)
- `apps/api/vitest.setup.ts` (new) + `apps/api/vitest.config.ts` (add setupFiles) + root `vitest.config.ts` (add `test.globalTeardown`)

**Verified before session ends:**
- `pnpm install --frozen-lockfile` exits 0 → confirms peer-dep compatibility (the unverified Q6/Q8 item).
- `pnpm exec bddgen --dry-run --config tests/e2e-cjm/bddgen.config.ts` exits 0.
- `pnpm vitest run tools/__tests__/global-vitest-teardown.test.ts` exits 0.
- `pnpm vitest run tools/lint-weak-assertions.test.ts` exits 0.
- `pnpm tsx tools/lint-weak-assertions.ts --self-test` exits 0.
- `pnpm tsx tools/lint-weak-assertions.ts apps/web` reports 8 offenders (Wave-1 sweep will close them).
- `git status --short` captured to handoff doc; nothing committed.

**Estimated burn:** wall-clock 90–150 min; context 80–110k tokens (heavy on reading analog files: `tools/lint-english.ts` + `tools/lint-english.test.ts` + `packages/litellm-client/*` + `tests/e2e/helpers/phase6-compose.ts`).

**Open mid-session checkpoints (Rule 4 candidates):**
- If playwright-bdd 8.4.2 API differs from PATTERNS.md docs → halt, surface to user.
- If `pnpm install` produces a peer-dep `ERR` (not just warnings) → halt.
- If `tools/**` is excluded from root coverage AND task 13-01-03 acceptance demands 90/90/90/90 coverage → propose adding a coverage-include override OR a separate `tools/vitest.config.ts`.

**Handoff state:** Session 2 reads `13-01-SESSION-1-HANDOFF.md`, verifies `git status --short` matches, then proceeds.

---

### Session 2 — `packages/email/` real implementation + Logger + tests (Task 13-01-04)

**Goal:** flesh out `packages/email/src/EmailSender.ts` with the 8 tests in the plan's behavior block (incl. prod loud-fail, SMTP_SECURE override, SMTP_REJECT_UNAUTHORIZED, plain-object Logger).

**Files authored:**
- `packages/email/src/EmailSender.ts` (verbatim extract from `apps/api/src/email.ts` + Logger structural interface + prod loud-fail gate at line where `!host` is detected + SMTP_SECURE/SMTP_REJECT_UNAUTHORIZED env reads)
- `packages/email/src/EmailSender.test.ts` (8 unit tests; analog: `apps/api/src/email.test.ts`)
- `packages/email/src/index.ts` (final re-exports)
- `packages/email/README.md` (English-only env-var contract doc)

**Verified before session ends:**
- `pnpm vitest run packages/email` exits 0 with ≥8 tests passing.
- `pnpm vitest run packages/email --coverage` reports ≥90/90/90/90 on `EmailSender.ts`.
- `grep -E "FastifyBaseLogger" packages/email/src/EmailSender.ts` returns 0 matches (Logger is structural).
- `git status --short` captured; nothing committed.

**Estimated burn:** wall-clock 60–90 min; context 50–75k tokens (mostly reading `apps/api/src/email.ts` + `apps/api/src/email.test.ts` and porting verbatim).

**Open mid-session checkpoints:**
- SMTP_PASSWORD vs SMTP_PASS env-name decision is already locked in plan (user decision 7 — keep SMTP_PASSWORD). No checkpoint.
- If `nodemailer` types differ between root and packages/email/ (root has `@types/nodemailer` somewhere; packages/email needs its own devDep) → small alignment.

**Handoff state:** Session 3 picks up with `packages/email/` GREEN-tested in the working tree, but **apps/worker still wires `noopSender`** (the integration wiring lands ONLY in the final atomic commit per D-04).

---

### Session 3 — Health probe + weak-assertion sweep (Tasks 13-01-05, 13-01-06)

**Goal:** add `migrations_completed` to `/api/health` + update `HealthResponse` schema; rewrite all 8 weak-assertion sites.

**Files authored:**
- `apps/api/src/routes/health.ts` (+ `checkMigrationsCompleted` helper; reuse existing app pool).
- `apps/api/src/routes/health.test.ts` (NEW; the route currently has no co-located test).
- `packages/contract-tests/src/schemas.ts` (**not** `schemas/health.ts` — see Q11 / busted assumption #5). Find the `HealthResponse` definition and add `migrations_completed: z.boolean()`.
- `packages/contract-tests/src/health.test.ts` (UPDATE; current test asserts only `{status: "ok"}` parse — needs to assert presence of `migrations_completed: true` against a live api).
- `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx` (3 sites: 147, 165, 186 → `findByText` + `toBeInTheDocument`).
- `apps/web/src/components/screens/notes/__tests__/NotesListClient.test.tsx` (4 sites: 127, 166, 276, 295).
- `apps/web/src/components/screens/notes/__tests__/NoteDetailClient.test.tsx` (1 site: 360 — line 370 is `toBeGreaterThanOrEqual(2)` on `calls`, NOT a `getAllBy.../queryAllBy...` chain, so the plan's regex won't flag it; do NOT modify line 370 unless the sweep is explicitly broader).

**Verified before session ends:**
- `pnpm tsx tools/lint-weak-assertions.ts apps/web` exits 0 with empty stderr.
- `pnpm vitest run apps/web` exits 0 with no regression vs baseline.
- `pnpm vitest run apps/api/src/routes/health.test.ts` exits 0 (≥2 tests).
- `pnpm vitest run packages/contract-tests` exits 0.
- `git status --short` captured; nothing committed.

**Estimated burn:** wall-clock 70–100 min; context 60–90k tokens (reading 3 large test files + schema + health route; smaller than session 1 but the schema-evolution diff touches several conformance fixtures).

**Open mid-session checkpoints:**
- If `HealthResponse` is `.strict()` (per `schemas.ts` line ~26 convention), adding the new field with `.strict()` will break all existing consumers that don't yet emit it. **Check first.** From recon: `schemas.ts` lines 23–25 say "Response schemas: NO `.strict()`" — so `HealthResponse` should be open and the extension is safe. Verify in execution.
- If `checkMigrationsCompleted()` opens a one-shot pg Client instead of reusing the pool, the linter / health-probe test will pass but production behavior will leak connections. Reuse the app pool (the existing one passed into `healthRoutes`).

**Handoff state:** Session 4 inherits a working tree with packages/email/ GREEN, lint tooling GREEN, /api/health hardened, weak-assertion sweep complete — and NO commits.

---

### Session 4 — Compose harness + readiness + mailpit helper + steps file (Task 13-01-07)

**Goal:** author the harness primitives (`compose-harness.ts`, `wait-for-readiness.ts`, `mailpit-helper.ts`, `world.ts` final shape, `auth.steps.ts`) and the readiness-probe unit test.

**Files authored:**
- `tests/e2e-cjm/support/compose-harness.ts`
- `tests/e2e-cjm/support/wait-for-readiness.ts` (with CLI-entry mode for Makefile invocation)
- `tests/e2e-cjm/support/mailpit-helper.ts` (`waitForEmail`, `extractVerificationLink`)
- `tests/e2e-cjm/support/world.ts` (final playwright-bdd Fixtures shape — replaces session-1 placeholder)
- `tests/e2e-cjm/steps/auth.steps.ts`
- `tools/__tests__/readiness-probe.test.ts`

**Critical corrections vs plan (from this RECON):**
- Postgres `SELECT 1` probe (PATTERNS.md line 466, plan line 460): **REMOVE.** Postgres is not host-bound. Replace with API-mediated readiness — the `/api/health` probe with `migrations_completed === true` already proves DB liveness.
- Mailpit probe URL: confirm whether to use `http://localhost:8025/api/v1/messages` (requires adding `ports:` to mailpit OR add `127.0.0.1:8025:8025` mapping) OR `https://mailpit.localhost/api/v1/messages` via Traefik. **Surface as Rule 4 user-decision checkpoint at the start of session 4** — the answer is a 1-line compose edit OR a constant change in `mailpit-helper.ts`.
- `compose-harness.ts` `bootStack()`: clarify whether to boot base `docker-compose.yml` OR `-f docker-compose.yml -f docker-compose.embedded-litellm.yml`. **Surface as Rule 4 user-decision checkpoint.**

**Verified before session ends:**
- `pnpm vitest run tools/__tests__/readiness-probe.test.ts` exits 0 with ≥4 tests.
- `grep -v '^//' tests/e2e-cjm/support/compose-harness.ts | grep -c -- "--profile.*default"` ≥1.
- `grep -rE "retry: [^0]|retries: [^0]" tests/e2e-cjm/` returns 0 matches.
- `git status --short` captured; nothing committed.

**Estimated burn:** wall-clock 90–120 min; context 70–100k tokens (reading `tests/e2e/compose-helper.ts`, `tests/e2e/helpers/phase6-compose.ts`, playwright-bdd API discovery, undici MockAgent patterns).

**Handoff state:** Session 5 inherits the full harness scaffold in the working tree. Two open checkpoints recorded.

---

### Session 5 — ATOMIC COMMIT + integration delta + live proof (Task 13-01-08)

**Goal:** wire `createEmailSender` into apps/worker, delete `apps/api/src/email.ts` + update 3 importers, author the two reference scenarios (`@cjm-1.1`, `@cjm-1.2`), add Makefile target + GHA workflow, run the live proof, then make the SINGLE atomic commit.

**Files authored / modified in this session:**
- `apps/worker/src/index.ts` (remove `noopSender` lines 68-72, add `createEmailSender` import + `realSender` const, replace `sender: noopSender` → `sender: realSender`).
- `apps/worker/package.json` (+`"@openwhispr/email": "workspace:*"`).
- `apps/api/src/email.ts` → **DELETE** (importer count = 4 ≤ 5 per Q5).
- `apps/api/src/auth.ts` (update import path to `@openwhispr/email`).
- `apps/api/src/__tests__/auth-locale-and-enqueue.test.ts` (update import path).
- `apps/api/src/__tests__/auth-send-verification-email.test.ts` (update import path).
- `apps/api/src/email.test.ts` → DELETE (replaced by `packages/email/src/EmailSender.test.ts` from session 2).
- `tests/e2e-cjm/features/signup-verify.feature` (replace placeholder with `@cjm-1.1` + `@cjm-1.2` full scenarios).
- `tests/e2e-cjm/steps/auth.steps.ts` (flesh out step bodies from the skeleton authored in session 4).
- `Makefile` (add `e2e-cjm:` target + `.PHONY` entry).
- `.github/workflows/e2e-cjm.yml`.

**Live proof BEFORE committing:**
1. `pnpm install --frozen-lockfile` (sanity).
2. `pnpm vitest run` (full repo) — green.
3. `pnpm tsx tools/lint-weak-assertions.ts apps/web` — exit 0.
4. `pnpm tsx tools/lint-weak-assertions.ts --self-test` — exit 0.
5. `make e2e-cjm` (no flag) — expect refusal.
6. `E2E_CJM=1 make e2e-cjm SCENARIO=@cjm-1.1` — exit 0.
7. `E2E_CJM=1 make e2e-cjm SCENARIO=@cjm-1.2` — exit 0.
8. **Only then:** `git add -A` (excluding the `.planning/config.json` `M`, the `speaches-audio.md` `D`, and any other unrelated working-tree drift — surface as Rule 4 if uncertain), then `git commit -m "feat(13-01): ship e2e-cjm harness + replace worker noopSender with real EmailSender + close testcontainers leak + lint weak assertions"` (or split conventional-commit body per HEREDOC pattern).

**Verified before session ends:**
- `git log --oneline -1` shows exactly the one new commit.
- `git log -1 --name-only` lists all D-04 file invariants (worker/index.ts, packages/email/src/EmailSender.ts, tools/lint-weak-assertions.ts, the 3 sweep test files, apps/api/src/routes/health.ts, signup-verify.feature, Makefile, e2e-cjm.yml).
- `grep -v '^//' apps/worker/src/index.ts | grep -c "noopSender"` = 0.

**Estimated burn:** wall-clock 120–180 min including live compose boot + tear-down (compose `up` on the realistic stack averaged 90s in prior phases); context 80–110k tokens (reading and re-checking everything for the commit + writing summary).

**Open mid-session checkpoints:**
- If `E2E_CJM=1 make e2e-cjm SCENARIO=@cjm-1.1` fails on a real bug in `compose-harness.ts` or `wait-for-readiness.ts` → apply Rule 1 inline (auto-fix bug), re-run, re-verify. Do NOT commit until both scenarios are green.
- If the live proof reveals that `@cjm-1.1`'s verification-link click does NOT mark the account verified (which would prove the real bug TD-13.c that the harness exists to catch in v2) → **stop, this is the harness *working as intended*.** Either (a) the bug is on the worker side and the harness should commit RED with `@expected-red` and a follow-up issue, OR (b) the bug was already fixed and the harness mis-asserts. **This is the most likely real Rule 4 checkpoint for plan 13-01** — surface to user.

**Handoff state:** Plan complete; SUMMARY.md written; STATE.md advanced.

---

### Session sizing rationale

5 sessions × avg 90k token burn = avg 75k headroom per session. The largest single read in sessions 1 + 4 (analog files + research lookups) consumes ~30k. Even with `pnpm install` output buffering (which is verbose but tool-output, not context), the budget holds.

**If a session over-burns:** the 5-session plan can be collapsed to 4 by merging session 3 into session 4 (the weak-assertion sweep is large but mostly mechanical 1-line replacements). Conversely, if session 5 (the live proof) hits a real Rule 4 checkpoint, it can spill into a 6th session without disturbing the atomic-commit invariant — just resume the commit in the next agent.

---

## 4. Open questions (blockers that need user input)

These are real Rule 4 architectural / configuration questions surfaced during recon. The plan does not answer them. The executor will halt and surface them at the appropriate session boundary.

### OQ-1 — Mailpit reachability from the harness host process

The harness runs as a host-side `pnpm exec playwright` process and polls mailpit's HTTP API. On the current stack, mailpit's `:8025` is **not bound to the host**. Two choices:

| Option | Change | Pro | Con |
|---|---|---|---|
| A | Add `ports: ["127.0.0.1:8025:8025"]` to mailpit in base `docker-compose.yml` | 1-line edit; matches dev ergonomic | host-port pollution; clashes with parallel test runs |
| B | Route via Traefik: change `MAILPIT_API` constant to `https://mailpit.localhost/api/v1` and add Traefik labels to mailpit (if not already present) | hostname-only addressing; matches the `/etc/hosts` entry the GHA workflow already adds | requires verifying / adding `mailpit.localhost` Traefik router |

**Recommended:** Option B (matches the harness's `https://app.localhost` + `https://api.localhost` aesthetic). Needs label verification — `grep -A20 "mailpit:" docker-compose.yml` did not surface Traefik labels for mailpit in my recon scan, suggesting they're absent. If absent, Option B = 5-line label addition.

### OQ-2 — Which compose file does `make e2e-cjm` boot?

Base `docker-compose.yml` and `docker-compose.embedded-litellm.yml` are both present. The user's currently-running stack uses ONLY the embedded-litellm overlay. The plan's Makefile target (PATTERNS.md line 415) uses `docker compose --profile default up -d` with no `-f` — which defaults to `docker-compose.yml` only.

Confirm with user: do we boot `docker-compose.yml` solo (and let `litellm` use its `litellm_config.contract.yaml` mock) OR `-f docker-compose.yml -f docker-compose.embedded-litellm.yml`? The CONTEXT (line 124) says embedded-litellm; the plan implies base-only.

### OQ-3 — Postgres direct probe in `wait-for-readiness.ts`

Plan (PATTERNS.md line 466 / PLAN task 13-01-07 behavior) calls for `new Client({connectionString: env.DATABASE_URL_OWNER}).connect()` + `SELECT 1`. Postgres is not host-bound. Drop the probe (rely on `/api/health` `migrations_completed`) OR add `ports: ["127.0.0.1:5432:5432"]` to postgres.

**Recommended:** Drop the direct probe. `/api/health` with `migrations_completed: true` is a strictly stronger liveness assertion (it exercises the api's pool, which transitively proves Postgres + PgBouncer + the migrations table). Save a port binding and one probe.

### OQ-4 — `packages/email/` devDeps alignment

Root `package.json` pins `typescript@6.0.3`, `@types/node@25.6.2`, `vitest@4.1.5`. PATTERNS.md proposed `packages/email/package.json` devDeps with `typescript@^5.6.0` + `@types/node@^22.0.0`. **Use root pins** to avoid duplicate transitives. No user input needed unless executor encounters install-time conflict.

### OQ-5 — Coverage thresholds on `tools/**`

Root `vitest.config.ts` excludes `tools/**` from coverage. Plan task 13-01-03 acceptance requires ≥90/90/90/90 on `tools/lint-weak-assertions.ts`. Choices:

| Option | Mechanism |
|---|---|
| A | Drop `tools/**` from root coverage exclude (slim line change) |
| B | Add `coverage.include` override in a new `tools/vitest.config.ts` |
| C | Use a per-file include override at `packages/email/vitest.config.ts`-style scope but rooted in tools/ |

Recommended: Option A — `tools/**` exclusion was a Phase 0 convenience. With Phase 13 adding real lint tools that demand coverage discipline, dropping the exclusion is correct. Surface only if executor finds the exclusion is load-bearing for other tools' tests (it shouldn't be).

### OQ-6 — `apps/web/public/` untracked dir vs atomic commit scope

The atomic commit boundary needs to be clear: should the `git add -A` in session 5 exclude `apps/web/public/` (which is part of `.planning/deferred-items.md §2`, not phase 13)? Yes — phase 13 owns nothing in `apps/web/public/`. Use explicit `git add` of the D-04 file inventory, not `git add -A`. Surface only as a discipline reminder.

---

## 5. RECON Summary — 5 most consequential findings

1. **Mailpit `:8025` is not host-bound on the running stack.** The harness host process cannot reach `http://localhost:8025/api/v1/messages` as written. Needs a port-binding edit OR a Traefik route change (OQ-1). This is the highest-impact finding — the plan's signature E2E assertion (`@cjm-1.1` verification-email round-trip) depends on it.

2. **`packages/contract-tests/schemas/health.ts` does NOT exist.** The schemas live in a single file at `packages/contract-tests/src/schemas.ts` exported via the `"./schemas"` package export. The plan's `files_modified` list (line 27) targets a path that doesn't exist; the real edit lands in `src/schemas.ts`. Mechanical correction.

3. **`apps/api/src/email.ts` has 4 importers (not >5), so use the DELETE option, not the shim.** The 4 importers: `email.test.ts` (moved), `auth.ts` (update import), and 2 `__tests__/auth-*.test.ts` (update imports). Cleaner outcome than a re-export shim.

4. **Weak-assertion site count is 8 occurrences across 3 files, not 9 across 7 sites.** SignUpForm has 3, NotesListClient has 4, NoteDetailClient has 1 matching the plan's regex (line 360; line 370 was a `calls.toBeGreaterThanOrEqual(2)` chain that the regex does not flag). Plan acceptance criterion line 437 ("≥ 9 line changes across exactly 3 files") should be adjusted to ≥8.

5. **playwright-bdd + @cucumber/cucumber are NOT installed.** Lockfile has no `playwright-bdd:` entry; `node_modules/playwright-bdd` does not exist. The first session MUST run `pnpm install --frozen-lockfile` after the package.json bumps and verify the install succeeds before authoring `world.ts`'s final shape. If peer-deps explode under Node 24 + Vitest 4 + Next 15.5.18, this becomes a user-decision Rule 4 checkpoint blocking the entire plan.

---

**RECON-only mode complete.** No edits, no commits, no installs, no compose-up commands ran. Working tree pre-recon vs post-recon: only this RECON.md added (untracked).

