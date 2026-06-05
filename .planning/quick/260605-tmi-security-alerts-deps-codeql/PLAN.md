---
quick_id: 260605-tmi
slug: security-alerts-deps-codeql
date: 2026-06-05
status: in-progress
---

# Quick 260605-tmi — Close 4 open GitHub security alerts (deps + CodeQL)

## Goal

Close all 4 open GitHub security alerts. All are dev-only / build-tool with
ZERO production exposure in the api/web/worker images. NO version bump, NO
release, NO chart/values edit — released prod images 1.2.4 are untouched.

| Alert | Sev | What | Root cause | Fix |
|---|---|---|---|---|
| #34 + #35 | CRITICAL 9.8 | `vitest` GHSA-5xrq-8626-4rwp (UI server arb file read/exec, `<4.1.0`) | only `vitest@3.2.4` source = `tools/test-probe/package.json` pin | bump test-probe vitest + @vitest/coverage-v8 → 4.1.5 |
| #33 | HIGH | `tmp` GHSA-ph9p-34f9-6g65 (path traversal, `<0.2.6`) | `tmp@0.2.5` transitive (testcontainers) | pnpm-workspace override `tmp@<0.2.6` → `>=0.2.6 <0.3.0` |
| #39 | HIGH | CodeQL `js/incomplete-sanitization` `tools/lint-changelog.ts:82` | `version.replace(/\./g,"\\.")` escapes only `.` not backslash/metachars | `escapeRegExp` helper, RED-first TDD |

## Verified facts (orchestrator, do not re-litigate)

- `tools/test-probe/package.json` pins `"vitest": "3.2.4"` + `"@vitest/coverage-v8": "3.2.4"`.
  Root workspace already on 4.1.5 (4 lock entries). Bumping test-probe collapses #34 AND #35.
- Overrides live in **`pnpm-workspace.yaml`** (NOT package.json — there is no root `pnpm` key).
  Existing scoped-selector CVE-bump style: `protobufjs@<7.5.8: ">=7.5.8 <8.0.0"`, `qs@<6.15.2: ...`,
  `ws@<8.20.1: ">=8.20.1 <9.0.0"`. Add `tmp@<0.2.6: ">=0.2.6 <0.3.0"` in that block, same style + a comment.
- pnpm 11.0.8. `tmp@0.2.5` appears at pnpm-lock.yaml:13123 + 6615.
- `tools/lint-changelog.ts:82`: `const footer = new RegExp(\`^\\[${version.replace(/\./g, "\\.")}\\]:\\s\`, "m");`
  CodeQL msg: "This does not escape backslash characters in the input." `version` is parsed from CHANGELOG
  (not user input) → exploitability theoretical, but fix is correct + trivial + this is freshly-authored code.
- `tools/lint-changelog.test.ts` has 12 tests today; must all stay green. `pnpm lint:changelog` must still
  pass on the real CHANGELOG (top section 1.2.4 == Chart appVersion 1.2.4).

## Tasks

### Commit 1 — deps (#33/#34/#35)
1. Edit `tools/test-probe/package.json`: `vitest` 3.2.4 → 4.1.5, `@vitest/coverage-v8` 3.2.4 → 4.1.5.
2. Edit `pnpm-workspace.yaml` overrides block: add (with a short comment matching the existing CVE-bump
   comments) `tmp@<0.2.6: ">=0.2.6 <0.3.0"`.
3. `pnpm install` — regenerate lockfile.
4. Run test-probe suite under vitest 4.1.5; adjust `test`/`test:cov` scripts only if a vitest 3→4 flag
   actually broke (e.g. coverage flag rename). Do NOT loosen coverage thresholds.
5. VERIFY: `grep -n "vitest@3.2.4" pnpm-lock.yaml` → 0 hits. `grep -nE "^\s+tmp@0\.2\.5" pnpm-lock.yaml`
   → 0 hits; tmp ≥0.2.6 present.
6. Commit: `fix(security): bump test-probe vitest 3.2.4->4.1.5 + override tmp>=0.2.6 (deps #33/#34/#35)`.

### Commit 2 — CodeQL (#39), STRICT RED-first TDD (test + fix SAME commit)
1. RED: add a test to `tools/lint-changelog.test.ts` proving the current incomplete escaping is wrong
   (assert an `escapeRegExp` helper escapes backslash / `+` / `*` / `(` etc., or feed a crafted
   version-like string with a metachar and assert correct literal matching). Watch it FAIL on current code.
2. GREEN: add `function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }`
   and apply it at line 82 in place of `version.replace(/\./g, "\\.")`. Keep behavior identical for `X.Y.Z`.
3. Full `tools/lint-changelog.test.ts` suite GREEN (12 + new). `pnpm lint:changelog` GREEN on real CHANGELOG.
4. Commit: `fix(security): escape all regex metachars in lint-changelog version match (CodeQL #39)`.

## Hard constraints
- Strict TDD on #39 (RED first, same commit). No type-suppression. English-only. Generic-naming. LOCKER-clean.
- commitlint: header ≤100, body lines ≤100. No `--no-verify`.
- NO version bump / tag / release / chart edit. Land atomic commits on main locally;
  orchestrator handles `pnpm test:all` evidence stamp + push + GitHub alert re-scan verification.

## Done when
- `grep -n "vitest@3.2.4" pnpm-lock.yaml` → 0; no `tmp@0.2.5`; tmp ≥0.2.6 present.
- lint-changelog.test.ts GREEN incl. new escaping test; `pnpm lint:changelog` GREEN.
- test-probe suite GREEN under vitest 4.1.5. `pnpm install` clean. Working tree = expected diffs only.
