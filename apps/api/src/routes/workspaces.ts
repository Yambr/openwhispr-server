// SPDX-License-Identifier: FSL-1.1-ALv2
// GET /api/workspaces and GET /api/me/joinable — workspace bootstrap.
//
// Upstream models an organization as a self-service SaaS workspace: a user
// creates one, invites colleagues by email, buys seats, and other people ask to
// join it. None of that maps onto a corporate install, where the tenant IS the
// company and identities arrive from the directory — there is nothing to found,
// nothing to buy, and nobody to admit.
//
// The desktop still bootstraps through these two endpoints once its team-space
// capability flag is on (GET /api/me/spaces answering 200), so leaving them
// 404 costs a steady error stream and leaves workspaceStore parked in its
// error state. Both therefore answer honestly rather than being stubbed:
//
//   * /api/workspaces — the tenant, described as the one workspace it is.
//   * /api/me/joinable — empty, because joining is not an action a user takes
//     here; membership follows the directory.
//
// Billing fields are nulls and zero seats. The fork strips the billing UI
// entirely (BILLING_ENABLED=false), and a fabricated plan would be the
// client's only source of truth about something that does not exist here.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "../errors.js";

export interface WorkspacesDeps {
  db: TransactionalDb<ExecutableTx>;
}

/**
 * A workspace as the desktop expects it (`DataWrap<Workspace[]>`, see the
 * upstream `Workspace` interface in src/types/electron.ts).
 */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_by_user_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  seats: number;
  seats_used: number;
  created_at: string;
  updated_at: string;
  role: "owner" | "admin" | "member";
}

interface TenantRow {
  id: string;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function iso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
}

/** Lowercase, hyphenated, ASCII-safe — the desktop uses it only as a key. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A tenant named entirely in non-Latin characters slugifies to nothing;
  // "workspace" keeps the field non-empty without pretending to transliterate.
  return slug.length > 0 ? slug : "workspace";
}

export const buildWorkspacesRoutes = (deps: WorkspacesDeps) =>
  async function workspacesRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/workspaces",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;

        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            SELECT "id", "name", "created_at", "updated_at"
              FROM "tenants"
             WHERE "id" = ${tenantId}::uuid
          `)) as { rows?: TenantRow[] };
          return result.rows ?? [];
        });

        const tenant = rows[0];
        // The caller is authenticated INTO this tenant, so a missing row means
        // the tenant was deleted mid-session. An empty list is the truthful
        // answer; inventing a workspace would be worse.
        const data: Workspace[] = tenant
          ? [
              {
                id: tenant.id,
                name: tenant.name,
                slug: slugify(tenant.name),
                // Nobody "created" the tenant through this API — it is
                // provisioned by the deployment.
                created_by_user_id: null,
                stripe_customer_id: null,
                stripe_subscription_id: null,
                plan: "self-hosted",
                status: "active",
                trial_ends_at: null,
                current_period_end: null,
                cancel_at_period_end: false,
                seats: 0,
                seats_used: 0,
                created_at: iso(tenant.created_at),
                updated_at: iso(tenant.updated_at),
                // Gates the workspace-management UI
                // (spacePermissions.canManageWorkspace → owner|admin). There
                // are no team or space endpoints yet, so advertising management
                // rights would surface buttons whose every action 404s. This
                // becomes "admin" in the change that ships those endpoints.
                role: "member",
              },
            ]
          : [];

        reply.header("Cache-Control", "no-store");
        return reply.send({ data });
      },
    });

    app.route({
      method: "GET",
      url: "/api/me/joinable",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        reply.header("Cache-Control", "no-store");
        return reply.send({ data: [] });
      },
    });
  };

export default buildWorkspacesRoutes;
