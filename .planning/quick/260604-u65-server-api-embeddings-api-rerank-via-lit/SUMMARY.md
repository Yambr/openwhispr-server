---
phase: quick-260604-u65
plan: 01
subsystem: api / litellm-client
tags: [embeddings, rerank, litellm-passthrough, capabilities, operator-gateway]
requires:
  - "@openwhispr/litellm-client passthrough() + LitellmUpstreamError + MissingProviderKeyError"
  - "apps/api dualAuthHook (global auth) + centralized error-handler envelope"
provides:
  - "POST /api/embeddings — OpenAI-shape embeddings forward via operator gateway"
  - "POST /api/rerank — Cohere-shape rerank forward via operator gateway"
  - "GET /api/capabilities features.embeddings / features.rerank flags + ETag rotation"
  - "LitellmClientConfig.defaultEmbeddingModel / defaultRerankModel env seam"
affects:
  - "desktop client embeddings path (server-or-clean-error, no onnx fallback)"
key-files:
  created:
    - apps/api/src/routes/embeddings.ts
    - apps/api/src/routes/rerank.ts
    - apps/api/tests/unit/embeddings-route.test.ts
    - apps/api/tests/unit/rerank-route.test.ts
  modified:
    - packages/litellm-client/src/config.ts
    - packages/litellm-client/tests/unit/config.test.ts
    - apps/api/src/routes/index.ts
    - apps/api/src/index.ts
    - apps/api/src/routes/capabilities.ts
    - apps/api/tests/unit/routes/__tests__/capabilities.test.ts
    - .env.slim.example
    - .env.full.example
    - docs/operations.md
    - docs/self-hosting.md
    - tools/lint-no-env-branches.allowlist.txt
    - tools/lint-no-hardcode.allowlist.txt
    - tools/lint-no-suppressions.allowlist.txt
    - tools/lint-prod-readiness.allowlist.txt
metrics:
  completed: 2026-06-04
  tasks: 5
  commits: 5
---

# Quick 260604-u65: Server /api/embeddings + /api/rerank via LiteLLM passthrough

Two new server wire endpoints — `POST /api/embeddings` (OpenAI-shape) and `POST /api/rerank`
(Cohere-shape) — forward to the operator's in-perimeter gateway via the shared
`litellm-client.passthrough()`, streaming the upstream response (status + content-type + body)
back verbatim, plus `features.embeddings` / `features.rerank` capability flags gated on
`LITELLM_MASTER_KEY` AND the respective operator model env. Contract is server-or-clean-error:
when no model is configured the route returns a clean 503 (never 401) and the capability flag is
false, so the desktop client never falls back to its broken local onnx worker.

## Commits

- C1 `56128c78` feat(litellm-client): defaultEmbeddingModel/defaultRerankModel env seam
- C2 `006083e5` feat(api): forward POST /api/embeddings to operator gateway via passthrough
- C3 `6931de2b` feat(api): forward POST /api/rerank to operator gateway via passthrough
- C4 `6fdc31e6` feat(api): capabilities reports features.embeddings/rerank on operator config
- C5 `2538ae31` docs: document operator embeddings/rerank model env + endpoints (no fallback)

## What shipped (line numbers)

- config.ts: interface fields @82 (defaultEmbeddingModel) / @89 (defaultRerankModel); env seam
  @364/@368 (empty-is-unset, NO literal default); conditional spread @413/@414.
- embeddings.ts: route decl @71, rateLimit max:120/1min, manual EmbeddingsRequest.parse(),
  model = body.model ?? deps.embeddingModel (undefined -> 503 before passthrough),
  LitellmUpstreamError -> 502 (EMBEDDINGS_UPSTREAM_FAILED), MissingProviderKeyError -> 503.
- rerank.ts: route decl @70, RerankRequest {query, documents[], model?, top_n?}, path /v1/rerank,
  RERANK_UPSTREAM_FAILED -> 502.
- routes/index.ts: litellmModels deps gains embeddingModel/rerankModel; embeddings push @626,
  rerank push @634 (both inside the deps.litellm gate; registration = LOCKER-04 non-test importer).
- index.ts: litellmModels assembly threads defaultEmbeddingModel @951 / defaultRerankModel @954
  via conditional spread.
- capabilities.ts: FeaturesSection +embeddings/+rerank; deriveFeatures gates @99-110;
  envHash keys +LITELLM_EMBEDDING_MODEL @136 / +LITELLM_RERANK_MODEL @137 (ETag rotation).

## Env seam / wiring

LITELLM_EMBEDDING_MODEL / LITELLM_RERANK_MODEL env -> loadLitellmConfigFromEnv() -> index.ts
litellmModels assembly -> routes/index.ts litellmModels deps -> Embeddings/RerankDeps -> handler
(body.model ?? deps.<model>). No route reads process.env (LOCKER-01).

## Verification

- pnpm --filter @openwhispr/litellm-client config test: 57 passed (57), incl 6 new U65 tests.
- npx vitest run --project=api embeddings-route rerank-route capabilities: 3 files passed,
  37 passed (37) = embeddings 10 + rerank 10 + capabilities 17.
- Typecheck: litellm-client tsc exit 0; apps/api tsc exit 0.
- All lockers clean on diff (env-branches / no-suppressions / no-hardcode / prod-readiness /
  secret-shape / shell-cred / plaintext-cols); gitleaks + commitlint passed on every commit.
- ZERO concrete corporate embeddings/rerank model names or namespaces anywhere. Generic
  placeholders only (op-embed-alias, op-rerank-alias). "Cohere-shape rerank" describes the wire
  RESPONSE SCHEMA (like "OpenAI-shape embeddings"), not a model alias.

## Deviations

1. [Rule 3] Allowlist line-drift bumps beyond the PLAN's env-branches entry — line-drift ONLY
   (same entry text, new line number + rationale): no-hardcode (config.ts 151->169, index.ts
   1098->1107, routes/index.ts 377->378), no-suppressions (index.ts 984/1104/1264 ->
   993/1113/1273, three pre-existing as-unknown-as casts I did not author), env-branches
   (routes/index.ts 719->745).
2. [Rule 3] prod-readiness LOCKER-04 manual-parse allowlist net-add for embeddings.ts:69 +
   rerank.ts:68 with the same issue-31-04 tag as reason.ts (manual .parse() = body validation;
   Phase 41 bulkfix backlog; LOCKER-04 is WARN, BLOCKING deferred per CLAUDE.md).
3. env example file names: PLAN named .env.example / .env.{development,production,test,docker}
   .example which do NOT exist; actual templates are .env.slim.example / .env.full.example (the
   only two carrying LITELLM_*_MODEL aliases). Documented there in matching format.
4. commit subject case: PLAN's "POST /api/..." subjects rejected by commitlint subject-case;
   rephrased to lowercase "forward POST /api/...".
5. rerankModel interface field + index.ts assembly spread landed in C2 (with embeddings),
   inert until C3 wired the route — keeps shared line-drift accounted once. TDD same-commit
   rule intact (C3 route + tests landed together).

## Self-Check: PASSED
- All 5 commit SHAs confirmed on HEAD (git log --oneline).
- All 4 created files exist on disk.
- Config test 57/57, route tests 37/37 re-run GREEN with own eyes.
- Working tree clean except this SUMMARY (only untracked plan dir).
