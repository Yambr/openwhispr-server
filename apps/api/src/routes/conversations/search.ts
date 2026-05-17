// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 07 / Task 1 — POST /api/conversations/search (WIRE-24).
//
// Wire shape (matches ConversationsService.search):
//   Request:  { query: string (1..256), limit?: number }
//   Success:  200 { conversations: SearchResult[] }
//             where SearchResult = CloudConversation + score
//
// Per Plan 07 must_haves: response key is `conversations` (PLURAL,
// matching upstream `{ conversations: CloudConversation[] }`). The
// `score` field is added per CloudConversation + score per plan's
// must_have row.
//
// websearch_to_tsquery('simple', $1) per RESEARCH § Pattern 3 — never
// raises on operator-laden user input (T-05-03).
// ts_rank against the GIN-indexed content_search column (over title)
// from Plan 01.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, ValidationError } from "../../errors.js";
import { type CloudConversationRow, rowToCloudConversation } from "./shape.js";

const SearchRequestSchema = z
  .object({
    query: z.string().min(1).max(256),
    limit: z.number().int().positive().optional(),
  })
  .strict();

interface SearchRow extends CloudConversationRow {
  score: number | string;
}

export interface ConversationsSearchDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildConversationsSearchRoutes = (deps: ConversationsSearchDeps) =>
  async function conversationsSearchRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/conversations/search",
      // Plan 51-12c — schema:body for LOCKER-04.
      schema: { body: SearchRequestSchema },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        // Pitfall #3 — trim-blank pre-check.
        const rawBody = (req.body ?? {}) as { query?: unknown };
        if (typeof rawBody.query === "string" && rawBody.query.trim().length < 1) {
          throw new ValidationError("QUERY_REQUIRED", "query must be non-empty");
        }
        const body = SearchRequestSchema.parse(req.body);
        const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            SELECT c.*, ts_rank(c.content_search, q) AS score
              FROM "conversations" c,
                   websearch_to_tsquery('simple', ${body.query}) AS q
             WHERE c."user_id" = ${userId}::uuid
               AND c."deleted_at" IS NULL
               AND c.content_search @@ q
          ORDER BY score DESC, c.created_at DESC
             LIMIT ${limit}
          `)) as { rows?: SearchRow[] };
          return result.rows ?? [];
        });

        return reply.code(200).send({
          conversations: rows.map((row) => ({
            ...rowToCloudConversation(row),
            score: typeof row.score === "number" ? row.score : Number(row.score ?? 0),
          })),
        });
      },
    });
  };

export default buildConversationsSearchRoutes;
