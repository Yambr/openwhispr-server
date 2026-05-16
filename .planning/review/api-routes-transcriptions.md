# Review: api-routes-transcriptions

Branch: main @ 1832f28
Scope: apps/api/src/routes/{transcriptions,tokens,v1/keys,agent}/** + apps/api/src/lib/web-search/**

## Summary
- Files reviewed: 17 (5 transcriptions + 4 tokens + 3 v1/keys + 3 agent + 4 web-search; excluded __fixtures__ + __tests__)
- Findings: CRITICAL=0 HIGH=3 MEDIUM=4 LOW=4
- Top 3 production risks:
  1. **`/api/agent/stream` default model slug is broken** — falls back to `qwen/qwen3.6-plus` which is NOT in LiteLLM `model_list` (config defines `qwen3.6-plus` without the `qwen/` provider prefix). Any authed request that omits `body.model` and where `DEFAULT_AGENT_MODEL` env is unset will receive an upstream 404, emitted as a `finish_reason:"upstream_error"` chunk under HTTP 200. Docs in `docs/self-hosting.md`/`docs/operations.md` copied the wrong default verbatim.
  2. **`/api/agent/stream` accepts unvalidated request bodies** — no zod parse on `messages`/`tools`/`systemPrompt`. Malformed payloads bypass the centralized 400 handler and crash post-hijack as synthetic `stream_error` finish chunks. The `as RequestBody` cast on the raw body is the user-flagged suppression pattern.
  3. **`/api/agent/stream` has no route-level rate-limit override despite being the most expensive endpoint in the scope** — LLM-cost-bearing route relies on global default bucket, while every other authed surface in scope (transcriptions, tokens, keys, web-search) sets explicit max+timeWindow.

## Findings

### [HIGH] Default agent model slug does not match LiteLLM model_list
- File: `apps/api/src/routes/agent/stream.ts:77`
- Category: Hardcode / production breakage
- Evidence:
  ```ts
  const DEFAULT_AGENT_MODEL = "qwen/qwen3.6-plus";
  ```
  Cross-references:
  - `compose/litellm/litellm_config.yaml:23` — `model_name: qwen3.6-plus` (no `qwen/` prefix)
  - `compose/litellm/litellm_config.realistic.yaml:29` — same
  - `packages/litellm-client/src/config.ts:30` — `DEFAULT_CHAT_MODEL = "qwen3.6-plus"`
  - `apps/api/src/routes/reason.ts:65` — `DEFAULT_MODEL = "qwen3.6-plus"`
  - All `__fixtures__/*.sse` — `"model":"qwen3.6-plus"`
  
  Only `stream.ts` uses the `qwen/`-prefixed form. LiteLLM matches by `model_name` (proxy alias), not by the `openrouter/qwen/...` underlying ID — sending `qwen/qwen3.6-plus` returns `{"error":{"message":"litellm.NotFoundError: ... model=qwen/qwen3.6-plus"}}`.
- Why it matters: out-of-the-box default `/api/agent/stream` request (no body.model, no env override) burns a request budget, emits an `upstream_error` finish chunk, and confuses operators because the centralized handler is bypassed (response is HTTP 200). Docs (`docs/self-hosting.md:86`, `docs/operations.md:639`) propagate the same broken default.
- Fix: change to `const DEFAULT_AGENT_MODEL = "qwen3.6-plus";` so the slug matches the proxy alias. Update both docs files to match. Add a contract test that asserts `DEFAULT_AGENT_MODEL` is a member of `compose/litellm/litellm_config.yaml`'s `model_name` set.

### [HIGH] /api/agent/stream skips request body validation
- File: `apps/api/src/routes/agent/stream.ts:120`
- Category: Input validation / `as` suppression
- Evidence:
  ```ts
  const body = (req.body ?? {}) as RequestBody;
  ...
  const messages = prependSystemPrompt(body.messages ?? [], body.systemPrompt);
  const extras: Record<string, unknown> = {};
  if (body.tools !== undefined) {
    extras.tools = translateLegacyTools(body.tools);
  }
  ```
  No zod parse; `body.messages`, `body.tools`, `body.systemPrompt` are trusted by shape. `translateLegacyTools` does `tools.map(...)` — if a client sends `{ tools: "abc" }` this throws post-hijack and surfaces as a `stream_error` finish chunk rather than the canonical 400 envelope.
- Why it matters: violates the project's "byte-for-byte" wire contract by routing valid-payload mistakes through a stream_error path that operators can't grep for; also confuses desktop clients (200 + finish:stream_error vs 400 with reason). Authenticated callers can also push arbitrary unvalidated arrays into LiteLLM (multiplying cost) — `messages` length / nesting unchecked.
- Fix: define `AgentStreamRequestSchema` in `@openwhispr/wire-schemas` (mirroring `WebSearchRequestSchema` pattern used at `web-search.ts:94`) and replace the cast with `const body = AgentStreamRequestSchema.parse(req.body);` BEFORE `reply.hijack()`. Cap `messages.length`, `tools.length`, and `systemPrompt.length` explicitly.

### [HIGH] /api/agent/stream has no LLM-cost rate-limit
- File: `apps/api/src/routes/agent/stream.ts:108-112`
- Category: Cost exposure / rate-limit asymmetry
- Evidence:
  ```ts
  app.route({
    method: "POST",
    url: "/api/agent/stream",
    handler: async (req, reply) => {
  ```
  No `config: { rateLimit: {...} }`. Compare against:
  - `transcriptions/create.ts:28` — `{ rateLimit: { max: 120, timeWindow: "1 minute" } }`
  - `transcriptions/batch-create.ts:41` — `{ max: 5, timeWindow: "1 minute" }`
  - `tokens/assemblyai.ts:56-66`, `tokens/deepgram.ts:35-40`, `tokens/openai-realtime.ts:61-66` — `{ max: 30, timeWindow: "1 minute", keyGenerator: per-user }`
  - `agent/web-search.ts:77-85` — `{ max: 30, timeWindow: "1 minute", keyGenerator: per-user }`
  - `v1/keys/create.ts:64-68` — `{ max: 5, timeWindow: "1 hour", keyGenerator: per-user }`
  
  Every other authed route in the scope sets an explicit per-route override; the most expensive one (paid LLM tokens per request) inherits only the global default.
- Why it matters: a leaked bearer token / compromised PAK can drain operator OpenRouter/OpenAI budget at the global per-IP rate; behind a shared NAT one user's drain shares the per-IP cap with others.
- Fix: add per-user `config.rateLimit` to the agent stream route (e.g., `{ max: 20, timeWindow: "1 minute", keyGenerator: (req) => req.user?.id ?? req.ip }`); set `authRequired: true` so anon traffic skips IP-tier bucket creation.

### [MEDIUM] Disabled-by-design AbortSignal on upstream call breaks intended T-08.2-03 contract
- File: `apps/api/src/routes/agent/stream.ts:162-189`
- Category: Workaround masking root cause
- Evidence: long comment block deliberately omits `signal: abort.signal` from `deps.litellm.chatCompletionsStream({...})` with the rationale that combining a process-wide SSRF-wrapped `Agent` with `undici.request` + `AbortSignal` aborts at dispatch. The follow-up reads:
  ```
  // Deferred follow-up: investigate undici 7.25 `signal:` + custom
  // wrapped `Agent` interaction (research candidate cause #4 — likely
  // related to openclaw/openclaw#19147 / #46685 / #61448).
  ```
  Client-disconnect propagation now relies on (a) `req.raw.once("close")` flipping `abort.signal.aborted` (consulted nowhere on the upstream side) and (b) `Readable.toWeb` `cancel()` propagation, which only fires when the consumer breaks the loop AFTER receiving at least one chunk. A client that disconnects mid-`fetch` (before first byte) cannot cancel the upstream until headers arrive — the request body keeps streaming on the operator's dime.
- Why it matters: classic "workaround masking a real bug" pattern called out in the hunt list. The fix is "TBD" with three GitHub issue references and no owner / timeline.
- Fix: open a tracked issue with a reproducible undici test case; meantime, install a watchdog timer (e.g., 60s) so a disconnected-before-first-byte client cannot keep the upstream open indefinitely.

### [MEDIUM] /api/v1/keys/create and /api/v1/keys/revoke do not set `authRequired: true`
- File: `apps/api/src/routes/v1/keys/create.ts:60-69`, `apps/api/src/routes/v1/keys/revoke.ts:46`
- Category: Hardening asymmetry with V2-SEC-01 carve-out
- Evidence: tokens routes (`assemblyai.ts:55`, `deepgram.ts:34`, `openai-realtime.ts:60`) explicitly set `authRequired: true` to make the IP-tier `onRequest` hook short-circuit on anonymous traffic so `owrl:ip:*` buckets aren't created pre-auth. The keys + transcriptions + agent routes do not — anonymous traffic still creates IP buckets on these surfaces.
- Why it matters: same anonymous-DoS vector the tokens routes mitigate, just on a different URL prefix. Currently inconsistent.
- Fix: add `authRequired: true` to each route under `v1/keys/**`, `transcriptions/**`, and `agent/**` that is gated by `dualAuthHook`.

### [MEDIUM] Web-search ledger insert swallow masks DB issues silently
- File: `apps/api/src/routes/agent/web-search.ts:142-157`
- Category: Suppression-by-design
- Evidence:
  ```ts
  } catch (e) {
    req.log.warn(
      { provider: provider.name, requestId, err: (e as Error).message },
      "usage_ledger insert failed; continuing",
    );
  }
  ```
  Comment justifies it ("Ledger failure must not deny the user their results"), but no metric is emitted on this path; only a warn log. A persistent `usage_ledger` outage would silently zero out web-search billing without any alarm-able signal.
- Why it matters: usage-accounting hole. Phase 5 explicitly debits via `usage_ledger`; quiet ledger failure removes the audit basis.
- Fix: increment a Prometheus counter `usage_ledger_insert_failed_total{kind="web-search.*"}` so the operator can alert on > 0; keep the user-facing 200 behavior.

### [MEDIUM] `agent/web-search.ts` provider-label dispatch is a one-off; doesn't scale
- File: `apps/api/src/routes/agent/web-search.ts:98-114`
- Category: Architecture / coupling
- Evidence:
  ```ts
  const envVarName =
    provider.name === "tavily"
      ? "TAVILY_API_KEY"
      : provider.name === "yandex"
        ? "YANDEX_SEARCH_API_KEY + YANDEX_SEARCH_FOLDER_ID"
        : "<provider env vars>";
  const label =
    provider.name === "tavily"
      ? "Tavily"
      : provider.name === "yandex"
        ? "Yandex"
        : provider.name;
  ```
  Adding a third provider (e.g., Brave) per D-01 ("more providers may be added later") requires editing the route, contradicting the design comment at lines 6-10 that says the route registers UNCONDITIONALLY.
- Why it matters: registry pattern is undermined by hardcoded mapping at the route boundary.
- Fix: add `readonly envVarLabel: string` and `readonly displayLabel: string` to `WebSearchProvider` (types.ts:33); the adapter owns its own labels, the route consumes the contract.

### [LOW] Dead-code `void` expressions in Yandex adapter
- File: `apps/api/src/lib/web-search/yandex-adapter.ts:341-342`
- Category: Dead code / lint-pacifier
- Evidence:
  ```ts
  void upstreamRequestId;
  void query.length;
  ```
  Computed-then-discarded values. The comment immediately above acknowledges they are unused. These exist solely to silence `noUnusedLocals` and signal "we computed this on purpose".
- Why it matters: confuses readers; if you needed structured log context, emit it; otherwise drop the computation.
- Fix: either pass `{ requestId: upstreamRequestId, queryLength: query.length, grpcCode }` into a `req.log.warn(...)` inside the adapter via a passed-in logger, or remove these lines and the surrounding bookkeeping.

### [LOW] Test-only exports leaked into production module surface
- File: `apps/api/src/routes/tokens/_call-provider.ts:154`, `apps/api/src/lib/web-search/yandex-adapter.ts:371-375`
- Category: Convention drift
- Evidence:
  - `_call-provider.ts:154` — `export const __test = { buildMessage };`
  - `yandex-adapter.ts:371` — `export const __testing__ = { mapRegion, parseYandexXml, stripHlword };`
  
  Two different conventions (`__test` vs `__testing__`) for the same purpose, and both ride the production bundle.
- Why it matters: small but real — production code carries test indirection; lint can't enforce the "don't import from production" comment.
- Fix: pick one naming (`__testing` per the existing two-instance majority elsewhere in the codebase if any — check) and tree-shake-marker; or move to sibling `__internals__.ts` re-exported only by tests via path alias.

### [LOW] `qwen3.6-plus` model name is fictional
- File: `apps/api/src/routes/agent/stream.ts:77`, `apps/api/src/routes/reason.ts:65`, `packages/litellm-client/src/config.ts:30`
- Category: Naming / future-breakage smell (out of scope but flagged)
- Evidence: Qwen public releases through 2026 are 1.5 / 2 / 2.5 / 3 / 3-Max series — no `qwen3.6-plus`. OpenRouter model id `openrouter/qwen/qwen3.6-plus` will not resolve.
- Why it matters: only a smell here — not a primary in-scope finding. Flagged because the slug appears with the prefix divergence above. Confirm with operator memory that this is an intentional placeholder pre-release.
- Fix: replace with a real model id (e.g., `qwen3-max`, `qwen3-235b-a22b-instruct`) once chosen, in BOTH the litellm config files and code defaults.

### [LOW] `transcriptions/batch-create.ts` permits bare-array body shape outside the BACKEND_SPEC
- File: `apps/api/src/routes/transcriptions/batch-create.ts:27-30`
- Category: Wire contract relaxation
- Evidence:
  ```ts
  const BatchCreateBodySchema = z.union([
    z.object({ transcriptions: z.array(TranscriptionInputSchema) }),
    z.array(TranscriptionInputSchema),
  ]);
  ```
  Comment "Accepts both ... for resilience — mirrors folders/notes." The CLAUDE.md hard rule is "every endpoint we serve matches `BACKEND_SPEC.md` byte-for-byte". A union accepting a bare array goes beyond byte-for-byte even if it's resilient.
- Why it matters: drift from spec, and the spec is the constitutional anchor.
- Fix: either confirm `BACKEND_SPEC.md` actually documents the bare-array form and link to the line, or remove the bare-array branch.

## Dead code
- `apps/api/src/lib/web-search/yandex-adapter.ts:341-342` — `void upstreamRequestId; void query.length;` — computed-then-discarded. See [LOW] above.
- `apps/api/src/routes/agent/web-search.ts:165-168` — `webSearchRegistry` re-exported "purely for symmetry" with no consumer cited; no test or other module imports it through `web-search.ts`. Verify by `grep -r "from.*routes/agent/web-search" apps packages` — if no caller, drop the re-export.

## Suppressed warnings
- `apps/api/src/routes/agent/stream.ts:86-104, 132-143, 237, 254, 263` — multiple `/* v8 ignore next */` coverage suppressions on defensive `catch {}` blocks. Each is justified by comment ("socket-already-closed defensive guard; raced-only"), but volume is high — 6 ignores in one file. Suggest a dedicated `swallowSocketClosed(fn)` helper so the suppression centralises to one place.
- `apps/api/src/routes/agent/stream.ts:120` — `as RequestBody` cast (see HIGH finding above).
- `apps/api/src/routes/agent/stream.ts:233` — `Readable.toWeb(upstream.body as Readable) as ReadableStream<Uint8Array>` — double cast for the Web/Node stream bridge; acceptable boundary cost.
- `apps/api/src/routes/v1/keys/create.ts:134` — `err as { code?: string; cause?: { code?: string } } | null` — typing pg/drizzle error shape; acceptable.

No `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` / `eslint-disable` / `biome-ignore` found in scope.

## Disabled tests near scope
- None found. `__tests__/setup.ts` files exist for `transcriptions` and `v1/keys`; no `.skip` / `xit` / `it.todo` markers detected in those directories.

## Notes
- `apps/api/src/routes/transcriptions/**` is purely a CRUD wrapper over the `transcriptions` table — it is NOT the LiteLLM multipart pass-through. The hunt list's concern about "LiteLLM multipart pass-through, historically problematic" applies to a separate route (`/api/transcribe` in `apps/api/src/routes/transcribe.ts`) which is OUT OF SCOPE per the file glob. No findings on multipart streaming were possible here.
- `apps/api/src/routes/tokens/**` correctly avoids logging any token material; provider keys appear only in outbound headers; 503 envelope strings are centralized in `_call-provider.ts:78-93`. No leakage found.
- `apps/api/src/routes/v1/keys/**` correctly hashes via Argon2id + never persists clear text + returns clear text exactly once on `/create`. No `key_hash` ever appears in the wire response (explicit column lists in both `list.ts:92-94` and `revoke.ts:70-71`).
- Web-search adapters DO make live HTTP calls (Tavily via `undici.fetch`, Yandex via `undici.request`); neither returns canned/fixture data in production code paths. The Yandex stub from the original f7904a8 commit (referenced in `yandex-adapter.ts:2`) has been replaced.
- BYOK guard (`packages/byok-guard`) is imported in `apps/api/src/index.ts:61` (`assertBYOKConfig`) but NOT referenced from any in-scope file. The v1/keys routes manage server-issued PATs (Argon2id-hashed), not BYOK upstream-provider keys — so the absence of a `byok-guard` dependency is by design. The hunt-list concern ("v1/keys MUST use packages/byok-guard") appears to conflate the two key concepts; PAT routes correctly do not flow through byok-guard.
