---
phase: quick-20260526-realtime-translate-passthrough-session-lifecycle
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/lib/realtime-frame-translate.ts
  - apps/api/tests/unit/lib/realtime-frame-translate.test.ts
  - charts/openwhispr-server/Chart.yaml
  - charts/openwhispr-server/values.yaml
autonomous: true
requirements:
  - QUICK-RT-PASSTHRU-01
user_setup: []

must_haves:
  truths:
    - "translateUpstreamToClient(frame) returns the same object reference for frame.type === 'session.created' (passthrough, NO rename to transcription_session.created)"
    - "translateUpstreamToClient(frame) returns the same object reference for frame.type === 'session.updated' (passthrough, NO rename, NO payload flattening)"
    - "translateClientToUpstream is unchanged — transcription_session.update path remains because the dead-Beta-only code path costs nothing and the public surface stays stable; client emits GA session.update which already falls through the early return"
    - "Production real-mic flow: WSS handshake → server forwards GA session.created → upstream OpenWhispr/Yambr client switch case 'session.created' fires → pendingResolve is called → no 15s timeout → transcription frames arrive"
    - "vitest unit suite apps/api/tests/unit/lib/realtime-frame-translate.test.ts is GREEN with assertions flipped to passthrough semantics"
    - "Coverage on apps/api/src/lib/realtime-frame-translate.ts ≥ 90/90/90/90 (lines/branches/functions/statements)"
    - "No constitutional locker fires (LOCKER-01..LOCKER-08 all clean): no NODE_ENV branches added, no type suppressions, no hardcoded localhost/UUID/secret-shape, no unused exports, no error secret shape, no shell credential interp, no plaintext credential columns"
    - "TypeScript compiles clean (no noUnusedLocals failure from now-orphaned gaToBetaSessionPayload / gaAudioFormatToBeta)"
    - "charts/openwhispr-server/Chart.yaml: version 1.0.10 → 1.0.11, appVersion '1.0.7' → '1.0.8'"
    - "charts/openwhispr-server/values.yaml: image.tag '1.0.7' → '1.0.8' with lineage note appended above the 1.0.7 lineage describing the translate-passthrough fix"
    - "Single atomic git commit lands the production change + tests + chart + values bump together"
    - "Image tag v1.0.8 created locally on the commit SHA"
    - "Chart tag openwhispr-server-1.0.11 created locally on the commit SHA"
    - "Both tags pushed to origin alongside the commit"
  artifacts:
    - path: "apps/api/src/lib/realtime-frame-translate.ts"
      provides: "Beta↔GA frame translation with passthrough session.created/session.updated"
      contains: "translateUpstreamToClient"
    - path: "apps/api/tests/unit/lib/realtime-frame-translate.test.ts"
      provides: "vitest unit suite (RED→GREEN flipped to passthrough)"
      contains: "passes session.created through unchanged"
    - path: "charts/openwhispr-server/Chart.yaml"
      provides: "Helm chart version 1.0.11 with appVersion 1.0.8"
      contains: "version: 1.0.11"
    - path: "charts/openwhispr-server/values.yaml"
      provides: "image.tag 1.0.8 + lineage note"
      contains: "tag: \"1.0.8\""
  key_links:
    - from: "apps/api/src/routes/realtime.ts (line 436)"
      to: "translateUpstreamToClient"
      via: "module import"
      pattern: "import.*translateUpstreamToClient"
    - from: "Helm chart 1.0.11"
      to: "openwhispr-api image tag 1.0.8"
      via: "values.yaml image.tag"
      pattern: "tag:\\s*\"1.0.8\""
    - from: "git tag v1.0.8"
      to: "single commit containing src + tests + chart + values"
      via: "annotated git tag on HEAD"
      pattern: "v1.0.8"
    - from: "git tag openwhispr-server-1.0.11"
      to: "same commit SHA as v1.0.8"
      via: "annotated git tag on HEAD"
      pattern: "openwhispr-server-1.0.11"
---

<objective>
Restore the realtime translation contract to the actually-shipping upstream OpenWhispr / Yambr-fork desktop client (which speaks **OpenAI Realtime GA throughout**, not Beta as the stale header comment claims). `translateUpstreamToClient` must passthrough `session.created` and `session.updated` unchanged so the client's switch table (`case "session.created"` / `case "session.updated"`) fires and the WSS session lifecycle resumes.

Purpose: fix the production symptom — WSS handshake opens, server forwards a renamed `transcription_session.created` frame, client's switch falls to the default branch, pendingResolve never fires, 15-second connection timeout, zero transcription frames received (peer wd6g78xz reproduced on prod k8s 2026-05-26; same logic bug exists locally even if user did not detail-test).

Output: single atomic git commit + image tag v1.0.8 + chart tag openwhispr-server-1.0.11, all pushed to origin.

Atomicity guarantee: the production code change, the test flip, the chart bump (1.0.10 → 1.0.11), and the values image tag bump (1.0.7 → 1.0.8) land in **one** commit. Two annotated git tags point at that one commit SHA. If anything in the GREEN/coverage/locker chain fails, NOTHING is committed; we re-iterate on the same uncommitted working tree.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@apps/api/src/lib/realtime-frame-translate.ts
@apps/api/tests/unit/lib/realtime-frame-translate.test.ts
@apps/api/src/routes/realtime.ts
@charts/openwhispr-server/Chart.yaml
@charts/openwhispr-server/values.yaml
@CLAUDE.md

<interfaces>
<!-- Key contracts the executor needs. Already verified against the codebase. -->

From apps/api/src/lib/realtime-frame-translate.ts (current state):

```typescript
export interface RealtimeFrame { type: string; [key: string]: unknown }

export function translateClientToUpstream(frame: RealtimeFrame): RealtimeFrame;
// Rewrites transcription_session.update -> session.update + flat-to-nested payload.
// All other frame types pass through (early return on line 351).
// UNCHANGED by this plan — client emits GA session.update directly which already
// falls through the early return.

export function translateUpstreamToClient(frame: RealtimeFrame): RealtimeFrame;
// CURRENT: rewrites session.created -> transcription_session.created (line 384-386)
//          and session.updated -> transcription_session.updated + payload flatten (387-393).
// TARGET: full passthrough. Lines 384-393 REMOVED. The function becomes essentially
//         `return frame;`.

export function buildRelaySessionUpdateFrame(config: RelayTranscriptionConfig): RealtimeFrame;
// UNCHANGED — relay still injects its own GA session.update on upstream open
// (Design B preconfigured-client fix, DEFECT 6).

export function parseRealtimeFrame(raw: string): ParseResult;
// UNCHANGED.

// Local (non-exported) helpers used today by translateUpstreamToClient:
//   gaToBetaSessionPayload (line 238)
//   gaAudioFormatToBeta    (line 150)
// After the fix these become unused. TypeScript noUnusedLocals will flag them.
// DECISION: DELETE both functions (clean, no allowlist needed because they were
// never exported — LOCKER-04 dead-export does not apply).
```

From apps/api/src/routes/realtime.ts (lines 369, 404-405, 432-435 — current, UNCHANGED by this plan):

```typescript
let relaySessionUpdateEchoPending = false;
// On upstream open:
relaySessionUpdateEchoPending = true;
upstreamSocket.send(JSON.stringify(buildRelaySessionUpdateFrame(transcription)));
// On upstream message, BEFORE translate:
if (relaySessionUpdateEchoPending && parsed.frame.type === "session.updated") {
  relaySessionUpdateEchoPending = false;
  return; // swallow the relay's own self-injected update echo
}
const translated = translateUpstreamToClient(parsed.frame); // ← becomes passthrough
clientSocket.send(JSON.stringify(translated));
```

Note: the echo-swallow check on line 432 already compares against the GA name
`session.updated`. That was correct BEFORE the fix because the check runs BEFORE
translate. It remains correct AFTER the fix (translate no longer renames). The
DEFECT-6 swallow is now even more important — without it, the client would see
an unsolicited `session.updated` echo for the relay's self-injected configuration.

Test wrapper helpers (apps/api/tests/unit/lib/realtime-frame-translate.test.ts:31-44):
- `betaToGaSessionPayload(session)` wraps `translateClientToUpstream({type:"transcription_session.update", session})` — KEEP (still exercises Beta→GA client path).
- `gaToBetaSessionPayload(session)` wraps `translateUpstreamToClient({type:"session.updated", session})` — DELETE (after fix, this returns the input session reference unchanged, no transform to assert).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: RED — flip vitest assertions in realtime-frame-translate.test.ts to passthrough semantics, run, confirm failure</name>
  <files>apps/api/tests/unit/lib/realtime-frame-translate.test.ts</files>
  <behavior>
    - `describe("translateUpstreamToClient — GA → Beta")` block (currently lines 300-374) is RENAMED to `describe("translateUpstreamToClient — passthrough (GA→GA per current client contract)")` AND its assertions flipped:
      - "rewrites session.created to transcription_session.created" → "passes session.created through unchanged" — assert `translateUpstreamToClient(frame) === frame` (same reference) AND `result.type === "session.created"`. Frame fixture keeps `{ type:"session.created", session:{ id:"sess_1" } }`.
      - "rewrites session.updated to transcription_session.updated" → "passes session.updated through unchanged" — assert same-reference passthrough AND `result.type === "session.updated"`. Frame fixture stays `{ type:"session.updated", session:{} }`.
      - "flattens the GA session payload on session.updated back to Beta shape" → DELETE entirely (no flattening occurs anymore).
      - "passes transcription delta result frames through unchanged" + "passes transcription completed result frames through unchanged" + "passes input_audio_buffer.committed / speech_* events through unchanged" + "passes GA error frames through unchanged" + "does not double-translate an already-Beta frame" → KEEP (still passthrough, semantics unchanged).
    - `describe("gaToBetaSessionPayload — inverse nested→flat transform")` block (lines 192-227) → DELETE entirely. The local helper this exercised no longer exists in production code.
    - Test-file helper `function gaToBetaSessionPayload(...)` (lines 36-44) → DELETE (no callers after the delete above; round-trip test at line 213-220 dies with the describe block).
    - `describe("round-trip — Beta in, GA at upstream, Beta back to client")` block (line 376) → RENAME to `describe("round-trip — client emits GA, server passes through both directions")` AND update first test "client transcription_session.update survives as nested GA session.update":
      - Keep the Beta→GA assertions on the client→upstream leg (this leg is unchanged by the fix).
      - For the upstream→client leg, change the upstream reply frame from `{ type:"session.created", session:{} }` to the same, AND change assertion from `expect(clientGetsBack.type).toBe("transcription_session.created")` to `expect(clientGetsBack).toBe(upstreamReply)` (same-reference passthrough) PLUS `expect(clientGetsBack.type).toBe("session.created")`.
    - Imports at top of test file: leave `betaToGaSessionPayload` test-helper alone (still used). Type-only imports unchanged.
    - All other `describe` blocks (`parseRealtimeFrame`, `betaToGaSessionPayload`, `translateClientToUpstream`, `buildRelaySessionUpdateFrame`) → UNCHANGED.
    - Expected outcome: `pnpm exec vitest run apps/api/tests/unit/lib/realtime-frame-translate.test.ts` reports FAILING tests on the two passthrough cases and on the round-trip assertion (because production code still renames). This is the RED phase per project TDD discipline.
  </behavior>
  <action>Edit apps/api/tests/unit/lib/realtime-frame-translate.test.ts exactly as specified in `<behavior>`. Do NOT touch production code in this task — the test failure is the gate proving production code is wrong. After editing, run vitest from repo root: `pnpm --filter @openwhispr/api exec vitest run tests/unit/lib/realtime-frame-translate.test.ts` (or the equivalent vitest invocation; see existing test scripts in apps/api/package.json). Capture the output. Verify at least 2 tests FAIL with messages mentioning `transcription_session.created` / `transcription_session.updated` mismatch. DO NOT proceed to Task 2 until you have read the failure messages with your own eyes.</action>
  <verify>
    <automated>pnpm --filter @openwhispr/api exec vitest run tests/unit/lib/realtime-frame-translate.test.ts 2>&1 | tee /tmp/red-phase.log; grep -E "FAIL|✗|passes session\.(created|updated) through unchanged" /tmp/red-phase.log | head -20</automated>
  </verify>
  <done>vitest exits non-zero AND the failure log contains at least 2 failing tests with names matching "passes session.(created|updated) through unchanged" OR the round-trip test, with mismatch messages referencing the still-present rename to `transcription_session.*`. RED phase verified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — apply production passthrough fix in realtime-frame-translate.ts, delete dead local helpers, update header comment, re-run vitest</name>
  <files>apps/api/src/lib/realtime-frame-translate.ts</files>
  <behavior>
    Production code edits (single file):
    1. **`translateUpstreamToClient` body** (current lines 383-395): replace the entire `if/if/return` ladder with a single `return frame;`. Final shape:
       ```typescript
       export function translateUpstreamToClient(frame: RealtimeFrame): RealtimeFrame {
         return frame;
       }
       ```
       Keep the export, the function name, and the parameter signature identical — `routes/realtime.ts` imports it by name (line 147) and any future divergence would still hook here. The JSDoc above the function must be rewritten (see step 3).
    2. **DELETE** the local helper functions that lose their last caller:
       - `function gaToBetaSessionPayload(...)` (current lines 238-254).
       - `function gaAudioFormatToBeta(...)` (current lines 150-167).
       Both are `function`, not `export function`, so LOCKER-04 dead-export does not apply, and there is no allowlist. TypeScript `noUnusedLocals` would otherwise fail the build. Delete cleanly including the JSDoc blocks immediately above each.
    3. **REWRITE the header comment** (current lines 1-60):
       - Replace the "Background" paragraph (lines 4-15) to reflect the corrected contract: the actually-shipping immutable client (upstream OpenWhispr at /Users/nick/openwhispr/src/helpers/openaiRealtimeStreaming.js:132-177 AND Yambr fork v1.7.8) speaks OpenAI Realtime GA throughout — `case "session.created"` / `case "session.updated"` in its switch table, zero references to `transcription_session.*`, and emits `{ type:"session.update", session:{ type:"transcription", audio:{ input:{...} } } }` directly as GA-nested.
       - Replace the "Translation contract" block (lines 24-46) with:
         - client → upstream: `transcription_session.update` is still TRANSFORMED to GA `session.update` (kept for the legacy non-preconfigured / Beta-only client path — costs nothing and stays defensive). Buffer events pass through. Everything else passes through.
         - upstream → client: FULL PASSTHROUGH. `session.created`, `session.updated`, transcription results, buffer events, errors — all returned unchanged. No more Beta-vocabulary rename.
       - Replace the "DATA-PATH NOTE" block (lines 48-54) with a note documenting the 2026-05-26 prod incident: server's stale Beta-rename hung the client's switch-table default branch, 15s timeout, zero frames received; peer wd6g78xz reproduced on prod k8s with real-mic input.
       - Keep "Hardening (T-03-07-07)" paragraph (lines 56-60) unchanged — the parse-result hardening still applies.
    4. **Update the JSDoc above `translateUpstreamToClient`** (current lines 362-382): rewrite to describe full passthrough. State that the function is currently a no-op pure passthrough and is kept as a named export so future divergence (e.g. a future client that needs GA→something rewrites) can hook here without changing call sites in `routes/realtime.ts`. Mention that the relay still self-injects its GA `session.update` (DEFECT 6) and the `session.updated` echo for that injection is swallowed by `relaySessionUpdateEchoPending` in `bridgeRealtimeSockets` BEFORE translate is called — the swallow is now a quality-of-life feature (no unsolicited update echoes reach the client) rather than a correctness gate.
    5. **Update the JSDoc above `translateClientToUpstream`** (current lines 330-348): add a note that the `transcription_session.update` → `session.update` translation is legacy / defence-in-depth — the actually-shipping client emits GA `session.update` directly, which falls through the early return on line 351. The translation remains because the cost is zero and it keeps the surface backwards-compatible with any future Beta-speaking client.
    6. Keep `betaToGaSessionPayload`, `betaAudioFormatToGa`, `isPlainObject`, `REALTIME_PCM_SAMPLE_RATE`, `parseRealtimeFrame`, `buildRelaySessionUpdateFrame`, all type exports — UNCHANGED.
    7. Re-run vitest. The flipped tests from Task 1 MUST now pass. The round-trip test MUST pass. ALL OTHER tests in the file MUST still pass (parseRealtimeFrame, betaToGaSessionPayload via the public client→upstream surface, translateClientToUpstream, buildRelaySessionUpdateFrame).
  </behavior>
  <action>Edit apps/api/src/lib/realtime-frame-translate.ts per `<behavior>` steps 1-6. Use a single Edit per logical change (header comment rewrite, function body replacement, helper deletions, JSDoc updates) to keep the diff reviewable. After all edits, run `pnpm --filter @openwhispr/api exec vitest run tests/unit/lib/realtime-frame-translate.test.ts`. Verify exit code 0 and that the test summary shows 0 failures. Then run a typecheck — `pnpm --filter @openwhispr/api exec tsc --noEmit` — to confirm noUnusedLocals does not fire on the deleted helpers. If typecheck fails because of any orphan reference, fix the production code (NOT the test) and re-run.</action>
  <verify>
    <automated>pnpm --filter @openwhispr/api exec vitest run tests/unit/lib/realtime-frame-translate.test.ts 2>&1 | tee /tmp/green-phase.log; grep -E "Test Files.*passed|Tests.*passed" /tmp/green-phase.log; pnpm --filter @openwhispr/api exec tsc --noEmit 2>&1 | tee /tmp/typecheck.log; test ${PIPESTATUS[0]} -eq 0</automated>
  </verify>
  <done>vitest reports ALL tests in realtime-frame-translate.test.ts as passing (zero failures). tsc --noEmit exits 0 with no errors mentioning `gaToBetaSessionPayload` or `gaAudioFormatToBeta`. GREEN phase verified.</done>
</task>

<task type="auto">
  <name>Task 3: Coverage verification on diff ≥ 90/90/90/90 — vitest --coverage scoped to realtime-frame-translate.ts</name>
  <files>apps/api/src/lib/realtime-frame-translate.ts, apps/api/tests/unit/lib/realtime-frame-translate.test.ts</files>
  <action>Run vitest with coverage scoped to the translate module. Exact command (adjust flag form to whatever apps/api/package.json or apps/api/vitest.config.ts exposes; the standard form is `--coverage` + `--coverage.include`): `pnpm --filter @openwhispr/api exec vitest run --coverage --coverage.include='src/lib/realtime-frame-translate.ts' tests/unit/lib/realtime-frame-translate.test.ts`. Parse the printed coverage table for the row for `realtime-frame-translate.ts` and confirm Lines / Statements / Branches / Functions are ALL ≥ 90.00%. If any axis is < 90, identify the uncovered lines (the coverage report prints uncovered line ranges), add the missing assertions to the test file in the same vein as existing tests (e.g. round-trip with a different fixture, additional passthrough type), and re-run. Do NOT lower the bar — CLAUDE.md mandates ≥ 90/90/90/90 on new/modified code per phase.</action>
  <verify>
    <automated>pnpm --filter @openwhispr/api exec vitest run --coverage --coverage.include='src/lib/realtime-frame-translate.ts' tests/unit/lib/realtime-frame-translate.test.ts 2>&1 | tee /tmp/cov.log; awk '/realtime-frame-translate\.ts/ { for(i=1;i<=NF;i++) print $i }' /tmp/cov.log</automated>
  </verify>
  <done>Coverage table for `realtime-frame-translate.ts` shows Lines ≥ 90% AND Branches ≥ 90% AND Functions ≥ 90% AND Statements ≥ 90%. Captured in /tmp/cov.log for the audit trail.</done>
</task>

<task type="auto">
  <name>Task 4: Constitutional locker audit — run all LOCKER-01..LOCKER-08 linters against the diff, confirm zero new findings</name>
  <files>apps/api/src/lib/realtime-frame-translate.ts, apps/api/tests/unit/lib/realtime-frame-translate.test.ts</files>
  <action>Run each constitutional locker linter from the repo root. Discover available scripts via `cat package.json | grep -A1 '"lint'` or `ls tools/lint-*.ts`. Run at minimum: LOCKER-01 (no-env-branches), LOCKER-02 (no-suppressions), LOCKER-03 (no-hardcode), LOCKER-04 (prod-readiness — dead-export + route-shape), LOCKER-05 (secret-shape-in-error), LOCKER-06 (shell-credential-interp), LOCKER-PLAINTEXT-COLS / LOCKER-08 (no-plaintext-secret-columns). Typical invocation: `pnpm exec tsx tools/lint-no-env-branches.ts` (or whatever the package.json script alias is — `pnpm run lint:lockers` if it exists, else loop the individual scripts). For each: confirm exit code 0 and zero new findings on the two modified files. **Special attention to LOCKER-04 dead-export pass**: the deletions in Task 2 are LOCAL functions (not exported), so they should not produce LOCKER-04 findings; however a regression where a developer accidentally exports a now-orphaned helper would fire here. If any locker fires UNRELATED to this diff (pre-existing debt visible because the linter happens to scan widely), confirm by running the same linter on `main` (`git stash` the working tree, run linter, compare findings, `git stash pop`) and only block on findings NEW to this diff.</action>
  <verify>
    <automated>pnpm exec tsx tools/lint-no-env-branches.ts && pnpm exec tsx tools/lint-no-suppressions.ts && pnpm exec tsx tools/lint-no-hardcode.ts && pnpm exec tsx tools/lint-prod-readiness.ts && pnpm exec tsx tools/lint-secret-shape-in-error.ts && pnpm exec tsx tools/lint-shell-credential-interpolation.ts && pnpm exec tsx tools/lint-no-plaintext-secret-columns.ts 2>&1 | tee /tmp/lockers.log</automated>
  </verify>
  <done>All locker linters exit 0. /tmp/lockers.log contains no NEW findings on apps/api/src/lib/realtime-frame-translate.ts or apps/api/tests/unit/lib/realtime-frame-translate.test.ts. Pre-existing debt elsewhere is documented (if any) but not blocking.</done>
</task>

<task type="auto">
  <name>Task 5: Helm chart + values bump — Chart.yaml to 1.0.11 / appVersion 1.0.8, values.yaml image.tag to 1.0.8 with lineage note</name>
  <files>charts/openwhispr-server/Chart.yaml, charts/openwhispr-server/values.yaml</files>
  <action>
    1. Edit charts/openwhispr-server/Chart.yaml:
       - Change `version: 1.0.10` → `version: 1.0.11` (one occurrence).
       - Change `appVersion: "1.0.7"` → `appVersion: "1.0.8"` (one occurrence).
       - Do not touch `apiVersion`, `name`, `description`, `kubeVersion`, `home`, `sources`, `keywords`, `maintainers`, or `annotations`.
    2. Edit charts/openwhispr-server/values.yaml:
       - Change `tag: "1.0.7"` (current line 88) → `tag: "1.0.8"`.
       - PREPEND a new lineage block immediately above the existing `# Chart 1.0.7 lineage:` block (current line 79). New block format must match the existing lineage convention (English-only per DOCS-09, no Cyrillic):
         ```
         # Chart 1.0.11 lineage:
         #   Image v1.0.8 — apps/api/src/lib/realtime-frame-translate.ts:
         #   translateUpstreamToClient now passes session.created /
         #   session.updated through unchanged. The actually-shipping
         #   immutable OpenWhispr / Yambr-fork desktop client speaks
         #   OpenAI Realtime GA throughout (client switch table handles
         #   `case "session.created"` / `case "session.updated"`, zero
         #   references to `transcription_session.*`). Prior Beta-rename
         #   contract was based on a stale spec read; in prod the rename
         #   landed the client switch on the default branch, pendingResolve
         #   never fired, 15s WSS connection timeout, 0 transcription
         #   frames received. Peer wd6g78xz reproduced on prod k8s
         #   2026-05-26 with real-mic input. No chart-side env-var or
         #   values changes required for operators — pure server code fix.
         ```
       - Do NOT touch any other key in values.yaml (no image repository changes, no resource changes, no env-var additions, no ingress changes).
    3. After editing, render the chart locally to confirm it still parses: `helm template charts/openwhispr-server --dry-run 2>&1 | head -40` (must exit 0 and produce YAML, even if it complains about missing required values — we are smoke-testing the chart structure, not a deployment). Acceptable failure modes: missing required values that would always need an operator-supplied values-override (e.g. DATABASE_URL secret). Unacceptable failure modes: YAML parse errors, template syntax errors.
  </action>
  <verify>
    <automated>grep -E "^version:|^appVersion:" charts/openwhispr-server/Chart.yaml; grep -nE "tag: \"1\\.0\\.8\"|Chart 1\\.0\\.11 lineage" charts/openwhispr-server/values.yaml; helm template charts/openwhispr-server 2>&1 | head -5 | grep -E "^---|^apiVersion:" || echo "HELM_TEMPLATE_OK_OR_VALUES_MISSING"</automated>
  </verify>
  <done>Chart.yaml shows `version: 1.0.11` AND `appVersion: "1.0.8"`. values.yaml shows `tag: "1.0.8"` AND the new "Chart 1.0.11 lineage:" comment block above the existing 1.0.7 lineage. `helm template` does not crash with YAML/template syntax errors.</done>
</task>

<task type="auto">
  <name>Task 6: Single atomic git commit + image tag v1.0.8 + chart tag openwhispr-server-1.0.11, push all to origin</name>
  <files>(no file edits; git operations only)</files>
  <action>
    1. Confirm working tree contains exactly the four expected modified files (and nothing else): `git status --short`. Expected output:
       ```
        M apps/api/src/lib/realtime-frame-translate.ts
        M apps/api/tests/unit/lib/realtime-frame-translate.test.ts
        M charts/openwhispr-server/Chart.yaml
        M charts/openwhispr-server/values.yaml
       ```
       If anything else appears (untracked files, other modifications), STOP and investigate — do not commit unrelated debris.
    2. Stage exactly those four paths (do not use `git add -A` or `.`): `git add apps/api/src/lib/realtime-frame-translate.ts apps/api/tests/unit/lib/realtime-frame-translate.test.ts charts/openwhispr-server/Chart.yaml charts/openwhispr-server/values.yaml`.
    3. Verify the staged diff one last time: `git diff --cached --stat` and `git diff --cached` (skim for any inadvertent secret-shape strings — the pre-commit gitleaks hook will catch them but a self-check is cheaper).
    4. Commit with the conventional-commits message body per the seed in the task brief. Use HEREDOC for formatting. **Hook policy (project CLAUDE.md hard rule #4): NEVER use `--no-verify`.** Let lefthook + gitleaks run.
       ```bash
       git commit -m "$(cat <<'EOF'
       fix(realtime): passthrough session.created/session.updated to client unchanged

       Server's translateUpstreamToClient previously rewrote upstream GA
       `session.created` to Beta `transcription_session.created` (and
       session.updated likewise + payload flatten). Header comment claimed
       "immutable client speaks Beta vocabulary". This contract is wrong
       for the actually-shipping client: both upstream OpenWhispr
       (/Users/nick/openwhispr/src/helpers/openaiRealtimeStreaming.js:132)
       and Yambr fork v1.7.8 (peer-confirmed bundle grep) speak GA
       throughout: client switch table only handles `case "session.created"`
       + `case "session.updated"`, zero references to `transcription_session.*`.
       Client also EMITS GA `{type:"session.update", session:{type:"transcription",
       audio:{input:...}}}` directly; passthrough on the client-to-upstream leg
       works for that without any code change.

       Result before fix: WSS handshake opens, server forwards
       `transcription_session.created`, client switch falls to default branch,
       pendingResolve never fires, 15s connection timeout + 0 frames received
       in real mic test (peer wd6g78xz reproduced on prod k8s 2026-05-26).
       Test 4 saw the renamed frame as wire-level raw because that probe ran
       `ws.on('message')` without the client state machine.

       Fix: translateUpstreamToClient becomes full passthrough for session
       lifecycle events. translateClientToUpstream is unchanged (already
       passthrough for everything except the legacy/dead `transcription_session.update`
       path, kept as defence-in-depth). Local helpers gaToBetaSessionPayload
       and gaAudioFormatToBeta deleted (no callers remain).

       Tests flipped RED-to-GREEN: assertions on the translateUpstreamToClient
       describe block now verify same-reference passthrough for session.created
       and session.updated.

       Image v1.0.8 + chart 1.0.11 atomic release.
       EOF
       )"
       ```
    5. Verify the commit landed: `git log --oneline -1` (capture the SHA) and `git show --stat HEAD` (confirm exactly 4 files changed).
    6. Create the two annotated tags on HEAD:
       ```bash
       git tag -a v1.0.8 -m "Image v1.0.8 — realtime translate passthrough fix (peer wd6g78xz prod incident 2026-05-26)"
       git tag -a openwhispr-server-1.0.11 -m "Helm chart 1.0.11 — image v1.0.8 default, realtime translate passthrough fix"
       ```
    7. Confirm both tags point at the same SHA: `git rev-parse v1.0.8 openwhispr-server-1.0.11 HEAD` — all three values MUST be identical.
    8. Push commit + both tags to origin in one push: `git push origin main && git push origin v1.0.8 openwhispr-server-1.0.11`. The two commands are separated because pushing a tag with `--follow-tags` only follows annotated tags reachable from the pushed branch HEAD (both are, so `--follow-tags` would also work; the explicit form is more verifiable).
    9. Final verification: `git ls-remote origin v1.0.8 openwhispr-server-1.0.11 refs/heads/main` should return three lines, the v1.0.8 and openwhispr-server-1.0.11 tag SHAs equal to the main branch HEAD SHA.
  </action>
  <verify>
    <automated>git status --short | tee /tmp/post-commit-status.log | wc -l | awk '{ exit ($1 == 0) ? 0 : 1 }' && git log --oneline -1 && git rev-parse v1.0.8 openwhispr-server-1.0.11 HEAD | sort -u | wc -l | awk '{ exit ($1 == 1) ? 0 : 1 }' && git ls-remote origin v1.0.8 openwhispr-server-1.0.11 refs/heads/main</automated>
  </verify>
  <done>git status is clean (zero modified/untracked files). `git log --oneline -1` shows the new fix commit. `git rev-parse v1.0.8 openwhispr-server-1.0.11 HEAD | sort -u | wc -l` returns 1 (all three resolve to the same SHA). `git ls-remote origin` shows both tags and main HEAD point at that SHA on the remote.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → server WSS | Untrusted browser/Electron WS frames cross here; already mitigated by `parseRealtimeFrame` byte-cap + JSON-shape gate (UNCHANGED by this plan). |
| server → upstream GA WSS | Trusted egress to OpenAI/LiteLLM; no new attack surface in this diff. |
| git remote (origin) | Tag/branch push surface; gitleaks pre-push hook is the secret-exfil gate (per CLAUDE.md hard rule #4, never `--no-verify`). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-quick-rt-01 | Spoofing | client→server WSS frames | accept | No new auth surface — translation change is byte-shape only. Existing Better Auth + tenant scoping on `/v1/realtime` route (UNCHANGED) remains the gate. |
| T-quick-rt-02 | Tampering | malformed upstream frame | mitigate | `parseRealtimeFrame` (UNCHANGED) rejects malformed/oversized payloads before translate is called; the relay drops them and keeps the socket alive. |
| T-quick-rt-03 | Repudiation | git tag misalignment | mitigate | Task 6 verifies all three refs (v1.0.8, openwhispr-server-1.0.11, HEAD) resolve to the same SHA via `git rev-parse | sort -u | wc -l` MUST be 1, both locally AND on origin (`git ls-remote`). |
| T-quick-rt-04 | Information disclosure | accidental secret commit (image tag bump near env-var docs) | mitigate | gitleaks lefthook pre-commit + pre-push (CLAUDE.md hard rule #4); zero `--no-verify` allowed. Manual `git diff --cached` skim in Task 6 step 3 is a self-check. |
| T-quick-rt-05 | Denial of service | passthrough lets larger upstream session payloads reach client | accept | `parseRealtimeFrame` already enforces MAX_REALTIME_FRAME_BYTES = 1 MiB cap. GA payloads are smaller than the prior Beta-rename + flatten output (no expansion). |
| T-quick-rt-06 | Elevation of privilege | unchanged | accept | No auth code, no role checks, no privilege boundary touched in this diff. |

</threat_model>

<verification>
Phase-level checks executed in the order tasks run:

1. RED phase (Task 1): vitest exits non-zero with at least 2 failing tests naming "passes session.(created|updated) through unchanged" or the round-trip case.
2. GREEN phase (Task 2): vitest exits 0 (all tests pass); tsc --noEmit exits 0 (no unused-locals fallout from helper deletions).
3. Coverage (Task 3): vitest --coverage on the translate module reports ≥ 90% on lines/branches/functions/statements.
4. Lockers (Task 4): every LOCKER-01..LOCKER-08 linter exits 0 with no new findings on the two modified `apps/api` files.
5. Chart (Task 5): `grep` confirms Chart.yaml version 1.0.11 + appVersion 1.0.8, values.yaml tag 1.0.8 + new lineage block; `helm template` does not crash with syntax errors.
6. Commit/tags (Task 6): git status clean post-commit; one new fix commit on HEAD; `git rev-parse v1.0.8 openwhispr-server-1.0.11 HEAD | sort -u | wc -l == 1`; `git ls-remote origin` shows both tags and main HEAD all on the same remote SHA.

Independent verification protocol (mandatory per CLAUDE.md hard rule #3):
- Re-run `pnpm --filter @openwhispr/api exec vitest run tests/unit/lib/realtime-frame-translate.test.ts` and read the exit code + summary with own eyes.
- `git log --oneline -1` to confirm the cited SHA is on HEAD.
- `git diff HEAD~1 -- apps/api/src/lib/realtime-frame-translate.ts | head -80` to confirm the `translateUpstreamToClient` body is now `return frame;`.
- `git ls-remote origin v1.0.8 openwhispr-server-1.0.11` to confirm tags are on the remote (not just local).
</verification>

<success_criteria>
The plan is COMPLETE if and only if ALL of the following are simultaneously true:

1. **Code:** `apps/api/src/lib/realtime-frame-translate.ts` has a `translateUpstreamToClient` whose body is exactly `return frame;` (verified by `grep -A2 "export function translateUpstreamToClient" apps/api/src/lib/realtime-frame-translate.ts | head -3` showing `return frame;`).
2. **Code:** The local helpers `gaToBetaSessionPayload` and `gaAudioFormatToBeta` are absent from the file (verified by `grep -c "gaToBetaSessionPayload\|gaAudioFormatToBeta" apps/api/src/lib/realtime-frame-translate.ts == 0`).
3. **Header doc:** The file header no longer claims "immutable client speaks Beta vocabulary"; instead documents the GA-throughout client contract verified against `/Users/nick/openwhispr/src/helpers/openaiRealtimeStreaming.js`.
4. **Tests:** `pnpm --filter @openwhispr/api exec vitest run tests/unit/lib/realtime-frame-translate.test.ts` exits 0 with all tests passing; the `describe("translateUpstreamToClient — passthrough …")` block asserts same-reference passthrough on session.created AND session.updated; the `describe("gaToBetaSessionPayload — inverse nested→flat transform")` block is absent.
5. **Typecheck:** `pnpm --filter @openwhispr/api exec tsc --noEmit` exits 0.
6. **Coverage:** All four coverage axes ≥ 90% on `apps/api/src/lib/realtime-frame-translate.ts` per the vitest --coverage report.
7. **Lockers:** All of LOCKER-01, -02, -03, -04, -05, -06, -08 linters exit 0 with no new findings on the diff.
8. **Chart:** `charts/openwhispr-server/Chart.yaml` has `version: 1.0.11` AND `appVersion: "1.0.8"`. `charts/openwhispr-server/values.yaml` has `tag: "1.0.8"` AND a "Chart 1.0.11 lineage:" comment block above the existing 1.0.7 lineage.
9. **Atomicity:** Exactly one new commit on HEAD touches exactly the four files in `files_modified`; `git diff --stat HEAD~1` confirms.
10. **Tags:** Annotated tags `v1.0.8` and `openwhispr-server-1.0.11` exist locally AND on origin, both pointing at the same SHA as `main` HEAD. `git rev-parse v1.0.8 openwhispr-server-1.0.11 HEAD | sort -u | wc -l == 1` and `git ls-remote origin v1.0.8 openwhispr-server-1.0.11 refs/heads/main` shows three rows with the same SHA.
11. **No hook bypass:** No `--no-verify` anywhere in the executed commands; lefthook + gitleaks must run on the commit and the push.

Any failure on items 1-11 means the plan is NOT done — the executor must remediate before claiming completion.
</success_criteria>

<output>
After completion, create `.planning/quick/20260526-realtime-translate-passthrough-session-lifecycle/SUMMARY.md` with:
- Final commit SHA + the two tag names + the remote-confirmation `git ls-remote` output.
- Test results: vitest exit code, total tests run, coverage percentages (lines/branches/functions/statements) on the translate module.
- Locker scan results: each LOCKER-NN exit code + new findings count (must be 0).
- Chart smoke result: `helm template` outcome (parsed OK / declined on missing required values is acceptable).
- Operator hand-off: bullet list reminding the ykoolfs5 / deployments-yambr-prod gitops operator to bump chart `targetRevision: 1.0.11` after the OCI publish pipeline lands the new chart.
- Out-of-scope ledger: Phase 63 backlog (validateLitellmBoot full guard, /api/ready) and `availableProviders: ["openai"]` option D explicitly NOT touched in this plan.
</output>
