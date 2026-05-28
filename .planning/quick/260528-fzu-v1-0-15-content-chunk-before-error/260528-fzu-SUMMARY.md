---
phase: quick-260528-fzu
plan: 01
subsystem: api
tags: [agent-stream, ndjson, wire-contract, fastify, helm, tdd]

# Dependency graph
requires:
  - phase: quick-260528-0cm
    provides: emitTerminalErrorChunk closure + type:"error" terminal wire chunk
  - phase: quick-260528-370
    provides: chart 1.0.14 / appVersion 1.0.14 baseline
provides:
  - "content-before-error wire ordering on /api/agent/stream upstream failure (preflight + drain)"
  - "visible error bubble on the immutable desktop client without any client change"
  - "chart 1.0.18 / appVersion 1.0.15 / image tag 1.0.15"
affects: [agent-stream, desktop-client-rendering, helm-release, future agent wire-contract changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "single-closure dual-call-site wire emission (preflight + drain inherit one content+error write)"
    - "content-chunk-carries-canonical-error fallback for clients without a type:error case"

key-files:
  created:
    - .planning/quick/260528-fzu-v1-0-15-content-chunk-before-error/260528-fzu-SUMMARY.md
  modified:
    - apps/api/src/routes/agent/stream.ts
    - apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts
    - apps/api/tests/integration/agent-stream-error-contract.test.ts
    - apps/api/tests/unit/routes/agent/stream.test.ts
    - charts/openwhispr-server/Chart.yaml
    - charts/openwhispr-server/values.yaml

key-decisions:
  - "Content write lives ONCE in emitTerminalErrorChunk so both preflight and drain inherit it; no call-site duplication."
  - "Content text = U+274C cross-mark glyph + space + classified.error (the same canonical, secret-redacted message as the error chunk)."
  - "Structured type:error chunk shape kept byte-identical (4 keys) for structured/future-client consumers; no done chunk follows."
  - "Sibling stream.test.ts Tests 9/17/18/18b were flipped to content-before-error ordering too — they share the same wire contract as the two plan-named files and would otherwise break the build."

patterns-established:
  - "Pattern: when a wire chunk type is unrenderable by an immutable client, prepend a content chunk carrying the same canonical text rather than changing the client."

requirements-completed: [QUICK-260528-fzu]

# Metrics
duration: 14min
completed: 2026-05-28
---

# Phase quick-260528-fzu Plan 01: v1.0.15 content-chunk-before-error Summary

**On /api/agent/stream upstream failure the server now emits a `{type:"content", text:"❌ <error>"}` line immediately before the unchanged structured `{type:"error",...}` line — making the failure visible in the immutable desktop client's chat bubble (which only renders content/tool_calls/tool_result) without touching the client.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-28T11:40:00Z (approx)
- **Completed:** 2026-05-28T11:47:00Z (approx)
- **Tasks:** 2 completed
- **Files modified:** 6 (4 code/test in Task 1, 2 chart YAML in Task 2)

## Accomplishments
- Fixed the empty-bubble HIGH bug: upstream failures now render a visible error message client-side, on BOTH the preflight (`chatCompletionsStream` rejection) and drain (mid-stream readable break) failure paths.
- Kept the structured error chunk contract byte-identical (4 keys: `type,error,code,provider`), so structured/future-client consumers are unaffected, and preserved the v1.0.13 no-done terminal-error semantics.
- Bumped the Helm chart to 1.0.18 / appVersion 1.0.15 / image tag 1.0.15 with a changelog note.

## Task Commits

Each task was committed atomically:

1. **Task 1: Emit content chunk before error chunk (TDD)** - `f97598f3` (fix) — code + tests in ONE atomic commit (RED: flipped 22 wire-ordering assertions across the two plan-named files + 4 in sibling stream.test.ts; GREEN: added the single content-chunk write inside `emitTerminalErrorChunk`).
2. **Task 2: Bump chart to 1.0.18 with image v1.0.15 default** - `ba9f5272` (chore) — Chart.yaml + values.yaml only.

_Note: Task 1 is a single atomic RED→GREEN commit per the strict-TDD-same-commit constitutional rule._

## Files Created/Modified
- `apps/api/src/routes/agent/stream.ts` — GREEN: added a `const contentChunk: StreamChunk = { type:"content", text:` `` `❌ ${classified.error}` `` ` }` write inside the `emitTerminalErrorChunk` closure, BEFORE the existing error-chunk write, guarded by the same `if (!raw.writableEnded)` + try/catch socket-closed defense. The new catch carries a matching `/* v8 ignore next 3 */`. `classifyUpstreamError` is still called once per failure (reused `classified` binding).
- `apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts` — RED: `ERROR_CONTENT_PREFIX` constant; wire-envelope block now expects length 2 with content[0] + error[1] and `content.text === PREFIX + error.error`; 4-key shape assertion repointed to the error chunk; drain-parity asserts the LAST content chunk equals `PREFIX + error`; secret-shape test repoints error reads to the last chunk and adds content-line secret-shape nots.
- `apps/api/tests/integration/agent-stream-error-contract.test.ts` — RED: `ERROR_CONTENT_PREFIX`; Cases 1/2/3/5/6 (preflight) expect length 2 with content[0]; Case 4 (drain) asserts the trailing PREFIX content chunk equals `PREFIX + terminal error`; model-name leak nots extended to the content line.
- `apps/api/tests/unit/routes/agent/stream.test.ts` — RED: `ERROR_CONTENT_PREFIX`; Tests 9/17/18/18b flipped from length 1 to length 2 with content[0] + error[1] and `PREFIX + error` assertions (same wire contract as the plan-named files).
- `charts/openwhispr-server/Chart.yaml` — version 1.0.17 → 1.0.18, appVersion "1.0.14" → "1.0.15".
- `charts/openwhispr-server/values.yaml` — image default tag "1.0.14" → "1.0.15" + a 1.0.15 changelog note above the 1.0.14 entry.

## Verification

- **Tests GREEN (own eyes):** Full agent-stream test corpus (11 files, 85 tests) all pass. The two plan-named files specifically: `stream-error-mapping.test.ts` (20 tests) + `agent-stream-error-contract.test.ts` (6 tests) = 26 passed.
- **Diff coverage on stream.ts:** Lines 100% (67/67), Statements 98.55% (68/69), Functions 100% (8/8). The new content-write block statements (L282/292/296/297/303/309/310) each executed 73×. Whole-file branch shows 82% but the 4 uncovered branches are ALL pre-existing and unrelated to the diff: L126 (`req.user?.id ?? req.ip` rate-limit fallback), L203 (`body.messages ?? []`), L329 (non-string content stringify, Phase 52), L385 (`if (raw.writableEnded) break` mid-drain race, carries a v8-ignore). The added content-write branch is fully covered → diff ≥90/90/90/90 satisfied per the scope-boundary rule.
- **Typecheck:** `tsc --noEmit` on apps/api → exit 0.
- **Constitutional lockers:** LOCKER-01 (no NODE_ENV branch), LOCKER-02 (no type-suppression), LOCKER-03 (no host/UUID/secret-shape literal; cross-mark glyph is a UI marker, not flagged) all clean on the diff; full pre-commit locker suite (incl. -05/-06/-08) passed on both commits.
- **Helm:** `helm lint charts/openwhispr-server` → 1 chart linted, 0 failed. `version: 1.0.18`, `appVersion: "1.0.15"`, `tag: "1.0.15"` all confirmed via grep.
- **Hooks:** gitleaks, english, biome, commitlint all GREEN on both commits (initial commit re-issued once to shorten the 102-char header to 94 chars for commitlint's 100-char limit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Flipped sibling stream.test.ts Tests 9/17/18/18b to the new wire ordering**
- **Found during:** Task 1 GREEN verification (full corpus run).
- **Issue:** The plan's `files_modified` listed only two test files, but `apps/api/tests/unit/routes/agent/stream.test.ts` (the sibling) also asserts the single-error-chunk wire shape (`toHaveLength(1)`) in Tests 9/17/18/18b — the SAME wire contract this fix changes. The production change correctly broke those stale assertions; leaving them red would break the build.
- **Fix:** Added `ERROR_CONTENT_PREFIX` and flipped those 4 tests to expect content[0] + error[1] with `PREFIX + error`, in the same atomic Task 1 commit (still RED→GREEN; production code already correct).
- **Files modified:** apps/api/tests/unit/routes/agent/stream.test.ts
- **Commit:** f97598f3

**2. [Rule 3 - Blocking] Shortened the Task 1 commit header to satisfy commitlint**
- **Found during:** Task 1 commit (commit-msg hook).
- **Issue:** The plan's literal commit subject "fix(agent): emit content chunk before error chunk so client renders error bubble (260528-fzu, v1.0.15)" is 102 chars; commitlint's `header-max-length` is 100.
- **Fix:** Trimmed "so client renders" → "to render" (94 chars). No bypass of the hook.
- **Commit:** f97598f3

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired components introduced.

## Self-Check: PASSED

- `apps/api/src/routes/agent/stream.ts` content-write FOUND (L292-294 `type: "content"` + `❌ ${classified.error}`).
- Commit `f97598f3` FOUND on HEAD~1; commit `ba9f5272` FOUND on HEAD.
- Chart values FOUND: `version: 1.0.18`, `appVersion: "1.0.15"`, `tag: "1.0.15"`.
- Working tree clean (only the SUMMARY.md remains, per orchestrator docs-commit contract).
