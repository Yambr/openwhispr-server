---
slug: 260528-0cm-agent-stream-error-contract
created: 2026-05-28
status: discuss-phase complete
audit: .planning/debug/agent-stream-upstream-error-2026-05-28.md
peer-trigger: 9zn786o0
severity: HIGH
---

# CONTEXT — `/api/agent/stream` error wire contract

## Scope summary

Close HIGH bug from peer 9zn786o0. Replace bare terminal `{type:"done", finishReason:"upstream_error", usage:{0,0}}` (route `apps/api/src/routes/agent/stream.ts:272-284` AND mid-stream drain L319-L337) with a richer `{type:"error", error, code, provider}` chunk that the desktop / web renderer can bind to an error UI. Introduce taxonomy helper `apps/api/src/lib/agent-upstream-error-classify.ts`. Flip log level `warn → error` with structured event `agent.stream.upstream_failure`.

In scope of this discussion: lock the 4 gray areas below so the planner can write phase plan + RED tests without re-deciding.

Out of scope:
- Provisioning fix (adding `openai/gpt-oss-120b` alias to `compose/litellm/litellm_config.yaml`) — product/operator decision, separate ticket.
- Client renderer changes (the desktop / web client is the contract source-of-truth; we conform to it, not vice-versa).
- Reason-cleanup / realtime stream parity — separate routes, separate phases.
- `/api/transcribe` non-stream envelope (already uses canonical 502 + `error.code:"upstream_error"`).

---

## D1 — Mid-stream error vs preflight error semantics

| Option | Pros | Cons | Complexity | Recommendation |
|---|---|---|---|---|
| (a) Same shape both cases: `type:"error"` REPLACES final `done` regardless of preceding content | Single client code path; minimal renderer change; matches peer's "do not emit done after error" spec verbatim; renderer bubble flips from partial-content → error state cleanly | Client loses the `finishReason` discriminant in the mid-stream case; partial content already rendered may look orphaned without explicit flip | 2 files (stream.ts catch + drain), 1 helper. Risk: low — single terminal frame per stream, matches existing `endWithFinish` invariant of "one terminal write per response" | **LOCK** |
| (b) Different shapes per failure mode (preflight = error-terminal, mid-stream = `done` with `finishReason:"upstream_error"` + preserved partial content) | Preserves partial content semantics on mid-stream; backward compatible with existing `finishReason:"upstream_error"` consumers | Two wire shapes for the same logical event; renderer must branch on "has content been emitted" state to interpret; defeats the entire bug-fix point (empty-bubble still possible if preflight code path leaks into mid-stream) | 2 files + state tracking ("did we emit content yet?"). Risk: medium — race between content-write and error-throw means flag may be stale | Reject |
| (c) Mid-stream emits `error` THEN `done` (explicit double-terminator) | Maximally informative — renderer gets both an error signal AND a clean stream-end marker | Violates peer wire contract ("not emit done after error"); requires renderer change to tolerate post-error frames; ambiguous parse on a strict NDJSON consumer that breaks on first terminal | 2 files. Risk: medium-high — wire-contract regression; client may treat post-error `done` as a second message | Reject |

**Locked pick: (a) — Same shape both cases. `type:"error"` is the SOLE terminal frame for any upstream failure regardless of whether content was already streamed.**

**Rationale:** Peer's contract is explicit (`type:"error"` is terminal; no `done` after). The R32 lookup (`.planning/quick/20260522-r32-agent-stream-chunk-vocab/SUMMARY.md`) already established that `ReasoningService.processTextStreamingCloud` filters strictly on `type` value — the renderer was rebuilt around exactly that filter. A mid-stream error landing as `type:"error"` will flip the assistant bubble to error UI; any partial content already rendered will be visually replaced or annotated by the renderer's existing error-takeover path. Option (b) re-introduces the exact bug class we're closing (a `done` chunk that the renderer can't bind to error UI). Option (c) breaks the wire contract on its face.

**Planner implication:** The new helper produces ONE `{type:"error", ...}` chunk. The catch block at L272-L284 emits it and ends the response. The drain-error catch at L319-L337 emits the SAME shape — DOES NOT also emit `done`. Test cases must assert "exactly one terminal frame, type === 'error'" for both preflight and mid-stream failure modes (audit §7.4 already calls this out).

---

## D2 — `provider` field inference

| Option | Pros | Cons | Complexity | Recommendation |
|---|---|---|---|---|
| (a) `provider = "litellm"` always (immediate upstream) | Trivially correct (server's POV); no extra parsing; no fragile header dependency; works identically for bundled-default AND corporate `LITELLM_BASE_URL` override | Loses the "actual provider behind LiteLLM" debugging signal; operator must cross-correlate via `litellm_call_id` in logs | 1 helper. Risk: trivial | **LOCK** |
| (b) Parse `metadata.llm_provider` from LiteLLM error body | Maximally informative; surfaces the real provider (groq/openai/openrouter) to the client | Requires JSON.parse on `bodyText` (already redacted+truncated to 200 chars — may be malformed or truncated mid-key); LiteLLM body shape is not guaranteed stable across versions; corporate-LiteLLM operators may strip this field; couples server tightly to upstream JSON layout | 1 helper + JSON parse + defensive fallback. Risk: medium — fragile to LiteLLM body shape drift; LOCKER-05 truncation may cut the field | Reject |
| (c) Resolve from request `model` slug prefix (`groq/...` → `"groq"`, `openai/...` → `"openai"`) | Pure function on a value the server controls; deterministic | Many aliases don't carry a prefix (`qwen3.6-plus`, `openwhispr-default`); the model slug a client sends is opaque metadata, not a contract about which provider serves it; the alias-to-provider map lives in `litellm_config.yaml` (corporate operators override) — server-side lookup would be wrong half the time | 1 helper + alias table import. Risk: medium — duplicates LiteLLM's routing logic in the server; drifts the moment operator edits yaml | Reject |
| (d) Two-level: `{provider: "litellm", upstream_provider: "openai"}` | Best of both — debug info + stable top-level field | Widens the wire contract more than necessary; client renderer would have to learn two fields; corporate operators may not want to leak `upstream_provider` to end users at all | 1 helper + wire schema extension. Risk: medium — schema churn for marginal UX gain | Reject |

**Locked pick: (a) — `provider: "litellm"` always.**

**Rationale:** The server's immediate upstream IS LiteLLM Proxy, full stop — bundled-default or corporate-override, same answer. The actual provider behind LiteLLM (groq/openai/openrouter/anthropic) is debugging metadata, not user-facing UI signal — operators correlate via `litellm_call_id` (already captured to logs at `stream.ts:294-300`) + the new `event:"agent.stream.upstream_failure"` log binding. The client renderer needs `provider` purely to compose a user-facing message like "openwhispr cloud service is unavailable" — it does NOT need (and should not surface) "groq is rate-limited". Option (a) also future-proofs: when corporate-operator swaps in vLLM / Bedrock / internal gateway, the wire stays `"litellm"` and corporate-internal correlation stays in their own observability stack.

**Planner implication:** `AgentUpstreamProvider` type narrows to literal `"litellm"` in the wire envelope. The taxonomy helper's `provider` field is hardcoded to `"litellm"` for any `LitellmUpstreamError`; for connect/timeout errors it can be `"unknown"` (we don't know which hop failed). Audit §5.2's broader union `"groq" | "openai" | "openrouter" | "anthropic" | "litellm" | "unknown"` shrinks to `"litellm" | "unknown"`. Tests assert exactly these two values.

---

## D3 — `error` field — raw upstream message vs operator-friendly canonical?

| Option | Pros | Cons | Complexity | Recommendation |
|---|---|---|---|---|
| (a) Pass through `bodyText` verbatim (already redacted at construction by LOCKER-05) | Maximum debugging info reaches the client log/inspector; trivial implementation | Renderer treats it as user-facing UI text — surfaces raw LiteLLM strings like "Invalid model name passed in model=..." or vendor-specific error JSON to non-technical users; not i18n-able; LOCKER-05 redacts secret SHAPES but not vendor URLs, internal stack hints, or model-name leaks | 1 helper. Risk: medium — UX regression (technical strings in chat UI); auditability concern (raw vendor text in user chat history if persisted) | Reject |
| (b) Canonical user-facing message per code class (i18n-friendly English; ru via existing i18next pipeline later) | Stable, predictable client UX; safe to ship to non-technical users; i18n-ready; no vendor leakage in user-visible surface | Operator debugging requires reading logs (already do); slight code duplication if codes proliferate | 1 helper with ~6 message templates. Risk: low — pure function, easy to test | **LOCK** |
| (c) Both fields: `{error: "<canonical>", upstream_message: "<bodyText>"}` for client-side decision | Renderer shows canonical, devtools shows raw — best of both | Widens wire contract; client renderer must pick which field to render (ambiguity); persisting chat history may serialize the raw upstream text into user-visible records on a renderer bug; corporate-operator surface area larger | 1 helper + wire schema widening. Risk: medium — schema churn; risk of leaking `upstream_message` if renderer regresses | Reject |

**Locked pick: (b) — Canonical English user-facing message per code class.**

**Rationale:** The client renderer renders `error` field as UI text directly (per peer's contract — error TOAST/bubble bound to the chunk). Raw LiteLLM body text is operator-domain language ("Invalid model name passed in model=...") that confuses end users and leaks server-internal naming. Audit §5.2 already drafts safe canonical messages per code — that's the right shape. Operators get the raw redacted body via the structured log (`upstream_body_truncated` field on the `agent.stream.upstream_failure` event), where it belongs. This keeps LOCKER-05 redaction defense intact AND adds a second layer (canonical messages can never contain credential shapes by construction).

**Planner implication:** Helper exposes `userFacingMessage` per code (English literals at the helper site — i18n keying deferred to a follow-up i18n phase). Log binding carries `upstream_body_truncated` for operator debugging. Tests must assert: (a) `chunk.error` matches the canonical message for the code, (b) `chunk.error` contains NO secret-shape substring (regex from `redactSecretShapes`), (c) the raw `bodyText` from `LitellmUpstreamError` appears ONLY in `req.log.error` binding, never in the wire chunk JSON. The 6 canonical message templates: `upstream_auth`, `upstream_rate_limit`, `upstream_quota_exceeded`, `upstream_invalid_model`, `upstream_timeout`, `upstream_unknown` — exactly the taxonomy from audit §5.2.

---

## D4 — Backward compatibility on `done.finishReason:"upstream_error"`

| Option | Pros | Cons | Complexity | Recommendation |
|---|---|---|---|---|
| (a) Remove `upstream_error` as a `finishReason` value entirely; the new `type:"error"` chunk fully replaces it | Clean union; no stale dead path; eliminates the empty-bubble bug at the type level (no way to emit it) | Breaks any fixture / log alert / dashboard that greps for `finishReason:"upstream_error"` | 1 type change + helper. Repo grep shows: 2 test files reference the literal (`stream.test.ts` Test 9, Test 18 — both will be REWRITTEN to assert the new error chunk shape per audit §7.1/§7.2); 1 load-test flow comment (`tools/load-test/src/flows/agent-stream.ts:45` — comment-only, not a code path); 1 CJM step test uses it as a 502 envelope `error.code` value (separate non-stream surface — unaffected); 1 dist artifact (regenerated on build). NO production-code consumers, NO log alerts, NO dashboards reference it. Risk: low — all consumers are tests being rewritten in this same phase | **LOCK** |
| (b) Keep `finishReason:"upstream_error"` as documented alias; emit BOTH `type:"error"` AND `done` chunks | Backward compatible with any unknown external consumer | Defeats D1's "single terminal frame" lock; reintroduces the ambiguity peer's contract is closing | 2 files + test rewrite. Risk: medium — wire-contract internal inconsistency | Reject |
| (c) Deprecate with warning over a release cycle | Standard deprecation hygiene | No external consumers identified (grep evidence above) → deprecation cycle is procedure-theatre with zero risk reduction; delays the user-visible fix by a release; this is a HIGH bug, not a wire-evolution decision | 2 files + version-gated emission logic. Risk: low procedurally but high product-cost (HIGH bug stays unfixed for a release) | Reject |

**Locked pick: (a) — Remove `upstream_error` as a valid `finishReason` value entirely.**

**Rationale:** Repo-wide grep confirms zero production-code consumers: the 2 test references (`stream.test.ts` Test 9 + Test 18) are EXACTLY the tests being rewritten as part of this phase's TDD RED→GREEN (audit §7.2 explicitly calls out renaming + reshaping them). The load-test flow reference is a 2026-05 forensic comment, not active code. The CJM-step test uses `"upstream_error"` as a non-stream HTTP envelope `error.code` value (`502` body) — orthogonal to NDJSON `finishReason`, unaffected. No Loki/Grafana alert rules in `compose/grafana/` or `charts/openwhispr/templates/grafana/` reference the literal. No customer-facing docs reference it. Deprecation cycles are for wire fields with external consumers; this has none.

**Planner implication:** The `StreamChunk` discriminated union (`apps/api/src/lib/sse-parser.ts:28-35`) gets the new `error` variant ADDED. The `done.finishReason` value space is implicitly narrowed (we just stop emitting `"upstream_error"` from the route + `"stream_error"` from the drain path — both replaced by `type:"error"`). The `finishReason: string` TypeScript type stays open (`stop|length|tool_calls|content_filter|incomplete` continue to flow through from upstream as bare strings), so no type-narrowing migration. The `endWithFinish(raw, "upstream_error")` call at L282 is DELETED; the drain-error `finishReason:"stream_error"` synthetic chunk at L325-L330 is DELETED. Test cases `stream.test.ts` Test 9 and Test 18 are REWRITTEN to assert `type:"error"` (not renamed; same test slot, new assertion shape) — audit §7.2's `agent-stream-error-then-end.test.ts` is the canonical RED for these.

---

## Cross-cutting implications for the planner

1. **New file:** `apps/api/src/lib/agent-upstream-error-classify.ts` — pure helper, no deps beyond `@openwhispr/litellm-client`'s `LitellmUpstreamError` + `redactSecretShapes`. Exports `classifyAgentUpstreamError`, `AgentUpstreamErrorCode`, `AgentUpstreamProvider` (narrowed to `"litellm" | "unknown"` per D2), `AgentUpstreamErrorEnvelope`.
2. **Modified file:** `apps/api/src/lib/sse-parser.ts` — widen `StreamChunk` with `{type:"error", error: string, code: AgentUpstreamErrorCode, provider: AgentUpstreamProvider}` variant.
3. **Modified file:** `apps/api/src/routes/agent/stream.ts` — rewrite catch L272-L284 (preflight) AND drain catch L319-L337 (mid-stream) to emit the new chunk shape; flip `req.log.warn` → `req.log.error` with structured event binding; hoist `resolveModel(...)` into a const above the try so it's available in the log binding.
4. **Modified file:** `apps/api/tests/unit/routes/agent/stream.test.ts` — rewrite Test 9 + Test 17 + Test 18 to assert new `type:"error"` shape per audit §7.1-§7.3.
5. **New file:** `apps/api/tests/unit/routes/agent/__tests__/agent-stream-upstream-error-envelope.test.ts` — full taxonomy coverage per audit §7.1 (11 cases).
6. **New file:** `apps/api/tests/unit/routes/agent/__tests__/agent-stream-mid-stream-error.test.ts` — drain-path parity per audit §7.4.
7. **New file:** `tests/e2e/agent/stream-error-rendering.spec.ts` — Playwright through real `docker compose` per audit §7.5 (DISCIPLINE rule: E2E mandatory).
8. **Coverage floor:** Per DISCIPLINE rule 2, new helper ≥ 90% on lines/branches/functions/statements; modified `stream.ts` catch paths 100%.
9. **LOCKER posture preserved:** All `bodyText` access in helper goes through `redactSecretShapes(...).slice(0, 500)` (LOCKER-05 envelope-at-construction); no new hardcoded literals (LOCKER-03); zero type-suppressions (LOCKER-02); no NODE_ENV branches (LOCKER-01); route already has `schema.body` + `config.rateLimit` so LOCKER-04 stays clean.

