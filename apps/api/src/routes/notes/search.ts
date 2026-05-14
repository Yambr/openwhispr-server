// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 3 — POST /api/notes/search (WIRE-22).
//
// Wire shape (matches ~/openwhispr/src/services/NotesService.ts.search):
//   Request:  { query: string (1..256), limit?: number }
//   Success:  200 { notes: SearchResult[] }   (SearchResult = CloudNote + score)
//   400:      empty/blank query (Pitfall #3)
//
// D-26 upgrade per RESEARCH § Pattern 3:
//   Use `websearch_to_tsquery('simple', $1)` rather than the original
//   D-26's `plainto_tsquery`. Rationale:
//     * websearch_to_tsquery NEVER raises syntax errors on user input
//       — operators (parens, quotes, OR, -) are handled gracefully or
//       ignored. plainto_tsquery preserves them as literal terms, which
//       degrades to "no matches" on perfectly reasonable queries like
//       `"quarterly roadmap"`.
//     * T-05-03 (tsquery injection) — websearch_to_tsquery sanitizes by
//       contract; no `to_tsquery` raw-input path exists in this route.
//
// Ordering: ts_rank(content_search, query) DESC, created_at DESC.
// content_search is the tsvector GENERATED column on (title, content)
// indexed with GIN (notes_content_search_idx).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, ValidationError } from "../../errors.js";
import { type CloudNoteRow, rowToCloudNote } from "./shape.js";

const SearchRequestSchema = z
  .object({
    query: z.string().min(1).max(256),
    limit: z.number().int().positive().optional(),
  })
  .strict();

interface SearchRow extends CloudNoteRow {
  score: number | string;
}

export interface NotesSearchDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildNotesSearchRoutes = (deps: NotesSearchDeps) =>
  async function notesSearchRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/notes/search",
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        // Pre-check trimmed length BEFORE the zod parse — a whitespace-
        // only string (`"   "`) is technically `min(1)` valid but
        // semantically empty. Pitfall #3.
        const rawBody = (req.body ?? {}) as { query?: unknown };
        if (typeof rawBody.query === "string" && rawBody.query.trim().length < 1) {
          throw new ValidationError("QUERY_REQUIRED", "query must be non-empty");
        }
        const body = SearchRequestSchema.parse(req.body);
        const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          // websearch_to_tsquery('simple', $1) — RESEARCH upgrade of D-26.
          // ts_rank(content_search, query) AS score per upstream
          // SearchResult interface.
          const result = (await tx.execute(sql`
            SELECT n.*, ts_rank(n.content_search, q) AS score
              FROM "notes" n,
                   websearch_to_tsquery('simple', ${body.query}) AS q
             WHERE n."user_id" = ${userId}::uuid
               AND n."deleted_at" IS NULL
               AND n.content_search @@ q
          ORDER BY score DESC, n.created_at DESC
             LIMIT ${limit}
          `)) as { rows?: SearchRow[] };
          return result.rows ?? [];
        });

        return reply.code(200).send({
          notes: rows.map((row) => ({
            ...rowToCloudNote(row),
            score: typeof row.score === "number" ? row.score : Number(row.score ?? 0),
          })),
        });
      },
    });
  };

export default buildNotesSearchRoutes;
