---
slug: r23-reason-agent-schema
date: 2026-05-21
status: complete
commit: b9f9085b
branch: fix/r23-reason-agent-request-schema
---

# R23 — /api/reason + /api/agent/stream request-schema alignment — SUMMARY

## Outcome

Both routes now accept the full request body documented in
`docs/BACKEND_SPEC.md` — the body the immutable client sends. Every
documented field is explicitly typed `.optional()`; `text`/`messages`
stay required and validated; `.strict()` → `.passthrough()` for
forward-compat. The response-shape fields `provider`/`promptMode`/
`matchType` were removed from `ReasonRequest` (they never belonged in
the request).

## Commit

`b9f9085b` on `fix/r23-reason-agent-request-schema` (stacked on R22),
atomic.

## Changes

Production: `packages/wire-schemas/src/reason.ts`,
`packages/wire-schemas/src/agent.ts`, `apps/api/src/routes/reason.ts`
(forced `promptMode`/`matchType` echo → literal `"default"`). Route
handler logic untouched. No DB migration.

## Final accepted contract

- `POST /api/reason` — `text` required; `model`, `agentName`,
  `customDictionary` (string[]), `customPrompt`, `systemPrompt`,
  `language`, `locale`, `sessionId`, `clientType`, `appVersion`,
  `clientVersion`, `sttProvider`, `sttModel`, `sttLanguage`,
  `audioFormat` (strings) + `sttProcessingMs`, `sttWordCount`,
  `audioDurationMs`, `audioSizeBytes`, `clientTotalMs` (numbers) all
  optional; `.passthrough()`.
- `POST /api/agent/stream` — `messages` required; `model`,
  `systemPrompt`, `tools`, `sessionId`, `clientType`, `appVersion`
  optional; `.passthrough()`. Sub-objects keep `.strict()`.

## Verification

- 8 test files / 60 tests green (full documented body → 200;
  undocumented extra key → tolerated; bare body still works).
- LOCKER lints clean for the diff; zero new tsc errors.
- Live curl + client-agent UI run of case (г) AI: pending stack rebuild.
