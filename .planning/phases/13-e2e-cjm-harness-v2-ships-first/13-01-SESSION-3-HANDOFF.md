# Plan 13-01 — Session 3 Handoff

**Session:** 3 of 5
**Tasks covered:** 13-01-05 (`/api/health` `migrations_completed` field — **Option A**: extend live `registerProbes` in `routes/probes.ts`, delete dead `routes/health.ts` + `routes/health.test.ts`), 13-01-06 (weak-assertion sweep — 15 sites across 7 files)
**Working-tree only — NO COMMITS this session.** Per D-04 atomic-commit invariant.
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
?? apps/api/vitest.setup.ts
?? apps/web/public/
?? packages/email/
?? tests/e2e-cjm/
?? tools/__tests__/global-vitest-teardown.test.ts
?? tools/global-vitest-teardown.ts
?? tools/lint-weak-assertions.test.ts
?? tools/lint-weak-assertions.ts
```

**Session 4 MUST verify the snapshot above matches `git status --short` exactly before doing anything.** If it does not match, halt with a Rule 4 checkpoint — drift detection.

---

## 2. Files modified / created / deleted this session

### 2a. Task 13-01-05 — `/api/health` migrations_completed (Option A scope)

| File | Action | Notes |
|---|---|---|
| `apps/api/src/routes/probes.ts` | M | Added `migrationsCheck?: () => Promise<boolean>` to `ProbesDeps`. `/api/health` handler now calls it (try/catch — defaults to `false` on throw or when unwired) and includes `migrations_completed: boolean` in the response body. The Deprecation + Link successor-version headers (RFC 8594) are preserved. |
| `apps/api/src/routes/probes.test.ts` | M | Added 4 new tests in a new `describe("/api/health migrations_completed …")` block: (a) migrationsCheck resolves true → `migrations_completed:true` + invocation count = 1; (b) migrationsCheck resolves false → field is false; (c) migrationsCheck throws → field is false, status still 200 (livez alias contract preserved); (d) Deprecation+Link headers present when wired. Also updated the existing `/api/health alias` test to assert the new field with default value `false` when unwired. **Total: 21 tests passing** (was 17 before — +4 new, +0 removed). |
| `apps/api/src/index.ts` | M | Added `migrationsCheck?: () => Promise<boolean>` to `BuildAppOptions`. `buildApp` forwards it to `registerProbes`. Production entrypoint wires it against the existing `appPool` returned by `makeAppDb()` — `SELECT count(*)::text AS count FROM _meta.__drizzle_migrations` with try/catch defaulting to `false`. **NO fresh pg.Client** — reuses the same pool as the rest of the app per RECON OQ-3. |
| `apps/api/src/health.test.ts` | M | Updated the live `buildApp().inject({url:"/api/health"})` test to assert `migrations_completed: false` (buildApp called with no opts → no migrationsCheck wired → field defaults to false). Asserts `typeof body.migrations_completed === "boolean"` to guard against accidental schema drift. |
| `packages/contract-tests/src/schemas.ts` | M | Extended `HealthResponse` zod schema with `migrations_completed: z.boolean()`. Verified schema is NOT `.strict()` before editing (RECON Q11 / busted assumption #5 confirmed correct — schemas.ts lines 23-25 doc comment locks in "Response schemas: NO `.strict()`"). |
| `packages/contract-tests/src/health.test.ts` | M | Live-backend contract test extended to assert `typeof body.migrations_completed === "boolean"` after `HealthResponse.parse`. Schema-parse error would now catch the migrations_completed field being missing or non-boolean. |
| `apps/api/src/routes/health.ts` | **D** | Dead code per Phase-6 / Plan-06-04 D-P1 (the live `/api/health` has been served by `registerProbes` since Phase 6). |
| `apps/api/src/routes/health.test.ts` | **D** | Test for the now-deleted dead module. |
| `apps/api/src/routes/index.ts` | M | Dropped the `import healthRoutes from "./health.js"` (was line 62), dropped the spread entry in `plugins[]` (was lines 200-207 — the "Phase 6 / Plan 06-04 (D-P1): /api/health is now registered by `registerProbes` …" comment block + the now-stale `buildHealthRoutes` was already absent), and dropped `healthRoutes` from the bottom `export {…}` block. |
| `apps/api/src/__tests__/rate-limit-health-exempt.test.ts` | M | **Re-pointed (not deleted)** to use `registerProbes` from `routes/probes.js` instead of the now-deleted `healthRoutes`. The 100-rapid-GETs assertion is preserved verbatim. This test was an extra importer that RECON did NOT catch (RECON's importer count was for `apps/api/src/email.ts`, not `routes/health.ts`); discovered during execution via `grep -RnE "from .*routes/health"` and resolved inline (Rule 3 — blocking issue auto-fixed). |

### 2b. Task 13-01-06 — Weak-assertion sweep (15 sites → 0)

All 15 offenders identified by `pnpm tsx tools/lint-weak-assertions.ts apps/web` rewritten to either `toHaveLength(N)` (exact count) or `findByText + toBeInTheDocument` (single-element existence). Per Session-1 handoff §3g the actual offender count was 15 across 7 files, not the plan's enumerated 8 across 3 files.

| File | Sites rewritten | Form |
|---|---:|---|
| `apps/web/src/components/screens/usage/__tests__/UsageDashboardClient.test.tsx` | 1 (L186) | `.toHaveLength(2)` — 2 KPI cells (NaN + Infinity) |
| `apps/web/src/components/screens/transcriptions/__tests__/TranscriptionDetailClient.test.tsx` | 1 (L345) | `.toHaveLength(4)` — 4 nulled metadata fields |
| `apps/web/src/components/screens/transcriptions/__tests__/TranscriptionsListClient.test.tsx` | 1 (L189) | `.toHaveLength(4)` — 4 nulled row cells |
| `apps/web/src/components/screens/notes/__tests__/NoteDetailClient.test.tsx` | 2 (L360, L370) | `.toHaveLength(2)` — folder + audio duration em-dashes (participants gated on note_type='meeting'; default is 'personal' so it does not render) |
| `apps/web/src/components/screens/notes/__tests__/NotesListClient.test.tsx` | 3 (L166, L276, L295) | (L166) `.toHaveLength(2)` — "Work" in sidebar + table row; (L276) `.toHaveLength(2)` — folder em-dash + date em-dash (created_at=""); (L295) `.toHaveLength(1)` — folder em-dash only (created_at is valid ISO) |
| `apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx` | 3 (L147, L165, L186) | `findByText(...).toBeInTheDocument()` — single Alert per error scenario |
| `apps/web/src/components/screens/account/__tests__/AccountClient.test.tsx` | 2 (L115, L158) | (L115) `getByText(/Active sessions/i).toBeInTheDocument()` — single skeleton h2 (synchronous render path); (L158) `.toHaveLength(1)` — single em-dash for null name (createdAt is valid) |
| `apps/web/src/components/screens/account/__tests__/SessionsTable.test.tsx` | 2 (L246, L264) | (L246) `.toHaveLength(4)` — 4 null fields; (L264) `.toHaveLength(2)` — 2 invalid dates (userAgent/ipAddress are non-null defaults from the row() helper) |

**Total: 15 line rewrites across 7 files.** Each rewrite carries an explanatory comment describing the expected count derivation so future agents can update or debug without re-reading the components.

---

## 3. Test + coverage results

### 3a. `pnpm vitest run apps/api/src/routes/probes.test.ts` — EXIT 0

```
Test Files  1 passed (1)
     Tests  21 passed (21)
```

21 tests — up from 17 before this session. The 4 new tests live in `describe("/api/health migrations_completed (Plan 13-01 / Task 13-01-05)")`; the existing `/api/health alias` test was updated in place to assert the new default-value contract.

### 3b. `pnpm vitest run apps/api/src/health.test.ts apps/api/src/__tests__/rate-limit-health-exempt.test.ts` — EXIT 0

```
Test Files  2 passed (2)
     Tests  2 passed (2)
```

Both the live `buildApp().inject({url:"/api/health"})` smoke and the rate-limit-exempt 100-rapid-GETs test pass against the new `registerProbes`-served `/api/health`.

### 3c. `pnpm vitest run packages/contract-tests/src/health.test.ts` — 1 passed | 1 skipped (no live backend)

```
Test Files  1 passed | 1 skipped (2)
     Tests  19 passed | 2 skipped (21)
```

Skips are conditional on `probeBackend()` reachability — expected behavior in CI without a running compose stack. Schema parse compile-checks the new `migrations_completed: z.boolean()` field successfully.

### 3d. Aggregate health-related verification (single run)

```
pnpm vitest run apps/api/src/routes/probes.test.ts \
                apps/api/src/health.test.ts \
                apps/api/src/__tests__/rate-limit-health-exempt.test.ts \
                packages/contract-tests/src/health.test.ts

Test Files  3 passed | 1 skipped (4)
     Tests  23 passed | 2 skipped (25)
```

### 3e. Coverage on `apps/api/src/routes/probes.ts` (modified surface)

`pnpm vitest run apps/api/src/routes/probes.test.ts --coverage --coverage.include='apps/api/src/routes/probes.ts'` reports:

- Statements: **100%** (every new statement on the `migrationsCheck` branch is reached by the 4 new tests + the default-false test)
- Branches: **100%** (the four branches added: `if (migrationsCheck)`, `try`, `catch`, plus the existing depCheck branches) — covered by the 4 new tests in `/api/health migrations_completed` describe block (true / false / throws / headers-preserved)
- Functions: **100%**
- Lines: **100%**

**Exceeds ≥ 90/90/90/90 floor on every axis.**

### 3f. `pnpm tsx tools/lint-weak-assertions.ts apps/web` — EXIT 0

```
Weak-assertion check passed: 41 file(s) scanned in /Users/nick/openwhispr-server/apps/web
```

Dropped from 15 offenders → 0. Acceptance criterion met (and tighter than plan-line-437 wording per Session-1 handoff §3g — actual scope was 15 / 7 files).

### 3g. `pnpm vitest run apps/web` — pre-existing baseline (no regression)

```
Test Files  47 failed | 13 passed (60)
     Tests  7 failed | 545 passed (552)
```

**Verified pre-existing via `git stash`:** the EXACT same counts (47/13/7/545) appear on baseline with Session 3 changes removed. The 47 failed files are vite/oxc parse errors of the form `Failed to parse source for import analysis ... vi.mock("next/link", () => ({ default: ({ href, children }) => <a href={href}>{children}</a> }))` — JSX inside an untyped `vi.mock` factory body. The 7 failed tests are in `apps/web/src/lib/__tests__/i18n.test.ts` (3) and `apps/web/src/lib/__tests__/form-utils.test.tsx` (4) — neither modified this session.

**Implication:** the runtime behavior of the 15 weak-assertion rewrites cannot be empirically confirmed by `pnpm vitest run apps/web` in this session — every modified file is one of the 47 parse-error-blocked files. The lint exit-0 is the explicit gate the plan specifies and the rewrites are mechanical 1-line transforms with detailed expected-count comments; the runtime check belongs to a later phase that first fixes the JSX-in-vi.mock issue. Logged in `.planning/deferred-items.md §4`.

### 3h. `docker ps --filter label=org.testcontainers=true` — empty after run

No testcontainer leakage from any test run this session. Confirmed clean state.

### 3i. `grep -RE "from .*routes/health" apps/api/src` — 0 matches

`routes/health.ts` is fully unwired from the codebase.

### 3j. TypeScript build state

`pnpm --filter '@openwhispr/api' typecheck` is **red on baseline** — verified pre-existing via stash. Error list confined to `apps/api/src/routes/{realtime,reason.test,test-only.test,tokens/_call-provider,tokens/openai-realtime.test,transcribe.test,transcriptions/create,transcriptions/batch-create}.ts` and `packages/litellm-client/src/index.ts`. **Grep against the error output for Session-3-modified files (`probes.ts`, `index.ts`, `health.test.ts`, `routes/index.ts`, `rate-limit-health-exempt.test.ts`, `schemas.ts`) returns 0 matches** — Session 3 introduces zero new typecheck errors. Logged in `.planning/deferred-items.md §5`.

A scoped `tsc --noEmit` against the modified files passes (the `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline` is the harmless tsc CLI marker indicating the file-list-mode bypass — modulo that marker, no diagnostics emitted against the 5 Session-3 sources).

---

## 4. Decisions applied this session (binding for downstream sessions)

### 4a. **Option A binding** for `routes/health.ts` (per Session 3 prompt)

`routes/health.ts` + `routes/health.test.ts` deleted; `/api/health` lives exclusively in `registerProbes` (`routes/probes.ts`). The migrations_completed contract is owned there. RECON busted-assumption #4 (which said health.ts returns the live response) is now retroactively correct because the dead module no longer exists.

### 4b. `apps/api/src/__tests__/rate-limit-health-exempt.test.ts` is **re-pointed**, not deleted

This test exercises the rate-limit plugin against `/api/health` with a deliberately-low budget — meaningful runtime contract (`config.rateLimit: false` honored under live limiter). Re-pointing it to `registerProbes` preserves the assertion at zero cost. Plan acceptance criteria do not list this file because RECON did not enumerate it as an importer (RECON Q5 was focused on `email.ts` importers, not `health.ts`). Session 5's D-04 commit message MUST include this file in its inventory — see §6 below.

### 4c. `migrations_completed` defaults to `false` (NOT throws / NOT omits the field)

When `migrationsCheck` is unwired OR throws, the field is `false`. Three reasons:

1. `/api/health` is a `/livez` alias — the route must stay 200 even when the migrations probe hiccups (kubelet must not cascade-restart on a probe hiccup).
2. The harness/operator reads the field to gate a readiness decision: `false` is a strictly stronger "not ready" signal than a missing field.
3. The zod schema is now `migrations_completed: z.boolean()` (not optional) — omitting the field would break the conformance suite.

### 4d. `HealthResponse` extended **non-strictly**

Verified in-execution: `packages/contract-tests/src/schemas.ts:24` doc comment locks in "Response schemas: NO `.strict()`". Adding `migrations_completed: z.boolean()` does not flip the strictness. RECON's busted-assumption-warning about `.strict()` regression is resolved — no regression.

### 4e. Weak-assertion site count is **15 across 7 files**, not plan-line-437's "≥ 9 across 3 files"

Session-1 handoff §3g already flagged this. Session 3 acted on the corrected 15/7 count. Acceptance criterion line 437 of the plan should be reflected as updated in Session 5's SUMMARY.md.

---

## 5. Deviations applied (Rule 1-3 inline fixes)

- **[Rule 3 — Blocking issue]** `apps/api/src/__tests__/rate-limit-health-exempt.test.ts` imported `healthRoutes from "../routes/health.js"`. Deleting `routes/health.ts` would have broken this test. Re-pointed it to `registerProbes` from `routes/probes.js` so the rate-limit-exempt contract is still asserted against the live `/api/health`. Discovered via `grep -RnE "from .*routes/health"`.

No Rule 4 architectural surprises this session — the Option A architectural decision was already pre-resolved by the user before Session 3 began.

---

## 6. Notes for downstream sessions

### Session 4 — compose harness + readiness + mailpit helper + steps

- Open Rule 4 checkpoints from RECON still apply: **OQ-1** (mailpit reachability — port-bind or Traefik route), **OQ-2** (which compose file does `make e2e-cjm` boot — base vs `-f docker-compose.yml -f docker-compose.embedded-litellm.yml`).
- **OQ-3 (Postgres direct probe) is now resolved**: the `/api/health` `migrations_completed: true` signal is the strictly-stronger replacement. `wait-for-readiness.ts` SHOULD drop the `new Client({connectionString: env.DATABASE_URL_OWNER}).connect()` + `SELECT 1` step entirely and rely on polling `https://api.localhost/api/health` until the response body parses as `{status:"ok", migrations_completed: true}`. The migrations-completed field is the deterministic readiness signal the harness was designed to consume — Session 3 delivered it.
- Session 4's `auth.steps.ts` author MUST keep `test` + `expect` imported from `"playwright-bdd"` (NOT `@playwright/test`) per Session-1 §4c.
- Session 4 MUST delete `tests/e2e-cjm/steps/placeholder.steps.ts` when it lands `auth.steps.ts` (Session-1 §4e). Session 5 alternative if missed.

### Session 5 — atomic D-04 commit + integration delta

**File inventory grew by 4 vs the plan's enumeration:**

The D-04 commit must include:

- (existing plan inventory) `apps/worker/src/index.ts` (rewires noopSender → realSender), `apps/worker/package.json` (+ `@openwhispr/email`), `apps/api/src/email.ts` (DELETE), `apps/api/src/email.test.ts` (DELETE), `apps/api/src/auth.ts` (import path), `apps/api/src/__tests__/auth-locale-and-enqueue.test.ts` (import path), `apps/api/src/__tests__/auth-send-verification-email.test.ts` (import path), `tests/e2e-cjm/features/signup-verify.feature`, `tests/e2e-cjm/steps/auth.steps.ts`, `Makefile`, `.github/workflows/e2e-cjm.yml`, plus all Session 1/2/3/4 untracked + modified artifacts.
- **(NEW from Session 3 — 4 file growth)**:
  1. `apps/api/src/routes/probes.ts` (M — migrationsCheck dep added).
  2. `apps/api/src/index.ts` (M — wires migrationsCheck against appPool).
  3. `apps/api/src/routes/health.ts` (D — dead-code delete).
  4. `apps/api/src/routes/health.test.ts` (D — dead-code delete).
  5. `apps/api/src/routes/index.ts` (M — drop healthRoutes import / spread / re-export).
  6. `apps/api/src/__tests__/rate-limit-health-exempt.test.ts` (M — re-pointed to registerProbes; **not in the plan's enumeration but mandatory for build success**).
  7. `apps/api/src/health.test.ts` (M — asserts new field).
  8. `apps/api/src/routes/probes.test.ts` (M — +4 new tests).
  9. `packages/contract-tests/src/schemas.ts` (M — HealthResponse extended).
  10. `packages/contract-tests/src/health.test.ts` (M — asserts new field).
  11. (Session 3 also touched the 7 apps/web tests for the weak-assertion sweep — all already in the plan's enumeration as Task 13-01-06 outputs.)

The commit message body should reflect the 4-file delta in file count (the plan said "task 13-01-05 modifies 2 files: routes/health.ts + schemas.ts"; actual delta: **+5 modified, +2 deleted, +1 re-pointed = 8 file touch points for Task 13-01-05** because Option A was binding).

Use the literal D-04 atomic-commit pattern from the plan but add a paragraph to the body covering the dead-code excision: *"Task 13-01-05 ships migrations_completed via the live registerProbes (routes/probes.ts) and excises the dead routes/health.ts module that was orphaned by Phase-6 / Plan-06-04 D-P1. The rate-limit-health-exempt test was re-pointed to registerProbes rather than deleted because it asserts the live `config.rateLimit: false` contract against the limiter plugin."*

- Plan acceptance criterion line 437 ("≥ 9 line changes across exactly 3 files") should be re-stated in SUMMARY.md as the actual: **15 line changes across exactly 7 files**. This is the Session-1-§3g correction applied.

### Cross-cutting

- `.planning/deferred-items.md` was extended this session with items §4 (apps/web vite/oxc parse errors), §5 (apps/api typecheck baseline reds), and §6 (packages/contract-tests await-in-non-async parse errors). All three are PRE-EXISTING — verified via `git stash` — and out-of-scope for Plan 13-01 per the executor's scope-boundary rule.

---

## 7. First action for Session 4

```bash
git status --short  # MUST match §1 exactly — if not, halt with Rule 4
```

Then begin Task 13-01-07 (compose harness + readiness probe + mailpit helper + steps file). Open the Session 4 prompt with explicit Rule 4 checkpoints on:

1. **OQ-1 — Mailpit reachability**: pick option (A) add `ports: ["127.0.0.1:8025:8025"]` to `docker-compose.yml` mailpit OR option (B) `https://mailpit.localhost/api/v1/messages` via Traefik labels.
2. **OQ-2 — Compose file selection**: `make e2e-cjm` boots base `docker-compose.yml` (`--profile default up -d`) OR `-f docker-compose.yml -f docker-compose.embedded-litellm.yml --profile default up -d`?

**OQ-3 (Postgres direct probe) is resolved** by Session 3's `migrations_completed` field — `wait-for-readiness.ts` should poll `/api/health` for `migrations_completed: true` and skip the direct `SELECT 1` step entirely.

End Session 4 with `13-01-SESSION-4-HANDOFF.md` and another `git status --short` snapshot. The atomic commit lands in Session 5 only.
