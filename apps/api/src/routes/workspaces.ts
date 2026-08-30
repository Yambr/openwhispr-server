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
import { z } from "zod";
import { AuthError, NotFoundError } from "../errors.js";
import { slugify } from "../lib/slug.js";

const WorkspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();

/** Colleagues offered by the team-roster picker. */
export interface WorkspaceMember {
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  email: string;
  name: string | null;
  image: string | null;
}

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

interface WorkspaceUserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: Date | string;
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

// Shared with teams and spaces, which need the same rules — see lib/slug.ts.
export { slugify };

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
                // (spacePermissions.canManageWorkspace → owner|admin). Every
                // employee may create a team and a space here, so every
                // employee gets the management surface — the per-space and
                // per-team checks are what actually decide who may change
                // WHAT, in teams.ts and spaces.ts.
                role: "admin",
              },
            ]
          : [];

        reply.header("Cache-Control", "no-store");
        return reply.send({ data });
      },
    });

    app.route({
      method: "GET",
      url: "/api/workspaces/:workspaceId/members",
      schema: { params: WorkspaceParams },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const { workspaceId } = WorkspaceParams.parse(req.params);
        // Exactly one workspace exists here; a different id is a stale client
        // or someone probing, and neither should get a colleague list back.
        if (workspaceId !== tenantId) {
          throw new NotFoundError("WORKSPACE_NOT_FOUND", "workspace not found");
        }

        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          // Everyone in the tenant, because the tenant IS the company and the
          // directory already vetted every one of them. Deliberately narrow:
          // this is a picker an ordinary employee calls, so it returns what the
          // roster UI renders and nothing more — widening it later should be a
          // decision, not a side effect.
          const result = (await tx.execute(sql`
            SELECT "id", "email", "name", "created_at"
              FROM "users"
             ORDER BY "email" ASC
          `)) as { rows?: WorkspaceUserRow[] };
          return result.rows ?? [];
        });

        const data: WorkspaceMember[] = rows.map((u) => ({
          user_id: u.id,
          // Membership of the single workspace is not graded here; who may
          // change a given team or space is decided per-object in teams.ts and
          // spaces.ts.
          role: "member",
          joined_at: iso(u.created_at),
          email: u.email,
          name: u.name ?? null,
          // No avatar storage; the field exists because the client reads it.
          image: null,
        }));

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
