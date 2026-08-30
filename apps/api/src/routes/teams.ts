// SPDX-License-Identifier: FSL-1.1-ALv2
// Teams — who may open a space.
//
// A team here is a named list of colleagues, nothing more. Upstream wraps teams
// in invitations and seat accounting; in a corporate install every identity is
// already vetted by the directory, so adding somebody is picking a person who
// has signed in, and there is nobody to invite and nothing to buy.
//
// ANY employee may create a team. The alternative — admins only — means shared
// notes move at the speed of a ticket queue, which is the failure mode this
// feature exists to remove. The creator becomes an admin MEMBER of their own
// team immediately, because otherwise they would need somebody already inside
// it to let them in, and there is nobody.
//
// `ad_group` is written by nothing yet. Binding a team to a directory group is
// the next step; the column is here so that step needs no migration.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from "../errors.js";
import { slugify, uniqueSlug } from "../lib/slug.js";

export interface TeamsDeps {
  db: TransactionalDb<ExecutableTx>;
}

const NAME_MAX = 256;

const WorkspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();
const TeamParams = z.object({ teamId: z.string().uuid() }).strict();
const TeamMemberParams = z
  .object({ teamId: z.string().uuid(), userId: z.string().uuid() })
  .strict();

const TeamCreateBody = z
  .object({
    name: z.string().min(1).max(NAME_MAX),
    description: z.string().max(NAME_MAX).nullish(),
    emoji: z.string().max(16).nullish(),
  })
  .strict();

const TeamMemberAddBody = z
  .object({
    user_id: z.string().uuid(),
    role: z.enum(["admin", "member"]).optional(),
  })
  .strict();

export interface Team {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
  email: string;
  name: string | null;
  image: string | null;
}

function iso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
}

/**
 * There is exactly one workspace — the tenant. A different id is a stale client
 * or someone probing; either way it must not reach an insert, and 404 is the
 * honest answer for a workspace that does not exist here.
 */
function assertWorkspaceIsTenant(workspaceId: string, tenantId: string): void {
  if (workspaceId !== tenantId) {
    throw new NotFoundError("WORKSPACE_NOT_FOUND", "workspace not found");
  }
}

type Tx = { execute(query: ReturnType<typeof sql>): Promise<unknown> };

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await tx.execute(query)) as { rows?: T[] };
  return result.rows ?? [];
}

/** Managing a team's roster requires being an admin OF that team. */
async function assertTeamAdmin(tx: Tx, userId: string, teamId: string): Promise<void> {
  const found = await rows<{ role: string }>(
    tx,
    sql`SELECT tm."role"
          FROM "team_members" tm
          JOIN "teams" t ON t."id" = tm."team_id" AND t."deleted_at" IS NULL
         WHERE tm."team_id" = ${teamId}::uuid AND tm."user_id" = ${userId}::uuid
         LIMIT 1`,
  );
  // A team you are not in is indistinguishable from one that does not exist —
  // outsiders do not get to enumerate teams by probing for 403 vs 404.
  if (found.length === 0) {
    throw new NotFoundError("TEAM_NOT_FOUND", "team not found");
  }
  if (found[0]?.role !== "admin") {
    throw new ForbiddenError("TEAM_FORBIDDEN", "team admin required");
  }
}

export const buildTeamsRoutes = (deps: TeamsDeps) =>
  async function teamsRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/workspaces/:workspaceId/teams",
      schema: { params: WorkspaceParams },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const { workspaceId } = WorkspaceParams.parse(req.params);
        assertWorkspaceIsTenant(workspaceId, tenantId);

        const listed = await withTenant(deps.db, tenantId, async (tx) =>
          rows<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            emoji: string | null;
            member_count: string | number;
            created_at: Date | string;
            updated_at: Date | string;
          }>(
            tx,
            sql`SELECT t."id", t."name", t."slug", t."description", t."emoji",
                       t."created_at", t."updated_at",
                       (SELECT count(*) FROM "team_members" m WHERE m."team_id" = t."id")
                         AS "member_count"
                  FROM "teams" t
                 WHERE t."deleted_at" IS NULL
                 ORDER BY t."name" ASC`,
          ),
        );

        const data: Team[] = listed.map((t) => ({
          id: t.id,
          workspace_id: tenantId,
          name: t.name,
          slug: t.slug,
          description: t.description ?? null,
          emoji: t.emoji ?? null,
          member_count: Number(t.member_count ?? 0),
          created_at: iso(t.created_at),
          updated_at: iso(t.updated_at),
        }));
        reply.header("Cache-Control", "no-store");
        return reply.send({ data });
      },
    });

    app.route({
      method: "POST",
      url: "/api/workspaces/:workspaceId/teams",
      schema: { params: WorkspaceParams, body: TeamCreateBody },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { workspaceId } = WorkspaceParams.parse(req.params);
        assertWorkspaceIsTenant(workspaceId, tenantId);
        const body = TeamCreateBody.parse(req.body);

        const created = await withTenant(deps.db, tenantId, async (tx) => {
          const taken = new Set(
            (
              await rows<{ slug: string }>(
                tx,
                sql`SELECT "slug" FROM "teams" WHERE "deleted_at" IS NULL`,
              )
            ).map((r) => r.slug),
          );
          const slug = uniqueSlug(slugify(body.name, "team"), taken);

          const inserted = await rows<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            emoji: string | null;
            created_at: Date | string;
            updated_at: Date | string;
          }>(
            tx,
            sql`INSERT INTO "teams"
                  ("tenant_id", "name", "slug", "description", "emoji", "created_by_user_id")
                VALUES (${tenantId}::uuid, ${body.name}, ${slug},
                        ${body.description ?? null}, ${body.emoji ?? null}, ${userId}::uuid)
                RETURNING *`,
          );
          const team = inserted[0];
          if (!team) throw new ValidationError("TEAM_NOT_CREATED", "team could not be created");

          // The creator joins as an admin in the same transaction: a team whose
          // only possible admin is not in it cannot be administered at all.
          await tx.execute(sql`
            INSERT INTO "team_members" ("tenant_id", "team_id", "user_id", "role")
            VALUES (${tenantId}::uuid, ${team.id}::uuid, ${userId}::uuid, 'admin')
          `);
          return team;
        });

        const data: Team = {
          id: created.id,
          workspace_id: tenantId,
          name: created.name,
          slug: created.slug,
          description: created.description ?? null,
          emoji: created.emoji ?? null,
          member_count: 1,
          created_at: iso(created.created_at),
          updated_at: iso(created.updated_at),
        };
        return reply.code(201).send({ data });
      },
    });

    app.route({
      method: "GET",
      url: "/api/teams/:teamId/members",
      schema: { params: TeamParams },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { teamId } = TeamParams.parse(req.params);

        const listed = await withTenant(deps.db, tenantId, async (tx) => {
          // Only members see a roster. A team you are not in reads as absent.
          const mine = await rows<{ role: string }>(
            tx,
            sql`SELECT "role" FROM "team_members"
                 WHERE "team_id" = ${teamId}::uuid AND "user_id" = ${userId}::uuid LIMIT 1`,
          );
          if (mine.length === 0) throw new NotFoundError("TEAM_NOT_FOUND", "team not found");

          return rows<{
            user_id: string;
            role: string;
            joined_at: Date | string;
            email: string;
            name: string | null;
          }>(
            tx,
            sql`SELECT tm."user_id", tm."role", tm."joined_at", u."email", u."name"
                  FROM "team_members" tm
                  JOIN "users" u ON u."id" = tm."user_id"
                 WHERE tm."team_id" = ${teamId}::uuid
                 ORDER BY u."email" ASC`,
          );
        });

        const data: TeamMember[] = listed.map((m) => ({
          user_id: m.user_id,
          role: m.role === "admin" ? "admin" : "member",
          joined_at: iso(m.joined_at),
          email: m.email,
          name: m.name ?? null,
          // No avatar storage here; the field exists because the client reads it.
          image: null,
        }));
        reply.header("Cache-Control", "no-store");
        return reply.send({ data });
      },
    });

    app.route({
      method: "POST",
      url: "/api/teams/:teamId/members",
      schema: { params: TeamParams, body: TeamMemberAddBody },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { teamId } = TeamParams.parse(req.params);
        const body = TeamMemberAddBody.parse(req.body);

        await withTenant(deps.db, tenantId, async (tx) => {
          await assertTeamAdmin(tx, userId, teamId);
          // The tenant guard is RLS's job for the row itself, but a user id
          // from another tenant would insert a dangling grant, so check it.
          const target = await rows<{ id: string }>(
            tx,
            sql`SELECT "id" FROM "users" WHERE "id" = ${body.user_id}::uuid LIMIT 1`,
          );
          if (target.length === 0) throw new NotFoundError("USER_NOT_FOUND", "user not found");

          // Re-adding an existing member updates their role rather than 409ing:
          // the client's roster UI treats this as "set membership".
          await tx.execute(sql`
            INSERT INTO "team_members" ("tenant_id", "team_id", "user_id", "role")
            VALUES (${tenantId}::uuid, ${teamId}::uuid, ${body.user_id}::uuid,
                    ${body.role ?? "member"})
            ON CONFLICT ("team_id", "user_id") DO UPDATE SET "role" = EXCLUDED."role"
          `);
        });

        return reply.code(201).send({ data: { ok: true } });
      },
    });

    app.route({
      method: "DELETE",
      url: "/api/teams/:teamId/members/:userId",
      schema: { params: TeamMemberParams },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const callerId = req.user.id;
        const params = TeamMemberParams.parse(req.params);

        await withTenant(deps.db, tenantId, async (tx) => {
          await assertTeamAdmin(tx, callerId, params.teamId);
          await tx.execute(sql`
            DELETE FROM "team_members"
             WHERE "team_id" = ${params.teamId}::uuid AND "user_id" = ${params.userId}::uuid
          `);
        });

        return reply.code(204).send();
      },
    });

    app.route({
      method: "DELETE",
      url: "/api/teams/:teamId",
      schema: { params: TeamParams },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { teamId } = TeamParams.parse(req.params);

        await withTenant(deps.db, tenantId, async (tx) => {
          await assertTeamAdmin(tx, userId, teamId);
          // Soft delete: the team's assignments stop conveying access because
          // every join filters `deleted_at IS NULL`, but the audit trail of who
          // could reach what survives.
          await tx.execute(sql`
            UPDATE "teams" SET "deleted_at" = now(), "updated_at" = now()
             WHERE "id" = ${teamId}::uuid AND "deleted_at" IS NULL
          `);
        });

        return reply.code(204).send();
      },
    });
  };

export default buildTeamsRoutes;
