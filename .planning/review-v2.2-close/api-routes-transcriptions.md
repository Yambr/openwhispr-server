# Re-review (v2.2 close): api-routes-transcriptions

Branch: main @ `b830cc4` (`docs(41): close phase 41; defer locker-04 flip + 32-cat-a/b tests to v2.3`)
Scope: `apps/api/src/routes/{transcriptions/**,tokens/**,v1/keys/**,agent/**}`
Prior review: `.planning/review/api-routes-transcriptions.md` (anchor SHA `1832f28`).

## Summary

- Files re-read at HEAD: 15 (4 transcriptions + shape.ts; 3 tokens routes + `_call-provider.ts`; 3 v1/keys; `agent/stream.ts` + `agent/translate-tools.ts` + `agent/web-search.ts`). `__fixtures__/`, `__tests__/` excluded as before.
- Cross-checked: `packages/wire-schemas/src/agent.ts`, `packages/litellm-client/src/model-aliases.ts`, `docs/self-hosting.md:86`, `docs/operations.md:639`, `compose/litellm/litellm_config.yaml`, `.planning/phases/41-residual-high-sweep/41-CONTEXT.md`.
- Closure-delta vs. prior review: **3 HIGH closed**, **4 MEDIUM still open by design** (deferred from Phase 41 scope), **4 LOW still open** (1 reclassified — see CLOSURE-DELTA below).
- New findings introduced by the closure work: **none** (no CRITICAL/HIGH regressions, no new MED, no new LOW). The Phase 41.b touch is surgical and additive.

Findings tally HEAD `b830cc4`: **CRITICAL=0 HIGH=0 MEDIUM=4 LOW=4** (down from HIGH=3 MED=4 LOW=4).

## Particular focus items requested by orchestrator

### LiteLLM multipart pass-through (transcriptions/**)

**Still out of scope at the file glob.** `apps/api/src/routes/transcriptions/**` continues to be a CRUD wrapper over the `transcriptions` table (`create.ts`, `batch-create.ts`, `delete.ts`, `batch-delete.ts`, `list.ts` + `shape.ts`). None of these files speak `multipart/form-data` or proxy audio bytes — they accept JSON `TranscriptionInput`/`{ids:[]}` bodies and write to Postgres under `withTenant(...)`.

The audio-bytes multipart pass-through route lives at `apps/api/src/routes/transcribe.ts` (singular) and is OUT OF THE FILE GLOB. The original review note at the bottom (line 190) was correct and remains accurate at `b830cc4`. **No new finding.**

Confirmed at HEAD:
- `create.ts:28` — `rateLimit: { max: 120, timeWindow: "1 minute" }` (D-32 no usage_ledger write — storage-only).
- `batch-create.ts:41` — `rateLimit: { max: 5, timeWindow: "1 minute" }`; `BatchCreateBodySchema` still tolerates bare-array shape (LOW-04 below).
- `batch-delete.ts:38`, `delete.ts:32`, `list.ts:38` — all carry explicit `rateLimit` overrides. All gate on `req.user && req.tenant` first.

### BYOK guard surface (`packages/byok-guard`) at v1/keys/**

The original review's note (line 194) stands at HEAD `b830cc4`: `packages/byok-guard` is consumed by `apps/api/src/index.ts` as `assertBYOKConfig`, NOT by anything under `v1/keys/**`. The `v1/keys` routes manage **server-issued PATs** (`pak_*` clear-text once + Argon2id `key_hash` at rest); they do not manage operator-supplied upstream-provider keys (which is what BYOK-guard envelope-encrypts). The two concepts are intentionally separate surfaces — the original "v1/keys MUST use byok-guard" concern conflates them.

I cross-verified by:
- `grep -n "byok-guard\|envelope" apps/api/src/routes/v1/keys/*.ts` → no hits.
- `create.ts:30` imports `generatePak, hashKey` from `apps/api/src/lib/argon2-keys.js` — the correct primitive for PAT material.
- `create.ts:103-112` SQL INSERT writes only `key_prefix` + `key_hash` (+ metadata); the clear-text PAK exists only in the response of `/create` (D-29) and is never persisted.
- `list.ts:91-94` and `revoke.ts:70-71` both use explicit column lists that exclude `key_hash` — no leak surface.

LOCKER-08 (`lint-no-plaintext-secret-columns`) at the schema layer protects against future drift if someone tried to add a plaintext `value` column to `api_keys` — but `api_keys.key_hash` is the Argon2id digest, which is itself the hash, not a secret-in-cleartext, so the linter does not (and should not) fire here.

**No finding.** The absence of `byok-guard` from v1/keys is by-design correct.

### agent/stream zod + rateLimit closure verification

All three HIGH findings from the prior review CLOSE cleanly at `b830cc4`:

- **HI-01 (yaml-derived default model)** — `apps/api/src/routes/agent/stream.ts:80` now reads `const DEFAULT_AGENT_MODEL = getDefaultAgentModel();` from `@openwhispr/litellm-client`. The loader at `packages/litellm-client/src/model-aliases.ts:127` parses `compose/litellm/litellm_config.yaml` and returns `model_list[0].model_name`. The yaml carries `qwen3.6-plus` (no `qwen/` prefix), so the route default now matches the proxy alias. Docs updated at `docs/self-hosting.md:86` and `docs/operations.md:639`. Loader has unit tests at `packages/litellm-client/tests/unit/model-aliases.test.ts`.

- **HI-02 (request-body validation)** — `apps/api/src/routes/agent/stream.ts:158` now does `AgentStreamRequestSchema.parse(req.body ?? {})` BEFORE `reply.hijack()` at line 168. Schema at `packages/wire-schemas/src/agent.ts:55` is `.strict()` with explicit caps: `messages` ≤ 50, `tools` ≤ 64, `systemPrompt` ≤ 16_384 chars, `model` 1..128 chars. Route also references it declaratively in `schema: { body: AgentStreamRequestSchema }` at line 122 to satisfy LOCKER-04. The previous `(req.body ?? {}) as RequestBody` cast is gone — only `body` is now a narrowed local type, not a suppression of inbound shape.

- **HI-03 (LLM-cost rate-limit)** — `apps/api/src/routes/agent/stream.ts:124-139` now declares `authRequired: true` + `rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: (req) => req.user?.id ?? req.ip }`. Cost-tier reasoning documented inline (20/min/user, below the 30/min token-mint cap because a single agent stream can run ≥ 30s and burn N tokens).

The MED-01 finding (`signal: abort.signal` deliberately omitted; client-disconnect-before-first-byte path can leak upstream) remains open and explicitly justified in-file (lines 200-227) with three undici GitHub issue references — flagged in CLOSURE-DELTA as carried forward.

## Findings at HEAD b830cc4

### [MEDIUM] Disabled-by-design AbortSignal on upstream call still active

- **File:** `apps/api/src/routes/agent/stream.ts:200-227, 230-236`
- **Status:** Open — carried forward verbatim from prior review's MED-01.
- **Evidence:** The 28-line `NOTE (Phase 08.2 deviation — empirical live finding)` block is unchanged. The call site at line 230 still omits `signal: abort.signal` from `deps.litellm.chatCompletionsStream({...})`. Client-disconnect-before-headers cannot interrupt the upstream POST body until the consumer receives at least one chunk and the `Readable.toWeb(...)` consumer breaks.
- **Why it matters:** A disconnected client can keep a paid LLM request open on the operator's dime up to LiteLLM's own server-side body timeout. Not a regression; not closed.
- **Fix:** unchanged from prior review — open a tracked undici 7.x ticket with the wrapped-Agent + signal repro; install a 60s server-side watchdog in the meantime that calls `abort.abort()` from a `setTimeout`.

### [MEDIUM] /api/v1/keys/** + /api/transcriptions/** still missing `authRequired: true`

- **Files:** `apps/api/src/routes/v1/keys/create.ts:60-69`, `v1/keys/list.ts:76-79`, `v1/keys/revoke.ts:43-46`, `transcriptions/create.ts:25-28`, `transcriptions/batch-create.ts:38-41`, `transcriptions/batch-delete.ts:35-38`, `transcriptions/delete.ts:29-32`, `transcriptions/list.ts:35-38`.
- **Status:** Open — carried forward from prior review's MED-02.
- **Evidence:** `grep -n "authRequired" apps/api/src/routes/v1/keys/*.ts apps/api/src/routes/transcriptions/*.ts` returns no hits. Phase 41.b only added `authRequired: true` to `agent/stream.ts:128`. Tokens routes already had it (`assemblyai.ts:55`, `deepgram.ts:34`, `openai-realtime.ts:60`). Web-search at `agent/web-search.ts:77-86` also lacks the flag (not flagged by prior review explicitly but worth noting for parity).
- **Why it matters:** Same anonymous-DoS vector the tokens routes mitigate. Anonymous traffic hitting these authed-gated URLs still creates `owrl:ip:*` buckets via the IP-tier `onRequest` hook before the 401 fires. Asymmetric hardening.
- **Fix:** unchanged — add `authRequired: true` to each route in the listed set. Mechanical one-liner per route; should ship alongside its own minimal `tests/integration/rate-limit-isolation.integration.ts` extension.

### [MEDIUM] usage_ledger insert failure still silent (no metric)

- **File:** `apps/api/src/routes/agent/web-search.ts:142-157`
- **Status:** Open — carried forward from prior review's MED-03.
- **Evidence:** `grep -rn "usage_ledger_insert_failed_total" apps/api/src` returns no hits. The `catch (e) { req.log.warn(...) }` block at line 150-157 still swallows ledger writes with only a warn log. No Prometheus counter; no alerting hook.
- **Why it matters:** Usage-accounting hole. A persistent ledger outage would zero out web-search billing silently. Same risk class as the original review.
- **Fix:** add `usage_ledger_insert_failed_total{kind="web-search.*"}` counter via the existing OTel/prom-client bridge. Increment inside the catch, keep the user-facing 200 behavior unchanged.

### [MEDIUM] Web-search provider-label dispatch still hardcoded at the route boundary

- **File:** `apps/api/src/routes/agent/web-search.ts:98-114`
- **Status:** Open — carried forward from prior review's MED-04.
- **Evidence:** The two ternaries (`provider.name === "tavily" ? ... : provider.name === "yandex" ? ... : ...`) are byte-identical to the prior review snapshot. `apps/api/src/lib/web-search/types.ts` has not grown `envVarLabel` / `displayLabel` fields (`grep -n "envVarLabel\|displayLabel" apps/api/src/lib/web-search/types.ts` empty).
- **Why it matters:** Adding a third provider (D-01: "more providers may be added later") still requires editing this route. Registry pattern undermined.
- **Fix:** unchanged — promote `readonly envVarLabel: string` and `readonly displayLabel: string` to `WebSearchProvider`; the route consumes the contract.

### [LOW] Dead `void` expressions in Yandex adapter

- **File:** `apps/api/src/lib/web-search/yandex-adapter.ts:341-342`
- **Status:** Open — carried forward.
- **Evidence:** `void upstreamRequestId; void query.length;` still present verbatim.
- **Fix:** unchanged.

### [LOW] Test-only export naming drift (`__test` vs `__testing__`)

- **Files:** `apps/api/src/routes/tokens/_call-provider.ts:154` (`__test`), `apps/api/src/lib/web-search/yandex-adapter.ts:371` (`__testing__`).
- **Status:** Open — carried forward.
- **Evidence:** Both lines unchanged at HEAD; the two conventions still coexist.
- **Fix:** unchanged — pick one convention (suggest `__testing` to align with the two-instance majority in `apps/api`).

### [LOW] `qwen3.6-plus` model name is fictional

- **Files:** `apps/api/src/routes/agent/stream.ts:80` (now indirect via loader); `apps/api/src/routes/reason.ts:65`; `packages/litellm-client/src/config.ts`; `compose/litellm/litellm_config.yaml:23`.
- **Status:** Reclassified — was previously LOW; the *prefix-drift* component is now CLOSED by HI-01 because the route default tracks the yaml. What remains is the operator-facing concern that `qwen3.6-plus` is not a real OpenRouter / Qwen model id. **Still LOW** — the value is a placeholder pending operator decision per the original memory note. No security impact, just a future-rename smell.
- **Fix:** unchanged — substitute a real Qwen model id (e.g. `qwen3-max`) once chosen, in BOTH the yaml AND `packages/litellm-client/src/config.ts:DEFAULT_CHAT_MODEL`. The loader will pick it up automatically; no route edit required (proof point that HI-01 was well-architected).

### [LOW] `transcriptions/batch-create.ts` accepts bare-array body

- **File:** `apps/api/src/routes/transcriptions/batch-create.ts:27-30`
- **Status:** Open — carried forward.
- **Evidence:** `BatchCreateBodySchema = z.union([z.object({transcriptions: z.array(...)}), z.array(...)])` is unchanged at HEAD.
- **Fix:** unchanged — either anchor the bare-array form to a specific line in `BACKEND_SPEC.md`, or drop the bare-array branch.

## Dead code

- `apps/api/src/lib/web-search/yandex-adapter.ts:341-342` — see LOW above. Unchanged.
- `apps/api/src/routes/agent/web-search.ts:168` — `export { resolveWebSearchProvider, webSearchRegistry };` re-export. Re-checked at HEAD: `grep -rn "from.*routes/agent/web-search" apps packages` shows only `apps/api/src/index.ts` and one e2e fixture as importers, neither of which uses `webSearchRegistry`. The comment ("purely for symmetry") is still accurate; this is an unconsumed export. Carried as **LOW dead-code observation** (not a separate severity entry — listed here only).

## Suppressed warnings

- `apps/api/src/routes/agent/stream.ts:89, 98, 104, 171, 178, 275, 292, 301` — eight `/* v8 ignore next */` coverage suppressions. Volume increased by ~2 vs. prior review because the new `try { raw.flushHeaders() } catch {}` and `try { req.raw.socket?.setNoDelay(true) } catch {}` guards (added when zod validation was moved before hijack) each carry one ignore. Each is locally justified ("socket-already-closed defensive guard; raced-only" or "defensive: flushHeaders may throw on already-flushed adapters"). The aggregate count is high for a single file; the prior review's suggested refactor (`swallowSocketClosed(fn)` helper) was not done. **Not a regression** — same pattern at slightly higher cardinality. No new finding.
- `apps/api/src/routes/agent/stream.ts:271` — `Readable.toWeb(upstream.body as Readable) as ReadableStream<Uint8Array>` — double cast for the Node-Web stream bridge. Same boundary-cost call as prior review; acceptable.
- `apps/api/src/routes/v1/keys/create.ts:134` — `err as { code?: string; cause?: { code?: string } } | null` — pg-error typing pattern; unchanged from prior review; acceptable.
- `apps/api/src/routes/tokens/openai-realtime.ts:79` — `(req.body ?? {}) as RequestBody` is **still present** in `openai-realtime.ts`. The prior review did NOT flag this (legitimate — body validation happens explicitly via the 1/2 allowlist at line 82). However, given HI-02 closed the same pattern in `agent/stream.ts`, parity-via-zod here would be a small hygiene win. **Not a finding** — flagged for v2.3 grooming.

No `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` / `eslint-disable` / `biome-ignore` found in scope. LOCKER-02 unchanged.

## Disabled tests near scope

None found. `apps/api/src/routes/transcriptions/__tests__/setup.ts` and `apps/api/src/routes/v1/keys/__tests__/setup.ts` exist; `grep -rn "\\.skip\\|xit(\\|it\\.todo\\|describe\\.skip" apps/api/src/routes/{transcriptions,v1/keys,agent,tokens}` returns no hits.

## CLOSURE-DELTA vs. prior review

| Prior finding | Severity | HEAD `b830cc4` state | Closing artefact |
|---|---|---|---|
| HI-01 default agent model slug mismatched yaml | HIGH | **CLOSED** | `agent/stream.ts:80` reads via `getDefaultAgentModel()` from `packages/litellm-client/src/model-aliases.ts:127`; docs updated `self-hosting.md:86` + `operations.md:639`; loader unit-tested |
| HI-02 /api/agent/stream skips body validation | HIGH | **CLOSED** | `wire-schemas/src/agent.ts:55` `AgentStreamRequestSchema` (`.strict`, capped); `agent/stream.ts:122,158` declarative `schema` ref + manual `.parse()` BEFORE `reply.hijack()` |
| HI-03 /api/agent/stream missing rate-limit | HIGH | **CLOSED** | `agent/stream.ts:124-139` `authRequired: true` + per-user 20/min bucket; reasoning documented inline |
| MED-01 AbortSignal omitted from upstream | MEDIUM | **OPEN, deferred** | unchanged; 3× GitHub-issue refs; no watchdog timer installed |
| MED-02 missing `authRequired` on v1/keys + transcriptions | MEDIUM | **OPEN, out of Phase 41.b scope** | only `agent/stream.ts` was patched in Phase 41.b — by design |
| MED-03 ledger-insert swallow has no metric | MEDIUM | **OPEN, out of scope** | no Prometheus counter added; warn-log only |
| MED-04 web-search provider-label dispatch hardcoded | MEDIUM | **OPEN, out of scope** | `types.ts` not augmented with `envVarLabel`/`displayLabel` |
| LOW-01 `void` dead expressions in yandex-adapter | LOW | **OPEN** | unchanged |
| LOW-02 `__test` vs `__testing__` naming drift | LOW | **OPEN** | unchanged |
| LOW-03 `qwen3.6-plus` fictional model id | LOW | **OPEN (residual smell only)** | prefix-drift component closed by HI-01; fictional-name component remains |
| LOW-04 `batch-create` accepts bare-array body | LOW | **OPEN** | unchanged |

**Net for v2.2 publication:** zero CRITICAL, zero HIGH. The four MEDIUMs are operator-aware (each is explicitly out-of-scope-by-design for Phase 41.b per `41-CONTEXT.md:25`; they were tagged as the residual sweep against this review's high band only). LOWs are hygiene.

## Recommendation for v2.2 publication

**Publish as-is.** The HIGH-band closure is clean and complete; the supporting infrastructure (yaml-loader at `packages/litellm-client/src/model-aliases.ts`, wire schema at `packages/wire-schemas/src/agent.ts`, route reorder around `reply.hijack()`) is well-shaped. The four MED carry-forwards do not block OSS publication — each has a clear single-PR fix path and is documented in the original review for the next sweep.

Suggested follow-up phase (v2.3): a single "review-MED-sweep" plan covering MED-02 (authRequired propagation, ~7 lines × 8 files), MED-03 (one Prometheus counter), MED-04 (label promotion + 2 adapter `readonly` fields), and the v8-ignore consolidation helper. All four are mechanical and could land in a ≤ 200-line PR with TDD coverage in `tests/integration/rate-limit-isolation.integration.ts` + `apps/api/src/lib/web-search/__tests__/registry.test.ts`.

---
Reviewed: 2026-05-16 (HEAD `b830cc4`).
Depth: standard, anchored to the prior review's 9-category scaffold + closure-delta requested by orchestrator.
