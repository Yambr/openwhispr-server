---
slug: r23-reason-agent-schema
date: 2026-05-21
status: planned
branch: fix/r23-reason-agent-request-schema
---

# R23 — /api/reason and /api/agent/stream reject the documented request body

## Problem

`POST /api/reason` and `POST /api/agent/stream` `400 {"error":"Invalid
request"}` when sent the request body documented in `docs/BACKEND_SPEC.md`
(the body the immutable client actually sends). They work only with a
bare `{text}` / `{messages}`.

Root cause: `ReasonRequest` (`packages/wire-schemas/src/reason.ts`) is
`.strict()` and only knows `text/model/provider/promptMode/matchType` —
and `provider/promptMode/matchType` are RESPONSE-shape fields wrongly
placed in the request schema. `AgentStreamRequestSchema`
(`packages/wire-schemas/src/agent.ts`) is also `.strict()` and missing
`sessionId/clientType/appVersion`. Every documented client field beyond
`text`/`messages` trips `.strict()` → 400.

## Fix — align request schemas with BACKEND_SPEC.md

Approach (client-agent confirmed): explicitly model every documented
field as typed `.optional()`, keep `text`/`messages` required and
validated (NOT `z.any()`), add `.passthrough()` as forward-compat
insurance for future client fields.

### `packages/wire-schemas/src/reason.ts` — `ReasonRequest`

Required: `text` (string, 1..MAX_REASON_TEXT_LENGTH). Optional:
`model` (string), `agentName` (string), `customDictionary` (string[]),
`customPrompt` (string), `systemPrompt` (string), `language` (string),
`locale` (string), `sessionId` (string), `clientType` (string),
`appVersion` (string), `clientVersion` (string), `sttProvider` (string),
`sttModel` (string), `sttLanguage` (string), `audioFormat` (string),
`sttProcessingMs` (number), `sttWordCount` (number),
`audioDurationMs` (number), `audioSizeBytes` (number),
`clientTotalMs` (number). Replace `.strict()` with `.passthrough()`.
REMOVE `provider`, `promptMode`, `matchType` from the REQUEST schema —
they are `ReasonResponse` fields. The route handler echoes
`body.promptMode ?? "default"` / `body.matchType ?? "default"`
(`reason.ts:151-152`) — after removal those become the literal
defaults `"default"` (the client never sends them anyway). `ReasonResponse`
unchanged.

### `packages/wire-schemas/src/agent.ts` — `AgentStreamRequestSchema`

Required: `messages` (array). Optional: `model` (string, already there),
`systemPrompt` (string, already there), `tools` (array, already there),
plus NEW `sessionId` (string), `clientType` (string), `appVersion`
(string). Replace `.strict()` with `.passthrough()`. Keep
`AgentChatMessageSchema` / `AgentLegacyToolSchema` as-is (their `.strict()`
is fine — those are sub-objects with a fixed shape).

## Antipatterns to avoid

- ❌ `z.any()` / removing body validation — `text`/`messages` must stay validated
- ❌ `.passthrough()` WITHOUT explicit typed fields (a field-name typo would be silently swallowed)
- ❌ Touching the route handlers' logic — only the schemas change
- ❌ `as any` / `@ts-ignore` (LOCKER-02)

## TDD order (RED → GREEN, real surface)

1. RED unit/integration — POST `/api/reason` with the FULL documented
   body from BACKEND_SPEC.md (all ~21 fields at once) → currently 400,
   must become 200. Same for `/api/agent/stream` full documented body.
   Drive through real `buildApp` (R21/R22 lesson).
2. RED — an UNDOCUMENTED extra field → must pass (`.passthrough()`),
   not 400.
3. Keep green — bare `{text}` / `{messages}` still works.
4. GREEN — update the two schemas. ≥90% coverage on the diff.

## Verification

- Tests green; full documented body → 200 on both routes.
- Live curl: full BACKEND_SPEC body on `/api/reason` + `/api/agent/stream`
  → real LLM result (200 / NDJSON), with real upstream keys.
- Report the exact final accepted contract of both routes to the client
  agent for BACKEND_SPEC.md reconciliation.
