---
slug: agent-stream-single-system
quick_id: 260605-q7w
date: 2026-06-05
type: quick
requirements: [upstream-#14]
status: complete-on-main-not-released
commits:
  - 0f0c3bcf
---

# Quick 260605-q7w — agent-stream strict single-system normalization (upstream-#14)

## One-liner

Replaced the additive `prependSystemPrompt` (D-11) with `normalizeSystemMessages`,
which folds the optional `body.systemPrompt` plus every in-array `system` message into
EXACTLY ONE merged system message at index [0] — eliminating the corp qwen/vLLM gateway
HTTP 400 caused by the desktop client sending two byte-identical leading system messages.

## Problem (upstream-#14, HIGH)

`/api/agent/stream` forwarded TWO leading system messages because the desktop client
sends BOTH `messages[0]={role:"system",content:X}` AND a byte-identical
`body.systemPrompt=X`. The gateway's strict chat template (qwen-class model) rejects
more than one leading system message, returning HTTP 400 on every cloud agent-chat request.

## Fix

`normalizeSystemMessages(messages, systemPrompt)` in
`apps/api/src/routes/agent/translate-tools.ts` — pure array logic, no I/O:

- Accumulate system fragments in order: `systemPrompt` first (when truthy), then each
  `role==="system"` message's `content` in array order.
- Dedup: skip a fragment byte-identical (string) to one already accumulated. Non-string
  fragments are always included (no equality attempt, no crash).
- Single fragment -> emit directly (object content survives the round-trip).
- Multiple fragments -> join distinct STRING fragments with two newlines; non-string
  fragments are JSON-rendered and appended so nothing is dropped (D-11 no-content-loss).
- Preserve the relative order of all non-system messages.
- No system content at all -> return unchanged. Empty-string systemPrompt -> unset.

D-11 doc-comment SUPERSEDED with an upstream-#14 rationale block. Sole importer
`stream.ts` updated (import + call site + comment). No alias export.

## Behavior matrix (all asserted)

| Case | Input | Output |
|------|-------|--------|
| 1 byte-dup | [sys "P", user "hi"] + "P" | [sys "P", user "hi"] (NOT "P\n\nP") |
| 2 distinct | [sys "you are a sloth", user "hi"] + "be helpful" | [sys "be helpful\n\nyou are a sloth", user "hi"] |
| 3 prompt-no-sys | [user "hi"] + "be helpful" | [sys "be helpful", user "hi"] |
| 4 no-prompt-leading-sys | [sys "S", user "hi"] + undefined | unchanged |
| 5 mid-array fold | [user a, sys X, asst b, sys Y, user c] + undefined | [sys "X\n\nY", user a, asst b, user c] |
| 5 dedup | [sys X, user a, sys X] + undefined | [sys "X", user a] |
| 6 no-sys | [user "hi"] + undefined | unchanged |
| history-order | [sys S, user u1, asst a1, user u2] + "S" | [sys "S", user u1, asst a1, user u2] |
| non-string single | [sys {nested}, user "hi"] + undefined | [sys {nested}, user "hi"] |
| non-string multi | [sys "A", user "hi", sys {nested}] + undefined | [sys "A\n\n{\"nested\":true}", user "hi"] |

## Files changed

- apps/api/src/routes/agent/translate-tools.ts -- normalizeSystemMessages replaces
  prependSystemPrompt; D-11 comment block + jsdoc superseded.
- apps/api/src/routes/agent/stream.ts -- import (:62), call site (:203), comments updated.
- apps/api/tests/unit/routes/agent/translate-tools.test.ts -- describe rewritten to
  "normalizeSystemMessages (upstream-#14, strict single system)" + all 6 cases + byte-dup
  + history-order + non-string guard (single & multi). 16 tests.
- apps/api/tests/unit/routes/agent/stream.test.ts -- "Test 4" rewritten from additive
  two-system to merged single-system; "Test 4b" added for byte-identical client body;
  :331 comment updated.

## Commits

| SHA | Message |
|-----|---------|
| 0f0c3bcf | fix(api): normalize agent-stream to exactly one system message (upstream-#14) |

Single atomic commit -- tests + production code together (RED->GREEN folded; the old
test asserted the old behavior, so the test rewrite and the impl ship in the same commit).

## Verification (own eyes)

Task 1 -- coverage
(pnpm --filter @openwhispr/api test --coverage --coverage.include='src/routes/agent/translate-tools.ts' tests/unit/routes/agent/translate-tools.test.ts):
- Tests 16 passed (16)
- Statements 100% (27/27), Branches 100% (16/16), Functions 100% (4/4), Lines 100% (24/24)
- Exceeds the >=90/90/90/90 floor on all four axes.

Task 2 -- wiring + typecheck + regression:
- grep -rn "prependSystemPrompt" apps/api/src apps/api/tests | grep -v '/dist/' -> ZERO_HITS
- pnpm --filter @openwhispr/api typecheck -> clean (no as any / @ts-ignore / @ts-expect-error)
- pnpm --filter @openwhispr/api test tests/unit/routes/agent/stream.test.ts tests/integration/agent-stream-error-contract.test.ts
  -> Test Files 2 passed (2), Tests 33 passed (33) (27 stream unit + 6 integration)

Pre-commit hooks: GREEN -- gitleaks (no leaks), biome (no fixes), english-only (1514
files scanned, passed), all LOCKER lints clean/WARN-only (non-blocking).

## Deviations from PLAN

1. stream.test.ts had a real route-level assertion, not just a comment. The PLAN context
   said stream.test.ts only mentioned prependSystemPrompt in a comment with no assertion
   on two-system output. In fact "Test 4" (:514) asserted the OLD additive
   [system(be helpful), system(you are a sloth), user(hi)] forwarded body. Under the new
   strict invariant this input must forward ONE merged system. Rewrote Test 4 to assert
   the merged single system (Rule 1 -- test asserted behavior being intentionally
   replaced) and added Test 4b for the exact byte-identical client body at the route
   boundary. Strongest end-to-end proof of upstream-#14; net coverage win.

2. Russian owner-decision quote dropped from the code comment. The PLAN suggested keeping
   the Russian quote alongside the English gloss. The english-only LOCKER (BLOCKING
   pre-commit hook, CLAUDE.md hard rule) refused the commit. Resolved per CLAUDE.md
   precedence: comment carries the English gloss only -- "Owner decision: exactly one
   system message, strictly."

3. One extra test beyond the PLAN list for >=90% functions coverage. The PLAN's non-string
   guard used a single fragment -> hits the length===1 early return, leaving the
   multi-fragment non-string merge branch (JSON.stringify map + non-string else push)
   uncovered (75% functions / line 136 on first run). Added "non-string guard with
   multiple fragments" to exercise that branch -> 100% on all four axes.

## Out of scope (orchestrator owns)

- No pnpm test:all evidence stamp, no push, no tag, no version bump -- per the task brief
  the orchestrator handles push + test-evidence.

## Status

Complete on main, NOT released. Atomic commit 0f0c3bcf on main.
