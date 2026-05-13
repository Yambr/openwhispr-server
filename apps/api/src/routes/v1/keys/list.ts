// Phase 05 / Plan 09 / Task 2 — GET /api/v1/keys/list (WIRE-27).
//
// Wire shape (matches ~/openwhispr/src/services/ApiKeysService.ts.list):
//   Request:  GET /api/v1/keys/list (no body)
//   Success:  200 { data: { keys: ApiKey[] } } — V1Response envelope (D-28)
//
// `ApiKey` SHAPE deliberately OMITS the clear-text `key` field AND the
// stored `key_hash`. Only `key_prefix` is surfaced after creation
// (D-29). The CreateApiKeyResponse on POST /create is the ONLY surface
// that ever returns clear text (T-KEY-LEAK mitigation).
//
// Soft-revoke semantics (D-29): revoked rows REMAIN in the list, with
// `revoked_at` populated. Desktop UI can render "revoked at <ISO>" via
// the same row shape. This mirrors upstream ApiKeysService.list.
//
// All DB activity under withTenant(deps.db, tenantId, ...) so FORCE-RLS
// is in force (tenant_id GUC bound for the transaction). Cross-tenant
// invisibility is guaranteed by the api_keys_isolation RLS policy from
// Plan 01 migration 0010 (T-05-07 mitigation).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../../../errors.js";

export interface KeysListDeps {
  db: TransactionalDb<ExecutableTx>;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  revoked_at: Date | string | null;
}

interface ApiKeyWire {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

function toIso(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

export function rowToApiKey(row: ApiKeyRow): ApiKeyWire {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes: row.scopes ?? [],
    last_used_at: toIso(row.last_used_at),
    expires_at: toIso(row.expires_at),
    // created_at is NOT NULL in the schema so the toIso() coercion is
    // always defined; the `??` keeps the type-checker happy if a stale
    // ROW arrives without created_at (defense in depth).
    created_at: toIso(row.created_at) ?? new Date(0).toISOString(),
    revoked_at: toIso(row.revoked_at),
  };
}

export const buildKeysListRoutes = (deps: KeysListDeps) =>
  async function keysListRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/v1/keys/list",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const userId = req.user.id;

        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          // Explicit column list — NEVER include key_hash on the wire.
          // T-KEY-LEAK mitigation surface: this query is the single
          // emission point for the list shape.
          const result = (await tx.execute(sql`
            SELECT "id", "name", "key_prefix", "scopes",
                   "last_used_at", "expires_at", "created_at", "revoked_at"
              FROM "api_keys"
             WHERE "user_id" = ${userId}::uuid
             ORDER BY "created_at" DESC, "id" DESC
          `)) as { rows?: ApiKeyRow[] };
          return result.rows ?? [];
        });

        // V1Response envelope per D-28: { data: { keys: ApiKey[] } }.
        return reply.code(200).send({ data: { keys: rows.map(rowToApiKey) } });
      },
    });
  };

export default buildKeysListRoutes;
