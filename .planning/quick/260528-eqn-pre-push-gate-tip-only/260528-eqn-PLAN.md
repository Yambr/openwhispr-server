---
phase: quick-260528-eqn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tools/lint-pre-push-test-evidence.ts
  - tools/__tests__/lint-pre-push-test-evidence.test.ts
  - docs/test-evidence-gate.md
autonomous: true
requirements: []
quick_id: 260528-eqn

must_haves:
  truths:
    - "A push whose intermediate commits are red (no/failing evidence) but whose tip commit has all-22 green fragments is ACCEPTED (exit 0) — TDD red→green→refactor history no longer deadlocks the gate."
    - "A push whose TIP commit is missing evidence (or has failing/unannotated-skip fragments) is REFUSED (exit 1) — the gate still guards what actually lands."
    - "A tag push of a commit already on a remote (rev-list --not --remotes empty) still exits 0 (F13 optimization preserved)."
    - "A deletion push (localSha = 0x40) still exits 0 with nothing validated (F12/F18)."
    - "Multi-ref pushes still validate each ref independently, but only that ref's own tip commit."
    - "Per-file coverage on tools/lint-pre-push-test-evidence.ts stays >= 90/90/90/90."
  artifacts:
    - path: "tools/lint-pre-push-test-evidence.ts"
      provides: "enumerateCommitsForRef returns ONLY the tip commit (or [] for deletion / already-on-remote), not the rev-list range"
      contains: "rev-list"
    - path: "tools/__tests__/lint-pre-push-test-evidence.test.ts"
      provides: "Flipped F14/F17 assertions + new tip-only TDD-compat regression test (F19)"
      contains: "tip-only"
    - path: "docs/test-evidence-gate.md"
      provides: "Contract description updated to tip-only with a 'Why tip-only (TDD compatibility)' subsection"
      contains: "tip"
  key_links:
    - from: "runMain (tools/lint-pre-push-test-evidence.ts)"
      to: "enumerateCommitsForRef"
      via: "per-push-line SHA enumeration"
      pattern: "enumerateCommitsForRef\\(line"
    - from: "F19 regression test"
      to: "runMain"
      via: "3-commit chain, evidence on tip only, asserts exit 0"
      pattern: "runValidator|runMain"
---

<objective>
Fix the pre-push test-evidence gate (`tools/lint-pre-push-test-evidence.ts`) so it validates ONLY the TIP commit of each pushed ref instead of every commit in the push's rev-list range.

Purpose: The current per-commit-range behavior is STRUCTURALLY INCOMPATIBLE with the project's constitutional TDD discipline. A `test: red` commit has failing tests BY DESIGN, so it can never produce passing evidence — meaning the per-commit gate can NEVER pass on a proper red→green→refactor history. What lands/deploys is the final tree state at the tip; intermediate red commits are TDD *process* artifacts, not deploy artifacts. User decision (verbatim): "надо препуш а не прекоммит и проверять крайний комит" — keep the gate at PRE-PUSH and validate only the TIP (крайний = last/tip = localSha).

Output: `enumerateCommitsForRef` returns the tip SHA only (preserving the F13 "already on remote → []" optimization and the F12/F18 deletion → [] path); the test contract is flipped from range to tip-only via strict RED→GREEN; the file header doc comment and the operator runbook are updated to describe tip-only with a TDD-compatibility rationale.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- Key surfaces the executor needs. Extracted from the codebase — no exploration required. -->

From tools/lint-pre-push-test-evidence.ts:

The CURRENT enumerateCommitsForRef (lines 136-185) — the function to change:
- Signature: `function enumerateCommitsForRef(line: PushLine, repoRoot: string): string[]`
- PushLine shape: `{ localRef: string; localSha: string; remoteRef: string; remoteSha: string }`
- Constants in module scope: `NULL_SHA = "0".repeat(40)`, `SHA40_RE = /^[0-9a-f]{40}$/`, `validateSha(s): boolean`.
- Current body:
  1. if `localSha === NULL_SHA` → return [] (deletion).  [KEEP UNCHANGED]
  2. if `!validateSha(localSha)` → throw `malformed SHA from pre-push stdin: ${localSha}`.  [KEEP UNCHANGED]
  3. build argv: `remoteSha === NULL_SHA ? ["rev-list", localSha, "--not", "--remotes"] : ["rev-list", `${remoteSha}..${localSha}`]`.  [THIS TERNARY IS THE CHANGE — see Task 2]
  4. execFileSync("git", argv, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore","pipe","pipe"] }) wrapped in try/catch (catch is a c8-ignore block, lines 165-171).
  5. split stdout on "\n", trim, filter non-empty → `shas`.
  6. for each sha: `if (!validateSha(s)) throw` (the throw is a c8-ignore block, lines 178-182).
  7. return shas.

runMain consumer (lines 399-420) — UNCHANGED:
```
for (const line of lines) {
  let shas: string[];
  try { shas = enumerateCommitsForRef(line, deps.repoRoot); }
  catch (err) { deps.stderr.write(...); return 1; }
  for (const sha of shas) {
    totalCommits += 1;
    const { violations } = validateOneCommit(sha, deps.evidenceDir, canonicalEvidenceDir, projects);
    for (const v of violations) allViolations.push(v);
  }
}
```
validateOneCommit (lines 255-331) — UNCHANGED. It emits a `missing-projects` violation when any of the 22 fragments is absent for a SHA, plus `fragment-failed` / `fragment-unannotated-skip` / `fragment-malformed` / `fragment-symlink` violations.

From tools/__tests__/lint-pre-push-test-evidence.test.ts:
- Test harness (lines 116-151): `makeRepo()` inits a REAL git repo (`git init -q -b main`) under tmpdir; `commitInRepo(repo, content, msg)` writes file.txt + commits + returns HEAD SHA; `writeAllClean(sha)` writes all 22 clean-PASS fragments; `writeFragment(sha, project, body)` writes one fragment; `runValidator(stdin, env)` calls `runMain` with the test repo as repoRoot and captures exitCode/stdout/stderr.
- `NULL_SHA = "0".repeat(40)` at module scope.
- F13 (lines 375-388): tag push, marks commit on `refs/remotes/origin/main` via `git update-ref`, asserts exit 0 (rev-list --not --remotes empty).
- F14 (lines 390-398): new-branch push (remoteSha = NULL_SHA), single commit, asserts exit 0. Title says "enumerates each commit via rev-list <localSha> --not --remotes".
- F17 (lines 429-467): TWO `it()` blocks. First (lines 430-453) builds M-A-B (on remote) then rewinds to M and builds C-D, pushes remoteSha=b localSha=d, writes evidence for c+d, asserts exit 0; title "enumerates unique-to-localSha commits via rev-list remoteSha..localSha". Second (lines 454-466) same divergent history but evidence ONLY on d (c missing), asserts exit 1 + stderr matches `c`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — flip the test contract from per-commit-range to tip-only</name>
  <files>tools/__tests__/lint-pre-push-test-evidence.test.ts</files>
  <behavior>
    These assertions must FAIL against the current range-based enumerateCommitsForRef (that is the RED proof), and PASS after Task 2:
    - F14 (new-branch push): rename intent to tip-only. Build a 3-commit chain in the test repo (c1 → c2 → tip via three commitInRepo calls). Write all-22 clean fragments for the TIP ONLY; write NO fragments for c1/c2. stdin: `refs/heads/new-feature ${tip} refs/heads/new-feature ${NULL_SHA}`. Assert exit 0. (Under the OLD range impl, rev-list <tip> --not --remotes enumerates ALL THREE commits → c1/c2 missing evidence → exit 1 → RED.)
    - F17 first it() → rewrite to "validates only the tip d". Keep the M-A-B-then-C-D divergent-history harness. Write all-22 clean fragments for the TIP d ONLY; write NO fragments for c. stdin: `refs/heads/main ${d} refs/heads/main ${b}`. Assert exit 0. (Under OLD impl, rev-list b..d enumerates [c,d] → c missing → exit 1 → RED.)
    - F17 second it() → INVERT it. Title: "refuses when the TIP commit itself has no evidence (non-tip gaps are now allowed)". Same divergent history; write all-22 fragments for c (a NON-tip commit) but NONE for tip d. stdin: `refs/heads/main ${d} refs/heads/main ${b}`. Assert exit 1 AND stderr matches the tip SHA `d` (NOT c). (Under OLD impl, c has evidence + d has evidence-gap → still exit 1 but for d; under tip-only d-missing is the only thing checked → exit 1 for d. This case must end GREEN after Task 2 and is the proof that the TIP is still guarded.)
    - F11 (multi-ref): leave behavior intact — each ref's own tip is still validated; the existing single-commit-per-ref setup already validates only the tip, so this stays green. Add a clarifying comment that with tip-only each ref contributes exactly its localSha.
    - NEW F19 "tip-only — TDD-compat: red intermediate commits, green tip → exit 0": Build a 3-commit chain c1 (would be a `test: red` commit), c2 (intermediate), tip (green). Write all-22 clean fragments for the TIP ONLY. Optionally write a FAILING fragment (exit_code:1, fail:1, reason:"failed") for c1 to model a real red commit; write nothing for c2. stdin: `refs/heads/main ${tip} refs/heads/main ${c0base}` where c0base is the commit BEFORE c1 (use an initial base commit, then build c1/c2/tip on top, push remoteSha=base localSha=tip). Assert exit 0. This is the load-bearing TDD-compatibility regression proof.
    - F13 / F12 / F18 / F1-F10 / F15 / F16 and all "empty stdin" / "manifest" / "malformed stdin" / "evidence dir does not yet exist" cases: MUST remain unchanged and green.
  </behavior>
  <action>
    Edit `tools/__tests__/lint-pre-push-test-evidence.test.ts` ONLY in this task. Do NOT touch the production .ts file yet (this is the RED step — the assertions must fail first against the unchanged range-based impl).

    1. Update the F14 describe/it: replace the single-commit setup with a 3-commit chain. Use the existing `commitInRepo(root, ...)` helper three times to produce c1, c2, tip. Call `writeAllClean(tip)` only. Title the it() "validates only the tip commit (intermediate commits need no evidence)". stdin as in <behavior>. Assert exit 0. Update the F14 header comment block at the top of the file (lines 22 area) from "enumerates each commit" to "validates only the tip".

    2. Rewrite F17's two it() blocks per <behavior>. First it(): "validates only the tip d (non-tip c needs no evidence)" — evidence on d only, assert exit 0. Second it(): "refuses when the TIP commit itself has no evidence" — evidence on c (non-tip) only, NONE on d, assert exit 1 + `expect(r.stderr).toMatch(new RegExp(d))`. Remove the now-stale `void a;` / range-comment cruft as needed but KEEP the divergent-history construction (it is what makes the tip ≠ full-range distinction observable). Update the F17 header comment (line 25 area) from "enumerates unique commits ... rev-list remoteSha..localSha" to "validates only the tip of the pushed range (TDD-compatible)".

    3. Add the new F19 describe block after F18 (or after F17 — placement is cosmetic) per the <behavior> F19 spec. Build a base commit first so remoteSha=base is a real parent, then c1/c2/tip on top. Write all-22 clean fragments for tip; write a failing fragment for c1 via `writeFragment(c1, "api", { reason:"failed", exit_code:1, total:1, pass:0, fail:1, failures:[{file:"x.test.ts", name:"red", error_message_truncated:"intentional red"}] })` to model a TDD red commit (do NOT write the other 21 for c1 — a red commit has no full evidence by design). Assert exit 0.

    4. Add a one-line clarifying comment to F11 noting tip-only contributes exactly localSha per ref.

    Do NOT introduce `as any` / `@ts-ignore` / `@ts-expect-error` (LOCKER-02). Reuse the typed `EvidenceFragmentForTest` import already at the top of the file. English-only (project hard rule).
  </action>
  <verify>
    <automated>pnpm exec vitest run --project tools --reporter=dot tools/__tests__/lint-pre-push-test-evidence.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>The edited F14, F17 (both it blocks), and new F19 cases FAIL against the current range-based production code (RED confirmed); F13/F12/F18/F1-F10/F15/F16 and the misc cases still pass. Capture the failing test names — they are the RED evidence for the same-commit GREEN in Task 2.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — enumerateCommitsForRef returns the tip only; update header doc</name>
  <files>tools/lint-pre-push-test-evidence.ts</files>
  <behavior>
    After this change, enumerateCommitsForRef(line, repoRoot):
    - localSha === NULL_SHA (deletion) → return [] (unchanged).
    - !validateSha(localSha) → throw `malformed SHA from pre-push stdin: ${localSha}` (unchanged).
    - Otherwise: run `git rev-list localSha --not --remotes`. If the output is EMPTY (commit already on a remote — e.g. tag push of an already-validated commit, F13) → return []. Otherwise → return EXACTLY `[localSha]` (the tip). The `remoteSha..localSha` range branch is REMOVED entirely; the only rev-list call remaining is the single `--not --remotes` emptiness probe.
    - Keep the 40-hex validation on localSha (already done above before the probe) and on the probe output is no longer iterated for return (we return [localSha], not the probe list) — but the probe's own SHAs need no per-line validation since we don't return them. Drop the now-dead per-sha validation loop OR keep a single validateSha(localSha) guard; choose whichever keeps coverage clean without dead code.
  </behavior>
  <action>
    Edit `tools/lint-pre-push-test-evidence.ts` ONLY in this task — code + the Task-1 tests land in the SAME atomic commit per project constitution (RED+GREEN together).

    1. Rewrite `enumerateCommitsForRef` (lines 136-185):
       - Keep the deletion early-return (`if (localSha === NULL_SHA) return [];`).
       - Keep the `if (!validateSha(localSha)) throw ...` guard.
       - REMOVE the `remoteSha === NULL_SHA ? [...] : ["rev-list", `${remoteSha}..${localSha}`]` ternary. Replace argv with the FIXED `["rev-list", localSha, "--not", "--remotes"]`.
       - Run execFileSync with that argv (keep the existing try/catch; the catch stays a c8-ignore block — git rev-list always succeeds on a populated repo).
       - Parse stdout: split "\n", trim, filter non-empty → `probe`. If `probe.length === 0` → `return []` (preserves F13 already-on-remote optimization).
       - Otherwise → `return [localSha]`.
       - `remoteSha` is now UNUSED in the function body. Either destructure only `localSha` from `line` (`const { localSha } = line;`) or reference `remoteSha` is dropped — make sure no unused-var lint fires.
       - The previous per-sha `for (const s of shas) { if (!validateSha(s)) throw }` loop becomes dead (we no longer return the probe list). REMOVE it (and its c8-ignore block at lines 178-182) since localSha is already validated above and is the only SHA returned. This keeps coverage clean — no orphaned c8-ignore for an unreachable branch.

    2. Update the file HEADER doc comment (lines 6-23 area): change the contract description from "for any pushed commit SHA without ..." / "enumerates each pushed commit SHA" to "for the TIP commit of each pushed ref without ...". In the "Refusal criteria" list change "Any pushed commit SHA lacks a fragment" to "The TIP commit of any pushed ref lacks a fragment". Add ONE line of rationale: "Tip-only: intermediate commits in a push are TDD process artifacts (a `test: red` commit fails by design); the gate validates the tip tree state that actually lands." Keep the CI-bypass / path-safety / exit-code prose unchanged.

    3. Do NOT add `as any` / `@ts-ignore` / NODE_ENV branches. Do NOT change runMain, validateOneCommit, expectedFragmentPath, parseStdin, or any other function. Do NOT change Chart.yaml / appVersion / package.json. Do NOT touch the reporter or manifest.
  </action>
  <verify>
    <automated>pnpm exec vitest run tools/__tests__/lint-pre-push-test-evidence.test.ts --coverage --coverage.include=tools/lint-pre-push-test-evidence.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90 2>&1 | tail -25</automated>
  </verify>
  <done>All tests in the file pass (Task-1 RED cases now GREEN, including F19 TDD-compat and the inverted F17 tip-missing case). Per-file coverage on tools/lint-pre-push-test-evidence.ts is >= 90/90/90/90 on lines/branches/functions/statements (baseline was 100/95.12/100/100; the removed range branch must not drop any axis below 90). No new c8-ignore blocks orphaned. `git diff` shows ONLY the test file (Task 1) + this production file changed — no Chart.yaml/appVersion/package.json/reporter/manifest delta.</done>
</task>

<task type="auto">
  <name>Task 3: Update operator runbook to tip-only + TDD-compat rationale</name>
  <files>docs/test-evidence-gate.md</files>
  <action>
    Edit `docs/test-evidence-gate.md` to reflect tip-only validation:

    1. §1 "What the gate does" (line 10): change "every `git push` to `origin` is REFUSED for any pushed commit SHA without ..." to "every `git push` to `origin` is REFUSED when the TIP commit of any pushed ref lacks `.test-evidence/<sha>-<project>.json` fragments covering all 22 canonical vitest projects, OR with any fragment whose `exit_code !== 0` or `reason !== "passed"`, OR with any un-annotated `.skip`/`.todo` site."

    2. §1 three-layer table, L2 row (line 17): change "enumerates each pushed commit SHA, asserts the full 22-project manifest is covered per SHA" to "validates the TIP commit of each pushed ref, asserts the full 22-project manifest is covered on the tip".

    3. Add a NEW short subsection right after §1's three-layer-defence table (before §2), titled "### Why tip-only (TDD compatibility)". Content (concise, English-only): a `test: red` commit has failing tests BY DESIGN — the test exists, the implementation does not yet — so a red commit can never produce passing evidence; validating every commit in a push range would therefore make the gate structurally incompatible with the constitutional RED→GREEN→REFACTOR discipline. What gets merged and deployed is the final tree state at the TIP of the push, so the gate validates exactly that: the tip's evidence. Intermediate red/green commits are TDD process artifacts, not deploy artifacts. (Reference Quick 260528-eqn.)

    4. Scan the rest of the doc for any other "each pushed commit" / "per SHA" / "pushed commit range" phrasing in normative descriptions and align to tip-only where it changes the contract meaning. Recovery-scenario examples (§7) that reference a single `<sha>` are already tip-shaped — leave them. Do NOT change the SKIP-REASON taxonomy, the 22-project manifest list, the CI-bypass semantics, or the constitutional-alignment section beyond the contract wording.

    Do NOT bump any version string. English-only.
  </action>
  <verify>
    <automated>grep -n -i "tip" docs/test-evidence-gate.md | head -20</automated>
  </verify>
  <done>docs/test-evidence-gate.md describes tip-only validation in §1 (prose + L2 table row) and contains a "Why tip-only (TDD compatibility)" subsection explaining red-by-design + tip-is-what-deploys. No version bump. grep for "tip" returns the new contract language.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer workstation → git remote (origin) | The pre-push hook is the trust boundary that gates what enters the shared history. The validator reads attacker-influenceable inputs: pre-push stdin (ref tuples) and `.test-evidence/*.json` fragment files. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-eqn-01 | Tampering | enumerateCommitsForRef tip selection | accept | The tip-only change REDUCES surface (one rev-list probe vs a range walk) but introduces a residual: a malicious push could carry a green tip atop red intermediate commits whose code is what actually ships if the tip merely re-greens without the intermediate diffs landing. Accepted: the tip IS the merged tree state — what the tip's tree contains is exactly what deploys, so validating the tip's evidence covers the deployed code. Intermediate commits do not independently deploy. This is the explicit user decision and the documented rationale. |
| T-eqn-02 | Spoofing | `.test-evidence/<tip>-<project>.json` fragment files | mitigate | UNCHANGED from prior design — validateOneCommit still lstat-refuses symlinks (TOCTOU), realpath-contains within the canonical evidence dir, and rejects malformed JSON / exit_code!=0 / fail>0 / unannotated_skip>0. The tip-only change does not weaken any per-fragment check; it only narrows WHICH commit's fragments are inspected. |
| T-eqn-03 | Elevation of Privilege | CI bypass (GITHUB_ACTIONS/CI env) | accept | UNCHANGED — the env-based CI bypass at runMain top is untouched by this plan; the documented L3 deferred CI check remains the backstop for `--no-verify` bypassers. No new bypass introduced. |
</threat_model>

<verification>
- `pnpm exec vitest run --project tools tools/__tests__/lint-pre-push-test-evidence.test.ts` → all cases green (28 baseline + F19; F14/F17 rewritten).
- Per-file coverage command (Task 2 verify) → tools/lint-pre-push-test-evidence.ts >= 90/90/90/90.
- `git diff --name-only` shows exactly: tools/lint-pre-push-test-evidence.ts, tools/__tests__/lint-pre-push-test-evidence.test.ts, docs/test-evidence-gate.md. NO Chart.yaml / appVersion / package.json / reporter / manifest.
- LOCKER chain unaffected (tools/ file; no new suppressions, no NODE_ENV branches, no hardcoded prod secrets).
- Manual sanity (optional): the new F19 case is the load-bearing proof — a 3-commit push with a red intermediate and a green tip exits 0.
</verification>

<success_criteria>
- enumerateCommitsForRef returns [localSha] for a normal push, [] for deletion, and [] for an already-on-remote tip (F13 preserved).
- A multi-commit push with red intermediate commits but a green tip is ACCEPTED (exit 0) — the TDD deadlock is gone.
- A push whose TIP is missing/failing evidence is still REFUSED (exit 1).
- File header doc comment + docs/test-evidence-gate.md both describe tip-only with TDD-compatibility rationale.
- Single atomic commit: `fix(tools): pre-push gate validates tip commit only (TDD-compatible) (260528-eqn)` containing code + tests + docs together.
</success_criteria>

<output>
After completion, create `.planning/quick/260528-eqn-pre-push-gate-tip-only/260528-eqn-SUMMARY.md`.

Commit (single atomic, code + tests + docs together):
`fix(tools): pre-push gate validates tip commit only (TDD-compatible) (260528-eqn)`
</output>
