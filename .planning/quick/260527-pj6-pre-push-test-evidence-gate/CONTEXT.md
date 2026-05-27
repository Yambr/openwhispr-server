---
slug: 260527-pj6-pre-push-test-evidence-gate
title: HARD pre-push test-evidence gate (no `--no-verify` bypass)
date: 2026-05-27
posture: defence-in-depth; 3-layer mirror of gitleaks (L1 reporter, L2 pre-push, L3 CI)
constitutional_anchors:
  - CLAUDE.md hard-rule 4 (no `--no-verify`) — applies to test gate symmetrically
  - DISCIPLINE "test coverage ≥ 90/90/90/90" — gate REFUSES push if test run produced non-PASS
  - feedback_cjm_steps_need_unit_tests — same anti-pattern: forgetting tests / silently skipping
goal: |
  A push is allowed ONLY if every commit SHA in the push range has a
  matching `.test-evidence/<sha>.json` file recording a vitest run whose
  result is PASS for every project, with skip count under a threshold.
  Missing evidence → REFUSE. FAIL/ERROR in evidence → REFUSE. Skip-ratio
  over threshold → REFUSE. `--no-verify` bypass is constitutionally
  prohibited (CLAUDE.md hard-rule 4) and treated as a credential leak
  (rotation-class incident).
---

## Decisions

### D1 — Vitest reporter API: file output vs stdout JSON

| Option | Pros | Cons | Complexity | Recommendation |
|---|---|---|---|---|
| (a) Custom `Reporter` class with `onTestRunEnd(testModules, errors, reason)` writing per-workspace fragment | In-process; runs automatically on EVERY `vitest run` invocation across all 16 `projects` entries; iterates `testModule.children` for pass/fail/skip counts; can read `testModule.project.name` for the workspace name; no wrapper script to forget | Single shared filesystem write target → if reporter writes to one path, parallel `projects[]` invocations race; must scope filename per-project | 1 new file `tools/vitest-evidence-reporter.ts` (≈80 LOC) + 1 line in root `vitest.config.ts` `test.reporters` array; **Risk:** project-name collisions, atomic-write race, reporter not loaded by `pnpm --filter <pkg> test` if config inheritance breaks |
| (b) Builtin `--reporter=json --outputFile=...` + post-test wrapper that augments with git SHA | Stdlib reporter; no custom code in test path | Each `pnpm --filter` direct invocation skips the wrapper → evidence missing → pre-push REFUSES correct work; aggregation across 16 `projects[]` is a second script; wrapper-on-`pnpm test` is the same "developer forgot" anti-pattern user is trying to kill | 2 new files (wrapper.ts + aggregator.ts), npm-script rewiring of root `"test"`; **Risk:** workspace-direct vitest invocations bypass the wrapper |

**LOCKED:** **Option (a) — Custom reporter class.** Reasoning: the reporter is wired in the ROOT `vitest.config.ts` which every workspace `mergeConfig`s (verified at `apps/api/vitest.config.ts:19-23`). It therefore runs unconditionally on `pnpm test`, `pnpm --filter @openwhispr/api test`, AND raw `pnpm exec vitest run --project=api` — no wrapper-on-developer-discipline gap. Vitest 4's `onTestRunEnd(testModules, errors, reason)` is the documented hook (see `https://vitest.dev/api/advanced/reporters`) and exposes per-`TestModule` state + `project.name`. The race condition is handled in D2.

**Planner implication:** Phase ships a single new file `tools/vitest-evidence-reporter.ts` (TDD pair: `tools/vitest-evidence-reporter.test.ts` driving the reporter against a fixture `TestModule` array), one ADDITIVE line in `vitest.config.ts` (`reporters: ["default", "./tools/vitest-evidence-reporter.ts"]`), and matching ADDITIVE lines in every per-workspace vitest.config that overrides `reporters`. Reporter MUST be DI-clean — accept `process.env.OPENWHISPR_TEST_EVIDENCE_DIR` and `process.env.OPENWHISPR_TEST_EVIDENCE_SHA` so the test harness can pin them to a tmpdir without filesystem leaks (matches LOCKER-01 — no NODE_ENV branches; reporter is config-glue but evidence-dir env is operator-facing, allowed).

### D2 — Evidence aggregation across workspaces

| Option | Pros | Cons | Complexity | Recommendation |
|---|---|---|---|---|
| (a) Per-workspace fragments `.test-evidence/<sha>-<workspace>.json` + aggregator script | Fragments are atomic single-writer files (one project = one fragment); pre-push validator does the aggregation on read by globbing `<sha>-*.json`; no inter-process locking needed | Validator must know the canonical workspace set to detect "missing fragment" (else partial-coverage push silently passes); requires a generated `.test-evidence/projects.json` manifest or hard-coded list | 1 new file `tools/lint-pre-push-test-evidence.ts` (≈150 LOC) + canonical-projects manifest baked into validator; **Risk:** workspace added without manifest update → false-pass; mitigate with a self-test asserting manifest matches `vitest.config.ts` `projects[]` list |
| (b) Single file `.test-evidence/<sha>.json` with `proper-lockfile` append-rename | One file per SHA; trivial validator | New dep (`proper-lockfile`); file-lock on every test write blocks parallel `projects[]`; cross-process file-locks on macOS+Linux+CI runners differ in semantics; lock cleanup on SIGINT is a footgun | 1 new dep + lock-error-handling branches in reporter; **Risk:** lock races, stale `.lock` artefacts after crashed test runs |
| (c) Explicit `pnpm test:all && pnpm test-evidence:aggregate` chain | Simple; no concurrency | Developer running `pnpm --filter X test` directly produces no evidence → pre-push REFUSES (correct outcome) BUT this trains the team to run a special script, defeating "evidence on every test run" promise | Trivial wiring; **Risk:** habit drift to filtered vitest invocations |

**LOCKED:** **Option (a) — Per-workspace fragments + read-time aggregator.** Reasoning: vitest's `projects[]` runs each workspace in its own forked worker (`fileParallelism: false` notwithstanding — that's intra-workspace), so each fragment has exactly one writer. The validator reads `.test-evidence/<sha>-*.json`, asserts the fragment-name set equals the canonical-projects manifest, and short-circuits on missing OR FAILED fragments. The manifest is a generated artefact from `vitest.config.ts:projects[]` (a self-test asserts parity, matching the existing `chart-api-env-parity.test.ts` discipline at `tools/chart-api-env-parity.test.ts`).

**Planner implication:** Phase ships `tools/test-evidence-projects-manifest.json` (generated, tracked) + `tools/lint-test-evidence-projects-manifest.test.ts` (asserts manifest matches the live `vitest.config.ts:projects[]` projection — same shape as `chart-api-env-parity.test.ts`). Pre-push validator (`tools/lint-pre-push-test-evidence.ts`) globs `<sha>-*.json`, joins against the manifest, REFUSES on any missing/failed/over-skip fragment. Reporter writes to `.test-evidence/<sha>-<project.name>.json` using atomic write (`fs.writeFileSync` to `<path>.tmp` then `fs.renameSync` to final — POSIX guarantees rename atomicity within a filesystem).

### D3 — Skip rate threshold

`grep -rE "(it|test|describe)\.skip\b" apps/ packages/ | wc -l` = **121 lines, 19 non-e2e**. The 102 e2e skips are `playwright/test`'s `test.skip(condition, reason)` runtime-conditional skips (`test.skip(testInfo.project.name !== "slim", …)`), NOT static skips — they evaluate at test time and only count as skipped when the condition fires.

| Option | Pros | Cons | Complexity | Recommendation |
|---|---|---|---|---|
| (a) Ratio threshold 10% | Easy to communicate; absorbs legitimate platform-gated skips | Pre-Phase-44 a small workspace (e.g. `byok-guard` ≈ 12 tests) with a single legit conditional skip lands at 8.3% — one off-by-one inflates to 16.7% and trips the gate | Trivial; **Risk:** false-positive at small workspace size |
| (b) Ratio threshold 5% | Tighter | Trips immediately on any workspace with <20 tests + 1 conditional skip; refactor-hostile | Trivial; **Risk:** high false-positive rate at v1 size |
| (c) Absolute ceiling `skipped > 5` per project | Stable across workspace size growth | Mismatched semantics — caps small workspaces too tightly, lets `apps/web` (≈100 tests) silently grow 5 untracked skips | Trivial; **Risk:** semantic drift as workspaces grow |
| (d) Allowlist requiring `// SKIP-REASON: <text>` comment marker; reporter records reasons; un-annotated skips REFUSE | Strictest — forces explicit decision per skip; matches the "characterization-test on real surface" rule from `feedback_characterization_test_real_surface.md`; **complements** existing `.skip` patterns that already have explanatory string arg (`test.skip(true, "setup already completed")`) | Migration cost: 19 non-e2e + 102 e2e skip-sites need normalization; lint of comment marker is a second tool | 1 new lint tool (≈40 LOC) + 121-line touch-up commit before gate flips BLOCKING; **Risk:** noisy first commit, future skips slightly harder to land |

**LOCKED:** **Option (d) — Annotation allowlist.** Reasoning: the user's stated goal is "zero `tests fail but I'll fix in next commit`". A ratio threshold can't distinguish "intentionally platform-gated skip" from "silently disabled failing test"; only explicit per-skip annotation can. The existing 102 e2e skips already pass a human-readable string as the second arg (`test.skip(condition, "reason")`) — those are TRIVIALLY mechanically convertible to a comment marker by an upgrade codemod. The 19 non-e2e skips need one-line annotations. This is the same posture as DISCIPLINE rule 12 (`@ts-expect-error issue-NNNN: <reason>`).

**Planner implication:** Phase ships `tools/lint-skip-annotations.ts` (REFUSE on `.skip(` or `xit(` / `xdescribe(` without sibling `// SKIP-REASON: <≥10 chars>` within 5 lines above) with TDD pair, glob `{apps,packages,tests}/**/*.{test,spec}.ts`. Reporter records skip-reasons from comment metadata into the fragment; validator REFUSES on any un-annotated skip count > 0. Migration commit normalizes the existing 121 sites BEFORE the BLOCKING flip (matches the WARN→BLOCKING ledger pattern from LOCKER-04/05/06).

### D4 — Lefthook stdin protocol for pre-push hooks

| Option | Pros | Cons | Complexity | Recommendation |
|---|---|---|---|---|
| (a) `use_stdin: true` on the lefthook command + script reads `while read local_ref local_sha remote_ref remote_sha` | Canonical lefthook pattern (per `https://lefthook.dev/configuration/use_stdin/`); standard Git pre-push contract; portable to husky / bare-Git installs; explicit | Lefthook hangs WITHOUT `use_stdin: true` (pseudo-TTY default never closes stdin) — must be set or hook deadlocks; **only ONE command per pre-push event receives stdin** (lefthook hard-limit), so this hook becomes mutually exclusive with any other pre-push command that needs stdin (none today, but future-blocker) | 1 lefthook.yml entry + 1 TS script with `process.stdin` reader; **Risk:** forgetting `use_stdin: true` deadlocks every push; lock the parity in `tools/lint-lefthook-stdin-config.test.ts` |
| (b) Lefthook `{push_files}` / `{1}`-{2} template vars | No stdin plumbing | `{push_files}` is the file list, NOT the ref list; `$1 $2` are remote-name + remote-URL only (Git pre-push positional args), NOT the per-ref SHAs we need; cannot fulfil the requirement at all | N/A — not viable |
| (c) Shell-pipe `cat \| tsx tools/lint-pre-push-test-evidence.ts` | Works without lefthook stdin awareness | Same `use_stdin: true` requirement applies (lefthook closes the child's stdin without it); adds a `cat` process for no semantic benefit; violates LOCKER-06 ergonomics (bash-c interpolation pattern Linus called out) | Trivial; **Risk:** same hang as (a) without `use_stdin` |

**LOCKED:** **Option (a) — `use_stdin: true` + direct `process.stdin` reader.** Reasoning: the existing pre-push `gitleaks` command does NOT need refs (it uses `git rev-parse @{u}` to compute its own range, `lefthook.yml:105`); our new evidence gate MUST iterate the EXACT push range to map each pushed SHA to its evidence fragment. `use_stdin: true` is the documented lefthook switch for this, and a single regression test (`tools/lint-lefthook-stdin-config.test.ts`) pins it in YAML so a future edit can't silently drop it and re-introduce the hang.

**Planner implication:** Phase ships ONE new pre-push command in `lefthook.yml` with `use_stdin: true`, runner `tsx tools/lint-pre-push-test-evidence.ts`. The TS tool: (1) reads stdin line-by-line via `readline.createInterface({ input: process.stdin })`; (2) for each `local_ref local_sha remote_ref remote_sha`, expands `<remote_sha>..<local_sha>` via `git rev-list` to enumerate every pushed commit; (3) for each commit SHA, REFUSES if `.test-evidence/<sha>-<project>.json` missing for any manifest project, OR if any fragment's `state !== "passed"` (excepting annotated skips); (4) exits non-zero on any REFUSE with a human-readable explanation pointing at `docs/test-evidence-gate.md` (new). Regression: `tools/lint-lefthook-stdin-config.test.ts` parses `lefthook.yml`, asserts the evidence-gate command has `use_stdin: true` AND its `run:` line invokes the canonical tool path.

---

## Code-level implications (planner reads this section first)

1. **New files (TDD pairs each):**
   - `tools/vitest-evidence-reporter.ts` + `.test.ts` — custom reporter, writes `.test-evidence/<sha>-<project>.json` atomically (tmp + rename); reads `OPENWHISPR_TEST_EVIDENCE_DIR` and `OPENWHISPR_TEST_EVIDENCE_SHA` overrides for hermetic testability.
   - `tools/lint-pre-push-test-evidence.ts` + `.test.ts` — stdin-driven validator; rejects on missing/failed/un-annotated-skip fragments; integration test boots a temp git repo via testcontainers-free `simple-git` fixtures.
   - `tools/lint-skip-annotations.ts` + `.test.ts` — `// SKIP-REASON:` marker enforcement.
   - `tools/test-evidence-projects-manifest.json` + `tools/lint-test-evidence-projects-manifest.test.ts` — generated manifest with parity self-test (mirrors `chart-api-env-parity.test.ts`).
   - `tools/lint-lefthook-stdin-config.test.ts` — YAML-shape regression for `use_stdin: true`.
   - `docs/test-evidence-gate.md` — operator runbook (how the gate works, how to regenerate evidence, why `--no-verify` is constitutionally banned).

2. **Modified files:**
   - `vitest.config.ts` — add `reporters: ["default", "./tools/vitest-evidence-reporter.ts"]` at root level (each per-workspace config inherits via `mergeConfig`).
   - `lefthook.yml` — new pre-push command `test-evidence` with `use_stdin: true` + `tsx tools/lint-pre-push-test-evidence.ts`.
   - `.gitignore` — add `.test-evidence/` (evidence is local-only ephemeral, never committed).
   - `package.json` — add `"lint:pre-push-test-evidence": "tsx tools/lint-pre-push-test-evidence.ts"` and `"lint:skip-annotations": "tsx tools/lint-skip-annotations.ts"` (and the matching `test:lint-*` coverage-gated targets).
   - `CLAUDE.md` — extend hard-rule 4 to call out `--no-verify` on pre-push test-evidence gate explicitly (mirrors the gitleaks `--no-verify` ban already in place); document the new gate next to LOCKER ledger.

3. **Migration / one-shot commits (BEFORE BLOCKING flip):**
   - Normalize the 19 non-e2e + 102 e2e `.skip(` sites with `// SKIP-REASON: <text>` markers (codemod via `ts-morph`).
   - Backfill `.test-evidence/` for the current HEAD SHA so first-pull contributors aren't stuck.

4. **3-layer parity (mirrors gitleaks):**
   - **L1 (pre-commit):** Not applicable — tests don't run in pre-commit (too slow). The reporter fires on EVERY local `pnpm test` instead; this is the L1 equivalent.
   - **L2 (pre-push):** The new `tools/lint-pre-push-test-evidence.ts` — the hard gate.
   - **L3 (CI):** `.github/workflows/ci.yml` invokes the same validator against `${{ github.event.before }}..${{ github.event.after }}` as a redundant check on push to remote (catches `--no-verify` bypassers).

## Out-of-scope (deferred)

- Cross-machine evidence sharing (two devs pushing the same SHA from different laptops). Evidence is per-machine-per-checkout; CI L3 catches the bypass case.
- Evidence retention / rotation policy (size-bounded `.test-evidence/` GC). Defer to a follow-up plan; v1 ignores growth.
- Playwright e2e evidence integration. Out-of-scope for vitest gate; e2e fragments TBD in a separate phase.
- Coverage-floor checking inside evidence. Existing `lint-coverage-floor-per-phase.ts` already enforces ≥90/90/90/90 separately; this gate is correctness-only (PASS/FAIL/SKIP), not coverage.
- Mutation testing evidence (`stryker run`). Different cadence (weekly/nightly), not pre-push.

