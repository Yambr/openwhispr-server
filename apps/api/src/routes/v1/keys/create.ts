// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 09 / Task 2 — POST /api/v1/keys/create (WIRE-27).
//
// Wire shape (matches ~/openwhispr/src/services/ApiKeysService.ts.create):
//   Request:  { name: string, scopes?: string[], expiresInDays?: number | null }
//   Success:  200 { data: CreateApiKeyResponse } — V1Response envelope D-28
//             where CreateApiKeyResponse extends ApiKey with `key: pak_*`
//             (the clear-text PAK, returned EXACTLY ONCE per D-29).
//
// D-29 — clear-text PAK NEVER persisted. Storage: only `key_prefix`
//        (12-char non-secret lookup tag) + `key_hash` (Argon2id digest)
//        + metadata. Subsequent /list calls expose `key_prefix` only.
// D-28 — response envelope is `{ data: T }` per the V1Response convention
//        (distinct from the rest of Phase 5 which returns the resource
//        directly).
// T-05-02 / T-05-DOS — rate-limit 5/hour/user on /create. Argon2id at
//        m=64MiB/t=3/p=1 is intentionally CPU-expensive; the per-user
//        keyGenerator + tight window prevents flood-driven CPU saturation.
//        @node-rs/argon2 dispatches the hash onto the NAPI tokio
//        threadpool (Pitfall #5) so a single create call does NOT block
//        Fastify's event loop.
// D-30 — same-tenant duplicate active name → 409 envelope (relies on
//        the partial UNIQUE INDEX api_keys_active_name_idx from Plan 01
//        on (tenant_id, name) WHERE revoked_at IS NULL).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, ConflictError } from "../../../errors.js";
import { generatePak, hashKey } from "../../../lib/argon2-keys.js";
import { auditCtxFromRequest, recordAudit } from "../../../lib/audit.js";
import { type ApiKeyRow, rowToApiKey } from "./list.js";

export interface KeysCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

// Body schema mirrors upstream CreateApiKeyOptions. `name` non-empty;
// `scopes` defaults to []; `expiresInDays` maps to an absolute
// `expires_at` timestamp before insert. `.strict()` rejects accidental
// `key` / `key_hash` injection from a confused client.
const CreateBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    scopes: z.array(z.string().min(1).max(120)).max(64).optional(),
    expiresInDays: z.number().int().positive().max(3650).nullable().optional(),
  })
  .strict();

function computeExpiresAt(days: number | null | undefined): Date | null {
  if (days === null || days === undefined) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export const buildKeysCreateRoutes = (deps: KeysCreateDeps) =>
  async function keysCreateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/v1/keys/create",
      config: {
        // T-05-DOS mitigation — 5/hour/user. Per-user keyGenerator so a
        // single tenant cannot starve another's create budget via IP
        // collisions behind a shared NAT.
        rateLimit: {
          max: 5,
          timeWindow: "1 hour",
          keyGenerator: (req) => req.user?.id ?? req.ip,
        },
      },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const userId = req.user.id;

        const body = CreateBodySchema.parse(req.body ?? {});
        const scopesArr = body.scopes ?? [];
        // PG array literal: ARRAY['a', 'b']::text[] — drizzle's sql template
        // would otherwise expand a JS array as varargs ($6, $7, ...), which
        // doesn't compose with ::text[] cast. Use sql.join() to interpolate
        // each element as its own parameter inside an explicit ARRAY[] form.
        const scopesSql = scopesArr.length
          ? sql`ARRAY[${sql.join(
              scopesArr.map((s) => sql`${s}`),
              sql`, `,
            )}]::text[]`
          : sql`ARRAY[]::text[]`;
        const expiresAt = computeExpiresAt(body.expiresInDays);

        // Generate PAK + Argon2id hash BEFORE entering the transaction.
        // Hashing is the expensive step (~100ms at m=64MiB/t=3/p=1) and
        // we don't want to hold an open DB connection for the duration.
        const { clearText, prefix } = generatePak();
        const keyHash = await hashKey(clearText);

        let row: ApiKeyRow;
        try {
          row = await withTenant(deps.db, tenantId, async (tx) => {
            const result = (await tx.execute(sql`
              INSERT INTO "api_keys" (
                "tenant_id", "user_id", "name",
                "key_prefix", "key_hash",
                "scopes", "expires_at"
              ) VALUES (
                ${tenantId}::uuid, ${userId}::uuid, ${body.name},
                ${prefix}, ${keyHash},
                ${scopesSql}, ${expiresAt}
              )
              RETURNING "id", "name", "key_prefix", "scopes",
                        "last_used_at", "expires_at", "created_at", "revoked_at"
            `)) as { rows?: ApiKeyRow[] };
            const inserted = result.rows?.[0];
            if (!inserted) {
              throw new Error("api_keys insert returned no row");
            }
            // Phase 6 / Plan 05 / Task 2 — emit canonical D-A6 #8
            // `key.issued` audit row inside the same tx so the audit
            // log exists iff the api_keys INSERT commits. D-A7 forbids
            // raw key material — we emit only the `key_id` (the
            // api_keys.id UUID) which is non-secret. The clear-text
            // PAK + key_hash never reach the audit payload.
            await recordAudit(tx, auditCtxFromRequest(req, tenantId, userId), "key.issued", {
              key_id: inserted.id,
            });
            return inserted;
          });
        } catch (err) {
          // D-30 — partial UNIQUE (tenant_id, name) WHERE revoked_at IS
          // NULL collision → 409. `code: '23505'` is the Postgres
          // unique_violation SQLSTATE.
          // drizzle wraps pg errors in DrizzleQueryError; the original
          // pg SQLSTATE lives on `.cause.code` (or `.code` if not wrapped).
          const raw = err as { code?: string; cause?: { code?: string } } | null;
          const sqlState = raw?.code ?? raw?.cause?.code;
          if (sqlState === "23505") {
            throw new ConflictError("API_KEY_NAME_TAKEN", "api key with that name already exists");
          }
          throw err;
        }

        const wire = rowToApiKey(row);
        // D-28 envelope + D-29 clear-text-once. `key` field surfaces the
        // raw PAK exactly here; subsequent /list calls NEVER include it.
        return reply.code(200).send({ data: { ...wire, key: clearText } });
      },
    });
  };

export default buildKeysCreateRoutes;
