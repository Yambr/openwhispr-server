// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 02 / Task 2 — GET /api/usage (WIRE-10).
//
// Wire shape: BACKEND_SPEC.md:416-435.
//
// Behavior:
//   1. Dual-auth (Bearer or cookie) — reuse Phase 2 hook. Defensive 401
//      in handler when `req.user`/`req.tenant` missing.
//   2. Inside `withTenant(deps.db, tenantId, …)`:
//        SELECT COALESCE(SUM(units), 0) FROM usage_ledger
//          WHERE user_id = ${userId}
//      All ledger `kind` values (transcribe_minutes, reason_tokens,
//      streaming-stt, web-search.tavily, web-search.yandex) contribute
//      to `wordsUsed` (D-14). RLS restricts the SUM to the current
//      tenant via the app.tenant_id GUC set by withTenant.
//   3. Response: `{wordsUsed, wordsRemaining: 999_999_999, plan:
//      'unlimited', limitReached: false, isSubscribed: true,
//      isTrial: false}` per D-12/D-15. R34 — `isSubscribed`/`isTrial`
//      are read by the immutable desktop client's useUsage hook;
//      SyncService.canSync() gates cloud sync on `isSubscribed`.

import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../errors.js";

export interface UsageDeps {
  db: TransactionalDb<ExecutableTx>;
}

const UNLIMITED_REMAINING = 999_999_999;

interface SumRow {
  words_used: string | number | null;
}

export const buildUsageRoutes = (deps: UsageDeps) =>
  async function usageRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/usage",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        const tenantId = req.tenant;
        const userId = req.user.id;

        let wordsUsed = 0;
        await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            SELECT COALESCE(SUM(units), 0)::bigint AS words_used
            FROM usage_ledger
            WHERE user_id = ${userId}::uuid
          `)) as { rows?: SumRow[] };
          const sumRow = result.rows?.[0];
          if (sumRow) {
            const raw = sumRow.words_used;
            wordsUsed = typeof raw === "number" ? raw : raw == null ? 0 : Number(raw);
          }
        });

        return reply.code(200).send({
          wordsUsed,
          wordsRemaining: UNLIMITED_REMAINING,
          plan: "unlimited" as const,
          limitReached: false as const,
          // R34 — the immutable desktop client's useUsage hook reads
          // `isSubscribed` / `isTrial` and SyncService.canSync() gates
          // cloud sync of transcriptions/notes/conversations on
          // `isSubscribed`. The v1 corporate `unlimited` plan is a
          // fully-entitled, non-trial plan, so it always reports
          // subscribed. Without these fields the client coerces a
          // missing value to `false` and cloud sync never starts.
          isSubscribed: true as const,
          isTrial: false as const,
        });
      },
    });
  };

export default buildUsageRoutes;
