---
phase: quick-260604-u65
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/litellm-client/src/config.ts
  - packages/litellm-client/tests/unit/config.test.ts
  - apps/api/src/routes/embeddings.ts
  - apps/api/src/routes/rerank.ts
  - apps/api/src/routes/index.ts
  - apps/api/src/index.ts
  - apps/api/tests/unit/embeddings-route.test.ts
  - apps/api/tests/unit/rerank-route.test.ts
  - apps/api/src/routes/capabilities.ts
  - apps/api/tests/unit/capabilities-route.test.ts
  - tools/lint-no-env-branches.allowlist.txt
  - .env.example
  - .env.development.example
  - .env.production.example
  - .env.test.example
  - .env.docker.example
  - docs/operations.md
  - docs/self-hosting.md
autonomous: true
requirements: [U65-EMBEDDINGS, U65-RERANK, U65-CAPABILITIES]

must_haves:
  truths:
    - "An authenticated client can POST /api/embeddings and receive the operator-gateway's OpenAI-compatible embeddings response forwarded byte-for-byte"
    - "An authenticated client can POST /api/rerank and receive the operator-gateway's Cohere-shape rerank response forwarded byte-for-byte"
    - "When no embeddings model is configured (env unset) and the body omits a model, /api/embeddings returns 503 (operator-config) — never 401, never an onnx/cloud fallback"
    - "When no rerank model is configured and the body omits a model, /api/rerank returns 503"
    - "An upstream 4xx/5xx (e.g. model-not-installed 404) propagates to the client as a clean non-2xx so the client honors its no-fallback contract"
    - "Both routes require auth (defensive 401 when req.user absent), carry rateLimit config, and 400 on a malformed body"
    - "GET /api/capabilities reports features.embeddings and features.rerank booleans gated on (LITELLM_MASTER_KEY present) AND (the respective model env set)"
    - "The capabilities ETag rotates when LITELLM_EMBEDDING_MODEL / LITELLM_RERANK_MODEL flip"
  artifacts:
    - path: "apps/api/src/routes/embeddings.ts"
      provides: "buildEmbeddingsRoutes(deps) → POST /api/embeddings passthrough plugin"
      exports: ["buildEmbeddingsRoutes"]
    - path: "apps/api/src/routes/rerank.ts"
      provides: "buildRerankRoutes(deps) → POST /api/rerank passthrough plugin"
      exports: ["buildRerankRoutes"]
    - path: "packages/litellm-client/src/config.ts"
      provides: "defaultEmbeddingModel + defaultRerankModel config fields + env seam"
      contains: "defaultEmbeddingModel"
    - path: "apps/api/src/routes/capabilities.ts"
      provides: "features.embeddings + features.rerank gates + envHash keys"
      contains: "embeddings"
  key_links:
    - from: "apps/api/src/routes/index.ts"
      to: "buildEmbeddingsRoutes / buildRerankRoutes"
      via: "registration inside the if (deps.litellm) gate"
      pattern: "buildEmbeddingsRoutes|buildRerankRoutes"
    - from: "apps/api/src/index.ts litellmModels block"
      to: "litellmConfig.defaultEmbeddingModel / defaultRerankModel"
      via: "threaded into route deps"
      pattern: "defaultEmbeddingModel|defaultRerankModel"
    - from: "embeddings.ts / rerank.ts handler"
      to: "deps.litellm.passthrough(\"/v1/embeddings\" | \"/v1/rerank\", ...)"
      via: "raw upstream forward (status + content-type + body)"
      pattern: "passthrough\\(\"/v1/(embeddings|rerank)\""
---

<objective>
Add two server-side wire endpoints — POST /api/embeddings and POST /api/rerank — that forward to the operator's in-perimeter gateway via the shared litellm-client `passthrough()`, plus surface `features.embeddings` / `features.rerank` capability flags. This lets the desktop client send embeddings/rerank work to the server (the client's local onnx embeddings worker is broken upstream and immutable). Contract: if the server cannot do it → clean error, NO fallback. The client reads the capability flag first.

Purpose: Unblock the desktop client's embeddings path without any client-side fallback. The model values are operator-owned env (`LITELLM_EMBEDDING_MODEL` / `LITELLM_RERANK_MODEL`) — NO concrete model name is hardcoded anywhere; when unset, the capability flag is false and the route returns a clean 503.
Output: Two new routes, two new config fields + env seam, two new capability flags, env examples + operator/self-hosting docs, full RED→GREEN TDD coverage.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# Route template — MIRROR THIS EXACTLY (global dualAuthHook auth, manual zod parse, 503-not-401)
@apps/api/src/routes/reason.ts

# Capabilities route — features gating + envHash + deps.env injection pattern
@apps/api/src/routes/capabilities.ts

# litellm-client config — env seam + LitellmClientConfig interface
@packages/litellm-client/src/config.ts

<interfaces>
<!-- Confirmed against HEAD. Executor uses these directly — no exploration needed. -->

passthrough() — packages/litellm-client/src/index.ts:727 (interface @278):
  passthrough(path: string, args: {
    method: string;            // "POST"
    body?: unknown;            // pass JSON.stringify(...)
    contentType?: string;      // "application/json"
    userId: string;            // req.user.id (→ x-litellm-end-user-id, stable UUID)
    requestId: string;         // req.id
    endUser?: string;          // req.user.email ?? req.user.id (→ body.user-equivalent + opt header)
    signal?: AbortSignal;
    headersTimeout?: number;
    bodyTimeout?: number;
  }): Promise<Dispatcher.ResponseData<unknown>>
  // NOTE: passthrough() calls ensureOk() internally → THROWS LitellmUpstreamError on non-2xx.
  // To honor "forward upstream 4xx/5xx as a clean client-visible error", catch
  // LitellmUpstreamError and map to UpstreamError (502) — exactly like reason.ts:190-196.
  // On the 2xx path, forward the raw body stream + status + content-type.

LitellmUpstreamError — packages/litellm-client/src/errors.ts:136:
  public readonly status: number;  // upstream HTTP status, available for logging

Error classes — apps/api/src/errors.ts:
  ServiceUnavailable(code?, message?) → 503   // use for "no model configured"
  UpstreamError(code?, message?)      → 502   // use for upstream 4xx/5xx (client treats as clean fail)
  AuthError(code, message)            → 401   // defensive only

reason.ts route shape (MIRROR): app.route({ method, url, config:{ rateLimit:{ max, timeWindow } }, handler })
  - NO schema.body registered (manual ReasonRequest.parse(req.body) inside handler → ZodError → canonical 400 envelope).
  - This is HOW reason.ts satisfies the LOCKER-04 "every route has body validation" invariant: the
    manual zod .parse() IS the validation. Match this exactly (manual parse). DO NOT register schema.body.
  - Auth = global dualAuthHook (no preHandler); handler opens with: if (!req.user || !req.tenant) throw new AuthError(...)

litellmModels deps interface — apps/api/src/routes/index.ts:176:
  litellmModels?: { sttModel, chatModel, realtimeModel, cleanupModel, modelParams? }
  → ADD optional fields: embeddingModel?: string; rerankModel?: string;

litellmModels assembly — apps/api/src/index.ts:939:
  litellmModels = { sttModel: litellmConfig.defaultSttModel, chatModel: ..., ... }
  → ADD: ...(litellmConfig.defaultEmbeddingModel !== undefined ? { embeddingModel: litellmConfig.defaultEmbeddingModel } : {})
         and the rerank equivalent (use exactOptionalPropertyTypes-safe conditional spread).

env seam — packages/litellm-client/src/config.ts:329 (defaultSttModel pattern, but UNSET = undefined, NO literal default):
  const defaultEmbeddingModel =
    env.LITELLM_EMBEDDING_MODEL && env.LITELLM_EMBEDDING_MODEL.length > 0
      ? env.LITELLM_EMBEDDING_MODEL : undefined;
  // spread into return object via conditional spread (exactOptionalPropertyTypes):
  ...(defaultEmbeddingModel !== undefined ? { defaultEmbeddingModel } : {})
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (C1): litellm-client config — defaultEmbeddingModel / defaultRerankModel env seam</name>
  <files>packages/litellm-client/src/config.ts, packages/litellm-client/tests/unit/config.test.ts</files>
  <behavior>
    - Test: loadLitellmConfigFromEnv({ ...minimal valid env, LITELLM_EMBEDDING_MODEL: "op-embed-alias" }) → config.defaultEmbeddingModel === "op-embed-alias"
    - Test: LITELLM_EMBEDDING_MODEL unset → config does NOT carry defaultEmbeddingModel (key absent / undefined) — NO literal default substituted
    - Test: LITELLM_EMBEDDING_MODEL = "" (empty string) → treated as unset (undefined), mirroring the defaultSttModel empty-is-unset seam
    - Same three tests for LITELLM_RERANK_MODEL → config.defaultRerankModel
    - Use a generic placeholder alias like "op-embed-alias" in tests — NEVER a concrete corporate model name
  </behavior>
  <action>
    In packages/litellm-client/src/config.ts: add two OPTIONAL fields to the `LitellmClientConfig` interface (after `defaultCleanupModel`, before `modelParams`): `defaultEmbeddingModel?: string;` and `defaultRerankModel?: string;` with jsdoc explaining each is operator-owned via the respective env var, UNSET by default (no literal fallback — when undefined the route returns a clean 503 and the capability flag is false). DO NOT add a DEFAULT_*_MODEL constant — there is intentionally no default literal.
    In `loadLitellmConfigFromEnv()` (~@329, alongside defaultSttModel): compute `defaultEmbeddingModel` = `env.LITELLM_EMBEDDING_MODEL && env.LITELLM_EMBEDDING_MODEL.length > 0 ? env.LITELLM_EMBEDDING_MODEL : undefined` and the rerank equivalent. Spread into the returned config object using conditional spread (`...(defaultEmbeddingModel !== undefined ? { defaultEmbeddingModel } : {})`) to stay exactOptionalPropertyTypes-safe — same posture as the existing `userHeaderName` spread @390.
    LOCKER-01: this IS the env-read boundary (config.ts) — compliant.
    No re-export needed (these are interface fields, not new symbols).
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/litellm-client test config</automated>
  </verify>
  <done>config.test.ts asserts set/unset/empty behavior for both model env vars GREEN; no concrete model literal anywhere in config.ts diff; typecheck clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2 (C2): POST /api/embeddings route + registry wiring + RED tests</name>
  <files>apps/api/src/routes/embeddings.ts, apps/api/tests/unit/embeddings-route.test.ts, apps/api/src/routes/index.ts, apps/api/src/index.ts, tools/lint-no-env-branches.allowlist.txt</files>
  <behavior>
    - Test (forward): authed request, deps.embeddingModel = "op-embed-alias", deps.litellm.passthrough stub returns a 200 OpenAI-shape body ({object:"list", data:[{object:"embedding", embedding:[0.1,0.2], index:0}], model:"op-embed-alias", usage:{...}}) → route responds 200 with that body forwarded as-is; assert passthrough called with path "/v1/embeddings", method "POST", body JSON containing the validated input + model "op-embed-alias", userId=req.user.id, endUser=req.user.email, requestId=req.id
    - Test (caller model wins): body.model = "caller-alias" → passthrough body.model === "caller-alias" (overrides deps.embeddingModel)
    - Test (no model configured): deps.embeddingModel undefined AND body has no model → 503 with a code+literal pair, body.error.message carries NO secret/model detail; passthrough NEVER called
    - Test (upstream 4xx/5xx forwarded): passthrough stub throws LitellmUpstreamError(404, "...") → route responds non-2xx (502 UpstreamError canonical envelope); upstream detail logged not leaked
    - Test (bad body): body = { input: "" } (empty) → 400; body = { input: 123 } → 400; body = {} → 400
    - Test (auth required): req.user absent → 401 (defensive AuthError)
    - Bound the strings/array generously (mirror reason.ts MAX_* style): cap input string length and array length; reject empty string / empty array
    - Use generic alias placeholders in ALL tests — NEVER a concrete corporate model name
  </behavior>
  <action>
    Create apps/api/src/routes/embeddings.ts mirroring reason.ts:114-229 structure EXACTLY:
      - Export `interface EmbeddingsDeps { db?: ...; litellm: LitellmClient; embeddingModel?: string }` (db only if you mirror reason's ledger insert — the locked contract does NOT require a usage_ledger row for embeddings; OMIT the ledger write to keep scope tight, so db is NOT needed — confirm by re-reading reason.ts:207 then decide; default: no ledger, no db dep).
      - Export `const buildEmbeddingsRoutes = (deps) => async function embeddingsRoutes(app) { app.route({ method:"POST", url:"/api/embeddings", config:{ rateLimit:{ max:120, timeWindow:"1 minute" } }, handler }) }` and `export default buildEmbeddingsRoutes`.
      - Define a zod `EmbeddingsRequest` schema: `{ input: z.union([boundedString, z.array(boundedString).min(1).max(MAX_INPUTS)]), model: z.string().min(1).max(MAX_MODEL_LEN).optional() }`. boundedString = z.string().min(1).max(MAX_INPUT_CHARS). Pick MAX_* bounds generously, sourced from reason.ts conventions. NO schema.body on the route — manual `EmbeddingsRequest.parse(req.body)` inside the handler (LOCKER-04 body-validation satisfied via manual parse, same as reason.ts).
      - Handler: defensive `if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED","unauthorized")`. Parse body. Resolve `const model = parsed.model ?? deps.embeddingModel`. If `model === undefined` → `throw new ServiceUnavailable("SERVICE_UNAVAILABLE","Service temporarily unavailable")` (operator-config; NEVER 401; no model name on message). Else call `deps.litellm.passthrough("/v1/embeddings", { method:"POST", body: JSON.stringify({ ...parsed, model }), contentType:"application/json", userId: req.user.id, requestId: req.id, endUser: req.user.email ?? req.user.id })`.
      - Forward the 2xx raw: `reply.code(upstream.statusCode); const ct = upstream.headers["content-type"]; if (typeof ct === "string") reply.header("content-type", ct); return reply.send(upstream.body)` (upstream.body is a Node Readable — Fastify streams it). Re-read reason.ts:215-226 to confirm reply API; raw-forward differs from reason's JSON re-shape — that is intentional per the locked contract.
      - Catch `LitellmUpstreamError` → log `{ status: err.status }`, throw `new UpstreamError("EMBEDDINGS_UPSTREAM_FAILED","upstream embeddings provider failure")` (the resulting non-2xx is the client's clean-fail signal — no fallback). Catch `MissingProviderKeyError` → `ServiceUnavailable` (Pitfall #8: never 401), same as reason.ts:183.
    Registry (apps/api/src/routes/index.ts): add `embeddingModel?: string` (and rerankModel in Task 3) to the `litellmModels` deps interface @176. Inside the `if (deps.litellm)` gate (~@570-608, next to buildReasonRoutes), import + register: `const embeddingsDeps: EmbeddingsDeps = { litellm: deps.litellm, ...(deps.litellmModels?.embeddingModel ? { embeddingModel: deps.litellmModels.embeddingModel } : {}) }; plugins.push(buildEmbeddingsRoutes(embeddingsDeps));`. This registration IS the non-test importer satisfying the LOCKER-04 dead-export check.
    Entrypoint (apps/api/src/index.ts:939): thread `litellmConfig.defaultEmbeddingModel` into the `litellmModels` assembly via conditional spread (`...(litellmConfig.defaultEmbeddingModel !== undefined ? { embeddingModel: litellmConfig.defaultEmbeddingModel } : {})`).
    LOCKER-01 line-drift: adding the registration block in routes/index.ts inside the litellm gate (~@608) shifts the issue-31 NODE_ENV allowlist line (currently 719). After your edits run the lint and bump the allowlist line number + append `(drifted 719 → NNN by quick-260604-u65 embeddings registry wiring)` to the matching line in tools/lint-no-env-branches.allowlist.txt. This is line-drift only — same as prior quick tasks; do NOT add a new NODE_ENV branch.
    Test infra: model the route test on the existing reason-route unit test (find apps/api/tests/unit/reason-route.test.ts or equivalent — buildApp/inject with a stubbed litellm + injected session). Mock litellm at the BOUNDARY only (the LitellmClient.passthrough method) — this is a network-boundary mock, constitutionally allowed; no real Postgres needed since the route does no DB write.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api test embeddings-route</automated>
  </verify>
  <done>embeddings-route.test.ts GREEN on all 6 behaviors; route registered inside the litellm gate; entrypoint threads embeddingModel; env-branches lint passes (allowlist line bumped); typecheck + no-suppressions + prod-readiness lint clean; ZERO concrete model names in diff.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3 (C3): POST /api/rerank route + registry wiring + RED tests</name>
  <files>apps/api/src/routes/rerank.ts, apps/api/tests/unit/rerank-route.test.ts, apps/api/src/routes/index.ts, apps/api/src/index.ts, tools/lint-no-env-branches.allowlist.txt</files>
  <behavior>
    - Test (forward): authed, deps.rerankModel="op-rerank-alias", passthrough stub returns 200 Cohere-shape ({results:[{index:0, relevance_score:0.9}], model:"op-rerank-alias"}) → 200 forwarded as-is; assert passthrough called path "/v1/rerank", body JSON {query, documents, model:"op-rerank-alias", top_n?}, userId/endUser/requestId set
    - Test (caller model + top_n pass-through): body.model + body.top_n present → forwarded in body verbatim
    - Test (no model configured): deps.rerankModel undefined AND no body.model → 503; passthrough never called
    - Test (upstream error forwarded): LitellmUpstreamError(404) → 502 UpstreamError envelope
    - Test (bad body): { query:"", documents:["a"] } → 400; { query:"q", documents:[] } → 400; { query:"q" } (no documents) → 400; { documents:["a"] } (no query) → 400
    - Test (auth required): req.user absent → 401
    - Generic alias placeholders only — NEVER a concrete corporate model name
  </behavior>
  <action>
    Create apps/api/src/routes/rerank.ts mirroring embeddings.ts (Task 2) structure exactly, with route url "/api/rerank" and passthrough path "/v1/rerank".
    zod `RerankRequest`: `{ query: boundedString, documents: z.array(boundedString).min(1).max(MAX_DOCS), model: z.string().min(1).max(MAX_MODEL_LEN).optional(), top_n: z.number().int().positive().max(MAX_TOP_N).optional() }`. Manual parse inside handler (no schema.body), same LOCKER-04 satisfaction.
    Handler: resolve `model = parsed.model ?? deps.rerankModel`; undefined → 503 ServiceUnavailable. Else passthrough("/v1/rerank", { method:"POST", body: JSON.stringify({ ...parsed, model }), contentType:"application/json", userId, requestId, endUser }). Forward raw 2xx (statusCode + content-type + body stream). Catch LitellmUpstreamError → UpstreamError("RERANK_UPSTREAM_FAILED",...). Catch MissingProviderKeyError → ServiceUnavailable.
    Export `interface RerankDeps { litellm: LitellmClient; rerankModel?: string }`, `buildRerankRoutes`, default export.
    Registry: add `rerankModel?: string` to litellmModels deps interface @176 (alongside Task 2's embeddingModel). Register inside the same `if (deps.litellm)` gate next to embeddings: `const rerankDeps: RerankDeps = { litellm: deps.litellm, ...(deps.litellmModels?.rerankModel ? { rerankModel: deps.litellmModels.rerankModel } : {}) }; plugins.push(buildRerankRoutes(rerankDeps));`. Registration = the non-test importer (LOCKER-04).
    Entrypoint (apps/api/src/index.ts): thread `litellmConfig.defaultRerankModel` into litellmModels via conditional spread.
    LOCKER-01 line-drift: this adds more lines in routes/index.ts → re-run the env-branches lint and bump the allowlist line again, appending `(drifted NNN → MMM by quick-260604-u65 rerank registry wiring)`.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api test rerank-route</automated>
  </verify>
  <done>rerank-route.test.ts GREEN on all 6 behaviors; route registered; entrypoint threads rerankModel; all lockers (env-branches/no-suppressions/prod-readiness/no-hardcode) clean; ZERO concrete model names.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4 (C4): capabilities features.embeddings + features.rerank + envHash rotation</name>
  <files>apps/api/src/routes/capabilities.ts, apps/api/tests/unit/capabilities-route.test.ts</files>
  <behavior>
    - Test: deps.env with LITELLM_MASTER_KEY set + LITELLM_EMBEDDING_MODEL="x" → features.embeddings === true
    - Test: LITELLM_MASTER_KEY set + LITELLM_EMBEDDING_MODEL unset → features.embeddings === false
    - Test: LITELLM_MASTER_KEY unset + LITELLM_EMBEDDING_MODEL set → features.embeddings === false (gated on master key too)
    - Same three for rerank / LITELLM_RERANK_MODEL → features.rerank
    - Test (ETag rotation): two requests with identical env except LITELLM_EMBEDDING_MODEL flips set↔unset → different ETag (200 then a mismatched If-None-Match path); identical env → same ETag (304 fast path)
    - Use placeholder values like "x" / "op-embed-alias" — NEVER a concrete model name
  </behavior>
  <action>
    In apps/api/src/routes/capabilities.ts: extend `interface FeaturesSection` (@62) with `readonly embeddings: boolean;` and `readonly rerank: boolean;`. `CapabilitiesResponse` inherits automatically (@68).
    In `deriveFeatures(env)` (@79): add `const hasEmbeddingModel = typeof env.LITELLM_EMBEDDING_MODEL === "string" && env.LITELLM_EMBEDDING_MODEL.length > 0;` (rerank equivalent), then return `embeddings: hasLitellm && hasEmbeddingModel, rerank: hasLitellm && hasRerankModel`. This route reads env via the injected `deps.env ?? process.env` seam (@159) — consistent with the EXISTING accepted pattern (it already reads LITELLM_MASTER_KEY/OPENAI_API_KEY there @80-82); no new LOCKER-01 concern, no allowlist change.
    In `envHash(env)` (@100): append `"LITELLM_EMBEDDING_MODEL"` and `"LITELLM_RERANK_MODEL"` to the `keys` array so the ETag rotates when either flips.
    Wire-schema: investigation confirmed NO wire-schema exists for /api/capabilities in packages/wire-schemas (re-confirm with a grep for "capabilities" under packages/wire-schemas; if truly absent, state in SUMMARY "no wire-schema change — capabilities has no published wire schema"). If a contract/snapshot test for capabilities exists, update its expected shape to include the two new boolean fields.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api test capabilities-route</automated>
  </verify>
  <done>capabilities-route.test.ts GREEN on the 8 gating + ETag behaviors; FeaturesSection has embeddings+rerank; envHash includes both new keys; no wire-schema drift (or contract snapshot updated); ZERO concrete model names.</done>
</task>

<task type="auto">
  <name>Task 5 (C5): env examples (all 5) + operator + self-hosting docs</name>
  <files>.env.example, .env.development.example, .env.production.example, .env.test.example, .env.docker.example, docs/operations.md, docs/self-hosting.md</files>
  <action>
    Add `LITELLM_EMBEDDING_MODEL` and `LITELLM_RERANK_MODEL` to all five .env.*.example files, COMMENTED-OUT and UNSET by default, with a generic comment: "# Operator gateway model alias for /api/embeddings (in-perimeter model). UNSET = /api/embeddings returns a clean 503 and capabilities.features.embeddings is false. No fallback." and the rerank equivalent. CRITICAL: provide NO concrete model value — leave the value blank (e.g. `# LITELLM_EMBEDDING_MODEL=`). Do NOT invent a "bge-*" or any vendor default. Match the existing comment/format style of LITELLM_STT_MODEL / LITELLM_REALTIME_MODEL lines in those files.
    docs/operations.md: add a subsection under the LiteLLM model-alias config area documenting both env vars — operator points them at their in-perimeter embeddings/rerank model alias registered in their gateway catalog; unset → capability false + clean 503; explicitly state there is NO client-side onnx or cloud fallback (server-or-error contract). Generic language only.
    docs/self-hosting.md: add /api/embeddings + /api/rerank to the endpoint/capability list with a one-line note that they require the operator to register an embeddings/rerank alias in their gateway and set the two env vars; describe the capabilities.features.embeddings/rerank discovery flag the client reads first.
    English-only (constitutional). NO concrete corporate model name or namespace anywhere.
  </action>
  <verify>
    <automated>grep -L 'LITELLM_EMBEDDING_MODEL' .env.example .env.development.example .env.production.example .env.test.example .env.docker.example | grep -c . | grep -qx 0 && grep -rn 'LITELLM_RERANK_MODEL' docs/operations.md docs/self-hosting.md | grep -q . && echo OK</automated>
  </verify>
  <done>All 5 env examples carry both vars commented + value-less; operations.md + self-hosting.md document both endpoints + the no-fallback / capability-flag contract; no concrete model literal; gitleaks pre-commit clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| desktop client → /api/embeddings, /api/rerank | Untrusted JSON body (input/query/documents/model/top_n) crosses here; auth via dualAuthHook session token |
| route → operator gateway (passthrough) | Server-to-gateway hop carrying the master/virtual key + end-user attribution headers |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-u65-01 | Tampering | request body forwarded to /v1/embeddings, /v1/rerank | mitigate | Manual zod parse (EmbeddingsRequest/RerankRequest) before passthrough; `model` resolved server-side as `parsed.model ?? deps.<model>`; body re-serialized via JSON.stringify of the VALIDATED object only — no raw req.body pass-through, no merge of request fields into operator config (no upstream-injection vector) |
| T-u65-02 | Information disclosure | 503 "no model configured" + upstream-error path | mitigate | code+literal pair only; no model alias / no upstream body string on `.message` (LOCKER-05 posture); upstream detail logged server-side via req.log.warn, never on the wire envelope |
| T-u65-03 | Elevation of privilege | unauthenticated access | mitigate | Global dualAuthHook + defensive `if (!req.user) throw AuthError` in each handler; routes registered only inside the `deps.litellm` gate |
| T-u65-04 | Denial of service | large input arrays / huge strings → upstream cost amplification | mitigate | `config.rateLimit { max:120, timeWindow:"1 minute" }` on both routes (LOCKER-04); generous-but-bounded zod caps on string length, array length (MAX_INPUTS/MAX_DOCS), top_n (MAX_TOP_N) |
| T-u65-05 | Spoofing | end-user attribution to operator gateway | accept | endUser = req.user.email ?? req.user.id forwarded via passthrough's existing attribution headers (x-litellm-end-user-id stays the stable UUID); identity is server-stamped from the validated session, not client-supplied |
</threat_model>

<verification>
- `pnpm --filter @openwhispr/litellm-client test config` GREEN (Task 1)
- `pnpm --filter @openwhispr/api test embeddings-route rerank-route capabilities-route` GREEN (Tasks 2-4)
- All lint lockers pass on diff: env-branches (allowlist line bumped, no NEW branch), no-suppressions (no `as any`/`@ts-ignore`), prod-readiness (both routes have rateLimit + body validation via manual parse), no-hardcode (no concrete model literal, no secret shapes)
- Coverage ≥ 90/90/90/90 on the diff (new routes + config seam + capabilities delta)
- gitleaks pre-commit clean
- grep audit: ZERO concrete corporate model name / namespace in any code, comment, doc, env example, or commit message — generic terms only ("operator gateway model", "in-perimeter model")
</verification>

<success_criteria>
- POST /api/embeddings forwards a configured-model request to the operator gateway and returns the OpenAI-shape body as-is; returns 503 when no model is configured; 502 on upstream failure; 400 on bad body; 401 when unauthenticated
- POST /api/rerank does the same for the Cohere-shape rerank response
- GET /api/capabilities reports features.embeddings/rerank correctly gated, ETag rotates on model-env flips
- No client-side fallback path exists — server-or-clean-error contract holds
- Strict TDD honored: each route/config/capabilities change landed RED→GREEN with tests + production code in the SAME atomic commit
- No concrete model names anywhere (owner hard-constraint)
</success_criteria>

<e2e_recommendation>
These are wire-surface routes in BACKEND_SPEC territory, so an integration/contract test against a mock-litellm proving the FORWARD is warranted (more than the boundary-stubbed unit tests). Recommended (executor judgment, can fold into Task 2/3 or a follow-up): a hermetic test that stands up a mock-litellm returning an OpenAI embeddings shape on /v1/embeddings and a Cohere shape on /v1/rerank, drives buildApp with a real injected session, and asserts the route forwards status + body verbatim AND that a mock-litellm 404 (model-not-installed) propagates as a non-2xx clean error. If the existing test harness already has a mock-litellm fixture (it does for contract tests), reuse it; gate a full docker-compose e2e (tests/e2e/, E2E=1) only if the boundary mock cannot prove the stream-forward. Not blocking for this quick task but strongly recommended before the client cuts over.
</e2e_recommendation>

<output>
After completion, create `.planning/quick/260604-u65-server-api-embeddings-api-rerank-via-lit/SUMMARY.md`.

Suggested atomic commits (generic-naming in messages — no concrete model name):
- C1: `feat(litellm-client): add defaultEmbeddingModel/defaultRerankModel env seam (operator gateway models)`
- C2: `feat(api): POST /api/embeddings forwards to operator gateway via litellm passthrough`
- C3: `feat(api): POST /api/rerank forwards to operator gateway via litellm passthrough`
- C4: `feat(api): capabilities reports features.embeddings/rerank gated on operator model config`
- C5: `docs: document operator embeddings/rerank model env + endpoints (no client fallback)`
(C4 and C5 may be combined if diffs are small; keep C1/C2/C3 separate per the TDD same-commit rule.)
</output>
