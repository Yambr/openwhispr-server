# Review: api-routes-transcriptions
Branch: main @ 13f0864
Files reviewed: 16 (11 routes + 5 supporting modules)

Scope:
- `apps/api/src/routes/transcriptions/*.ts` — 6 files
- `apps/api/src/routes/tokens/*.ts` — 4 files
- `apps/api/src/routes/v1/keys/*.ts` — 3 files
- `apps/api/src/routes/agent/*.ts` — 3 files
- supporting: `apps/api/src/lib/web-search/*.ts` (registry + tavily + yandex + types)

## Summary
- CRITICAL: 1 / HIGH: 6 / MEDIUM: 4 / LOW: 4

Top-3 pre-publication production risks on this surface:

1. **LOCKER-04 schema-missing on 11 of 12 routes (HIGH).** Only `agent/stream.ts` declares the mandatory `schema:` field. The other eleven (`transcriptions/*` × 5, `tokens/*` × 3, `v1/keys/*` × 3, `agent/web-search.ts`) are allowlisted as `LOCKER-04-route-bulkfix-31-08` debt deferred to Phase 41. Until Phase 41 closes, every one of these routes parses the body manually with `Schema.parse(req.body)` — a single regression (missing parse() call on a future edit, or a thrown-then-swallowed ZodError) ships unvalidated input to the DB / upstream. This is the highest-leverage pre-publication invariant on this surface and the principal reason LOCKER-04 was designed.
2. **`transcriptions/list.ts` swallows `parseListQuery` errors and leaks raw `err.message` to the wire (HIGH).** Lines 49–53 bypass the centralized error handler and `reply.code(400).send({error: err.message})` directly — any future ParseError that interpolates an offending value (e.g. an over-long cursor token) would leak the raw user input or, worse, internal parser state through the canonical envelope contract. Inconsistent with every other route in the scope.
3. **`openai-realtime.ts` accepts `req.body` as `RequestBody` via plain type-assertion, with no zod validation (CRITICAL).** Line 79: `const body = (req.body ?? {}) as RequestBody`. `streams` is gated by an explicit `!== 1 && !== 2` allowlist, BUT `model` flows straight into `JSON.stringify({ session: { type: "realtime", model } })` outbound to `api.openai.com`. There is no length cap, type narrowing, or character-class restriction. A 50 MB string in `model` is currently a valid request that will be POSTed upstream within the 5s window before timing out — a free amplification primitive against any authed user's bucket. This is the only place in the scope where untrusted user input reaches an outbound JSON body without zod gating.

## Findings

### [CRITICAL] CR-1: openai-realtime.ts — `req.body` cast to `RequestBody` with no zod validation; `model` field unbounded
**File:** `apps/api/src/routes/tokens/openai-realtime.ts:79`
**Issue:** `const body = (req.body ?? {}) as RequestBody;` — a type assertion, not validation. Only `streams` is allowlisted ({1,2}). `body.model` is `string | undefined` per the interface, but undici accepts any value `JSON.stringify` can serialize. Adversary supplies `{"streams":1,"model":"<50MB string>"}` and we POST that upstream to OpenAI. No CPU/RAM bounds, no character-class restriction. The `as RequestBody` cast also violates LOCKER-02-style hygiene in spirit (type lies about reality without runtime backing). The route also has no `schema:` field (LOCKER-04 — see HI-1).
**Fix:** Add `OpenAIRealtimeRequestSchema` to `@openwhispr/wire-schemas` and `.parse(req.body ?? {})` before the streams check:
```ts
const Schema = z.object({
  streams: z.union([z.literal(1), z.literal(2)]).optional(),
  model: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._/-]+$/).optional(),
}).strict();
const body = Schema.parse(req.body ?? {});
```

### [HIGH] HI-1: LOCKER-04 — `schema:` missing on 11 of 12 routes in scope
**Files:**
- `apps/api/src/routes/transcriptions/batch-create.ts:38`
- `apps/api/src/routes/transcriptions/batch-delete.ts:35`
- `apps/api/src/routes/transcriptions/create.ts:25`
- `apps/api/src/routes/transcriptions/delete.ts:29`
- `apps/api/src/routes/transcriptions/list.ts:35`
- `apps/api/src/routes/tokens/assemblyai.ts:45`
- `apps/api/src/routes/tokens/deepgram.ts:26`
- `apps/api/src/routes/tokens/openai-realtime.ts:52`
- `apps/api/src/routes/v1/keys/create.ts:57`
- `apps/api/src/routes/v1/keys/list.ts:76`
- `apps/api/src/routes/v1/keys/revoke.ts:43`
- `apps/api/src/routes/agent/web-search.ts:74`

**Issue:** All 12 are allowlisted in `tools/lint-prod-readiness.allowlist.txt` as `issue-31-04-debt-LOCKER-04-route-bulkfix-31-08`. CLAUDE.md DISCIPLINE Rule 14 explicitly enforces declarative `schema: { body|querystring|params: <ZodSchema> }` on every route, with the BLOCKING flip deferred to Phase 41. Pre-publication on GitHub means an outside contributor will read these files and see twelve route registrations without schemas — a structural invariant we want enforced before the world sees the repo.
**Fix:** Add `schema: { body: <ExistingZodSchema> }` to each route. Most already construct the schema and call `.parse()` inside the handler — wire it into the declarative slot. For `revoke.ts` use `params: ParamsSchema`. For `list.ts` use `querystring: ListQuerySchema`. Closes Phase 41 backlog and lets `tools/lint-prod-readiness.ts` flip from `--warn-only` to BLOCKING.

### [HIGH] HI-2: transcriptions/list.ts — raw `err.message` leaked to wire bypasses central error handler
**File:** `apps/api/src/routes/transcriptions/list.ts:47-53`
**Issue:**
```ts
try { parsed = parseListQuery(...); }
catch (err) {
  return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid query" });
}
```
Every other route in scope throws `ValidationError(code, message)` and lets the centralized `setErrorHandler` emit the canonical envelope. This route emits a bare `{error: <raw_parseListQuery_message>}` — wire shape drift (BACKEND_SPEC requires the canonical envelope with `code`), and if `parseListQuery` ever interpolates the offending user-supplied cursor value into its error string the value is reflected to the wire verbatim.
**Fix:** Replace with `throw new ValidationError("INVALID_QUERY", "invalid query")` and log `err` separately via `req.log.warn`. Pattern matches `revoke.ts:55-58`.

### [HIGH] HI-3: agent/stream.ts — AbortSignal intentionally NOT forwarded to upstream LiteLLM call
**File:** `apps/api/src/routes/agent/stream.ts:200-227`
**Issue:** The 30-line comment block at L200–227 explains that `signal: abort.signal` was REMOVED from the `chatCompletionsStream` call because the wrapped SSRF dispatcher + AbortSignal combination caused `upstream_error` finish chunks. The workaround is documented but the live behavior is: when the client disconnects mid-stream, the upstream undici request continues running until the LiteLLM proxy itself finishes — until then, the agent stream still burns LLM tokens charged against `userId`. The `Readable.toWeb(...).cancel()` path only destroys the consumer side; it does NOT actually abort the in-flight request to LiteLLM in undici 7.25 with a wrapped Agent (per the documented forensic finding). For paid LLM with per-stream costs ≥ $0.10 this is a directly billable T-04-DISCONNECT mitigation regression and a known abuse vector (open stream → disconnect → repeat).
**Fix:** Track the work-around as a hard P0 follow-up. Two options: (a) move the SSRF wrapper inside an `undici.Pool` per-call instead of process-wide global dispatcher, then re-enable `signal:`; or (b) wire a dispatcher.destroy() call into the `req.raw.once('close')` handler so the underlying socket is forcibly killed regardless of signal propagation. Until then, document the actual abuse-vector impact in `docs/security.md` and add a per-user `stream_tokens_per_minute` budget on top of the 20/min request budget.

### [HIGH] HI-4: agent/stream.ts — DEFAULT_AGENT_MODEL resolved at module-load time, not per-request
**File:** `apps/api/src/routes/agent/stream.ts:80,84`
**Issue:** `const DEFAULT_AGENT_MODEL = getDefaultAgentModel();` evaluates at module import time. Operators editing `compose/litellm/litellm_config.yaml` after the API process started will not see the new default — the route silently uses the stale value until full process restart. The route's `resolveModel()` correctly checks `process.env.DEFAULT_AGENT_MODEL` first (env can be reloaded via SIGHUP-like patterns later), but the bottom-of-chain fallback is captured at import. This is the exact failure mode the HI-01 comment (lines 74–80) warned about, just relocated up the stack from "literal string drift" to "yaml-read drift".
**Fix:** Move `getDefaultAgentModel()` into `resolveModel()` (or cache it with a `Symbol.dispose`-style invalidation hook). Yaml-loader contract should advertise whether the read is hot-reloadable or boot-frozen.

### [HIGH] HI-5: web-search.ts — usage_ledger insert failure swallowed silently after upstream success
**File:** `apps/api/src/routes/agent/web-search.ts:150-157`
**Issue:** Ledger insert wrapped in `try { ... } catch (e) { req.log.warn(...); }` — failure is logged but the request returns 200 with the search results. The comment at L151–152 rationalizes "search is already paid for upstream", but the consequence is: a partial-outage where Postgres is briefly unavailable produces successful HTTP 200s with NO billing record, and there is no retry queue / dead-letter for the missed ledger row. For a 1000-concurrent-user installation this is a direct revenue-attribution bug surface and a compliance gap (audit trail incompleteness). The async insert is also outside the original `withTenant` block — a second DB roundtrip for what should be one transaction.
**Fix:** Either (a) fail the request 503 on ledger write failure (preferred — preserves accounting invariant), or (b) enqueue the missed ledger row to BullMQ for retry with idempotency on `request_id`. Document the chosen semantics in BACKEND_SPEC.md. Do NOT silently 200.

### [HIGH] HI-6: tokens routes — `Number(process.env.X_TTL)` produces NaN on malformed env, interpolated into URL/body
**Files:**
- `apps/api/src/routes/tokens/assemblyai.ts:79,81` (`expires_in_seconds=${ttl}` in URL)
- `apps/api/src/routes/tokens/deepgram.ts:49,60` (`ttl_seconds: ttl` in JSON body)

**Issue:** `Number(process.env.ASSEMBLYAI_TOKEN_TTL ?? DEFAULT_TTL_SECONDS)` — if the operator sets `ASSEMBLYAI_TOKEN_TTL=abc`, this becomes `NaN`. AssemblyAI URL becomes `?expires_in_seconds=NaN` → upstream 4xx → mapped to 503 "not configured" misleading the operator. Deepgram body `{"ttl_seconds":NaN}` → JSON.stringify produces `"ttl_seconds":null` (not technically NaN, but still wrong). No env validation at boot.
**Fix:** Validate at process boot via a `config/env.ts` zod gate: `z.coerce.number().int().positive().max(3600)`. Either reject startup or fall back to the documented default with a `req.log.warn`.

### [MEDIUM] MD-1: transcriptions/* word_count counter is locale-naive
**Files:** `apps/api/src/routes/transcriptions/create.ts:38`, `batch-create.ts:64`
**Issue:** `text.trim().split(/\s+/).length` is a poor word-counter for CJK languages (which have no whitespace separators) and produces `1` for any non-empty text in Chinese/Japanese/Korean. Given `language` is part of the schema and translations into CJK languages are plausible, the `word_count` field on the wire is misleading. Not a bug per se, but consumed by usage analytics.
**Fix:** Either accept a client-supplied `word_count` (preferred — the desktop has the canonical count), or branch on `language` and use a grapheme-cluster count for CJK. Document the chosen semantics.

### [MEDIUM] MD-2: agent/stream.ts — finish chunk synthesized with `usage:{promptTokens:0, completionTokens:0}` after upstream_error
**File:** `apps/api/src/routes/agent/stream.ts:88-108,285-296`
**Issue:** On upstream error / stream error, the synthetic finish chunk reports zero token usage. This contradicts the BACKEND_SPEC contract — desktop UI computes per-stream cost from these fields, and zero-cost finish chunks would mask error-induced token charges that actually accrued at the LiteLLM proxy hop. Phase 12 (BYOK + usage) will get fooled.
**Fix:** Either omit `usage` from error-finish chunks (BACKEND_SPEC should make it optional in error cases) or capture partial usage from accumulator state at the error point.

### [MEDIUM] MD-3: yandex-adapter.ts — error envelope unconditionally drops requestId after extraction
**File:** `apps/api/src/lib/web-search/yandex-adapter.ts:336,341-342`
**Issue:**
```ts
const upstreamRequestId = err.details?.[0]?.requestId ?? requestId;
void upstreamRequestId;
void query.length;
```
The `void` discards make these statements dead code — extracted, then thrown away. The comment at L337–340 says "actual log emission happens in the route handler", but the route handler (`agent/web-search.ts:124-127`) only logs `{ provider, message }`, not the requestId. For operator triage of Yandex 503s, the requestId is the only correlation point.
**Fix:** Attach the requestId to the typed `UpstreamError` (`new UpstreamError("Yandex upstream returned 5xx", { cause: { requestId } })`) and propagate it through the route's `req.log.warn` payload.

### [MEDIUM] MD-4: v1/keys/create.ts — Argon2id hash result not propagated through audit payload
**File:** `apps/api/src/routes/v1/keys/create.ts:123-125`
**Issue:** Audit payload contains only `key_id`. D-A7 forbids raw key material in audit, which is correct, but the audit row carries no provable linkage between the `key.issued` event and the eventual `key.revoked` event other than `key_id` — fine for normal operation, but on revoke the `auditCtxFromRequest` snapshot can drift (different `userAgent`, `ip`) and the audit log loses the issuance-context correlation. Not exploitable, just lower forensic value than it could carry.
**Fix:** Add `key_prefix` to both `key.issued` and `key.revoked` audit payloads (it's non-secret, already exposed via /list). Lets a SIEM grep for `key_prefix=pak_xxxx` across issuance + revoke without needing to JOIN on `key_id`.

### [LOW] LO-1: agent/stream.ts:145 — single-arg `AuthError("unauthorized")` inconsistent with two-arg convention
**File:** `apps/api/src/routes/agent/stream.ts:145`
**Issue:** Single-arg form resolves to `code=AUTH_ERROR, message="unauthorized"`. Every other route in scope uses `new AuthError("UNAUTHORIZED", "unauthorized")` to set an explicit code distinguishable from the default. Inconsistent envelopes between routes — a downstream consumer filtering on `error.code === "UNAUTHORIZED"` will miss the agent stream's 401.
**Fix:** `throw new AuthError("UNAUTHORIZED", "unauthorized");`

### [LOW] LO-2: web-search.ts — `WebSearchResponseSchema` from `@openwhispr/wire-schemas` not re-validated on adapter output
**File:** `apps/api/src/routes/agent/web-search.ts:118,159`
**Issue:** The route trusts the adapter to return the `{results: [{title,url,snippet}]}` shape and `reply.send(result)` without zod re-validation. If a future adapter regression returns `snippet: undefined` (Tavily falls back to `""` today, but the contract isn't enforced), the desktop client receives `snippet: undefined` which serializes as missing field — wire contract drift.
**Fix:** `return reply.code(200).send(WebSearchResponseSchema.parse(result));` — costs ~50µs per call, eliminates an entire class of adapter-output-drift regression.

### [LOW] LO-3: transcriptions/shape.ts — `numOrNull(audio_duration_ms)` accepts `Number(string)` non-finite drift
**File:** `apps/api/src/routes/transcriptions/shape.ts:47-51`
**Issue:** `Number("abc")` → `NaN` → `Number.isFinite(NaN)` → false → returns null. Correct behavior, but the row shape allows `string` for `audio_duration_ms` which only happens if the underlying DB type is bigint serialized as string. If that's intentional, the type cast `Number(bigint_string)` silently loses precision past `2**53`. For audio durations this is unreachable, but the type tolerance is a latent precision bug.
**Fix:** Use `BigInt(v)` then `Number(BigInt)` with explicit bounds check, or document that `audio_duration_ms` is bounded to `Number.MAX_SAFE_INTEGER`.

### [LOW] LO-4: tokens/_call-provider.ts — `ensureProviderDispatcher()` module-state `dispatcherInstalled` is process-wide single-use
**File:** `apps/api/src/routes/tokens/_call-provider.ts:44-56`
**Issue:** If a test framework calls `setGlobalDispatcher(realAgent)` between two test files (Vitest workers), the first call to `ensureProviderDispatcher()` sets `dispatcherInstalled=true` and subsequent calls no-op even after a MockAgent is installed/removed across boundaries. The constructor-name heuristic (`"Agent"` vs `"MockAgent"`) handles the install-time race but not the teardown-time race. Mostly a test-stability concern; production calls the function once and is fine.
**Fix:** Replace the boolean with a WeakRef to the previously-installed dispatcher; re-install if the current global is no longer ours. Or: ditch the global-dispatcher pattern entirely and pass `dispatcher: <Agent>` per-call to `fetch()`.

## Dead code
- `apps/api/src/lib/web-search/yandex-adapter.ts:371` — `__testing__` re-export. Allowlisted (`issue-31-04-debt-LOCKER-04-dead-export-phase-38`). Test-only surface; legitimately scheduled for cleanup in Phase 38.
- `apps/api/src/routes/agent/translate-tools.ts:29` — `OpenAITool` interface only used internally in this file's return type. Allowlisted (Phase 38).
- `apps/api/src/routes/agent/web-search.ts:168` — `export { resolveWebSearchProvider, webSearchRegistry }` re-export "for symmetry with other modules' boot patterns" but boot path doesn't actually call them through this file. Allowlisted (Phase 38).
- `apps/api/src/routes/tokens/_call-provider.ts:58,69,154` — `CallProviderOptions`, `CallProviderResult`, `__test`. All allowlisted (Phase 38). `__test.buildMessage` is "Exported for branch-coverage tests if needed" with no current test importer — true dead code, not actually needed for branch coverage today (handler branches achieve it).
- `apps/api/src/routes/agent/stream.ts:88-108` — `endWithFinish` helper called only once (L247). Inlining would reduce the surface but the function is named documentation; keep.

## Suppressed warnings
None in production code. The two `as unknown as` casts found are in test setup files (`transcriptions/__tests__/setup.ts:111`, `v1/keys/__tests__/setup.ts:142`) — out of review scope but worth noting: tests cast `db` to `Parameters<typeof buildXRoutes>[0]["db"]` to bypass a structural type mismatch. Acceptable in test seam per CLAUDE.md "mocks allowed only at process/network boundaries" — these casts are seams between the testcontainer-Postgres handle and the `TransactionalDb<ExecutableTx>` interface, not internal logic.

No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `biome-ignore`, or in-production `as any` found in the 16 reviewed files.

## Notes

**Strengths observed (not findings, but worth recording before publication):**
- All routes correctly defensive-check `req.user` + `req.tenant` even though `dualAuthHook` is global — proper defense-in-depth.
- `v1/keys/create.ts` correctly hashes via Argon2id with the comment explaining the `m=64MiB/t=3/p=1` choice + NAPI threadpool dispatch (Pitfall #5). Clear-text PAK never reaches `key_hash` storage; audit payload correctly carries only `key_id`.
- `transcriptions/batch-delete.ts` and `keys/list.ts` correctly use `sql.join(...)` for array-typed params instead of relying on drizzle's varargs expansion — the comment explaining why (L60–62 of batch-delete.ts) is exactly the kind of in-line forensic note we want in a public repo.
- `tokens/openai-realtime.ts` D-17 fail-fast on partial-success (T-04-01 mitigation, L102–116) is the correct call vs `Promise.allSettled` — the rationale is documented in the code.
- `agent/stream.ts` correctly throws AuthError **before** `reply.hijack()` so the centralized handler still emits the canonical 401 envelope (T-04-AUTH).
- LiteLLM client (out of review scope but verified) — `LitellmUpstreamError.bodyText` truncated to 200 chars at construction per Phase 37 / CRIT-FIX-09; correct LOCKER-05 defense-in-depth.
- All three web-search adapters (Tavily, Yandex) correctly **hardcode the upstream URL** — user input flows only into the JSON body's `query` field. T-05-01 (SSRF) is not exploitable from this surface.
- Tavily/Yandex API keys read from env only inside the Authorization header; error messages never echo the upstream body. T-05-09 (key leakage via error message) correctly mitigated.

**BYOK angle:** the reviewed surface does NOT touch BYOK encryption directly — `apps/api/src/routes/v1/keys/*` mints **PAKs (personal API keys for our own service)**, not BYOK provider keys. PAK material is hashed-only (Argon2id) and never plaintext-stored; encryption-at-rest via `packages/data/src/encryption/envelope.ts` applies to a different table (`oauth_accounts.access_token` etc, out of scope). LOCKER-08 plaintext-secret-column lint passes for `api_keys` table because only `key_hash` exists (no `key`/`token`/`password` column).

**Multipart pass-through note:** the high-risk multipart-to-LiteLLM transcribe route is NOT under `routes/transcriptions/**` — that directory only holds the CRUD storage endpoints. The actual `/api/transcribe` multipart handler lives in `apps/api/src/routes/transcribe.ts` (out of declared scope). If the user's intent was to also review the multipart pass-through, that file should be re-scoped explicitly — none of the CRUD endpoints here touch raw audio bytes or buffer multipart frames.

**Pre-publication blocker triage:** of the seven Critical+High findings, **CR-1 (openai-realtime body validation)** is the only one that should hard-block the GitHub publication. HI-1 (LOCKER-04 schema-missing) is allowlisted technical debt with a tracking issue; it's embarrassing-but-not-exploitable. HI-2/HI-3/HI-4/HI-5/HI-6 are correctness/billing-integrity defects that can ship behind an open GitHub issue. Recommend: fix CR-1 + HI-2 (the cheapest two), file tracked issues for the rest, then publish.
