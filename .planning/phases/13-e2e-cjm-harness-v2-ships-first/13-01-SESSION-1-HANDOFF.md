# Plan 13-01 — Session 1 Handoff

**Session:** 1 of 5
**Tasks covered:** 13-01-01 (scaffold/deps), 13-01-02 (global-vitest-teardown), 13-01-03 (lint-weak-assertions)
**Working-tree only — NO COMMITS this session.** Per D-04 atomic-commit invariant, the single plan-13-01 commit happens in Session 5.
**Date:** 2026-05-14

---

## 1. `git status --short` snapshot (end of session)

```
 M .planning/config.json
 M apps/api/vitest.config.ts
 M package.json
 M pnpm-lock.yaml
 D speaches-audio.md
 M vitest.config.ts
?? .planning/deferred-items.md
?? .planning/phases/13-e2e-cjm-harness-v2-ships-first/13-01-RECON.md
?? apps/api/vitest.setup.ts
?? apps/web/public/
?? packages/email/
?? tests/e2e-cjm/
?? tools/__tests__/global-vitest-teardown.test.ts
?? tools/global-vitest-teardown.ts
?? tools/lint-weak-assertions.test.ts
?? tools/lint-weak-assertions.ts
```

**Session 2 MUST verify the snapshot above matches `git status --short` before doing anything.** If it does not match, halt with a Rule 4 checkpoint — something drifted (the user may have run a command between sessions, or a parallel agent may have edited files).

---

## 2. Files written this session (`wc -l`)

| File | LOC | Status |
|---|---:|---|
| `tools/lint-weak-assertions.ts` | 225 | new |
| `tools/lint-weak-assertions.test.ts` | 322 | new |
| `tools/global-vitest-teardown.ts` | 76 | new |
| `tools/__tests__/global-vitest-teardown.test.ts` | 121 | new |
| `apps/api/vitest.setup.ts` | 14 | new |
| `tests/e2e-cjm/playwright.config.ts` | 56 | new |
| `tests/e2e-cjm/features/signup-verify.feature` | 17 | new (placeholder; real scenarios land Session 5) |
| `tests/e2e-cjm/support/world.ts` | 32 | new (placeholder; final fixtures land Session 4) |
| `tests/e2e-cjm/steps/placeholder.steps.ts` | 24 | new (placeholder; **DELETE** in Session 4 when `auth.steps.ts` lands) |
| `apps/api/vitest.config.ts` | modified | added `setupFiles: ["./vitest.setup.ts"]` |
| `vitest.config.ts` | modified | added `globalTeardown: ["./tools/global-vitest-teardown.ts"]`; dropped `tools/**` from coverage exclude (per OQ-5 Option A) |
| `package.json`, `pnpm-lock.yaml` | already done by prior agent | new devDeps: `@cucumber/cucumber@12.8.2`, `playwright-bdd@8.4.2`, `@axe-core/playwright@^4.10.2`; `@playwright/test` bumped 1.59.1 → 1.60.0 |
| `packages/email/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}` | already done by prior agent | skeleton with root pins (typescript@6.0.3, @types/node@25.6.2, vitest@4.1.5). EmailSender.ts lands Session 2. |

**Total new LOC this session:** 887.

---

## 3. Test + coverage results

### 3a. `pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts` — EXIT 0

```
Found feature files: 1
  - tests/e2e-cjm/features/signup-verify.feature
Found step files: 2
  - tests/e2e-cjm/support/world.ts (0 steps)
  - tests/e2e-cjm/steps/placeholder.steps.ts (3 steps)
Generating Playwright test files: 1
  - tests/e2e-cjm/.bdd-gen/features/signup-verify.feature.spec.js
Done (0.4s).
```

### 3b. `pnpm exec playwright install chromium` — EXIT 0

`Chrome Headless Shell 148.0.7778.96 (playwright chromium-headless-shell v1223)` installed.

### 3c. `pnpm vitest run tools/__tests__/global-vitest-teardown.test.ts` — EXIT 0

5 tests passing:

- `(a) globalTeardown invokes execFileSync with the docker prune argv`
- `(b) globalTeardown swallows execFileSync throws (never re-throws)`
- `(c) installSignalHook is idempotent — two calls add exactly one listener per signal`
- `(d) SIGINT handler calls pruneTestcontainers then process.exit(130)`
- `(d) SIGTERM handler calls pruneTestcontainers then process.exit(143)`

### 3d. `pnpm vitest run tools/lint-weak-assertions.test.ts` — EXIT 0

21 tests passing (6 subprocess execFileSync + 10 in-process WEAK_ASSERTION/scanRoot/selfTest + 5 in-process `run()` end-to-end).

### 3e. Coverage on the two new tools

Combined run via `pnpm vitest run tools/__tests__/global-vitest-teardown.test.ts tools/lint-weak-assertions.test.ts --coverage --coverage.include=...`:

| Metric | tools/global-vitest-teardown.ts | tools/lint-weak-assertions.ts |
|---|---:|---:|
| Statements | 100% (15/15) | 100% (50/50) |
| Branches | 100% (2/2) | 94.11% (16/17) |
| Functions | 100% (6/6) | 100% (3/3) |
| Lines | 100% (15/15) | 100% (49/49) |

**Combined: 100/94/100/100. Exceeds the constitutional ≥90/90/90/90 floor on both files.**

Uncovered branch on `lint-weak-assertions.ts` is the falsy arm of `selfTest()` (line 159) — unreachable while `selfTest()` is hard-coded to pass against the current regex; the subprocess test covers the CLI exit-1 path through an offender directory. Annotated with `/* c8 ignore */` markers where the unreachable arms are intentional defense-in-depth (path-traversal escape, glob non-string return, seen-set dedupe, broken-regex self-test fail).

### 3f. `pnpm tsx tools/lint-weak-assertions.ts --self-test` — EXIT 0

```
lint-weak-assertions self-test: PASS
```

### 3g. `pnpm tsx tools/lint-weak-assertions.ts apps/web` — EXIT 1 (expected)

**15 offenders — broader than the plan's enumeration of 8.** Plan's RECON.md busted assumption #9 already flagged "more sites than the plan enumerates"; Session 3 sweep MUST cover all 15, not just the 8 plan-named ones. Full list:

| # | File | Line | Col | Form |
|---:|---|---:|---:|---|
| 1 | `src/components/screens/usage/__tests__/UsageDashboardClient.test.tsx` | 186 | 18 | `toBeGreaterThanOrEqual(2)` |
| 2 | `src/components/screens/transcriptions/__tests__/TranscriptionDetailClient.test.tsx` | 345 | 20 | `toBeGreaterThanOrEqual(4)` |
| 3 | `src/components/screens/transcriptions/__tests__/TranscriptionsListClient.test.tsx` | 189 | 20 | `toBeGreaterThanOrEqual(4)` |
| 4 | `src/components/screens/notes/__tests__/NoteDetailClient.test.tsx` | 360 | 20 | `toBeGreaterThan(0)` |
| 5 | `src/components/screens/notes/__tests__/NoteDetailClient.test.tsx` | 370 | 20 | `toBeGreaterThan(0)` |
| 6 | `src/components/screens/notes/__tests__/NotesListClient.test.tsx` | 166 | 20 | `toBeGreaterThanOrEqual(2)` |
| 7 | `src/components/screens/notes/__tests__/NotesListClient.test.tsx` | 276 | 18 | `toBeGreaterThan(0)` |
| 8 | `src/components/screens/notes/__tests__/NotesListClient.test.tsx` | 295 | 18 | `toBeGreaterThan(0)` |
| 9 | `src/components/screens/auth/__tests__/SignUpForm.test.tsx` | 147 | 20 | `toBeGreaterThan(0)` |
| 10 | `src/components/screens/auth/__tests__/SignUpForm.test.tsx` | 165 | 20 | `toBeGreaterThan(0)` |
| 11 | `src/components/screens/auth/__tests__/SignUpForm.test.tsx` | 186 | 20 | `toBeGreaterThan(0)` |
| 12 | `src/components/screens/account/__tests__/AccountClient.test.tsx` | 115 | 18 | `toBeGreaterThanOrEqual(1)` |
| 13 | `src/components/screens/account/__tests__/AccountClient.test.tsx` | 158 | 18 | `toBeGreaterThanOrEqual(1)` |
| 14 | `src/components/screens/account/__tests__/SessionsTable.test.tsx` | 246 | 20 | `toBeGreaterThanOrEqual(4)` |
| 15 | `src/components/screens/account/__tests__/SessionsTable.test.tsx` | 264 | 20 | `toBeGreaterThanOrEqual(2)` |

**Session 3 acceptance criterion** (plan line 437 "≥ 9 line changes across exactly 3 files") MUST be revised — actual count is **15 line changes across 7 files**. The plan's `<files>` list for Task 13-01-06 should include `UsageDashboardClient.test.tsx`, `TranscriptionDetailClient.test.tsx`, `TranscriptionsListClient.test.tsx`, `AccountClient.test.tsx`, `SessionsTable.test.tsx` in addition to the 3 plan-named files.

---

## 4. Decisions applied this session (binding for downstream sessions)

### 4a. playwright-bdd config shape (BDD config inside `playwright.config.ts`)

**No `tests/e2e-cjm/bddgen.config.ts` file.** Per upstream playwright-bdd 8.4.2 API (verified against `node_modules/playwright-bdd/dist/cli/commands/test.js` + `dist/config/types.d.ts`): `bddgen` loads a Playwright config via `-c/--config` and reads `defineBddConfig({...})` returned-as-testDir from it. There is no separate BDD config file in 8.x.

- The plan's `files_modified` line referencing `tests/e2e-cjm/bddgen.config.ts` is **DROPPED** (user-approved Option A in the session prompt).
- The plan's verification command `pnpm exec bddgen --dry-run --config tests/e2e-cjm/bddgen.config.ts` is **REPLACED** with `pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts`. There is no `--dry-run` flag in 8.4.2 — `bddgen` always generates spec files (idempotent).

### 4b. `importTestFrom` deprecation — world.ts is loaded via the `steps` glob

playwright-bdd 8.4.2 emitted a runtime warning:

```
WARNING: Option "importTestFrom" in defineBddConfig() is not needed anymore.
Try to remove it and include that file into "steps" pattern.
```

`playwright.config.ts` therefore uses `steps: ["support/**/*.ts", "steps/**/*.ts"]` (support listed first so `world.ts`'s `createBdd(test)` binding is loaded before any step file imports the DSL).

### 4c. `createBdd()` requires `test` from `"playwright-bdd"` (not `@playwright/test`)

The placeholder world.ts initially imported `test` from `@playwright/test`; bddgen failed with `Error: createBdd() should use 'test' extended from "playwright-bdd"`. Final world.ts imports `test` + `expect` from `"playwright-bdd"` and re-exports them. Session 4's final world.ts will need to keep this contract when adding per-scenario fixtures.

### 4d. OQ-5 resolved → Option A

`tools/**` is no longer blanket-excluded from root coverage (`vitest.config.ts` exclude list). The new lint/teardown tools are now subject to the ≥90/90/90/90 floor; individual fixture/helper files inside `tools/` can be re-excluded on a per-file basis if needed in later phases.

### 4e. `tests/e2e-cjm/steps/placeholder.steps.ts` is a Session-1-only artifact

This file exists to give bddgen a non-empty step-definition file so a spec is generated (without step bindings, bddgen prints `Missing step definitions: 3` and skips generation, leaving `.bdd-gen/` empty). **Session 4** authors `tests/e2e-cjm/steps/auth.steps.ts`; **Session 4 or Session 5 MUST DELETE `placeholder.steps.ts` before the atomic commit.** It is NOT part of the Plan 13-01 final artifact.

### 4f. `tests/e2e-cjm/.bdd-gen/` is generator output — add to .gitignore in Session 5

The atomic commit MUST NOT include `tests/e2e-cjm/.bdd-gen/`. Session 5 should add `tests/e2e-cjm/.bdd-gen/` to `.gitignore` as part of the integration delta.

---

## 5. Notes for downstream sessions

### Session 2 — `packages/email/` real implementation

- **Skeleton is already on disk** (prior agent + nothing more this session). Files: `packages/email/package.json` (with root pins typescript@6.0.3, @types/node@25.6.2, vitest@4.1.5; NO @types/nodemailer wildcard — pin a real version), `packages/email/tsconfig.json` (extends `../../tsconfig.base.json`), `packages/email/vitest.config.ts` (90/90/90/90 thresholds), `packages/email/src/index.ts` (currently empty barrel).
- Session 2 first action: read `apps/api/src/email.ts` + `apps/api/src/email.test.ts` for the verbatim extract target, then author `packages/email/src/EmailSender.ts` (with the 8 tests from plan task 13-01-04 behavior block — prod loud-fail, SMTP_SECURE override, SMTP_REJECT_UNAUTHORIZED, plain-object Logger).
- Final `packages/email/src/index.ts` must re-export the public types + `createEmailSender`.

### Session 3 — health probe + weak-assertion sweep (CORRECTIONS)

- **Schema lives in `packages/contract-tests/src/schemas.ts`, NOT `packages/contract-tests/schemas/health.ts`.** RECON.md busted assumption #5; plan's `<files>` list line 376 is wrong. The edit lands in `src/schemas.ts`. The current file may or may not declare `HealthResponse` as `.strict()` — read first (RECON suggests it's NOT strict, so adding `migrations_completed: z.boolean()` should be safe).
- **15 weak-assertion sites, not 8.** See §3g above. The Task 13-01-06 `<files>` list must be expanded to 7 files (add UsageDashboardClient, TranscriptionDetailClient, TranscriptionsListClient, AccountClient, SessionsTable). Acceptance criterion line 437 should read "≥ 15 line changes across exactly 7 files".

### Session 4 — compose harness + readiness + steps

- Open checkpoints from RECON.md still apply: **OQ-1** (mailpit reachability — port-bind or Traefik route), **OQ-2** (which compose file does `make e2e-cjm` boot — base vs `-f docker-compose.yml -f docker-compose.embedded-litellm.yml`), **OQ-3** (drop the direct Postgres `SELECT 1` probe; rely on `/api/health migrations_completed`). Surface as Rule 4 checkpoints at the start of Session 4.
- Replace `tests/e2e-cjm/support/world.ts` with the final playwright-bdd 8.4.2 Fixtures shape. Keep `test` and `expect` imported from `"playwright-bdd"` (not `@playwright/test`) — see §4c.
- Author `tests/e2e-cjm/steps/auth.steps.ts` AND delete `tests/e2e-cjm/steps/placeholder.steps.ts` (see §4e).

### Session 5 — atomic commit + live proof (CORRECTIONS)

- **Makefile `e2e-cjm` target invocation MUST use `pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts`** (or `pnpm exec playwright test --config tests/e2e-cjm/playwright.config.ts` to run; bddgen is invoked by playwright-bdd's test fixture as part of `playwright test` in 8.x). **DO NOT reference `bddgen.config.ts` — that file does not and will not exist.** See §4a.
- Add `tests/e2e-cjm/.bdd-gen/` to `.gitignore`. See §4f.
- Ensure `tests/e2e-cjm/steps/placeholder.steps.ts` is deleted before the atomic commit.

---

## 6. First action for Session 2

```bash
git status --short  # MUST match §1 exactly — if not, halt with Rule 4
```

Then begin Task 13-01-04: read `apps/api/src/email.ts` and `apps/api/src/email.test.ts` in full, then author `packages/email/src/EmailSender.ts` + `packages/email/src/EmailSender.test.ts` + `packages/email/README.md`. Verify with `pnpm vitest run packages/email --coverage` and confirm ≥ 90/90/90/90 on `EmailSender.ts`.

End Session 2 with a `13-01-SESSION-2-HANDOFF.md` and another `git status --short` snapshot.
