---
slug: agent-stream-single-system
quick_id: 260605-q7w
date: 2026-06-05
type: quick
tdd: true
files_modified:
  - apps/api/src/routes/agent/translate-tools.ts
  - apps/api/src/routes/agent/stream.ts
  - apps/api/tests/unit/routes/agent/translate-tools.test.ts
  - apps/api/tests/unit/routes/agent/stream.test.ts
requirements: [upstream-#14]
must_haves:
  truths:
    - "/api/agent/stream forwards EXACTLY ONE system message, always at index [0]"
    - "byte-identical dup (messages[0]=system X + systemPrompt=X) collapses to ONE system, NOT 'X\\n\\nX'"
    - "non-system conversation history (user/assistant) keeps original relative order"
  artifacts:
    - path: "apps/api/src/routes/agent/translate-tools.ts"
      provides: "normalizeSystemMessages — strict single-system normalizer"
      contains: "normalizeSystemMessages"
  key_links:
    - from: "apps/api/src/routes/agent/stream.ts"
      to: "normalizeSystemMessages"
      via: "import + call at the messages-build site (~line 203)"
      pattern: "normalizeSystemMessages"
---

<objective>
Upstream #14 (HIGH): `/api/agent/stream` forwards TWO leading system messages (desktop sends `messages[0]={role:system,content:X}` AND a byte-identical `body.systemPrompt=X`) → corp qwen/vLLM returns HTTP 400 on every cloud agent-chat request because the strict chat template rejects >1 system message.

Fix the SERVER: replace the additive `prependSystemPrompt` (D-11) with a strict `normalizeSystemMessages` that ALWAYS emits ≤1 system message at index [0], merging all system content (systemPrompt first, then each system msg in array order), deduping byte-identical fragments, joining with `"\n\n"`, and preserving the relative order of all non-system messages.

Output: strict single-system normalization shipped, ≥90% coverage on `translate-tools.ts`, D-11 superseded by an upstream-#14 note.
</objective>

<context>
Owner decision (STRICT, hard rule — NOT an option): "Один системный промт, строго." Normalize to EXACTLY ONE system at [0], ALWAYS. NO "keep two if different" branch — different systems MERGE.

@apps/api/src/routes/agent/translate-tools.ts
@apps/api/tests/unit/routes/agent/translate-tools.test.ts

<interfaces>
Current (to be replaced) — translate-tools.ts:80-86:
  export function prependSystemPrompt(messages: ChatMessage[], systemPrompt: string | undefined): ChatMessage[]
  // unconditionally prepends a 2nd system: `if (!systemPrompt) return messages; return [{role:"system",content:systemPrompt}, ...messages];`

ChatMessage (translate-tools.ts:48-51): `{ role: string; content: unknown }`

Sole production importer — stream.ts:62 (import) + stream.ts:203 (call):
  const messages = prependSystemPrompt(body.messages ?? [], body.systemPrompt ?? undefined);
  // return is forwarded downstream as the llm request `messages` array.

Verified non-impacts (read, no change needed):
- apps/api/tests/unit/routes/agent/stream.test.ts:331 — only a code COMMENT mentions "prependSystemPrompt falsy-check"; no assertion on two-system output. Update the comment text only if it references old behavior.
- apps/api/tests/integration/agent-stream-error-contract.test.ts — payloads send user-only messages (no system dup), unaffected.
- dist/index.js hits are build output, ignore.
</interfaces>

NEW INVARIANT for `normalizeSystemMessages(messages, systemPrompt)` — 6 cases:
1. systemPrompt set + messages[0] byte-IDENTICAL system → `[{system,X}, ...rest]` (drop dup; NOT "X\n\nX").
2. systemPrompt set + messages[0] DIFFERENT system → `[{system, systemPrompt+"\n\n"+messages[0].content}, ...rest]`.
3. systemPrompt set + no system in messages → `[{system,systemPrompt}, ...messages]`.
4. no systemPrompt + leading system → pass through (already single).
5. system at index>0 (mid-array) → fold ALL system into [0] in original order, dedup byte-identical fragments, remove from original positions; non-system order preserved.
6. no systemPrompt + no system → unchanged.

Merge/dedup rule: accumulate fragments in order (systemPrompt first if set, then each system msg in array order), skip any string byte-identical to one already accumulated, join with `"\n\n"`, emit as single messages[0]; then all non-system msgs in original relative order. String-content equality only; non-string system content → include as-is fragment, no dedup, no crash.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED+GREEN — normalizeSystemMessages strict single-system normalizer</name>
  <files>apps/api/src/routes/agent/translate-tools.ts, apps/api/tests/unit/routes/agent/translate-tools.test.ts</files>
  <behavior>
    RED first — rewrite the existing `describe("prependSystemPrompt (D-11)")` block into `describe("normalizeSystemMessages (upstream-#14, strict single system)")`. The old Test 9 ("ADDITIVELY prepends — never replaces", asserting `[system(be helpful),system(you are a sloth),user]`) is REPLACED by the merge assertion (case 2). Cover all 6 cases + the two CRITICAL nuances:
    - Case 1 (byte-identical dup — THIS CLIENT'S EXACT BODY): messages=`[{system,"P"},{user,"hi"}]`, systemPrompt=`"P"` → `[{system,"P"},{user,"hi"}]`. Assert content is `"P"`, NOT `"P\n\nP"`, and exactly ONE system message.
    - Case 2 (different leading system): messages=`[{system,"you are a sloth"},{user,"hi"}]`, systemPrompt=`"be helpful"` → `[{system,"be helpful\n\nyou are a sloth"},{user,"hi"}]`.
    - Case 3 (systemPrompt, no system in msgs): `[{user,"hi"}]` + `"be helpful"` → `[{system,"be helpful"},{user,"hi"}]`.
    - Case 4 (no systemPrompt, leading system): `[{system,"S"},{user,"hi"}]` + undefined → unchanged (single system, pass through).
    - Case 5 (system at index>0, multiple, mid-array): `[{user,"a"},{system,"X"},{assistant,"b"},{system,"Y"},{user,"c"}]` + undefined → `[{system,"X\n\nY"},{user,"a"},{assistant,"b"},{user,"c"}]`. Assert exactly ONE system at [0] AND non-system order is `["a","b","c"]`.
    - Case 5 dedup: two byte-identical mid-array systems `[{system,"X"},{user,"a"},{system,"X"}]` → `[{system,"X"},{user,"a"}]` (single "X", not "X\n\nX").
    - Case 6 (no systemPrompt, no system): `[{user,"hi"}]` + undefined → unchanged (assert `.toBe` same ref OR deep-equal; result must be a single non-system array).
    - Empty/falsy systemPrompt: `""` treated as unset (no `{system,""}` injected) — preserve the old falsy semantics.
    - HISTORY ORDER (explicit): `[{system,"S"},{user,"u1"},{assistant,"a1"},{user,"u2"}]` + `"S"` (byte-identical) → assert the user/assistant tail is `["u1","a1","u2"]` in that exact order with ONE leading system.
    - Non-string content guard: a system msg with `content:{nested:true}` (object) must not crash; emitted as an as-is fragment, no dedup attempt.
    Update the top-of-file `import { prependSystemPrompt, translateLegacyTools }` → `normalizeSystemMessages`. Leave the existing translateLegacyTools describe block (D-07) untouched.
  </behavior>
  <action>
    GREEN — in translate-tools.ts, replace the `prependSystemPrompt` export (lines 80-86) with `export function normalizeSystemMessages(messages: ChatMessage[], systemPrompt: string | undefined): ChatMessage[]`. Pure array logic, no I/O:
    - Build an ordered fragment list: if systemPrompt is truthy, push it first; then iterate messages, pushing each `role==="system"` message's content as a fragment.
    - Dedup: skip a fragment when it is a string byte-identical to a string fragment already accumulated. Non-string fragments are always included (no equality attempt).
    - Partition non-system messages preserving original relative order.
    - If the accumulated fragment list is empty (no systemPrompt + no system msgs) → return the non-system messages array (case 6). If exactly one fragment and it originated solely from a single leading already-present system with no systemPrompt → may pass through (cases 4/6); simplest correct impl is to always reconstruct `[{role:"system", content: <merged>}, ...nonSystem]` when fragments exist, where merged = single string-join of string fragments with `"\n\n"` (and a single non-string fragment passed as-is when it is the only one). Keep the merge join logic in one helper-free inline block — do NOT add a NODE_ENV branch, no `as any`, no `@ts-ignore`.
    REPLACE the call site at stream.ts:203 `prependSystemPrompt(...)` → `normalizeSystemMessages(...)` and the import at stream.ts:62. Update the stream.ts comment at ~line 201 ("prependSystemPrompt's falsy-check") to reference normalizeSystemMessages. NO alias export — the single importer is updated directly (cleaner).
    Update the D-11 doc-comment block (translate-tools.ts lines 16-21 and the function jsdoc 73-78) to a SUPERSEDE note: "D-11 (additive prepend) SUPERSEDED by upstream-#14 — qwen/vLLM strict chat template rejects >1 system message; we now normalize to EXACTLY ONE system at index [0], merging+deduping all system content. Owner decision: 'один системный промт, строго.'" (English-only in the code; the Russian quote is the owner-decision citation — keep the English gloss as the normative text).
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api test --coverage --coverage.include='src/routes/agent/translate-tools.ts' tests/unit/routes/agent/translate-tools.test.ts</automated>
  </verify>
  <done>All new translate-tools.test.ts cases GREEN; ≥90% lines/branches/functions/statements on translate-tools.ts; no `prependSystemPrompt` symbol remains in src/ (grep); normalizeSystemMessages emits ≤1 system at [0] for all 6 cases + byte-identical dup yields single "P" + history order preserved.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Verify call-site wiring + no dangling references; whole-package typecheck</name>
  <files>apps/api/src/routes/agent/stream.ts, apps/api/tests/unit/routes/agent/stream.test.ts</files>
  <action>
    Confirm the rewrite from Task 1 is wired: `grep -rn prependSystemPrompt apps/api/src apps/api/tests` returns ZERO hits in source/test (dist/ build output ignored). If the stream.test.ts:331 comment still says "prependSystemPrompt", update the comment text to "normalizeSystemMessages". Run the api typecheck to confirm the contract change compiles with no type-suppression. Re-run the stream unit + integration tests to confirm the single-system change broke no existing assertions (integration test sends user-only payloads, expected GREEN).
  </action>
  <verify>
    <automated>grep -rn "prependSystemPrompt" apps/api/src apps/api/tests | grep -v '/dist/' ; test $(grep -rn "prependSystemPrompt" apps/api/src apps/api/tests | grep -vc '/dist/') -eq 0 && pnpm --filter @openwhispr/api typecheck && pnpm --filter @openwhispr/api test tests/unit/routes/agent/stream.test.ts tests/integration/agent-stream-error-contract.test.ts</automated>
  </verify>
  <done>Zero `prependSystemPrompt` references outside dist/; `pnpm --filter @openwhispr/api typecheck` clean (no `as any`/`@ts-ignore`/`@ts-expect-error`); stream unit + agent-stream-error-contract integration tests GREEN.</done>
</task>

</tasks>

<verification>
- LOCKER clean: change is pure array logic in translate-tools.ts (no new routes, no env branches, no hardcoded localhost/UUID/secret shapes, no shell interpolation).
- Both tasks land tests + production code in the SAME atomic commit (RED→GREEN folded — the test rewrite and the impl ship together since the old test asserts the old behavior).
- commitlint: header ≤100 chars, body lines ≤100.
- No version bump, no tag, no release — land on main. Orchestrator handles push + test-evidence.
</verification>

<success_criteria>
- `/api/agent/stream` forwards EXACTLY ONE system message at index [0] for every input shape (6 cases).
- The client's exact failing body (`messages[0]=system X` + `systemPrompt=X`, byte-identical) yields a SINGLE system with content `X` (not `"X\n\nX"`) — the qwen 400 root cause is eliminated.
- Conversation history (user/assistant tail) relative order is preserved and explicitly asserted.
- ≥90% coverage on translate-tools.ts; api typecheck + stream + integration suites GREEN; D-11 comment superseded with upstream-#14 rationale.
</success_criteria>

<output>
After completion, create `.planning/quick/260605-q7w-agent-stream-single-system/SUMMARY.md`.
</output>
