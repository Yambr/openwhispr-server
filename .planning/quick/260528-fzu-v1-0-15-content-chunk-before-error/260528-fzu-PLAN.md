---
phase: quick-260528-fzu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/routes/agent/stream.ts
  - apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts
  - apps/api/tests/integration/agent-stream-error-contract.test.ts
  - charts/openwhispr-server/Chart.yaml
  - charts/openwhispr-server/values.yaml
autonomous: true
requirements:
  - QUICK-260528-fzu

must_haves:
  truths:
    - "On /api/agent/stream upstream failure, the NDJSON wire carries a {type:content, text} line BEFORE the {type:error,...} line."
    - "The content chunk's text begins with the cross-mark prefix (U+274C glyph + space) followed by the canonical English error message."
    - "The content chunk's text equals prefix + the error chunk's error field (same canonical, secret-redacted message)."
    - "No {type:done} chunk follows the terminal error chunk (v1.0.13 terminal-error semantics preserved)."
    - "Both the preflight-failure path and the drain-failure path emit the content-then-error ordering (single closure, both call sites)."
    - "The structured error chunk shape is unchanged: exactly {type,error,code,provider}."
    - "Chart version is 1.0.18 and appVersion is 1.0.15."
  artifacts:
    - path: "apps/api/src/routes/agent/stream.ts"
      provides: "emitTerminalErrorChunk closure that writes a content chunk before the error chunk"
      contains: "type: content"
    - path: "apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts"
      provides: "Updated unit assertions: content-before-error ordering, prefix, text equals prefix+error, no-done"
      contains: "content"
    - path: "apps/api/tests/integration/agent-stream-error-contract.test.ts"
      provides: "Updated integration assertions: content-before-error ordering across the real undici path"
      contains: "content"
    - path: "charts/openwhispr-server/Chart.yaml"
      provides: "version 1.0.18 / appVersion 1.0.15"
      contains: "version: 1.0.18"
  key_links:
    - from: "apps/api/src/routes/agent/stream.ts emitTerminalErrorChunk"
      to: "classifyUpstreamError(err).error"
      via: "content chunk text equals prefix + classified.error"
      pattern: "classified\\.error"
    - from: "apps/api/src/routes/agent/stream.ts preflight catch (~L318) AND drain catch (~L368)"
      to: "emitTerminalErrorChunk"
      via: "both call sites route through the single closure so both get the content write"
      pattern: "emitTerminalErrorChunk"
---

<objective>
Fix the agent-chat empty-bubble HIGH bug (v1.0.15). The server already emits a
correct terminal {type:"error",...} chunk on /api/agent/stream upstream failure
(v1.0.13), but the immutable openwhispr desktop client's stream consumer
(useChatStreaming.ts) only handles chunk types content / tool_calls /
tool_result -- it has NO case for type:"error", so the structured error chunk is
silently dropped and the chat bubble renders empty.

Fix (peer Option A, confirmed GO): the server must ALSO emit a content chunk
carrying the error text BEFORE the structured error chunk, so the existing
client switch renders it into the bubble. The structured error chunk is kept
unchanged for structured consumers / future client versions.

Purpose: All signed-in users currently see an empty bubble on any upstream
failure. This makes the error visible without changing the immutable client.
Output: A content-before-error wire ordering on both the preflight and drain
failure paths, full TDD coverage, and a chart/appVersion bump.

PREFIX LITERAL: the content chunk text is prefixed with the U+274C CROSS MARK
glyph followed by a single space, exactly as in the task brief (the cross-mark
glyph + " " + classified.error). The executor MUST use the actual glyph in code
and tests. It is a UI marker string, NOT a credential/UUID/host literal, so it
is LOCKER-03 clean; the English-only source rule is unaffected (a glyph is not a
localized word).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Key contracts the executor needs. Extracted from codebase -- no exploration required. -->

StreamChunk union -- from apps/api/src/lib/sse-parser.ts (lines 34-47):
  type StreamChunk =
    | { type: "content"; text: string }
    | ToolCallChunk
    | { type: "done"; finishReason: string; usage: {...} }
    | { type: "error"; error: string; code: AgentErrorCode; provider: "litellm" | "unknown" };
The content variant { type: "content"; text: string } is the EXACT shape the
immutable client's switch renders. The error variant stays unchanged.

classifyUpstreamError -- from apps/api/src/lib/agent-upstream-error-classify.ts:
  classifyUpstreamError(err: unknown): ClassifiedAgentError
ClassifiedAgentError.error is the canonical English message, ALREADY
secret-redacted + canonical-mapped. This is the SAME value already used for the
error chunk's error field -- reuse it for the content chunk text.

emitTerminalErrorChunk -- CURRENT shape in apps/api/src/routes/agent/stream.ts
(closure ~L257-296). It currently: (1) computes classified + provider +
retryAfterMs; (2) calls req.log.error({event:"agent.stream.upstream_failure",...});
(3) if (!raw.writableEnded) writes ONE { type:"error", error:classified.error,
code:classified.code, provider } chunk inside a try/catch socket-closed guard.
Called by BOTH the preflight catch (~L318-333) AND the drain catch (~L368-375).
Each call site separately handles raw.end() -- do NOT add a content write at the
call sites; add it INSIDE the closure so both paths inherit it.
</interfaces>

<!-- Existing test harness already provides everything needed (no new helpers): -->
<!-- stream-error-mapping.test.ts: buildAppWithRejection() = preflight path; -->
<!--   chatCompletionsStreamWithMidDrainError()/buildAppWithStream() = drain path; -->
<!--   parseChunks(); ChunkOnWire interface ALREADY has an optional text field. -->
<!-- agent-stream-error-contract.test.ts: buildContractApp() = real undici path; -->
<!--   Case 4 = drain path; WireChunk interface ALREADY has an optional text field. -->
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Emit content chunk before error chunk (RED tests first, then GREEN impl, same commit)</name>
  <files>apps/api/src/routes/agent/stream.ts, apps/api/tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts, apps/api/tests/integration/agent-stream-error-contract.test.ts</files>
  <behavior>
    Wire ordering on upstream failure (BOTH preflight + drain paths):
    - Line 1: { type:"content", text } where text equals PREFIX + classified.error
      (PREFIX = U+274C cross-mark glyph + single space).
    - Line 2: { type:"error", error, code, provider } (UNCHANGED shape).
    - NO { type:"done" } line anywhere.
    Test 1 (preflight, unit): buildAppWithRejection(new LitellmUpstreamError(401,...))
      yields chunks length 2; chunks[0].type==="content"; chunks[0].text starts
      with PREFIX; chunks[1].type==="error"; chunks[0].text === PREFIX + chunks[1].error.
    Test 2 (drain, unit): chatCompletionsStreamWithMidDrainError yields at least 1
      real streamed content chunk ("hel"/"lo"), then a FINAL content chunk that is
      the error-prefixed text, then the terminal { type:"error" }; still NO done.
      Assert the LAST content chunk's text === PREFIX + the error chunk's error.
    Test 3 (no-done invariant preserved on both paths) -- already asserted, keep.
    Test 4 (integration, real undici): Case 1/2/3/5/6 (preflight) expect length 2
      with content[0] then error[1]; Case 4 (drain) expects a trailing
      PREFIX-prefixed content chunk immediately before the terminal error.
  </behavior>
  <action>
    Define a PREFIX constant in each test file equal to the U+274C cross-mark glyph
    + single space, mirroring the production literal, so tests assert the exact
    string the route emits.

    RED FIRST. Update existing assertions in BOTH test files to describe the new
    content-before-error ordering (these WILL fail against the current
    single-error-chunk impl):

    stream-error-mapping.test.ts:
    - "wire envelope per AgentErrorCode" block: currently asserts
      expect(chunks).toHaveLength(1), that chunks[0] is the error chunk, and
      Object.keys(chunk).sort()===["code","error","provider","type"]. Change to:
      chunks length 2; chunks[0] is the content chunk (type==="content", text
      starts with PREFIX); chunks[1] is the error chunk (the existing per-case
      code/provider/error assertions now target chunks[1]); add
      expect(chunks[0].text).toBe(PREFIX + chunks[1].error). Keep the 4-key
      Object.keys assertion but apply it to the ERROR chunk (chunks[1]) so the
      structured-error shape stays locked at {code,error,provider,type}. Keep
      expect(r.body).not.toContain('"type":"done"').
    - "mid-stream drain parity" test: after filtering content chunks, assert the
      LAST content chunk's text === PREFIX + (terminal error chunk).error; terminal
      chunk still type:"error" with NO done.
    - "secret-shape redaction at the wire boundary" test: repoint the error-chunk
      reads from chunks[0] to the LAST chunk (the type:"error" one); additionally
      assert the content chunk (chunks[0]) carries no secret-shape substrings (same
      canonical redacted message, so it must pass the same SECRET_SHAPE_* nots).

    agent-stream-error-contract.test.ts:
    - Cases 1,2,3,5,6 (preflight): change expect(chunks).toHaveLength(1) to length
      2; move the chunks[0] error-chunk assertions to the type:"error" chunk (the
      LAST chunk); add a content-chunk assertion: chunks[0].type==="content",
      chunks[0].text starts with PREFIX, chunks[0].text === PREFIX + (error chunk).error.
      Keep assertNoSecretShapes(r.body) (now also covers the content line --
      correct, same redacted message).
    - Case 4 (drain): after the existing content-chunks assertion, additionally
      assert the LAST content chunk is the PREFIX-prefixed error text and equals
      PREFIX + (terminal error chunk).error; terminal still type:"error", NO done.

    THEN GREEN -- apps/api/src/routes/agent/stream.ts, INSIDE the
    emitTerminalErrorChunk closure (~L257-296): BEFORE the existing
    if (!raw.writableEnded) {...type:"error"...} write block, add a content-chunk
    write guarded by the SAME if (!raw.writableEnded) check and the SAME try/catch
    socket-closed defense. Declare
    const contentChunk: StreamChunk = { type: "content", text: <PREFIX> + classified.error };
    where <PREFIX> is the U+274C cross-mark glyph + single space, then
    raw.write(JSON.stringify(contentChunk) + "\n") inside a try/catch that swallows
    a socket-closed write (mirror the v8-ignore defensive-comment style already on
    the error-chunk write). Reuse the already-computed classified binding (do NOT
    call classifyUpstreamError twice). Wire order: (1) content, (2) error, (3) NO
    done, (4) raw.end() at the call sites (unchanged). Because BOTH the preflight
    catch (~L318) and the drain catch (~L368) call this closure, do NOT duplicate
    the content write at the two call sites.

    Constitutional: no `as any`/@ts-ignore in production code (LOCKER-02) -- the
    content write is fully typed via the StreamChunk union. No NODE_ENV branch
    (LOCKER-01). The cross-mark prefix is a UI marker, not a credential/UUID/host
    literal (LOCKER-03 clean). English-only source preserved. Code + tests in ONE
    atomic commit:
    fix(agent): emit content chunk before error chunk so client renders error bubble (260528-fzu, v1.0.15)
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server/apps/api && pnpm exec vitest run tests/unit/routes/agent/__tests__/stream-error-mapping.test.ts tests/integration/agent-stream-error-contract.test.ts</automated>
  </verify>
  <done>
    Both test files GREEN. On preflight AND drain failure paths the wire emits a
    { type:"content", text } line whose text === PREFIX + the error chunk's error,
    immediately followed by the unchanged { type:"error",error,code,provider } line,
    with NO { type:"done" } line. classifyUpstreamError is called once per failure.
    No type-suppression, no NODE_ENV branch. Coverage on stream.ts at least
    90/90/90/90 on the diff (the added content-write block is exercised by both
    preflight + drain tests; the socket-closed catch carries a v8-ignore matching
    the error-chunk write).
  </done>
</task>

<task type="auto">
  <name>Task 2: Bump chart to 1.0.18 with image v1.0.15 default (SEPARATE commit)</name>
  <files>charts/openwhispr-server/Chart.yaml, charts/openwhispr-server/values.yaml</files>
  <action>
    Chart.yaml (lines ~17-18): change version: 1.0.17 to version: 1.0.18 and
    appVersion: "1.0.14" to appVersion: "1.0.15".

    values.yaml (image block, ~L178-192): change the default tag: "1.0.14" to
    tag: "1.0.15" (the image default tag tracks appVersion per the convention
    documented in that comment block), and prepend a one-line changelog note above
    the existing # 1.0.14 comment, matching the existing comment style, summarizing:
    "1.0.15 -- agent stream content-chunk-before-error fix (260528-fzu): server now
    emits a type:content chunk carrying the error text BEFORE the structured
    type:error chunk so the immutable desktop client (which only renders
    content/tool_calls/tool_result) shows the error in the chat bubble. Structured
    error chunk shape unchanged. No DB/auth/schema change."

    Chart/release bump ONLY -- no application code in this commit. Commit message:
    chore(server-chart): bump to 1.0.18 with image v1.0.15 default (260528-fzu)
  </action>
  <verify>
    <automated>cd /Users/nick/openwhispr-server && grep -E '^version: 1\.0\.18' charts/openwhispr-server/Chart.yaml; grep -E '^appVersion: "1\.0\.15"' charts/openwhispr-server/Chart.yaml; grep -E 'tag: "1\.0\.15"' charts/openwhispr-server/values.yaml</automated>
  </verify>
  <done>
    Chart.yaml reads version: 1.0.18 + appVersion: "1.0.15"; values.yaml image
    default tag reads "1.0.15" with a 1.0.15 changelog note. No application source
    in this commit (chart YAML only).
  </done>
</task>

</tasks>

<verification>
- pnpm exec vitest run for both target test files is GREEN (preflight + drain
  paths both assert content-before-error ordering, no-done invariant, and
  text === PREFIX + error).
- stream.ts diff coverage at least 90/90/90/90.
- Constitutional lockers clean on the diff: LOCKER-01 (no NODE_ENV branch),
  LOCKER-02 (no type-suppression), LOCKER-03 (no host/UUID/secret-shape literal;
  cross-mark glyph is a UI marker, not flagged).
- Chart.yaml version 1.0.18 / appVersion 1.0.15; values.yaml image tag 1.0.15.
- Two atomic commits: (1) fix(agent) code+tests, (2) chore(server-chart) bump.
</verification>

<success_criteria>
- On upstream failure, /api/agent/stream emits a content chunk (text =
  cross-mark prefix + canonical error) immediately before the unchanged terminal
  error chunk, on BOTH the preflight and the drain failure paths, with no done
  chunk following.
- The immutable desktop client (content/tool_calls/tool_result only) now renders
  the error text into the chat bubble.
- Structured { type:"error", error, code, provider } chunk shape is byte-identical
  to v1.0.13 (structured consumers / future clients unaffected).
- classifyUpstreamError, the client, the error chunk shape, the done-removal, and
  the lefthook hook / Groq aliases are all UNTOUCHED (out of scope).
- Chart bumped to 1.0.18 / appVersion 1.0.15 in a separate commit.
- Strict TDD honored: content-before-error assertions are the RED, the content
  write is the GREEN, in the same atomic commit.
</success_criteria>

<output>
After completion, create
.planning/quick/260528-fzu-v1-0-15-content-chunk-before-error/260528-fzu-SUMMARY.md
</output>
