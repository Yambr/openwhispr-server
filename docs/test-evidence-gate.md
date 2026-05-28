<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->

# Pre-push test-evidence gate (Quick 260527-pj6)

> **Status:** BLOCKING from v1.0.12 (chart 1.0.15). No `--warn-only` flag, no allowlist.
> **Posture:** identical to gitleaks pre-commit / pre-push — `--no-verify` is constitutionally prohibited (CLAUDE.md hard-rule 4, extended).

## 1 — What the gate does

The gate closes the **"tests pass locally but the push happens before tests finish"** anti-pattern. After this lands, every `git push` to `origin` is REFUSED when the TIP commit of any pushed ref lacks `.test-evidence/<sha>-<project>.json` fragments covering **all 22** canonical vitest projects, OR with any fragment whose `exit_code !== 0` or `state !== "passed"`, OR with any un-annotated `.skip` / `.todo` site.

### Three-layer defence (gitleaks parity)

| Layer | Where | When | What |
|---|---|---|---|
| **L1 — Reporter** | `tools/test-evidence-reporter.ts` | At every `vitest run` invocation | Writes one `.test-evidence/<sha>-<project>.json` fragment per workspace project at end of test run. Atomic write (`tmp+rename`); refuses symlink targets; canonicalises evidence dir via `realpathSync`. |
| **L2 — Pre-push validator** | `tools/lint-pre-push-test-evidence.ts` via lefthook `pre-push.scripts['test-evidence.sh']` (script `.lefthook/pre-push/test-evidence.sh`) | At every `git push` from a developer workstation | Reads pre-push stdin, validates the TIP commit of each pushed ref, asserts the full 22-project manifest is covered on the tip, all `exit_code === 0`, no un-annotated skips. (It is a SCRIPT not a command because lefthook commands get file-skipped on an empty push diff, leaving the gate dormant on an in-sync branch — #57.) |
| **L3 — CI redundant validator** | (deferred per CONTEXT — out of scope this Quick) | At every PR / push event in GitHub Actions | Re-runs L2 against the GitHub event-SHA range. Catches developers who bypass L2 with `--no-verify` (constitutionally prohibited). |

CI environments (`GITHUB_ACTIONS=true` or `CI=true`) bypass L2 with a stderr audit log — CI runs tests directly with its own coverage gates, so requiring evidence from L1 would deadlock.

### Why tip-only (TDD compatibility)

The gate validates **only the TIP commit of each pushed ref**, not every commit in the push range. A `test: red` commit has failing tests BY DESIGN — the test exists, the implementation does not yet — so a red commit can never produce passing evidence. Validating every commit in a push range would therefore make the gate structurally incompatible with the constitutional RED→GREEN→REFACTOR discipline (a proper red→green→refactor history would always deadlock).

What gets merged and deployed is the final tree state at the TIP of the push, so the gate validates exactly that: the tip's evidence. Intermediate red/green commits are TDD process artifacts, not deploy artifacts. (Reference Quick 260528-eqn.)

## 2 — Normal developer flow

```sh
# 1. Make a change
git checkout -b feat/my-feature
# ... edit code ...

# 2. Run all tests (writes evidence fragments)
pnpm test:all
# ↳ This is `pnpm -r test`, which fans out to every workspace.
#   Each workspace's vitest run writes one .test-evidence/<sha>-<project>.json fragment
#   for the current HEAD SHA.

# 3. Stage + commit (gitleaks fires on pre-commit; reporter-inheritance lint fires too)
git add ...
git commit -m "feat(area): description"

# 4. Push (gate fires on pre-push)
git push
# ↳ Hook reads the local→remote ref tuples from stdin, takes the TIP commit
#   of each pushed ref, and validates evidence for that tip. Passes → push proceeds.
#   Fails → REFUSED with a structured stderr describing the missing/failing
#   project, and a remediation hint.
```

The reporter is **idempotent + safe under watch mode**: `vitest --watch` skips the evidence write (`onInit` captures `vitest.config.watch === true`) so file watchers don't churn fragments mid-edit.

## 3 — Evidence fragment shape

One file per `(commit_sha, project)` tuple at `.test-evidence/<commit_sha>-<project>.json`:

```json
{
  "schema": 1,
  "generated_at": "2026-05-27T18:30:00.000Z",
  "project": "api",
  "commit_sha": "8ca2378805202d45f63b5a7f47d3f095f7cc7e08",
  "branch": "feat/pre-push-test-evidence-gate",
  "reason": "passed",
  "exit_code": 0,
  "total": 412,
  "pass": 411,
  "fail": 0,
  "skip": 1,
  "todo": 0,
  "unannotated_skip": 0,
  "failures": [],
  "skips": [
    {
      "file": "apps/api/tests/support/shared-pg.test.ts",
      "line": 42,
      "name": "shared-pg > verifies isolation under Postgres",
      "mode": "skip",
      "annotated": true,
      "skip_reason": "requires-docker — testcontainers needs Docker socket"
    }
  ]
}
```

**Hard rejection criteria** (gate exits 1 on ANY):
- `exit_code !== 0`
- `fail > 0`
- `reason !== "passed"`
- `unannotated_skip > 0`

**Path safety**: the validator canonicalises `<repo-root>/.test-evidence` via `fs.realpathSync` and refuses any fragment file that is itself a symlink (`fs.lstatSync(path).isSymbolicLink()`). The reporter writes fragments atomically via tmp+rename with `O_EXCL | 0o600`.

## 4 — SKIP-REASON annotation requirement

Every `.skip` / `.todo` call site MUST carry a `// SKIP-REASON: <≥10 chars>` annotation within **5 lines above** the call. The annotation is parsed AST-aware via `ts-morph` (not regex; see `tools/lint-skip-annotations.ts` for the comment-aware walker — the false-positive case at `apps/api/tests/support/shared-pg.ts:21` `// describe.skip from beforeAll` is correctly skipped).

**Accepted shape:**

```ts
// SKIP-REASON: requires-docker — testcontainers-postgresql needs Docker socket
it.skip("verifies behaviour under real Postgres", () => { /* ... */ });
```

**Rejected shapes:**

```ts
// no annotation
it.skip("..."); // REFUSED: <file>:<line> — it.skip missing // SKIP-REASON: <≥10 chars> within 5 lines above

// annotation too short (< 10 chars after "SKIP-REASON: ")
// SKIP-REASON: TODO
it.skip("..."); // REFUSED

// annotation outside 5-line window (6 lines above)
// SKIP-REASON: too-far-away — outside the window
//
//
//
//
//
it.skip("..."); // REFUSED
```

Treats `it.skip`, `test.skip`, `describe.skip`, `it.todo`, `test.todo`, `describe.todo`, `xit`, `xdescribe` identically.

### SKIP-REASON taxonomy (recommended)

1. **`requires-docker`** — test needs Docker socket / testcontainers (Postgres / Valkey / mock-litellm / Speaches).
2. **`topology-gated`** — test requires multi-node topology not present locally (e.g. distributed MinIO).
3. **`setup-complete`** — test runs only when an out-of-band setup completed (e.g. real Resend domain verified).
4. **`deferred-fix`** — known flaky / known broken, linked to a tracked deferred-items.md entry.

## 5 — CI bypass semantics

The L2 pre-push validator bypasses when `process.env.GITHUB_ACTIONS === "true"` OR `process.env.CI === "true"`:

```
[ci] skipping evidence gate (CI runs validator directly)
```

The bypass is **unconditional** and emits the audit line to stderr regardless of verbosity. Rationale:

- CI environments run tests directly with their own coverage thresholds; the L1 reporter still writes fragments inside CI, but L2 would simply re-validate something CI already validated.
- CI is the L3 layer that catches `--no-verify` bypassers on the remote side (deferred but constitutional).

**Anti-abuse**: a developer who exports `CI=1` locally would silently bypass L2. The audit log surfaces the bypass; the deferred L3 GitHub Actions check catches the missing evidence at PR time.

## 6 — Canonical 22-project manifest

The 22 vitest projects gate-monitored are pinned in `tools/test-evidence-projects-manifest.json`:

```
api                              (apps/api/vitest.config.ts)
web                              (apps/web/vitest.config.ts)
worker                           (apps/worker/vitest.config.ts)
data                             (packages/data/vitest.config.ts)
@openwhispr/byok-guard           (packages/byok-guard/vitest.config.ts)
@openwhispr/contract-tests       (packages/contract-tests/vitest.config.ts)
@openwhispr/email                (packages/email/vitest.config.ts)
@openwhispr/litellm-client       (packages/litellm-client/vitest.config.ts)
load-test                        (tools/load-test/vitest.config.ts)
test-probe                       (tools/test-probe/vitest.config.ts)
mock-litellm                     (compose/mock-litellm/vitest.config.ts)
e2e                              (tests/e2e/vitest.config.ts)
mock-realtime                    (tests/e2e/mock-realtime/vitest.config.ts)
@openwhispr/auth-stub            (vitest.config.ts inline)
@openwhispr/i18n-stub            (vitest.config.ts inline)
@openwhispr/observability        (vitest.config.ts inline)
@openwhispr/wire-schemas         (vitest.config.ts inline)
tools                            (vitest.config.ts inline)
tests-e2e-cjm-steps              (vitest.config.ts inline)
tests-e2e-cjm-support            (vitest.config.ts inline)
tests-integration                (vitest.config.ts inline)
tests-self-tests                 (vitest.config.ts inline)
```

Parity with the live `vitest.config.ts:projects[]` is enforced by `tools/__tests__/test-evidence-projects-manifest.test.ts`, which walks every root + per-workspace `vitest.config.ts` via `ts-morph` and asserts `new Set(manifest.projects) === new Set(liveProjectNames)`. The test fails on either addition or removal of a project without manifest update.

## 7 — Recovery scenarios

### 7.1 "Missing project X" REFUSE

```
❌ No test evidence for commit <sha>. Missing projects: [api, web]. Run `pnpm test:all` to regenerate.
```

**Cause**: `pnpm --filter <Y>` was used instead of `pnpm test:all`, OR the workspace registers a `reporters:` override that drops the evidence reporter.

**Resolution**:
```sh
rm -rf .test-evidence/$(git rev-parse HEAD)-*.json
pnpm test:all
git push   # gate should now accept
```

If the same project keeps missing after `pnpm test:all`, audit:
```sh
pnpm lint:vitest-reporter-inheritance   # names <file>:<line> precisely
```

Any workspace whose `reporters:` array does NOT include the evidence reporter is the culprit (`mergeConfig` REPLACES reporters[] instead of merging). Add the reporter to that workspace's array OR omit `reporters:` entirely to inherit from root.

### 7.2 "Stale evidence" (SHA mismatch after rebase)

**Cause**: tests were run pre-rebase; the rebase changed HEAD SHA; fragments are for the old SHA.

**Resolution**:
```sh
pnpm test:all   # writes fragments for the new HEAD SHA
git push
```

### 7.3 "Unannotated skip in <project>" REFUSE

```
❌ Fragment for project <X>: 2 unannotated_skip site(s):
  apps/<area>/tests/foo.test.ts:42 — it.skip
  apps/<area>/tests/bar.test.ts:17 — describe.skip
```

**Cause**: a `.skip` / `.todo` call landed without `// SKIP-REASON: <≥10 chars>` within 5 lines above.

**Resolution**: open the file:line reported in stderr; add the annotation:

```ts
// SKIP-REASON: requires-docker — testcontainers-postgresql needs Docker socket
it.skip("verifies behaviour under real Postgres", () => { /* ... */ });
```

Re-run `pnpm test:all` (fragment regenerates) and `git push`.

### 7.4 "Malformed evidence" REFUSE

```
❌ Malformed evidence at .test-evidence/<sha>-api.json
```

**Cause**: an interrupted test run left a `.test-evidence/<sha>-<project>.json.tmp.<pid>` orphan, or a manual edit corrupted the JSON.

**Resolution**:
```sh
rm -rf .test-evidence/
pnpm test:all
git push
```

### 7.5 NEVER `--no-verify`

CLAUDE.md hard-rule 4 prohibits `--no-verify` on the test-evidence gate, identically to gitleaks. Use the remediation steps above. Bypassing is a constitutional violation; the deferred L3 CI check catches it on the remote side regardless.

> Quoting CLAUDE.md:
>
> > NEVER bypass the gitleaks pre-commit / pre-push hooks. […] This extends to the pre-push test-evidence gate (260527-pj6) — never bypass for test failures or missing evidence.

## 8 — Workspace reporter inheritance contract

Three accepted shapes for `reporters:` in any `vitest.config.ts`:

1. **Absent** — workspace omits `reporters:` entirely → inherits from root config → ACCEPTED.
2. **Explicit array containing evidence reporter** — `reporters: [..., "./tools/test-evidence-reporter.ts"]` or `reporters: [..., resolve(ROOT_DIR, "tools/test-evidence-reporter.ts")]` → ACCEPTED.
3. **Anything else** — string-form, spread form, computed-variable form → REFUSED by `pnpm lint:vitest-reporter-inheritance` at pre-commit time.

Wired to **lefthook pre-commit** as `commands.vitest-reporter-inheritance` so reporter-inheritance drift is caught at commit-time, not push-time.

The L1 reporter relies on this contract: `mergeConfig` REPLACES (not merges) the `reporters[]` array across workspaces, so any workspace that declares its own `reporters:` MUST explicitly include the evidence reporter or the workspace will silently emit zero fragments and L2 will refuse the push.

## 9 — Codemod placeholder cleanup (audit backlog)

The Wave 1 codemod normalised 35 pre-existing `.skip`/`.todo` sites by inserting placeholder annotations of shape:

```
// SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
```

These placeholders pass the lint at landing time. Each placeholder is a tracked TODO with precise `<file>:<line>` location enumerated in:

```
.planning/quick/260527-pj6-pre-push-test-evidence-gate/SKIP-AUDIT-BACKLOG.md
```

(4-column format: file path | line number | current placeholder | suggested investigation steps).

**Follow-up Quick**: each placeholder must be audited — `git blame` the `.skip(` line to find the original PR, read PR description for skip rationale, classify per §4 taxonomy (`requires-docker` / `topology-gated` / `setup-complete` / `deferred-fix`), replace placeholder with real reason, drop the row from `SKIP-AUDIT-BACKLOG.md`. Cross-referenced in `.planning/deferred-items.md` for visibility.

## 10 — Operator commands quick reference

| Command | Purpose |
|---|---|
| `pnpm test:all` | Run every workspace's vitest project, writing 22 evidence fragments per HEAD SHA. |
| `pnpm test:evidence` | Alias for `test:all` — explicit name when invoking purely for evidence regeneration. |
| `pnpm test:evidence:check` | Synthesise a pre-push stdin line for HEAD against zero-SHA remote (treats as new-ref push), pipe to L2 validator. Useful for manually re-validating without an actual `git push`. |
| `pnpm test:evidence:projects-self-test` | Spawn `pnpm test:all` internally + check 22/22 manifest coverage. Replaces the Wave-3 prose self-test. Used by Wave 4 to gate the atomic commit. |
| `pnpm lint:skip-annotations` | CLI entry — scan all `.skip` / `.todo` sites for SKIP-REASON annotation compliance. |
| `pnpm lint:pre-push-test-evidence` | CLI entry — L2 validator; reads stdin in Git pre-push format. |
| `pnpm lint:vitest-reporter-inheritance` | CLI entry — workspace reporter inheritance lint (defence-in-depth for inheritance drift). |

## 11 — Constitutional alignment

- **CLAUDE.md hard-rule 4** (no `--no-verify`) — extended symmetrically; `--no-verify` is prohibited on this gate, same posture as gitleaks.
- **DISCIPLINE** "test coverage ≥ 90/90/90/90" — every new tool ships with its `.test.ts` at the constitutional floor (enforced by per-tool `test:*` scripts in `package.json`).
- **TDD** — RED→GREEN→REFACTOR; tests landed in the same atomic commit as implementation, per Quick 260527-pj6 wave structure.
- **LOCKER-05** — error message truncation: fragment field `error_message_truncated` is capped at 1000 chars per record.
- **LOCKER-06** — no shell credential interpolation: the pre-push script `.lefthook/pre-push/test-evidence.sh` execs `pnpm exec tsx tools/lint-pre-push-test-evidence.ts` in argv form (no `*_URL/*_KEY/*_TOKEN` interpolation, `set -euo pipefail`); codemod / validator / projects-self-test spawn Git via argv-array `spawnSync('git', [...], { shell: false })`.

End of operator runbook.
