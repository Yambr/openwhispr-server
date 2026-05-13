// Phase 05 / Plan 03 / Task 3 — POST /api/agent/web-search (WIRE-08).
//
// Wire shape (BACKEND_SPEC.md):
//   Request:  { query: string (1..256), numResults?: number (1..10, default 5) }
//   Success:  200 { results: [{title, url, snippet}, ...] }
//   503:      { error: "<Provider> not configured (set <ENV_VAR> in .env)" }
//   502:      { error: "web-search upstream failed" }
//   400:      { error: <zod issue> } on empty query / bad numResults / etc.
//   429:      Standard envelope (rate-limit plugin) — 30/min/user (D-07).
//
// Behavior:
//   1. Dual-auth → req.user.id + req.tenant set by global hook.
//   2. Resolve provider ONCE at registration via resolveWebSearchProvider()
//      (D-02 boot-fatal on unknown WEB_SEARCH_PROVIDER).
//   3. Per request:
//      a. Parse body with WebSearchRequestSchema → 400 envelope on failure
//         (centralized handler maps ZodError).
//      b. If !provider.isConfigured() → 503 missing-key envelope (Pitfall #8
//         — never 401). For Yandex this is also where the operator's
//         half-configured deployment (keys set, ENABLED flag unset) lands.
//      c. provider.search(query, numResults). Per-error mapping:
//         - MissingProviderKeyError → 503 with err.message verbatim
//         - UpstreamError           → 502 generic
//         - other                   → rethrow → 500 generic
//      d. On success: insert usage_ledger row (kind = `web-search.${provider.name}`,
//         units = 1, request_id = req.id). ON CONFLICT (request_id) DO NOTHING
//         honors the global request_id UNIQUE index; req.id is per-request so
//         duplicates are not expected, but the clause matches the project
//         idempotency pattern (D-06).
//   4. Rate-limit: 30/min/user via @fastify/rate-limit; key on req.user.id.
//
// Threat mitigations:
//   * T-05-01 SSRF — adapter URLs hardcoded; query stays in JSON body.
//   * T-05-09 key leakage — env vars consumed only inside adapter; errors
//     never echo upstream body.
//   * T-05-10 rate-limit bypass — per-user keyGenerator (Valkey-backed).
//   * T-WEB-INJ — WebSearchRequestSchema enforces 1..256 chars on query
//     and 1..10 on numResults.

import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { WebSearchRequestSchema } from "@openwhispr/wire-schemas";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../../errors.js";
import { resolveWebSearchProvider, webSearchRegistry } from "../../lib/web-search/registry.js";
import {
  MissingProviderKeyError,
  UpstreamError,
  type WebSearchProvider,
} from "../../lib/web-search/types.js";

export interface WebSearchDeps {
  db: TransactionalDb<ExecutableTx>;
  /**
   * Optional override — tests inject a fake provider directly rather
   * than driving the env-var path. Production omits this and the route
   * resolves via `resolveWebSearchProvider()` at registration time
   * (D-02 boot-fatal on unknown env value).
   */
  provider?: WebSearchProvider;
}

export const buildWebSearchRoutes = (deps: WebSearchDeps) =>
  async function webSearchRoutes(app: FastifyInstance): Promise<void> {
    // Resolve ONCE at registration. Re-resolving per-request would mask
    // operator typos in WEB_SEARCH_PROVIDER (D-02 boot-fatal stance).
    const provider = deps.provider ?? resolveWebSearchProvider();

    app.route({
      method: "POST",
      url: "/api/agent/web-search",
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          // D-07 — per-user bucket. dualAuthHook populates req.user.id
          // BEFORE rate-limit fires (Plan 02 D-04). Falls back to req.ip
          // purely as defense-in-depth.
          keyGenerator: (req) => req.user?.id ?? req.ip,
        },
      },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown already.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        // Manual zod parse so ZodError → centralized 400 envelope.
        const body = WebSearchRequestSchema.parse(req.body);

        if (!provider.isConfigured()) {
          // Per-provider 503 envelope. Pitfall #8 — NEVER 401.
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
          return reply.code(503).send({
            error: `${label} not configured (set ${envVarName} in .env)`,
          });
        }

        let result: { results: Array<{ title: string; url: string; snippet: string }> };
        try {
          result = await provider.search(body.query, body.numResults);
        } catch (e) {
          if (e instanceof MissingProviderKeyError) {
            return reply.code(503).send({ error: e.message });
          }
          if (e instanceof UpstreamError) {
            req.log.warn(
              { provider: provider.name, message: e.message },
              "web-search upstream failure",
            );
            return reply.code(502).send({ error: "web-search upstream failed" });
          }
          throw e;
        }

        // D-06 — ledger debit. units=1 per call; kind carries the provider
        // name so cross-kind SUM in /api/usage (D-14) attributes correctly.
        const tenantId = req.tenant;
        const userId = req.user.id;
        const requestId = req.id;
        const ledgerKind = `web-search.${provider.name}`;
        try {
          await withTenant(deps.db, tenantId, async (tx) => {
            await tx.execute(sql`
              INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
              VALUES (${tenantId}::uuid, ${userId}::uuid, ${requestId}, ${ledgerKind}, 1)
              ON CONFLICT (request_id) DO NOTHING
            `);
          });
        } catch (e) {
          // Ledger failure must not deny the user their results — the
          // search is already paid for upstream. Log but return success.
          req.log.warn(
            { provider: provider.name, requestId, err: (e as Error).message },
            "usage_ledger insert failed; continuing",
          );
        }

        return reply.code(200).send(result);
      },
    });
  };

// Re-export the registry helpers so apps/api/src/index.ts boot path
// can call resolveWebSearchProvider() at startup for D-02 fail-fast
// (registering this route already calls it; the re-export is purely
// for symmetry with other modules' boot patterns).
export { resolveWebSearchProvider, webSearchRegistry };

export default buildWebSearchRoutes;
