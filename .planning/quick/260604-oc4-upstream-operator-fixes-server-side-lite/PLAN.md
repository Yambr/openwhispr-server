---
phase: quick-260604-oc4
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/litellm-client/src/index.ts
  - packages/litellm-client/src/config.ts
  - packages/litellm-client/tests/unit/auth-headers.test.ts
  - packages/litellm-client/tests/unit/config.test.ts
  - apps/api/src/routes/reason.ts
  - apps/api/src/routes/transcribe.ts
  - apps/api/src/routes/diarization.ts
  - apps/api/src/routes/realtime.ts
  - apps/api/src/lib/realtime-frame-translate.ts
  - apps/api/src/config/realtime.ts
  - apps/api/tests/unit/lib/realtime-frame-translate.test.ts
  - apps/api/tests/unit/config/realtime.test.ts
  - .env.full.example
  - .env.external.example
  - .env.slim.example
  - .env.embedded.example
  - .env.local-speaches.example
  - docs/self-hosting.md
  - docs/operations.md
autonomous: true
requirements: [UPSTREAM-4, UPSTREAM-1.5, UPSTREAM-2.4, UPSTREAM-3.1]
user_setup: []

must_haves:
  truths:
    - "Every LiteLLM gateway call (chat/agent, cleanup, STT, realtime, diarization) carries the authenticated user's EMAIL in the OpenAI body `user` field when available, falling back to the UUID."
    - "When LITELLM_USER_HEADER_NAME is set, every gateway call emits that header carrying the end-user email (or fallback id); when unset, no such header is emitted."
    - "The internal x-litellm-end-user-id header continues to carry the stable UUID (NOT email) for LiteLLM end-user keying + spend-logs."
    - "A client-supplied realtime transcription model NEVER overrides the operator-configured model when force mode is on (default); client language continues to pass through."
    - "endUser values are CR/LF-rejected at authHeaders, same as userId/requestId."
    - "Operators reading self-hosting docs know to raise reverse-proxy body size to >=100MB and understand the requestKind/thinking-off contract."
  artifacts:
    - path: "packages/litellm-client/src/index.ts"
      provides: "endUser field on 4 request types; authHeaders emits configurable email header; body.user prefers endUser"
    - path: "packages/litellm-client/src/config.ts"
      provides: "userHeaderName config field loaded from LITELLM_USER_HEADER_NAME"
    - path: "apps/api/src/lib/realtime-frame-translate.ts"
      provides: "force-model pinning in translateClientToUpstream for both Beta and GA session.update frames"
    - path: "apps/api/src/config/realtime.ts"
      provides: "forceTranscriptionModel flag from REALTIME_FORCE_TRANSCRIPTION_MODEL"
  key_links:
    - from: "apps/api/src/routes/{reason,transcribe,diarization}.ts"
      to: "litellm-client request types"
      via: "endUser: req.user.email ?? req.user.id"
      pattern: "endUser:\\s*req\\.user\\.email"
    - from: "apps/api/src/routes/realtime.ts"
      to: "translateClientToUpstream"
      via: "force-model param threaded from RealtimeConfig"
      pattern: "translateClientToUpstream\\(.*force"
---

<objective>
Three independent server-side fixes from a corporate-operator upstream bug report, plus two docs-only items, packaged as exactly 3 atomic commits.

Purpose:
- FIX #4 (primary): give the bundled/corporate LiteLLM end-user EMAIL attribution in the OpenAI `user` body field AND a configurable HTTP header, across ALL gateway calls (chat/agent, cleanup, STT, realtime, diarization), while keeping the stable UUID for LiteLLM end-user keying + spend-logs.
- FIX #1.5: ensure the operator-configured realtime transcription model always wins over a client-supplied model.
- DOCS #2.4 + #3.1: document the requestKind/thinking-off contract and the reverse-proxy body-size requirement.

Output: 4 new request-type fields, 1 new client config field, 1 new realtime config flag, 3 new env vars (documented + validated + in all .env.*.example), updated docs.

DESIGN DECISIONS (locked, per orchestrator reconnaissance):
- D-1: `x-litellm-end-user-id` STAYS the UUID (`req.user.id`). It is LiteLLM's stable end-user key + spend-logs anchor; emails are mutable. Operator gets EMAIL in the body `user` field + the configurable header — both, not instead.
- D-2: New optional `endUser?: string` on all 4 request types. Call sites pass `req.user.email ?? req.user.id`. Body `user` becomes `endUser ?? userId`. authHeaders emits the configurable header `{[userHeaderName]: endUser}` ONLY when both `userHeaderName` is configured AND `endUser` is present.
- D-3: System/background calls (no authed user) pass no `endUser` -> no email header, body `user` falls back to UUID — exactly today's behavior.
- D-4: `REALTIME_FORCE_TRANSCRIPTION_MODEL` defaults to TRUE (operator model wins). Force pins `model` in BOTH the Beta-translation path AND the GA `session.update` passthrough path; client `language` still passes through.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md

<constraints>
- Strict TDD: RED test BEFORE impl, tests + production code land in the SAME commit. >=90% coverage on diff.
- No `as any` / `as unknown as` / `@ts-ignore` / `@ts-nocheck` (LOCKER-02). `@ts-expect-error issue-NNNN: <reason>` only.
- English-only source. Mock only at process/network boundary; the litellm-client unit tests inject a fake `request` fn (network boundary) — no live LiteLLM.
- LOCKER-01: env reads ONLY in config/*.ts and config.ts. Route code MUST NOT read process.env — the new realtime flag is resolved in config/realtime.ts and the new header name in litellm-client/config.ts.
- LOCKER-03: no hardcoded localhost / secret-shape literals outside tests/docs/compose. The configurable header NAME is operator-supplied via env; default header name when unset = NONE (header omitted), so no literal default ships in route code.
- LOCKER-04: every route already has schema+rateLimit; this plan touches NO route declarations, only request payloads — verify no new route is added.
</constraints>

<interfaces>
litellm-client request types (packages/litellm-client/src/index.ts):
  ChatCompletionRequest @194: { model?, messages, userId: string, requestId: string, extras?, signal?, headersTimeout?, bodyTimeout? }
  ChatCompletionsStreamRequest @218 extends ChatCompletionRequest: { streamOptions? }
  AudioTranscriptionRequest @231: { body: Readable, contentType, userId, requestId, model?, ... }
  PassthroughRequest @260: { method, body?, contentType?, userId, requestId, ... }

authHeaders @429 (CURRENT):
  function authHeaders(userId: string, requestId: string): Record<string,string>
  - CR/LF rejects userId and requestId
  - returns { authorization: Bearer <masterKey>, "x-litellm-end-user-id": userId, "x-litellm-spend-logs-metadata": JSON({openwhispr_request_id}) }

Body `user`: index.ts:480 (chatCompletions) and :566 (chatCompletionsStream) set `user: req.userId`.
  audioTranscriptions (multipart) + passthrough (opaque) set NO body user — header is the only attribution vector for those two.

LitellmClientConfig @config.ts:42 — has masterKey, baseUrl, providerKeys, defaultChatModel, defaultSttModel, defaultRealtimeModel, defaultCleanupModel, modelParams.
loadLitellmConfigFromEnv @config.ts:247 — env-read boundary.

Call sites (UUID today):
  reason.ts:171 userId: req.user.id
  transcribe.ts:226 userId: req.user.id
  diarization.ts:144 routes through litellm-client passthrough/authHeaders (confirm exact arg)
  realtime.ts:255/315 carry userId:string into buildUpstreamUrl->authHeaders
  req.user.email IS available on the Better Auth session user at all authed call sites (apps/api/src/auth.ts / middleware/dual-auth.ts).

Realtime translate (apps/api/src/lib/realtime-frame-translate.ts):
  translateClientToUpstream(frame) @321 — early-returns frame unchanged UNLESS type === "transcription_session.update" (Beta), in which case it calls betaToGaSessionPayload @165 which copies input_audio_transcription verbatim @184.
  GA-aware shipping client sends `session.update` DIRECTLY -> hits early return @322-324 -> passes model through UNCHANGED. Both paths must be force-pinned.
  Called at realtime.ts:391 in forwardClientFrame; `transcription: RelayTranscriptionConfig` is in scope at the bridge (realtime.ts:357).
  RelayTranscriptionConfig @210 / RealtimeTranscriptionConfig @config/realtime.ts:142 carry `model: string` and optional `language`.
  DEFAULT_REALTIME_TRANSCRIPTION_MODEL @config/realtime.ts:100; env REALTIME_TRANSCRIPTION_MODEL already wired.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (COMMIT 1 — Fix #4): LiteLLM end-user email body + configurable header</name>
  <files>packages/litellm-client/src/config.ts, packages/litellm-client/src/index.ts, packages/litellm-client/tests/unit/config.test.ts, packages/litellm-client/tests/unit/auth-headers.test.ts, apps/api/src/routes/reason.ts, apps/api/src/routes/transcribe.ts, apps/api/src/routes/diarization.ts, apps/api/src/routes/realtime.ts</files>
  <behavior>
    config.test.ts (RED first):
    - loadLitellmConfigFromEnv with LITELLM_USER_HEADER_NAME="X-OpenWhispr-User-Email" -> config.userHeaderName === "X-OpenWhispr-User-Email".
    - Unset or empty-string LITELLM_USER_HEADER_NAME -> config.userHeaderName === undefined (empty treated as unset, same seam as other model envs).
    - A header name containing CR/LF or a colon REFUSES to load (throw) — header names must be a single safe token (defence-in-depth; an operator typo cannot inject a second header).
    auth-headers.test.ts (RED first) — drive via the public client with an injected fake `request` fn capturing outbound headers + body:
    - chatCompletions with endUser="a@b.com": outbound body.user === "a@b.com"; x-litellm-end-user-id === userId (UUID, NOT email).
    - chatCompletions with endUser undefined: body.user === userId; no email header.
    - With userHeaderName set + endUser present: outbound headers carry {[userHeaderName]: "a@b.com"}.
    - With userHeaderName set + endUser undefined (system call): NO email header emitted.
    - With userHeaderName UNSET + endUser present: NO email header emitted (header opt-in).
    - audioTranscriptions + passthrough with userHeaderName set + endUser present: email header emitted (these have no body.user slot — header is their only attribution).
    - endUser containing CR/LF -> authHeaders throws "endUser must not contain CR/LF".
  </behavior>
  <action>
    Per D-1/D-2/D-3.
    config.ts: add `userHeaderName?: string` to LitellmClientConfig. In loadLitellmConfigFromEnv resolve from `env.LITELLM_USER_HEADER_NAME` (empty string -> undefined, mirroring the defaultChatModel seam). Validate the name is a single header token (reject CR/LF and `:`); throw on violation, same loud-fail posture as the master-key check.
    index.ts: add optional `endUser?: string` to ChatCompletionRequest, AudioTranscriptionRequest, PassthroughRequest (ChatCompletionsStreamRequest inherits). Extend authHeaders signature to accept endUser (e.g. `authHeaders(userId, requestId, endUser?)`); CR/LF-reject endUser; when `config.userHeaderName && endUser` add `{[config.userHeaderName]: endUser}` to the returned headers. Update the 4 authHeaders call sites (chatCompletions, chatCompletionsStream, audioTranscriptions, passthrough) to forward `req.endUser`. In chatCompletions @480 and chatCompletionsStream @566 set `user: req.endUser ?? req.userId`.
    Route call sites: add `endUser: req.user.email ?? req.user.id` alongside the existing `userId: req.user.id` at reason.ts (~171), transcribe.ts (~226), diarization.ts (confirm the passthrough/transcription call arg site), realtime.ts (~255/315 — thread endUser into the buildUpstreamUrl/authHeaders path; if realtime uses authHeaders for the WSS upstream dial, pass req.user.email ?? req.user.id; if email is not available at the upgrade seam, pass req.user.id and note it in the SUMMARY). Keep userId as the UUID everywhere.
    Do NOT add a body `user` to audioTranscriptions/passthrough (multipart/opaque) — header is their attribution vector. Confirm no wire-schemas change: endUser is a server->upstream concern, the client never sends it; packages/wire-schemas request schemas are UNAFFECTED (state this in the SUMMARY).
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/litellm-client test 2>&1 | tail -25</automated>
  </verify>
  <done>endUser flows to body.user + configurable header across all 4 methods; x-litellm-end-user-id stays UUID; header opt-in via LITELLM_USER_HEADER_NAME; CR/LF rejected; all relevant route call sites pass req.user.email ?? req.user.id; coverage >=90% on diff; commit `feat(litellm): end-user email body attribution + configurable LITELLM_USER_HEADER_NAME (upstream #4)`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2 (COMMIT 2 — Fix #1.5): force operator realtime transcription model over client override</name>
  <files>apps/api/src/config/realtime.ts, apps/api/src/lib/realtime-frame-translate.ts, apps/api/src/routes/realtime.ts, apps/api/tests/unit/config/realtime.test.ts, apps/api/tests/unit/lib/realtime-frame-translate.test.ts</files>
  <behavior>
    realtime.test.ts (config) (RED first):
    - REALTIME_FORCE_TRANSCRIPTION_MODEL unset -> resolved forceTranscriptionModel === true (default-on per D-4).
    - "0" / "false" (case-insensitive) -> false. "1" / "true" -> true.
    realtime-frame-translate.test.ts (RED first):
    - translateClientToUpstream(GA `session.update` whose session.audio.input.transcription.model="gpt-4o-mini-transcribe", force="gpt-4o-transcribe") -> outbound model === "gpt-4o-transcribe"; client `language` (if present) preserved.
    - Beta `transcription_session.update` with input_audio_transcription.model="bad", force set -> translated GA model === forced value; language preserved.
    - force arg undefined/omitted -> client model passes through UNCHANGED (back-compat; existing fixtures stay green).
    - Frame types other than session.update / transcription_session.update with a force arg -> returned unchanged (same object reference).
  </behavior>
  <action>
    Per D-4.
    config/realtime.ts: add `forceTranscriptionModel: boolean` to RealtimeConfig; resolve from `REALTIME_FORCE_TRANSCRIPTION_MODEL` (LOCKER-01 env boundary), default true, treat "0"/"false" (case-insensitive) as false. REUSE existing REALTIME_TRANSCRIPTION_MODEL for the value.
    realtime-frame-translate.ts: extend `translateClientToUpstream(frame, forceTranscriptionModel?: string)`. When forceTranscriptionModel is a non-empty string:
      (a) Beta path: after betaToGaSessionPayload, pin `ga.session.audio.input.transcription.model = forceTranscriptionModel` (preserve language).
      (b) GA passthrough path: intercept `frame.type === "session.update"` (currently early-returns) — if it carries session.audio.input.transcription, return a shallow-cloned frame with transcription.model pinned to forceTranscriptionModel (preserve language + sibling fields); otherwise return unchanged.
      When forceTranscriptionModel is undefined -> preserve today's behavior exactly (both paths unchanged).
    realtime.ts:391 — pass the forced model into translateClientToUpstream: `transcription.forceTranscriptionModel ? transcription.model : undefined` resolved from RealtimeConfig.forceTranscriptionModel (thread the boolean + model through to bridgeRealtimeSockets; transcription: RelayTranscriptionConfig is already in scope at :357). The relay-originated frame (buildRelaySessionUpdateFrame) already uses config.model — no change there.
    No NODE_ENV branch. No hardcoded model literal in route code (value comes from config).
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api test -- realtime-frame-translate realtime 2>&1 | tail -25</automated>
  </verify>
  <done>Client-supplied transcription model cannot override operator model in force mode (default on) on BOTH Beta and GA paths; language preserved; force-off restores passthrough; existing realtime fixtures green; coverage >=90% on diff; commit `fix(realtime): operator transcription model wins over client override via REALTIME_FORCE_TRANSCRIPTION_MODEL (upstream #1.5)`.</done>
</task>

<task type="auto">
  <name>Task 3 (COMMIT 3 — docs + env): env examples, requestKind/thinking contract, reverse-proxy body size</name>
  <files>.env.full.example, .env.external.example, .env.slim.example, .env.embedded.example, .env.local-speaches.example, docs/self-hosting.md, docs/operations.md</files>
  <action>
    Env examples (#4 + #1.5 follow-up): add commented entries to ALL FIVE .env.*.example files:
      `# LITELLM_USER_HEADER_NAME=X-OpenWhispr-User-Email`  (opt-in; when set, every gateway call carries the authenticated user's email in this header; body `user` always carries email-or-UUID regardless. x-litellm-end-user-id stays the stable UUID.)
      `# REALTIME_FORCE_TRANSCRIPTION_MODEL=true`  (default true; operator model from REALTIME_TRANSCRIPTION_MODEL always wins over a client-supplied realtime model. Set 0/false to honor the client.)
    docs/operations.md — add (or extend) a section documenting LITELLM_USER_HEADER_NAME and REALTIME_FORCE_TRANSCRIPTION_MODEL with the same operator-runbook style as the existing REALTIME_DEFAULT_LANGUAGE section.
    docs/operations.md (#2.4) — document the reasoning/thinking behavior: thinking-off (`extra_body.chat_template_kwargs.enable_thinking:false`) applies to the CLEANUP request class ONLY, is Qwen3/vLLM-specific (other backends ignore it silently), and the routing class is now EXPLICIT via `requestKind` (shipped #36): explicit `body.requestKind` PRIMARY, weakened isCleanupRequest FALLBACK. Reference REASONING_MODEL_PARAMS / REASONING_CLEANUP_MODEL as the configurable seam (no new env needed).
    docs/self-hosting.md (#3.1) — add a "Reverse-proxy body size" subsection: the API multipart cap is 100MB (index.ts MULTIPART_OPTIONS fileSize 100*1024*1024). Operators MUST raise their reverse proxy: nginx `client_max_body_size 100m;` (default 1MB -> 413 on audio upload), Traefik has no body-size limit by default (note it). State the symptom (413 Request Entity Too Large on /api/transcribe).
  </action>
  <verify>
    <automated>test "$(grep -l 'LITELLM_USER_HEADER_NAME' .env.full.example .env.external.example .env.slim.example .env.embedded.example .env.local-speaches.example | wc -l | tr -d ' ')" = "5" && grep -q 'REALTIME_FORCE_TRANSCRIPTION_MODEL' .env.full.example && grep -q 'client_max_body_size' docs/self-hosting.md && grep -qi 'requestKind' docs/operations.md && echo OK</automated>
  </verify>
  <done>All 5 env examples carry both new commented vars; operations.md documents both env vars + the requestKind/thinking-off contract; self-hosting.md documents the 100MB reverse-proxy body size requirement; commit `docs: LITELLM_USER_HEADER_NAME + REALTIME_FORCE_TRANSCRIPTION_MODEL + reverse-proxy body-size + requestKind/thinking contract (upstream #2.4/#3.1)`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator env -> litellm-client | LITELLM_USER_HEADER_NAME is operator-controlled; flows into an outbound HTTP header name. |
| authenticated user -> upstream | req.user.email (Better Auth, server-derived, not client-asserted) flows into outbound header value + body.user. |
| realtime client -> upstream | client-supplied session.update transcription.model is untrusted; force mode pins it. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-oc4-01 | Tampering | LITELLM_USER_HEADER_NAME header name | mitigate | config.ts rejects CR/LF and `:` in the header name at load (EX_CONFIG / throw) — an operator typo cannot inject a second header or split the request. |
| T-oc4-02 | Injection | endUser header value (email) | mitigate | authHeaders CR/LF-rejects endUser, same belt as userId/requestId; value is server-derived from Better Auth session (req.user.email), never client-asserted. |
| T-oc4-03 | Spoofing/Confusion | client-supplied realtime transcription model | mitigate | REALTIME_FORCE_TRANSCRIPTION_MODEL (default on) pins the operator model on both Beta + GA paths; a malicious/buggy client cannot redirect transcription to an unintended model. |
| T-oc4-04 | Information disclosure | email in upstream header/body | accept | email is PII but only crosses to the operator-owned LiteLLM over the existing https-enforced (HI-3) hop; no new external egress. Operator opt-in via env. |
</threat_model>

<verification>
- `pnpm --filter @openwhispr/litellm-client test` green; new auth-headers + config tests cover all D-2 branches.
- `pnpm --filter @openwhispr/api test -- realtime-frame-translate realtime` green; existing realtime fixtures unchanged when force arg omitted.
- `grep -rn 'endUser:\s*req\.user\.email' apps/api/src/routes` shows the email fallback at reason/transcribe/diarization (and realtime where email reaches the seam).
- `grep -rn 'as any\|@ts-ignore\|@ts-nocheck' <touched files>` returns nothing new (LOCKER-02).
- No new Fastify route declaration added (LOCKER-04 untouched).
- Diff coverage >=90/90/90/90 on all changed src files.
- packages/wire-schemas: UNAFFECTED — confirm no schema edit (endUser is server->upstream only).
</verification>

<success_criteria>
- Exactly 3 atomic commits: (1) Fix #4 litellm email+header, (2) Fix #1.5 realtime force-model, (3) docs+env.
- Each code commit lands tests + production together (strict TDD); RED proven before GREEN.
- 3 new env vars in all 5 .env.*.example, validated at the config boundary, documented in operations.md / self-hosting.md.
- x-litellm-end-user-id remains the UUID; email lands in body.user + configurable header per D-1.
</success_criteria>

<output>
After completion, create `.planning/quick/260604-oc4-upstream-operator-fixes-server-side-lite/SUMMARY.md` recording: actual line numbers touched, the diarization/realtime endUser seam resolution, wire-schemas no-op confirmation, and the 3 commit SHAs.
</output>
