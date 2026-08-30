// SPDX-License-Identifier: FSL-1.1-ALv2
// Spaces — the shared tree of notes and folders itself.
//
// ANY employee may create one (see teams.ts for why), and the creator manages
// what they created: `spaces.created_by_user_id` confers admin directly, so
// nobody has to be made an admin of some team first just to rename their own
// space.
//
// The invariant worth stating out loud: YOU CANNOT CREATE A SPACE YOU CANNOT
// SEE. Naming only teams you are not in would produce a space that vanishes
// from your own list the moment it exists — a silent self-lockout with no error
// anywhere. That is a 400, because the request is genuinely malformed: it asks
// for something nobody wanted.
//
// Reading and writing the CONTENT of a space is not decided here — that is
// lib/space-scope.ts, applied by the notes and folders routes.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from "../errors.js";
import { slugify, uniqueSlug } from "../lib/slug.js";

export interface SpacesDeps {
  db: TransactionalDb<ExecutableTx>;
}

const NAME_MAX = 256;

const WorkspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();
const SpaceParams = z.object({ spaceId: z.string().uuid() }).strict();
const SpaceTeamParams = z
  .object({ spaceId: z.string().uuid(), teamId: z.string().uuid() })
  .strict();

const SpaceCreateBody = z
  .object({
    name: z.string().min(1).max(NAME_MAX),
    description: z.string().max(NAME_MAX).nullish(),
    emoji: z.string().max(16).nullish(),
    team_ids: z.array(z.string().uuid()),
  })
  .strict();

const SpaceUpdateBody = z
  .object({
    name: z.string().min(1).max(NAME_MAX).optional(),
    description: z.string().max(NAME_MAX).nullish(),
    emoji: z.string().max(16).nullish(),
  })
  .strict();

const SpaceTeamAddBody = z
  .object({
    team_id: z.string().uuid(),
    access: z.enum(["admin", "member"]).optional(),
  })
  .strict();

function iso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
}

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

/**
 * Managing a space: an admin of a team assigned with admin access — the same
 * cap the listing reports as `my_role`. The creator arm below is a FALLBACK,
 * not a parallel rule: a space whose creator has since left every assigned team
 * would otherwise have nobody able to rename or retire it.
 *
 * A space you cannot reach at all reads as absent rather than forbidden —
 * outsiders do not get to enumerate spaces by probing 403 against 404.
 */
async function assertSpaceAdmin(tx: Tx, userId: string, spaceId: string): Promise<void> {
  const found = await rows<{ is_creator: boolean; is_admin: boolean; reachable: boolean }>(
    tx,
    sql`SELECT (s."created_by_user_id" = ${userId}::uuid) AS "is_creator",
               COALESCE(bool_or(st."access" = 'admin' AND tm."role" = 'admin'), false) AS "is_admin",
               COALESCE(bool_or(tm."user_id" IS NOT NULL), false) AS "reachable"
          FROM "spaces" s
          LEFT JOIN "space_teams" st ON st."space_id" = s."id"
          LEFT JOIN "team_members" tm
            ON tm."team_id" = st."team_id" AND tm."user_id" = ${userId}::uuid
         WHERE s."id" = ${spaceId}::uuid AND s."deleted_at" IS NULL
         GROUP BY s."id", s."created_by_user_id"`,
  );
  const row = found[0];
  if (!row || (!row.is_creator && !row.reachable)) {
    throw new NotFoundError("SPACE_NOT_FOUND", "space not found");
  }
  if (!row.is_creator && !row.is_admin) {
    throw new ForbiddenError("SPACE_FORBIDDEN", "space admin required");
  }
}

export const buildSpacesRoutes = (deps: SpacesDeps) =>
  async function spacesRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/workspaces/:workspaceId/spaces",
      schema: { params: WorkspaceParams, body: SpaceCreateBody },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { workspaceId } = WorkspaceParams.parse(req.params);
        assertWorkspaceIsTenant(workspaceId, tenantId);
        const body = SpaceCreateBody.parse(req.body);

        if (body.team_ids.length === 0) {
          // A space no team can open is content nobody can reach, including
          // the person creating it.
          throw new ValidationError("SPACE_NEEDS_TEAM", "a space needs at least one team");
        }

        const created = await withTenant(deps.db, tenantId, async (tx) => {
          const teamIds = [...new Set(body.team_ids)];
          const live = await rows<{ id: string; mine: boolean }>(
            tx,
            sql`SELECT t."id",
                       (tm."user_id" IS NOT NULL) AS "mine"
                  FROM "teams" t
                  LEFT JOIN "team_members" tm
                    ON tm."team_id" = t."id" AND tm."user_id" = ${userId}::uuid
                 WHERE t."deleted_at" IS NULL
                   AND t."id" IN (${sql.join(
                     teamIds.map((id) => sql`${id}::uuid`),
                     sql`, `,
                   )})`,
          );
          if (live.length !== teamIds.length) {
            throw new NotFoundError("TEAM_NOT_FOUND", "team not found");
          }
          if (!live.some((t) => t.mine)) {
            // See the header: creating a space you cannot see is never what
            // the caller meant.
            throw new ValidationError(
              "SPACE_WOULD_BE_INVISIBLE",
              "at least one team must include you",
            );
          }

          const taken = new Set(
            (
              await rows<{ slug: string }>(
                tx,
                sql`SELECT "slug" FROM "spaces" WHERE "deleted_at" IS NULL`,
              )
            ).map((r) => r.slug),
          );
          const slug = uniqueSlug(slugify(body.name, "space"), taken);

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
            sql`INSERT INTO "spaces"
                  ("tenant_id", "name", "slug", "description", "emoji", "created_by_user_id")
                VALUES (${tenantId}::uuid, ${body.name}, ${slug},
                        ${body.description ?? null}, ${body.emoji ?? null}, ${userId}::uuid)
                RETURNING *`,
          );
          const space = inserted[0];
          if (!space) throw new ValidationError("SPACE_NOT_CREATED", "space could not be created");

          // The creator's OWN teams are assigned with admin access; other named
          // teams get member. This is what makes "the creator manages what they
          // created" fall out of the ordinary cap rule instead of needing a
          // second, parallel rule in the listing — two rules for one question
          // is how they drift apart.
          const mine = new Set(live.filter((t) => t.mine).map((t) => t.id));
          for (const teamId of teamIds) {
            const access = mine.has(teamId) ? "admin" : "member";
            await tx.execute(sql`
              INSERT INTO "space_teams" ("tenant_id", "space_id", "team_id", "access")
              VALUES (${tenantId}::uuid, ${space.id}::uuid, ${teamId}::uuid, ${access})
              ON CONFLICT ("space_id", "team_id") DO NOTHING
            `);
          }
          return { space, teamCount: teamIds.length };
        });

        return reply.code(201).send({
          data: {
            id: created.space.id,
            workspace_id: tenantId,
            name: created.space.name,
            slug: created.space.slug,
            description: created.space.description ?? null,
            emoji: created.space.emoji ?? null,
            // The creator manages what they created — see assertSpaceAdmin and
            // the matching arm in me-spaces.ts.
            my_role: "admin" as const,
            member_count: 0,
            teams: [],
            created_at: iso(created.space.created_at),
            updated_at: iso(created.space.updated_at),
          },
        });
      },
    });

    app.route({
      method: "PATCH",
      url: "/api/spaces/:spaceId",
      schema: { params: SpaceParams, body: SpaceUpdateBody },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { spaceId } = SpaceParams.parse(req.params);
        const body = SpaceUpdateBody.parse(req.body);

        const updated = await withTenant(deps.db, tenantId, async (tx) => {
          await assertSpaceAdmin(tx, userId, spaceId);
          const sets = [sql`"updated_at" = now()`];
          if (body.name !== undefined) sets.push(sql`"name" = ${body.name}`);
          if (body.description !== undefined) {
            sets.push(sql`"description" = ${body.description ?? null}`);
          }
          if (body.emoji !== undefined) sets.push(sql`"emoji" = ${body.emoji ?? null}`);
          const setClause = sets.reduce((acc, frag, i) => (i === 0 ? frag : sql`${acc}, ${frag}`));

          const result = await rows<{
            id: string;
            name: string;
            slug: string;
            description: string | null;
            emoji: string | null;
            created_at: Date | string;
            updated_at: Date | string;
          }>(
            tx,
            sql`UPDATE "spaces" SET ${setClause}
                 WHERE "id" = ${spaceId}::uuid AND "deleted_at" IS NULL
                 RETURNING *`,
          );
          const row = result[0];
          if (!row) throw new NotFoundError("SPACE_NOT_FOUND", "space not found");
          return row;
        });

        return reply.send({
          data: {
            id: updated.id,
            workspace_id: tenantId,
            name: updated.name,
            slug: updated.slug,
            description: updated.description ?? null,
            emoji: updated.emoji ?? null,
            created_at: iso(updated.created_at),
            updated_at: iso(updated.updated_at),
          },
        });
      },
    });

    app.route({
      method: "DELETE",
      url: "/api/spaces/:spaceId",
      schema: { params: SpaceParams },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { spaceId } = SpaceParams.parse(req.params);

        await withTenant(deps.db, tenantId, async (tx) => {
          await assertSpaceAdmin(tx, userId, spaceId);
          // Soft delete. The space leaves every member's /api/me/spaces answer,
          // which is what makes the desktop purge its local mirror — so the
          // notes stop being reachable without being destroyed server-side.
          await tx.execute(sql`
            UPDATE "spaces" SET "deleted_at" = now(), "updated_at" = now()
             WHERE "id" = ${spaceId}::uuid AND "deleted_at" IS NULL
          `);
        });

        return reply.code(204).send();
      },
    });

    app.route({
      method: "POST",
      url: "/api/spaces/:spaceId/teams",
      schema: { params: SpaceParams, body: SpaceTeamAddBody },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { spaceId } = SpaceParams.parse(req.params);
        const body = SpaceTeamAddBody.parse(req.body);

        await withTenant(deps.db, tenantId, async (tx) => {
          await assertSpaceAdmin(tx, userId, spaceId);
          const team = await rows<{ id: string }>(
            tx,
            sql`SELECT "id" FROM "teams"
                 WHERE "id" = ${body.team_id}::uuid AND "deleted_at" IS NULL LIMIT 1`,
          );
          if (team.length === 0) throw new NotFoundError("TEAM_NOT_FOUND", "team not found");

          // Upsert: the client's assign call doubles as "set the access level".
          await tx.execute(sql`
            INSERT INTO "space_teams" ("tenant_id", "space_id", "team_id", "access")
            VALUES (${tenantId}::uuid, ${spaceId}::uuid, ${body.team_id}::uuid,
                    ${body.access ?? "member"})
            ON CONFLICT ("space_id", "team_id") DO UPDATE SET "access" = EXCLUDED."access"
          `);
        });

        return reply.code(201).send({ data: { ok: true } });
      },
    });

    app.route({
      method: "DELETE",
      url: "/api/spaces/:spaceId/teams/:teamId",
      schema: { params: SpaceTeamParams },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const params = SpaceTeamParams.parse(req.params);

        await withTenant(deps.db, tenantId, async (tx) => {
          await assertSpaceAdmin(tx, userId, params.spaceId);
          await tx.execute(sql`
            DELETE FROM "space_teams"
             WHERE "space_id" = ${params.spaceId}::uuid AND "team_id" = ${params.teamId}::uuid
          `);
        });

        return reply.code(204).send();
      },
    });

    app.route({
      method: "GET",
      url: "/api/spaces/:spaceId/members",
      schema: { params: SpaceParams },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.user || !req.tenant) throw new AuthError("UNAUTHORIZED", "unauthorized");
        const tenantId = req.tenant;
        const userId = req.user.id;
        const { spaceId } = SpaceParams.parse(req.params);

        const listed = await withTenant(deps.db, tenantId, async (tx) => {
          // Only people who can open the space see who else can.
          const reachable = await rows<{ ok: boolean }>(
            tx,
            sql`SELECT true AS "ok"
                  FROM "spaces" s
                  JOIN "space_teams" st ON st."space_id" = s."id"
                  JOIN "team_members" tm
                    ON tm."team_id" = st."team_id" AND tm."user_id" = ${userId}::uuid
                 WHERE s."id" = ${spaceId}::uuid AND s."deleted_at" IS NULL
                 LIMIT 1`,
          );
          if (reachable.length === 0) {
            const creator = await rows<{ ok: boolean }>(
              tx,
              sql`SELECT true AS "ok" FROM "spaces"
                   WHERE "id" = ${spaceId}::uuid AND "deleted_at" IS NULL
                     AND "created_by_user_id" = ${userId}::uuid LIMIT 1`,
            );
            if (creator.length === 0) throw new NotFoundError("SPACE_NOT_FOUND", "space not found");
          }

          return rows<{
            user_id: string;
            email: string;
            name: string | null;
            joined_at: Date | string;
            team_id: string;
            team_name: string;
            role: string;
            access: string;
          }>(
            tx,
            sql`SELECT tm."user_id", u."email", u."name", tm."joined_at",
                       t."id" AS "team_id", t."name" AS "team_name",
                       tm."role", st."access"
                  FROM "space_teams" st
                  JOIN "teams" t ON t."id" = st."team_id" AND t."deleted_at" IS NULL
                  JOIN "team_members" tm ON tm."team_id" = t."id"
                  JOIN "users" u ON u."id" = tm."user_id"
                 WHERE st."space_id" = ${spaceId}::uuid
                 ORDER BY u."email" ASC`,
          );
        });

        // One row per person, with attribution of which team(s) grant access —
        // the desktop renders "via team X" from this.
        const byUser = new Map<string, Record<string, unknown>>();
        for (const row of listed) {
          const entry = byUser.get(row.user_id) ?? {
            user_id: row.user_id,
            email: row.email,
            name: row.name ?? null,
            image: null,
            role: "member",
            joined_at: iso(row.joined_at),
            via_teams: [] as Record<string, unknown>[],
          };
          (entry.via_teams as Record<string, unknown>[]).push({
            team_id: row.team_id,
            name: row.team_name,
            role: row.role === "admin" ? "admin" : "member",
            access: row.access === "admin" ? "admin" : "member",
          });
          if (row.access === "admin" && row.role === "admin") entry.role = "admin";
          byUser.set(row.user_id, entry);
        }

        reply.header("Cache-Control", "no-store");
        return reply.send({ data: [...byUser.values()] });
      },
    });
  };

export default buildSpacesRoutes;
