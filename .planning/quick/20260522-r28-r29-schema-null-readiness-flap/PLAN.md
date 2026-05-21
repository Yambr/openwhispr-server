---
quick_id: 260522-r28r29
slug: r28-r29-schema-null-readiness-flap
date: 2026-05-22
status: planned
---

# R28 (CRIT) + R29 — reason/agent schema rejects `null` optionals; readiness probe flaps

## R28 — `/api/reason` + `/api/agent/stream` 400 on `null` for optional fields

### Problem (live-bisected by client agent)

`POST /api/reason` returns `400 {"error":"Invalid request"}` when an
optional field is sent as JSON `null`:

```
{"text":"hi"}                  -> 200   (key absent)
{"text":"hi","model":null}     -> 400   Invalid request
{"text":"hi","agentName":null} -> 400   Invalid request
{"text":"hi","customDictionary":[]} -> 200
```

Zod's `.optional()` accepts "key absent" OR a value of the declared
type — but NOT `null`. The immutable desktop client builds the
`/api/reason` body from `opts.model` / `opts.agentName`; on the FIRST
dictation of a session — before the store resolves a model/agent —
those are `null`, so the body literally contains `"model":null`. Server
400s → UI shows "Transcription failed: Invalid request". After an app
restart the store holds non-null values → the same call passes. This is
exactly the user-visible "first attempt fails, works after restart".

`null` for an unset optional field is valid JSON and standard client
behavior; BACKEND_SPEC marks `model`/`agentName` as optional, and
"optional" must tolerate `null`. The client is correct — fix is
server-side.

### Root cause + downstream safety

`packages/wire-schemas/src/reason.ts` + `agent.ts` declare every
optional field as `.optional()`. The route handlers already consume
these fields null-safely (`reason.ts`:
`body.model ?? deps.defaultModel ?? DEFAULT_MODEL` — `??` treats `null`
identically to `undefined`). So ONLY the Zod schema rejects `null`;
nothing downstream breaks once the schema admits it.

### Fix — `.optional()` → `.nullish()` on every optional field

`.nullish()` === `.optional().nullable()` — accepts absent, the typed
value, OR `null`. Apply to EVERY `.optional()` field in:

- **`packages/wire-schemas/src/reason.ts`** — `model`, `agentName`,
  `customDictionary`, `customPrompt`, `systemPrompt`, `language`,
  `locale`, `sessionId`, `clientType`, `appVersion`, `clientVersion`,
  `sttProvider`, `sttModel`, `sttLanguage`, `audioFormat`,
  `sttProcessingMs`, `sttWordCount`, `audioDurationMs`,
  `audioSizeBytes`, `clientTotalMs`. `text` stays required.
- **`packages/wire-schemas/src/agent.ts`** —
  `AgentStreamRequestSchema`: `model`, `systemPrompt`, `tools`,
  `sessionId`, `clientType`, `appVersion`. `messages` stays required.
  `AgentLegacyToolSchema.description` — also `.nullish()` (a client
  may send `"description":null`).
- `AgentChatMessageSchema.content` is already `z.unknown()` — accepts
  `null` — no change.

The `.max()` / `.min()` bounds stay (they apply only when a non-null
value is present). `.passthrough()` stays.

### Type-surface note (LOCKER-02 — no suppressions)

`.nullish()` widens `z.infer` to `T | null | undefined`. Any
TypeScript consumer of `ReasonRequest` / `AgentStreamRequest` that
reads these fields must already tolerate `undefined` (they were
`.optional()`); `null` is newly possible. Audit consumers — the route
handlers use `?? default`, which is correct for both. If any consumer
does `field.length` etc., fix it to `?? fallback` (do NOT add a
type-suppression). Run `tsc --noEmit` on `apps/api` + `apps/worker` +
`packages/*` and resolve any NEW error introduced by the widening.

## R29 — `/api/ready` flaps 503 because the LiteLLM probe hits `/health`

### Problem (live-confirmed)

`/api/ready` returns 503 intermittently (~27 of 251 polls, 4-10ms
response — fast, so not a timeout). The 503 originates in the
`litellm_upstream` check → `depCheck("litellm")` →
`apps/api/src/lib/dep-check.ts` which does `GET ${litellmUrl}/health`
and throws on `statusCode >= 500`.

LiteLLM's **`/health`** endpoint is a DEEP diagnostic: it fans out and
actively probes EVERY model in `model_list` (Groq, OpenRouter, OpenAI).
If any provider is briefly slow / rate-limited, `/health` reports
`unhealthy_endpoints` and a non-200 — so our probe flips to 503 even
though the PROXY itself is fully able to serve. Under load this makes
the R25 compose healthcheck cycle the container `unhealthy <-> healthy`.

### Fix — probe `/health/readiness`, not `/health`

LiteLLM exposes `/health/readiness` — it checks the PROXY's own state
(`{"status":"healthy","db":"connected",...}`), with NO provider
fan-out. Verified live on litellm 1.83.14: `/health/readiness` → 200
`{"status":"healthy","db":"connected"}`. That is the correct "is the
proxy able to accept requests" signal for a tight healthcheck poll;
`/health` (full provider matrix) is a diagnostic endpoint, wrong here.

- **`apps/api/src/lib/dep-check.ts`** — change the litellm probe URL
  from `${url}/health` to `${url}/health/readiness`. Keep the
  `statusCode >= 500` fail rule, the 2s timeout, the `body.dump()`
  socket drain. Update the header comment (line ~14
  `'litellm' → undici GET ${litellmUrl}/health`) to
  `/health/readiness` and add a one-line rationale (provider fan-out
  flap).
- Confirm `/readyz` (the other `depCheck` consumer) is ALSO correct
  with `/health/readiness` — it is: `/readyz` aggregates "deps able to
  serve," not "every provider model up." Note this in the comment.
- `tests/e2e/probes-dependency.test.ts` references the litellm probe
  path — update any hardcoded `/health` expectation to
  `/health/readiness`.

## TDD order (RED → GREEN — tests in the same atomic commit)

1. RED unit (`packages/wire-schemas`): `ReasonRequest.parse` accepts
   `{text:"hi", model:null}`, `{...,agentName:null}`, and a body with
   EVERY optional field explicitly `null` → all `.success === true`.
   `{text:""}` still fails (required min(1)). `model` non-string non-null
   (e.g. `42`) still fails. Mirror for `AgentStreamRequestSchema` —
   `model:null`, `tools:null`, a tool with `description:null`.
2. RED integration (`apps/api`): `POST /api/reason` with
   `{text:"hi",model:null,agentName:null}` → **200** (the first-dictation
   body). `POST /api/agent/stream` with `{messages:[...],model:null}`
   → 200 / NDJSON. Mock LiteLLM at the HTTP boundary.
3. RED unit (`apps/api`, dep-check): the litellm probe issues a GET to
   a URL ending `/health/readiness` (assert via an injected
   request-spy / mock); a 200 from that path → `ok:true`; a 503 → fail.
4. RED — adjust `probes-dependency.test.ts` expectation to
   `/health/readiness`.
5. GREEN — apply the `.nullish()` widening + the dep-check URL change +
   any `tsc` consumer fixes. ≥90/90/90/90 coverage on the diff.

## Antipatterns to avoid

- ❌ Stripping `null`s in the route handler before Zod (server-side
  band-aid — the schema is the contract; fix the contract).
- ❌ `.optional()` left on any field a client may send as `null`
  (half-fix — R28 recurs on the next field).
- ❌ `z.preprocess` null→undefined coercion (hides the contract; future
  readers can't see `null` is accepted).
- ❌ `as any` / `@ts-ignore` to paper over the `T|null` widening
  (LOCKER-02) — fix the consumer with `?? fallback`.
- ❌ Probing LiteLLM `/health` (provider fan-out) for a tight
  healthcheck poll — use `/health/readiness`.
- ❌ Loosening the `depCheck` 2s timeout / dropping `body.dump()`.
- ❌ `NODE_ENV` branch (LOCKER-01); dropping route `schema`/`rateLimit`
  (LOCKER-04).

## Verification

- All lockers green (01/02/03/04, rls, colocated-tests, tdd, english).
- `tsc --noEmit` — zero NEW errors from the `.nullish()` widening.
- Rebuild: `docker compose up -d --build api`.
- Live curl `:4000`, real sign-in bearer:
  `POST /api/reason {"text":"hi","model":null,"agentName":null}` → 200;
  `POST /api/agent/stream {"messages":[{"role":"user","content":"hi"}],"model":null}`
  → 200 NDJSON.
- `/api/ready` polled ≥ 30× over ~5 min under light load → 200 every
  time, zero 503 flap (the R29 fix). If litellm is genuinely down it
  still 503s correctly — verify by stopping the litellm container.
- After landing: update client `SERVER-REQUIREMENTS.md` §R28/R29 to
  CLOSED with commit SHAs; notify the client agent to re-run the
  first-dictation flow.
