// Phase 05 / Plan 04 / Task 2 — GET /api/stt-config (WIRE-11).
//
// Wire shape: BACKEND_SPEC.md:438.
//   200 OK -> { defaultModel: string, defaultLanguage: string,
//              availableProviders: string[] }
//   401    -> { error: string } (centralized envelope)
//
// Behavior:
//   1. Dual-auth (Bearer or cookie) is enforced at the app level by
//      `dualAuthHook` (Phase 2). Defensive 401 here when `req.user`/
//      `req.tenant` are missing — matches every other DB-touching
//      route's defensive guard.
//   2. Inside `withTenant(deps.db, tenantId, …)` we call
//      `resolveSttConfig(tx, tenantId, userId)` which runs two
//      parallel SELECTs (tenant_settings + user_settings) under the
//      app.tenant_id GUC — so cross-tenant settings are invisible
//      (RLS isolation policies from Plan 01).
//   3. `availableProviders` is computed at request time from
//      OPENAI_API_KEY / GROQ_API_KEY / ASSEMBLYAI_API_KEY /
//      DEEPGRAM_API_KEY presence (D-19). The settings tables never
//      gate this list.
//
// Per D-31 this is READ-only in v1; mutations land in Phase 7.
//
// Registered UNCONDITIONALLY in routes/index.ts (Pitfall #6 — DB-only,
// no LiteLLM gate). Same rate-limit budget as the rest of the
// operational surface.

import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../errors.js";
import { resolveSttConfig } from "../lib/settings-resolver.js";

export interface SttConfigDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildSttConfigRoutes = (deps: SttConfigDeps) =>
  async function sttConfigRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/stt-config",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const userId = req.user.id;
        const body = await withTenant(deps.db, tenantId, (tx) =>
          resolveSttConfig(tx, tenantId, userId),
        );
        return reply.code(200).send(body);
      },
    });
  };

export default buildSttConfigRoutes;
