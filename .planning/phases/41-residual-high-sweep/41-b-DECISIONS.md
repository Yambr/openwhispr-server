# Phase 41.b — DECISIONS (autonomous; user offline)

## D-1 — HI-01 model-alias source mechanism

**Choice:** **(b) Runtime parse** of `compose/litellm/litellm_config.yaml` at module load.

**Rationale:**
- `yaml` (v2.8.4) is already a root dep — no new dependency.
- Build-time codegen (option (a)) adds a `tools/gen-*` script + commits a generated `.ts` file + needs CI hook to detect drift. Higher cognitive overhead for the same outcome.
- Phase 41.f will reuse the same loader in `@openwhispr/litellm-client` (the file lives there). Runtime parse keeps the alias map as ONE place mutated by ops.
- Module-load parse is one-time cost; no per-request hit.
- Operators who edit yaml without a rebuild get an immediate restart-time effect; codegen would silently lag.

**Location:** `packages/litellm-client/src/model-aliases.ts` (new). Exports:
- `loadLitellmModelAliases(yamlPath?: string): string[]` — returns the `model_name` set from `model_list`.
- `getDefaultAgentModel(yamlPath?: string): string` — returns `model_list[0].model_name` (first entry is the canonical chat default; LiteLLM router order matches yaml order).

The route consumes `getDefaultAgentModel()` at module-load (top-level const) so per-request cost is zero. yaml path defaults to `<repo-root>/compose/litellm/litellm_config.yaml` resolved via `import.meta.url` traversal.

**Drift guard:** an assertion that `getDefaultAgentModel()` returns a value present in the yaml's `model_name` set is implicit (it reads from there).

## D-2 — HI-03 rate-limit `max` + `timeWindow`

**Choice:** `{ max: 20, timeWindow: '1 minute', keyGenerator: per-user }` + `authRequired: true`.

**Rationale:**
- Codebase peer-set (per review):
  - transcriptions/create.ts → 120/min — CRUD, cheap
  - transcriptions/batch-create.ts → 5/min — write-heavy, cheap-ish
  - tokens/{assemblyai,deepgram,openai-realtime}.ts → 30/min/user — token-mint
  - agent/web-search.ts → 30/min/user — paid SaaS-call but bounded by `numResults≤10`
  - v1/keys/create.ts → 5/hour/user — administrative
- `/api/agent/stream` is the most expensive endpoint: an LLM request with `messages.length≤50` AND streaming output can burn 10s of seconds of upstream + N tokens.
- Conservative: 20/min/user is below token-mint (30/min/user) — token-mint returns a single ephemeral secret in < 1s; agent-stream can run > 30s per request.
- 1-minute window matches the rest of the surface for operator-monitoring consistency.

**`authRequired: true`:** mirrors the tokens/v1 hardening pattern (per `api-routes-transcriptions.md` MEDIUM finding — but agent-stream is HIGH-priority so we close it here, not deferred).

## D-3 — Schema scope (HI-02)

`AgentStreamRequest`:
- `.strict()` per Phase 39 pattern.
- `messages: z.array(...).min(0).max(50)` — desktop ChatMessage; cap conversation length (defensive vs cost-multiplier attack).
- `tools: z.array(...).max(64).optional()` — legacy LegacyTool shape, structural only.
- `systemPrompt: z.string().max(16_384).optional()`.
- `model: z.string().min(1).max(128).optional()`.
- Schema lives in `packages/wire-schemas/src/agent.ts` and re-exports `LegacyTool`/`ChatMessage` shapes that mirror `apps/api/src/routes/agent/translate-tools.ts` types (kept in sync via shared schema).

Route parses BEFORE `reply.hijack()` so ZodError flows through centralized error handler → canonical 400 envelope (HI-02 acceptance criterion).

## D-4 — Test 5 + docs default-string update

Test 5 currently asserts `"qwen/qwen3.6-plus"`. Post-fix the expected default is `"qwen3.6-plus"` (matches yaml `model_list[0].model_name`). Test 5 + docs/self-hosting.md + docs/operations.md updated in same atomic commit as the GREEN production fix.
