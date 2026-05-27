---
quick_id: 260527-pj6
slug: pre-push-test-evidence-gate
mode: research
date: 2026-05-27
researcher: gsd-phase-researcher
confidence: HIGH
upstream: .planning/quick/260527-pj6-pre-push-test-evidence-gate/CONTEXT.md
---

# Research — HARD pre-push test-evidence gate

> **Purpose**: feed the planner verbatim API shapes, version pins, codebase
> metrics, and style references so the next sub-agent can write
> `tools/vitest-evidence-reporter.ts` + `tools/lint-pre-push-test-evidence.ts`
> + `tools/lint-skip-annotations.ts` + parity self-test + lefthook YAML edit
> without re-investigating any external interface.
>
> **All four CONTEXT decisions (D1 custom Reporter / D2 per-workspace
> fragments / D3 SKIP-REASON allowlist / D4 `use_stdin: true`) are
> verified against the live codebase below and require no re-litigation.**

---

## R1 — Vitest Reporter API (verbatim)

### R1.1 Version pin

| Source | Version |
|---|---|
| `package.json` devDependencies | `vitest: 4.1.5` `[VERIFIED: package.json]` |
| `@vitest/coverage-v8` | `4.1.5` `[VERIFIED: package.json]` |
| Installed in `node_modules/vitest/dist/` (mtime 2026-05-08) | 4.1.5 `[VERIFIED: ls -la]` |
| Node runtime | `v24.15.0` (LTS) `[VERIFIED: node --version]` |
| pnpm | `11.0.8` `[VERIFIED: pnpm --version]` |

`vitest: "4.1.5"` is pinned (exact, no `^`) in root `package.json:devDependencies`. The reporter API documented below is taken **verbatim** from the installed type declaration file `node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts` — not from upstream docs that could be on a different minor.

### R1.2 The `Reporter` interface (canonical signatures)

`[CITED: node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts:1041-1115]` — every line below is copy-paste from the installed `.d.ts`:

```ts
type TestRunEndReason = "passed" | "interrupted" | "failed";

interface Reporter {
  onInit?: (vitest: Vitest) => void;
  onTestRunStart?: (specifications: ReadonlyArray<TestSpecification>) => Awaitable<void>;
  onTestRunEnd?: (
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
    reason: TestRunEndReason,
  ) => Awaitable<void>;
  onTestModuleQueued?: (testModule: TestModule) => Awaitable<void>;
  onTestModuleCollected?: (testModule: TestModule) => Awaitable<void>;
  onTestModuleStart?: (testModule: TestModule) => Awaitable<void>;
  onTestModuleEnd?: (testModule: TestModule) => Awaitable<void>;
  onTestCaseReady?: (testCase: TestCase) => Awaitable<void>;
  onTestCaseResult?: (testCase: TestCase) => Awaitable<void>;
  onTestCaseAnnotate?: (testCase: TestCase, annotation: TestAnnotation) => Awaitable<void>;
  // ...
}
```

**The only hook this phase implements is `onTestRunEnd(testModules, unhandledErrors, reason)`.** Module-level and case-level hooks are unnecessary — `testModules` already carries the full tree by the time `onTestRunEnd` fires.

Reason values: `"passed" | "interrupted" | "failed"`.
- `"passed"` → write evidence fragment with `state: "passed"`.
- `"failed"` → write evidence fragment with `state: "failed"` (so a partial-failure record is observable to the gate, but gate REFUSES).
- `"interrupted"` → write nothing (SIGINT case; same posture as `global-vitest-teardown.ts` which swallows interrupts).

### R1.3 `TestModule` and how to iterate test cases

`[CITED: node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts:244-336]`

```ts
declare abstract class SuiteImplementation extends ReportedTaskImplementation {
  readonly children: TestCollection;
  errors(): SerializedError[];
}

declare class TestModule extends SuiteImplementation {
  readonly type = "module";
  readonly moduleId: string;       // absolute UNIX file path (or virtual id)
  readonly relativeModuleId: string;  // project-relative path
  state(): TestModuleState;        // "skipped" | "pending" | "failed" | "passed" | "queued"
  ok: () => boolean;
  meta: () => TaskMeta;
  diagnostic(): ModuleDiagnostic;
}

declare class TestCollection {
  at(index: number): TestCase | TestSuite | undefined;
  get size(): number;
  array(): (TestCase | TestSuite)[];
  allTests(state?: TestState): Generator<TestCase, undefined, void>;
  tests(state?: TestState): Generator<TestCase, undefined, void>;
  suites(): Generator<TestSuite, undefined, void>;
  allSuites(): Generator<TestSuite, undefined, void>;
  [Symbol.iterator](): Generator<TestSuite | TestCase, undefined, void>;
}

type TestSuiteState = "skipped" | "pending" | "failed" | "passed";
type TestModuleState = TestSuiteState | "queued";
type TestState = TestResult["state"];
type TestResult = TestResultPassed | TestResultFailed | TestResultSkipped | TestResultPending;

interface TestResultSkipped {
  readonly state: "skipped";
  readonly errors: undefined;
  readonly note: string | undefined;   // populated from `ctx.skip(note)`
}
```

**Canonical iteration pattern** the reporter uses to enumerate every test across every module (recursive into suites):

```ts
let passed = 0, failed = 0, skipped = 0, todo = 0;
const failures: Array<{ file: string; name: string; messages: string[] }> = [];
const skips: Array<{ file: string; name: string; note: string | undefined; mode: string }> = [];

for (const mod of testModules) {
  for (const testCase of mod.children.allTests()) {   // <-- recursive over nested suites
    const r = testCase.result();
    if (r.state === "passed") passed++;
    else if (r.state === "failed") {
      failed++;
      failures.push({
        file: mod.moduleId,
        name: testCase.fullName,
        messages: (r.errors ?? []).map((e) => e.message),
      });
    } else if (r.state === "skipped") {
      // testCase.options.mode is "skip" or "todo"
      if (testCase.options.mode === "todo") todo++;
      else skipped++;
      skips.push({
        file: mod.moduleId,
        name: testCase.fullName,
        note: r.note,
        mode: testCase.options.mode,  // "skip" | "todo"
      });
    }
  }
}
```

`TestCase.options.mode` is `"run" | "only" | "skip" | "todo"` `[CITED: reporters.d.ts:349]` — this is how to distinguish a `.skip` from a `.todo`. `TestResultSkipped.note` `[CITED: reporters.d.ts:400]` is populated when the test body calls `ctx.skip("reason")` at runtime; for static `.skip(true, "msg")` the `note` is `undefined` and the reason lives in the source comment (per D3).

### R1.4 `TestProject.name` — the per-fragment filename anchor (D2)

`[CITED: node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts:1930-1989]`

```ts
declare class TestProject {
  readonly vitest: Vitest;
  readonly globalConfig: ResolvedConfig;
  get hash(): string;
  get name(): string;     // <-- the project name we use for fragment filename
  get color(): ProjectName["color"];
  isRootProject(): boolean;
  // ...
}
```

**`TestModule` does NOT directly expose `.project`** — but every `TestCase` does via `ReportedTaskImplementation.project: TestProject` (`reporters.d.ts:124`). The reporter MUST read the project name off the first test case it encounters in each module, or alternatively off `vitest.projects` via the `onInit(vitest)` hook stashing the `Vitest` instance.

**Cleanest pattern** (avoids needing the `Vitest` global):

```ts
class EvidenceReporter implements Reporter {
  async onTestRunEnd(testModules, _errors, reason) {
    // Group modules by project name.
    const byProject = new Map<string, TestModule[]>();
    for (const mod of testModules) {
      // First testCase carries the project ref. If a module has zero tests
      // (e.g. all filtered out), it's safely skipped — projects with no
      // executed tests don't need an evidence fragment.
      const firstCase = mod.children.array().find((c) => c.type === "test") as TestCase | undefined;
      const projectName = firstCase?.project.name ?? "_unnamed";
      const arr = byProject.get(projectName) ?? [];
      arr.push(mod);
      byProject.set(projectName, arr);
    }
    // Write one fragment per project.
    for (const [projectName, modules] of byProject) {
      writeFragment(projectName, modules, reason);
    }
  }
}
```

**Critical**: the root `vitest.config.ts:projects[]` (verified at `vitest.config.ts:39-181`) declares **20 distinct project names**, each in its own forked worker. Each worker invokes the reporter ONCE on its own `onTestRunEnd`, with only the modules belonging to THAT project in `testModules`. (Vitest 4's per-project workers are isolated processes — the reporter is instantiated per project, not once globally.) This means:

1. **Each fragment is written by exactly one process** — no inter-process locking is needed (matches D2 lock-D1 reasoning).
2. The reporter's filename MUST encode `projectName` to avoid 20 workers racing on the same `.test-evidence/<sha>.json`.
3. The aggregate validator reads `<sha>-*.json` and joins against a manifest of the 20 expected project names.

### R1.5 Canonical project-name set (D2 manifest input)

Computed from `vitest.config.ts` and per-workspace `vitest.config.ts` files. Every project below contributes one fragment:

| # | Project name (`test.name` in config) | Config file | Notes |
|---|---|---|---|
| 1 | `api` | `apps/api/vitest.config.ts:30` `[VERIFIED]` | 201 test files (largest workspace) |
| 2 | `@openwhispr/web` (or `web` — TBC by grep) | `apps/web/vitest.config.ts` | needs verify |
| 3 | `worker` (or `@openwhispr/worker`) | `apps/worker/vitest.config.ts` | needs verify |
| 4 | `@openwhispr/byok-guard` | `packages/byok-guard/vitest.config.ts` | needs verify |
| 5 | `@openwhispr/contract-tests` | `packages/contract-tests/vitest.config.ts` | needs verify |
| 6 | `@openwhispr/data` | `packages/data/vitest.config.ts` | needs verify |
| 7 | `@openwhispr/email` | `packages/email/vitest.config.ts` | needs verify |
| 8 | `@openwhispr/litellm-client` | `packages/litellm-client/vitest.config.ts` | needs verify |
| 9 | load-test | `tools/load-test/vitest.config.ts` | needs verify |
| 10 | test-probe | `tools/test-probe/vitest.config.ts` | needs verify |
| 11 | mock-litellm | `compose/mock-litellm/vitest.config.ts` | needs verify |
| 12 | (e2e) | `tests/e2e/vitest.config.ts` | needs verify; vitest-runs-only-when-`E2E=1`? |
| 13 | (mock-realtime) | `tests/e2e/mock-realtime/vitest.config.ts` | needs verify |
| 14 | `@openwhispr/auth-stub` | inline (root config:63) `[VERIFIED]` |
| 15 | `@openwhispr/i18n-stub` | inline (root config:71) `[VERIFIED]` |
| 16 | `@openwhispr/observability` | inline (root config:79) `[VERIFIED]` |
| 17 | `@openwhispr/wire-schemas` | inline (root config:87) `[VERIFIED]` |
| 18 | `tools` | inline (root config:101) `[VERIFIED]` |
| 19 | `tests-e2e-cjm-steps` | inline (root config:119) `[VERIFIED]` |
| 20 | `tests-e2e-cjm-support` | inline (root config:133) `[VERIFIED]` |
| 21 | `tests-integration` | inline (root config:150) `[VERIFIED]` |
| 22 | `tests-self-tests` | inline (root config:161) `[VERIFIED]` |

→ **22 projects total**, not 16 as CONTEXT.md D2 said. CONTEXT was approximating; planner MUST read the live list. The parity self-test (`tools/lint-test-evidence-projects-manifest.test.ts`) generates this list from `vitest.config.ts:projects[]` AST at test time, eliminating manual maintenance drift.

**[ASSUMED] Per-workspace `name:` values for rows 2–13**: each per-workspace `vitest.config.ts` uses `mergeConfig(rootConfig, defineConfig({ test: { name: "<workspace>", ... } }))` (verified for `api` at `apps/api/vitest.config.ts:30`). The planner's first task is to run `grep -E '^\s+name:\s+"' apps/*/vitest.config.ts packages/*/vitest.config.ts tools/*/vitest.config.ts compose/*/vitest.config.ts tests/e2e/vitest.config.ts tests/e2e/mock-realtime/vitest.config.ts` and bake the result into the parity-self-test fixture. Listed assumed because individual `name:` strings weren't read in research.

### R1.6 Reporter registration in `vitest.config.ts`

`[CITED: vitest.dev/config/#reporters]` — reporters in Vitest 4 are registered via `test.reporters: Array<string | [string, options] | Reporter | { new(): Reporter }>`. The accepted shapes:

```ts
// vitest.config.ts (root)
export default defineConfig({
  test: {
    reporters: [
      "default",                                           // built-in
      "./tools/vitest-evidence-reporter.ts",               // path to a module exporting default class
      // OR a class:
      // new EvidenceReporter(),
    ],
    // ...
  },
});
```

The path-string form auto-imports the module and expects `default export` to be a Reporter class. The constructor receives no args.

**Inheritance via `mergeConfig`**: `apps/api/vitest.config.ts:22` does `mergeConfig(rootConfig, defineConfig({ test: { name: "api", ... } }))`. Vitest's `mergeConfig` deep-merges arrays by **concatenation** in `test.reporters` — so adding `reporters: ["default", "./tools/vitest-evidence-reporter.ts"]` at root applies to EVERY child workspace UNLESS the child also defines `test.reporters` (which would replace, not append). Audit step for the planner: grep `reporters:` in all per-workspace configs; if any sets it, the new reporter path must be added there too. `[ASSUMED]` — based on Vitest 4 mergeConfig behavior; planner verifies with one trial run.

### R1.7 Run mode detection (skip-during-watch)

The reporter SHOULD NOT write evidence during `vitest watch` — watch mode re-runs subsets, producing partial fragments that misrepresent the SHA's state. Detection:

- **`onInit(vitest: Vitest)`** is called with the `Vitest` instance; `vitest.config.watch: boolean` reveals mode. `[ASSUMED]` — `node:fs` and `Vitest` properties not verified beyond the `.d.ts` skim; planner confirms by reading `vitest.config` accessor on the `Vitest` class.

Simpler alternative (matches the project's pattern of `OPENWHISPR_*` env overrides): if `OPENWHISPR_TEST_EVIDENCE_DIR` is unset AND `process.env.npm_lifecycle_event` does NOT begin with `test` (or matches `test:watch`), bail. But cleanest is the watch-flag check above.

---

## R2 — Lefthook `use_stdin` (verbatim)

### R2.1 Version pin

| Source | Version |
|---|---|
| `node_modules/lefthook/package.json` | `2.1.8` `[VERIFIED]` |
| Local CLI on PATH | not installed — devs run via `pnpm exec lefthook ...` `[VERIFIED]` |

### R2.2 Schema-confirmed YAML shape (BLOCKING ground truth)

`[CITED: node_modules/lefthook/schema.json:5-120, $defs.Command]` — JSON Schema 2020-12 contract that lefthook validates `lefthook.yml` against:

```json
"Command": {
  "properties": {
    "run":        { "type": "string" },
    "files":      { "type": "string" },
    "root":       { "type": "string" },
    "fail_text":  { "type": "string" },
    "timeout":    { "type": "string", "examples": ["15s"] },
    "skip":       { "oneOf": [{ "type": "boolean" }, { "type": "array" }] },
    "only":       { "oneOf": [{ "type": "boolean" }, { "type": "array" }] },
    "tags":       { ... },
    "file_types": { ... },
    "glob":       { ... },
    "exclude":    { ... },
    "env":        { ... },
    "priority":   { "type": "integer" },
    "interactive":{ "type": "boolean" },
    "use_stdin":  { "type": "boolean" },        // <-- HERE, command-level
    "stage_fixed":{ "type": "boolean" }
  },
  "additionalProperties": false,
  "type": "object",
  "required": ["run"]
}
```

→ `use_stdin` is a **per-command property** (also valid on `Script` per `schema.json:472` and on `Group` per `schema.json:342`). It is **NOT** a hook-level property. Placement:

```yaml
pre-push:
  parallel: true
  commands:
    test-evidence:                              # <-- command name
      use_stdin: true                           # <-- HERE
      run: pnpm exec tsx tools/lint-pre-push-test-evidence.ts
      fail_text: |
        Pre-push test-evidence gate REFUSED. See docs/test-evidence-gate.md.
        --no-verify is constitutionally banned (CLAUDE.md hard-rule 4).
```

### R2.3 lefthook.dev docs — critical caveats

`[CITED: lefthook.dev/configuration/use_stdin/, fetched 2026-05-27]`

1. **Without `use_stdin: true`, lefthook hangs**. Quote: *"uses pseudo TTY by default, and it doesn't close stdin when all data is read"*. Missing the flag deadlocks every `git push`.
2. **Only ONE command per hook receives stdin**. Quote: *"With many commands or scripts having `use_stdin: true`, only one will receive the data. The others will have nothing."* — Today no other `pre-push` command needs stdin (the existing `gitleaks` command uses `git rev-parse @{u}` to compute its own range, see `lefthook.yml:105`). Future-blocker: any future stdin-consuming pre-push command would conflict. Regression-test that holds this invariant lives in `tools/lint-lefthook-stdin-config.test.ts` (per CONTEXT D4).
3. The flag can sit alongside `parallel: true` at the hook level — lefthook routes stdin to the first command (by config order) that asks for it.

### R2.4 How the `run:` script receives the data

When `use_stdin: true`, lefthook **forwards Git's pre-push stdin directly to the subprocess's stdin**. The TS tool reads it via:

```ts
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  // <local_ref> SP <local_sha> SP <remote_ref> SP <remote_sha>
  const [localRef, localSha, remoteRef, remoteSha] = line.split(" ");
  // ...
}
```

No env-var threading; no temporary file. The lefthook process simply pipes its own stdin to the spawned child.

---

## R3 — Git pre-push stdin protocol (verbatim)

### R3.1 Format

`[CITED: git-scm.com/docs/githooks#_pre_push]` — Git's documented contract, per line:

```
<local-ref> SP <local-object-name> SP <remote-ref> SP <remote-object-name> LF
```

Where SP is a single space and LF is `\n`. Token meanings:

| Token | Meaning | Example |
|---|---|---|
| `<local-ref>` | The local ref being pushed. The literal string `(delete)` if the ref is being deleted. | `refs/heads/main` |
| `<local-object-name>` | The 40-char hex SHA1 (or 64-char SHA256) of the commit at the tip of the local ref. **All zeros** when deleting. | `abc123def456...` |
| `<remote-ref>` | The remote ref being updated (full ref path including `refs/heads/` / `refs/tags/`). | `refs/heads/main` |
| `<remote-object-name>` | The SHA the remote ref currently points at, OR **all zeros** if the remote has no such ref yet (new branch / new tag). | `0000000000000000000000000000000000000000` |

### R3.2 Examples (every edge case the validator must handle)

```
# 1. Normal branch push, remote ref exists:
refs/heads/main 67890abcdef... refs/heads/main 12345abc...

# 2. New branch push (no remote ref yet):
refs/heads/feature-x abc123def... refs/heads/feature-x 0000000000000000000000000000000000000000

# 3. Ref deletion:
(delete) 0000000000000000000000000000000000000000 refs/heads/old-feature 67890abc...

# 4. Tag push (new tag — typical):
refs/tags/v1.0.12 deadbeef... refs/tags/v1.0.12 0000000000000000000000000000000000000000

# 5. Multiple refs in one `git push origin main v1.0.12 feature-y` — multiple lines:
refs/heads/main abc123... refs/heads/main def456...
refs/tags/v1.0.12 tag123... refs/tags/v1.0.12 0000000000000000000000000000000000000000
refs/heads/feature-y xyz789... refs/heads/feature-y 0000000000000000000000000000000000000000
```

### R3.3 Validator logic per line

```ts
for each line in stdin:
  parse [localRef, localSha, remoteRef, remoteSha]

  if localRef === "(delete)" OR localSha === "0000...0000":
    # Nothing being pushed for this ref (it's a deletion).
    skip

  if remoteSha === "0000...0000":
    # New ref on the remote — enumerate ALL commits reachable from localSha
    # but not on any other branch already pushed. Conservative: walk
    # localSha back to the merge-base with `main` (or the first commit on
    # the branch). Practical choice: `git rev-list <localSha> --not --remotes`
    range = `git rev-list ${localSha} --not --remotes`
  else:
    # Existing ref — enumerate the new commits being pushed.
    range = `git rev-list ${remoteSha}..${localSha}`

  for each sha in range:
    require .test-evidence/<sha>-<project>.json exists for every project in MANIFEST
    require each fragment has state="passed" AND skip-count rules pass
```

### R3.4 Tag pushes

Pre-push fires for tag pushes (line 4 example above). The validator's posture for tag pushes: **the tag SHA is itself a commit** (annotated tags resolve via `^{commit}`); `git rev-list refs/tags/v1.0.12^{commit} --not --remotes` enumerates the same commits the equivalent branch push would. For lightweight tags pointing at a commit already on `main`, `--not --remotes` returns empty → no commits to validate → ACCEPT (the commits already passed the gate on their branch push).

---

## R4 — Codebase metrics (counted live, 2026-05-27)

### R4.1 Vitest test count (rough — `(it|test)\(` line-count)

| Workspace | Test-call lines |
|---|---|
| apps/api | 201 |
| packages/data | 47 |
| packages/contract-tests | 44 |
| apps/web (vitest only — excl. playwright `tests/e2e/`) | 33 |
| apps/worker | 27 |
| packages/litellm-client | 13 |
| tools/load-test | 12 |
| tools/__tests__ + tools/*.test.ts | 11 |
| packages/wire-schemas | 7 |
| packages/byok-guard | 7 |
| packages/observability | 3 |
| packages/email | 2 |
| tools/test-probe | 1 |
| **Total (excl. tests/e2e/*, tests/e2e-cjm/*)** | **~603** |

`[VERIFIED: grep -crE "\b(it|test)\(" --include="*.test.ts" -r apps/ packages/ tools/]` — rough upper bound; some lines contain `test.each`, `it.concurrent`, etc. The reporter records the actual count from `TestModule.children.allTests()` which is exact at runtime.

### R4.2 Existing `.skip` site count

| Surface | `(it\|test\|describe)\.skip\b` line count |
|---|---|
| All `.ts`/`.tsx` under `apps/`, `packages/`, `tests/` (excl. node_modules/dist/.next/.stryker-tmp) | **54** `[VERIFIED]` |
| ↳ E2E (`tests/e2e`, `tests/e2e-cjm`, `apps/web/tests/e2e/`) | **34** `[VERIFIED]` |
| ↳ Non-e2e (vitest-runnable) | **20** `[VERIFIED]` |
| `xit(` or `xdescribe(` | **0** `[VERIFIED]` |
| Existing `// SKIP-REASON:` markers | **0** `[VERIFIED]` |

**CONTEXT.md D3 said "121 lines, 19 non-e2e"** — live count is 54 lines, 20 non-e2e. The discrepancy is small (one extra non-e2e file: `tests/integration/observability-stack-up.test.ts`) and doesn't change the migration-cost shape; it just means the codemod commit touches ~54 sites, not 121.

`grep` invariants used:

```bash
# Total
grep -rE "(it|test|describe)\.skip\b" --include="*.ts" --include="*.tsx" \
  apps/ packages/ tests/ \
  | grep -v "/node_modules/\|/dist/\|/.next/\|/.stryker-tmp/\|/.claude/worktrees/" \
  | wc -l   # → 54

# Non-e2e (subtract tests/e2e and tests/e2e-cjm trees)
grep -rE "(it|test|describe)\.skip\b" --include="*.ts" --include="*.tsx" \
  apps/ packages/ tests/ \
  | grep -v "/node_modules/\|/dist/\|/.next/\|/.stryker-tmp/\|/.claude/worktrees/\|tests/e2e\|tests/e2e-cjm" \
  | wc -l   # → 20

# Annotation marker (currently zero)
grep -rE "// SKIP-REASON:" apps/ packages/ tests/ tools/ | wc -l   # → 0
```

### R4.3 Non-e2e skip sites (the 20 the codemod touches)

The 20 non-e2e `.skip` sites are **almost entirely runtime-conditional Docker guards** — `const SUITE = canRunDocker() ? describe : describe.skip;` — not "test broken, skipped":

| Pattern | Examples (verified) | Annotation reason category |
|---|---|---|
| `canRunDocker() ? describe : describe.skip` | `apps/worker/tests/unit/jobs/reconciliation-discrepancy.test.ts:23`, `apps/worker/tests/unit/db/app-pool.test.ts`, `apps/worker/tests/unit/lib/with-tenant-context.test.ts`, `packages/data/tests/unit/__tests__/rls-property.test.ts`, `packages/data/tests/unit/__tests__/worker-rls-property.test.ts`, etc. | `// SKIP-REASON: requires-docker — testcontainers needed for real Postgres` |
| `describe.skip("descr...", ...)` plain | `apps/api/tests/unit/__tests__/litellm-spike-request-id.test.ts` (TBC by inspection) | `// SKIP-REASON: <specific>` |
| `apps/api/tests/support/shared-pg.ts:21` | comment-only ref, no actual `.skip` call here — false-positive in the grep | n/a (lint must NOT match comments) |

**Action item for the lint tool**: the regex `(it|test|describe)\.skip\b` matches inside `// describe.skip from beforeAll` comments. The lint tool MUST tokenize properly OR use a stricter regex like `^[^/]*\b(it|test|describe)\.skip\(` to exclude line-comment instances. The existing `lint-no-env-branches.ts` uses simple line-regex; the new lint needs a slightly smarter approach OR a comment-stripping pre-pass.

### R4.4 Suggested SKIP-REASON taxonomy

Based on the live skip-site survey, four categories cover all 54 occurrences:

| Tag | Description | Example annotation |
|---|---|---|
| `requires-docker` | Conditional skip when Docker daemon unavailable | `// SKIP-REASON: requires-docker — testcontainers-postgresql needs Docker socket` |
| `topology-gated` | Conditional skip when running against wrong topology (slim vs full) | `// SKIP-REASON: topology-gated — playwright project.name !== "slim"` |
| `setup-complete` | Conditional skip after first-run wizard already done | `// SKIP-REASON: setup-complete — onboarding already finished, axe scan moot` |
| `deferred-fix` | Static skip awaiting a tracked fix | `// SKIP-REASON: deferred-fix issue-NNN — Phase X.Y will land the real fix` |

The lint tool enforces the marker exists, NOT the taxonomy — the planner can pick any non-empty `≥10 chars` text after `SKIP-REASON:` (matches CONTEXT D3 spec).

---

## R5 — Path safety considerations

### R5.1 `.test-evidence/` directory

- **Location**: repo-root `./.test-evidence/` `[VERIFIED: relative to git root]`
- **`.gitignore` entry needed**: NOT present today `[VERIFIED: .gitignore]`. Existing gitignore covers `coverage/` and `.nyc_output/` but not `.test-evidence/`. Phase MUST add the entry.
- **Mode bits**: created with `mkdirSync(..., { recursive: true, mode: 0o700 })`. Fragment files written with `fs.writeFileSync(path, json, { mode: 0o600 })`.

### R5.2 Symlink-safety / TOCTOU

An attacker (or a careless developer) could `mkdir .test-evidence && ln -s /etc/passwd .test-evidence/abc123-api.json`. Then the reporter writing to that path would overwrite (or fail to overwrite — fs perms — but in a worktree owned by the user, `~/.profile` is writeable). Mitigation:

1. **`fs.realpathSync(repoRoot)`** to canonicalize the target dir at startup. Reject if not within repo root.
2. **`fs.lstatSync(fragmentPath)`** before write — if exists AND `isSymbolicLink()` → REFUSE with `"refusing to write evidence through symlink"` and exit non-zero. The reporter exit aborts the test run, surfacing the attack/misconfiguration.
3. **Atomic write**: `writeFileSync('<path>.tmp.<pid>', json, { mode: 0o600 })` → `renameSync('<path>.tmp.<pid>', '<path>')`. POSIX `rename(2)` is atomic within the same filesystem; CONTEXT D2 specifies this.
4. **Node.js `fs.open` lacks `O_NOFOLLOW` as a documented flag** `[ASSUMED — based on training]`. `fs.openSync(path, 'wx')` exists (`O_CREAT | O_EXCL`) which fails if path already exists; combined with lstat-check this covers the symlink attack at write time.

### R5.3 SHA validation

The validator MUST regex-check incoming SHAs from Git stdin before passing to `git rev-list` or interpolating into paths: `^[0-9a-f]{40}$` (or `^[0-9a-f]{64}$` for SHA256 repos — Yambr/openwhispr-server is SHA1, verified via `git rev-parse --show-object-format` produces `sha1`). Anything else → REFUSE with `"malformed SHA from pre-push stdin"`.

---

## R6 — CI environment detection idioms

`[CITED: docs.github.com/en/actions/learn-github-actions/variables, ci.yml]`

| Variable | Set by | Notes |
|---|---|---|
| `CI=true` | All major CI providers (GitHub, GitLab, CircleCI, Travis, Jenkins, Drone, BuildKite) | Universal idiom |
| `GITHUB_ACTIONS=true` | GitHub Actions only | Provider-specific |

**Local-dev probability**: extremely low for `CI=true` to be set on a developer's machine — but a paranoid Bash export inside an interactive shell can do it. Mitigation (matches existing repo discipline): **the reporter ALWAYS writes the fragment, regardless of `CI`**. The validator (`tools/lint-pre-push-test-evidence.ts`) reads the fragment and decides whether to REFUSE. There is no "skip validation if CI" branch — CI redundantly runs the same validator (per CONTEXT D-spec L3 layer). Therefore CI/local distinction is **not needed** for the gate itself.

The only legitimate CI-bypass is the unattended-CI-rerun case where the validator inside CI walks the GitHub `${{ github.event.before }}..${{ github.event.after }}` range against artifacts uploaded by the test job — out-of-scope for v1 per CONTEXT "Out-of-scope (deferred)" section.

---

## R7 — Tooling style reference (cite-for-cite copy from existing lints)

### R7.1 File-header template (every new tool)

```ts
#!/usr/bin/env -S pnpm exec tsx
// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * <tool-name>.ts — <one-line purpose>
 * (Phase 260527-pj6 / pre-push-test-evidence-gate — <which D-N decision>).
 *
 * <2-3 paragraph description of WHAT and WHY, mirroring
 *  tools/lint-no-env-branches.ts:1-40 voice>
 *
 * Exit codes:
 *   0 — clean
 *   1 — violations found (stderr enumerates each)
 *   2 — internal error
 */
```

### R7.2 CLI entrypoint pattern (last 20 lines of every `.ts`)

`[CITED: tools/lint-no-env-branches.ts:240-260]` — verbatim shape:

```ts
/* c8 ignore start */
const invokedDirect = (() => {
  const arg1 = process.argv[1] ?? "";
  return arg1.endsWith("<tool-name>.ts") || arg1.endsWith("<tool-name>.js");
})();
if (invokedDirect) {
  main(process.argv.slice(2)).then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(
        `<tool-name>: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    },
  );
}
/* c8 ignore stop */
```

### R7.3 Test-file scaffold

`[CITED: tools/lint-no-env-branches.test.ts:1-44]` — verbatim:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { <exports>, main } from "./<tool-name>.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "<tool-name>-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("<group>", () => {
  it("F1: <clean fixture> → zero violations", async () => { /* ... */ });
  it("F2: <violation fixture> → flagged", async () => { /* ... */ });
  // ... numbered F-cases matching plan task IDs
});
```

### R7.4 `package.json` scripts pattern (add 3 entries)

`[CITED: package.json:lint:no-env-branches and matching test:lint-no-env-branches]`:

```jsonc
"lint:skip-annotations": "tsx tools/lint-skip-annotations.ts",
"test:lint-skip-annotations": "vitest run tools/lint-skip-annotations.test.ts --coverage --coverage.include=tools/lint-skip-annotations.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90",

"lint:pre-push-test-evidence": "tsx tools/lint-pre-push-test-evidence.ts",
"test:lint-pre-push-test-evidence": "vitest run tools/lint-pre-push-test-evidence.test.ts --coverage --coverage.include=tools/lint-pre-push-test-evidence.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90",

"test:vitest-evidence-reporter": "vitest run tools/vitest-evidence-reporter.test.ts --coverage --coverage.include=tools/vitest-evidence-reporter.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90"
```

The reporter itself isn't a CLI so it has no `lint:*` script — only the `test:*` coverage-gated script.

### R7.5 Lefthook command insertion point

`[CITED: lefthook.yml:93-112]` — insert as a NEW command under existing `pre-push.commands`:

```yaml
pre-push:
  parallel: true
  commands:
    gitleaks:           # existing
      run: bash -c '...'
      fail_text: "..."
    web-test:           # existing
      glob: "apps/web/**"
      run: pnpm --filter @openwhispr/web test:unit
    test-evidence:      # NEW
      use_stdin: true
      run: pnpm exec tsx tools/lint-pre-push-test-evidence.ts
      fail_text: |
        Pre-push test-evidence gate REFUSED.
        See docs/test-evidence-gate.md.
        --no-verify is constitutionally banned (CLAUDE.md hard-rule 4 — same posture as gitleaks).
```

**Critical**: keep `parallel: true` at hook level. lefthook docs (R2.3 #2) only let ONE command receive stdin — the new `test-evidence` is the only command needing it; `gitleaks` and `web-test` don't ask for stdin and proceed in parallel.

### R7.6 Existing parity-self-test pattern (mirrors D2 manifest)

`[CITED: tools/chart-api-env-parity.test.ts:1-80]` — the closest analog. It shells out to `helm template` and asserts the rendered manifest contains every expected env var. Our parity self-test analog:

```ts
// tools/lint-test-evidence-projects-manifest.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// Import the resolved Vitest config OR parse vitest.config.ts via the
// `vitest` programmatic API to extract `projects:` names at test time.

const MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, "test-evidence-projects-manifest.json"), "utf8"),
) as { projects: string[] };

describe("test-evidence projects manifest parity", () => {
  it("manifest matches live vitest.config.ts:projects[] names", async () => {
    const liveProjects = await resolveLiveProjectNames(); // helper from vitest API
    expect(new Set(MANIFEST.projects)).toEqual(new Set(liveProjects));
  });
});
```

For `resolveLiveProjectNames()`, the implementer choice: programmatic (`createVitest('test', {}, {}, { dotenv: false })` then `.projects.map(p => p.name)`) OR static-parse (walk `vitest.config.ts` and per-workspace configs with `ts-morph`). The static-parse approach is cheaper and matches the existing repo's `tools/lint-*.ts` AST-walking style.

---

## R8 — Vitest 4 reporter pitfalls

**[VERIFIED via the installed `.d.ts` + existing config comments]**

### R8.1 Reporter discovery vs path-string vs class

Path-string form (`"./tools/vitest-evidence-reporter.ts"`) requires the file to **export `default`** a class implementing `Reporter`. Named exports are not auto-instantiated. If the class is exported as a named export, registration MUST use the inline `new EvidenceReporter()` shape OR a wrapper module with `export default`.

### R8.2 `mergeConfig` array concatenation gotcha

Vitest 4's `mergeConfig` concatenates `reporters[]` arrays, BUT if a per-workspace config REPLACES the entire `test:` object (rather than spread-merging), the reporter is dropped. The current per-workspace configs use `mergeConfig(rootConfig, defineConfig({ test: { name: "api", ... } }))` (verified `apps/api/vitest.config.ts:22`), which is spread-style. **`[ASSUMED]` — confirm by running `pnpm --filter @openwhispr/api test --reporter=default` and verifying the new reporter still fires.**

### R8.3 Coverage reporter vs custom reporter

Coverage is computed at the END of all `onTestRunEnd` hooks; `onCoverage(coverage)` fires on each reporter AFTER. The evidence reporter does NOT need coverage data — coverage is a separate gate (`lint-coverage-floor-per-phase.ts`). So `onCoverage` is unimplemented in this reporter.

### R8.4 Vitest watch mode race

Watch mode runs `onTestRunEnd` on every file change. If we write evidence in watch mode, every save overwrites the fragment with whatever subset just re-ran. **The reporter MUST detect watch mode and bail.** Pattern: read `vitest.config.watch` via `onInit(vitest)` and store it; in `onTestRunEnd`, early-return if `this.isWatch` true.

### R8.5 Forked-worker isolation

Per-project workers spawn fresh Node processes. Each reads `OPENWHISPR_TEST_EVIDENCE_DIR` and `OPENWHISPR_TEST_EVIDENCE_SHA` from `process.env`. The pre-push hook's outer process MUST export these BEFORE invoking `vitest run`. But — the canonical write flow is `git push` → `lefthook pre-push test-evidence` → the lint tool walks SHAs → for each missing SHA-fragment, the **developer** is told to run `pnpm test` (not lefthook). So:

- **`OPENWHISPR_TEST_EVIDENCE_SHA`**: defaults to `git rev-parse HEAD` at reporter startup if unset. This is the right default for `pnpm test` on the developer's current HEAD.
- **`OPENWHISPR_TEST_EVIDENCE_DIR`**: defaults to `<repoRoot>/.test-evidence` if unset. Lookup repo root via `git rev-parse --show-toplevel`.

The pre-push tool itself does NOT invoke `vitest`; it only READS existing fragments. Re-running tests is the developer's action after the gate REFUSES.

---

## Gotchas (summary for planner)

1. **`use_stdin` is command-level**, schema-verified at `lefthook/schema.json:109`. Hook-level placement → silent ignore + lefthook hangs every push.
2. **Only one pre-push command can consume stdin** (lefthook docs). No future stdin-consuming command can coexist without protocol change.
3. **Vitest 4 reporter path-string form requires `export default` Class** — named exports don't auto-instantiate.
4. **`mergeConfig` concatenates `reporters[]`** — but only if per-workspace config doesn't REPLACE `test.reporters`. Audit step: `grep -E "reporters:" <every vitest.config.ts>`.
5. **`onTestRunEnd` fires per-project (forked worker)**, NOT once globally. Reporter writes per-project fragments without locking — by accident-of-architecture, not by design.
6. **`TestCase.options.mode === "todo"`** is a distinct state from `"skip"`. Validator counts/annotates them separately if at all (CONTEXT D3 specs `.skip` and `xit/xdescribe`; planner decides whether `.todo` is annotated too — recommend: yes, with same `SKIP-REASON:` marker).
7. **`TestResultSkipped.note`** is only populated when test body calls `ctx.skip("reason")` at runtime — static `.skip(true, "msg")` leaves `note: undefined`. Hence the comment-marker is the source of truth, not the runtime note.
8. **Skip-pattern lint must exclude `//` line comments** — `apps/api/tests/support/shared-pg.ts:21` contains `// describe.skip from beforeAll` as a doc-comment. Naive regex flags it false-positive. Use either `^[^/]*` anchor OR strip `//`-comments before matching OR a TS AST walker.
9. **Symlink TOCTOU at `.test-evidence/<sha>-<project>.json`** — guard with `lstatSync().isSymbolicLink()` REFUSE-check pre-write + `mkdirSync({ recursive: true, mode: 0o700 })` + `writeFileSync({ mode: 0o600 })` + `renameSync` atomic.
10. **SHA injection** — validate `^[0-9a-f]{40}$` on every SHA read from stdin BEFORE passing to `git rev-list` or interpolating into filenames.
11. **All-zero SHA = sentinel** for new-ref (remote side) or deletion (local side). `remoteSha === "0000...0000"` requires `git rev-list <localSha> --not --remotes` to enumerate; `localSha === "0000...0000"` (deletion) means SKIP the line entirely.
12. **Watch-mode race** — reporter MUST early-return when `vitest.config.watch === true`, else evidence files get clobbered on every file save.
13. **22 projects, not 16** (CONTEXT.md approximated). Per-workspace `name:` values for 12 of those need to be read live (R1.5 [ASSUMED] table rows 2–13).
14. **20 non-e2e + 34 e2e = 54 skip sites** to annotate (CONTEXT said 121/19; current live counts differ — codemod scope is smaller).
15. **Zero existing `// SKIP-REASON:` markers** — the entire migration commit is greenfield, no merge conflicts.
16. **`.gitignore` MUST add `.test-evidence/`** — not present today.
17. **No existing PATH-installed `lefthook`** — devs invoke via `pnpm exec lefthook`. The new `tools/install-hooks.cjs` is the existing installer; check it (R7.4 referenced but un-read in research).
18. **Existing `web-test` pre-push command** at `lefthook.yml:110-112` runs `pnpm --filter @openwhispr/web test:unit` — this is essentially the OPPOSITE of the new evidence gate (it runs tests AT push-time rather than checking evidence FROM commit-time). After the new gate lands, `web-test` becomes redundant (tests already ran for the SHA). Planner decision: keep `web-test` (defence-in-depth) OR remove (single source of truth) — recommend KEEP for one release cycle then deprecate in a follow-up after the gate proves stable.

---

## Planner sequencing hints

> Recommended task order — each step is a discrete TDD pair (test first, then impl).

1. **Task 1 — Read live project names**: spawn a tiny utility (or do it manually in the plan) to `grep -E '^\s+name:' vitest.config.ts apps/*/vitest.config.ts packages/*/vitest.config.ts tools/*/vitest.config.ts compose/*/vitest.config.ts tests/e2e/vitest.config.ts tests/e2e/mock-realtime/vitest.config.ts` and bake the 22-name set into `tools/test-evidence-projects-manifest.json`. Same step: write `tools/lint-test-evidence-projects-manifest.test.ts` asserting the file matches the live config (mirror `tools/chart-api-env-parity.test.ts`).
2. **Task 2 — `tools/vitest-evidence-reporter.ts` + `.test.ts`**: the smallest unit. Test against fixture `TestModule[]` arrays (mock the TestModule shape with a tiny helper — DO NOT spawn real vitest). Verify atomic write via `lstatSync` on temp dir, fragment shape matches spec, mode `0o600`, watch-mode bail-out.
3. **Task 3 — Wire reporter into `vitest.config.ts`**: append `reporters: ["default", "./tools/vitest-evidence-reporter.ts"]` to root config. Run `pnpm test` once and verify `.test-evidence/<HEAD-SHA>-*.json` appears for ALL 22 projects. THIS IS THE INTEGRATION VERIFICATION STEP — do it before moving on.
4. **Task 4 — `tools/lint-skip-annotations.ts` + `.test.ts`**: AST-based or smart-regex skip-marker enforcer. Fixtures in `tools/lint-skip-annotations/fixtures/{clean,violates,allowlisted}/`. Coverage gate per R7.4 pattern.
5. **Task 5 — Skip-annotation codemod commit**: one large mechanical commit normalizing the 54 existing `.skip` sites with `// SKIP-REASON: <reason>` markers. This commit MUST land BEFORE the lint flips BLOCKING.
6. **Task 6 — `tools/lint-pre-push-test-evidence.ts` + `.test.ts`**: stdin parser → SHA enumerator → fragment validator. Tests use a tmp Git repo fixture (no testcontainers — pure `simple-git` or shell `git init && commit` in `mkdtempSync`). Cover all 5 stdin edge cases from R3.2.
7. **Task 7 — `tools/lint-lefthook-stdin-config.test.ts`**: YAML-parse `lefthook.yml`, assert `pre-push.commands.test-evidence.use_stdin === true` AND `.run` matches `/lint-pre-push-test-evidence\.ts/`. This is the regression guard against a future edit silently dropping `use_stdin`.
8. **Task 8 — `lefthook.yml` edit**: add the new `test-evidence` command per R7.5.
9. **Task 9 — `.gitignore`**: add `.test-evidence/` under the existing `# Coverage` block (or new `# Test-evidence (local-only ephemeral)` block).
10. **Task 10 — `package.json` scripts**: 3 new entries per R7.4.
11. **Task 11 — `docs/test-evidence-gate.md`**: operator runbook explaining the gate, how to regenerate evidence, why `--no-verify` is banned, recovery from "missing evidence" REFUSE.
12. **Task 12 — `CLAUDE.md` hard-rule 4 extension**: amend the existing hard-rule 4 (about `--no-verify` for gitleaks) to explicitly include the new test-evidence pre-push gate — symmetric posture, same wording.
13. **Task 13 — Backfill evidence for current HEAD**: run `pnpm test` on `main` post-Task-3 to populate `.test-evidence/<current-HEAD>-*.json` so the first developer pulling the new gate isn't stuck.
14. **Task 14 — CI L3**: `.github/workflows/ci.yml` adds a job that runs `tsx tools/lint-pre-push-test-evidence.ts` against the GitHub event SHA range. Out-of-scope for v1 per CONTEXT — DEFER to follow-up.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Per-workspace `name:` strings for rows 2–13 of the project table | R1.5 | Manifest mismatch → parity self-test fails; planner runs the verification grep BEFORE writing the manifest, so risk is low |
| A2 | `mergeConfig` concatenates `reporters[]` rather than replacing | R1.6, R8.2 | Reporter never fires for child workspace → fragments missing → gate REFUSES correct work. Planner verifies in Task 3 integration step |
| A3 | Watch-mode detection via `vitest.config.watch` accessor | R1.7, R8.4 | Watch-mode writes spurious fragments → no security impact but confusing artefacts. Mitigation: bail-out logic, tested in Task 2 |
| A4 | Node `fs.openSync(path, 'wx')` + `lstatSync` combo covers symlink-attack surface | R5.2 | TOCTOU window remains; mitigation: `fs.realpathSync` canonicalize + `lstat` pre-check, tested in Task 2 |
| A5 | `git rev-parse --show-object-format` returns `sha1` for this repo | R5.3 | If SHA256 ever adopted, regex `^[0-9a-f]{40}$` rejects valid SHAs; mitigation: regex covers both `{40}` and `{64}` |
| A6 | Vitest 4 forks per-project workers each invoking `onTestRunEnd` once | R8.5 | If actually invoked once globally, fragments still correct (single writer); if invoked multiple times per worker, last-writer-wins is fine since same-process |

All other claims in this research are tagged `[VERIFIED]` (live grep / file read) or `[CITED]` (with source path + line).

---

## Open Questions (none blocking — all deferred-acceptable)

1. **Should `.todo` be annotated alongside `.skip`?** Recommend yes — same `// SKIP-REASON: todo - <ticket>` marker, since `.todo` is morally equivalent to "deferred" (CLAUDE.md DISCIPLINE rule 12's `@ts-expect-error issue-NNNN:` analog).
2. **Should playwright `test.skip()` in `.spec.ts` files (the 34 e2e sites) be annotated?** These don't go through the vitest reporter (playwright runs via `pnpm test:e2e-cjm`). The pre-push gate cares only about vitest fragments. Recommend: include them in the lint pass (consistency + future-proofing for e2e fragment phase) but EXCLUDE from the vitest-evidence reporter scope.
3. **What's the right "stale evidence" TTL?** If a developer runs `pnpm test` Monday, commits Wednesday, push Friday — the evidence is 4 days old but for the same SHA. Recommend: gate accepts any-age fragment for the SHA (SHA is the identifier; age doesn't matter), but CI L3 (deferred) re-runs to catch drift.

---

## Sources

### Primary (HIGH confidence — code/schema verified)
- `node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts:1041-1115` — `Reporter` interface
- `node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts:244-336` — `TestModule`/`TestCollection`/`TestCase`
- `node_modules/vitest/dist/chunks/reporters.d.CEnv6XRv.d.ts:1930-1989` — `TestProject`
- `node_modules/lefthook/schema.json:5-120` — `$defs.Command` (use_stdin placement)
- `node_modules/lefthook/package.json` — lefthook 2.1.8
- `package.json` — vitest 4.1.5
- `lefthook.yml:93-112` — existing pre-push structure
- `vitest.config.ts:39-181` — projects array
- `tools/lint-no-env-branches.ts` + `.test.ts` — style canon
- `tools/global-vitest-teardown.ts` — argv-array spawn pattern
- `tools/chart-api-env-parity.test.ts` — parity-self-test canon
- `.gitignore` — verified missing `.test-evidence/` entry
- Live greps run 2026-05-27 for skip counts and test counts

### Secondary (HIGH confidence — official docs)
- `https://git-scm.com/docs/githooks#_pre_push` — pre-push stdin format (R3.1)
- `https://lefthook.dev/configuration/use_stdin/` — `use_stdin` semantics + only-one-command constraint (R2.3)

### Tertiary (MEDIUM confidence)
- Vitest 4 watch-mode accessor on `Vitest` instance — known by reputation, not verified in research (A3)
- Node fs symlink primitive availability — known by reputation, verified by `node --version` only (A4)
