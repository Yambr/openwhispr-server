// SPDX-License-Identifier: FSL-1.1-ALv2
// GET /api/me/spaces — which team spaces this account may open.
//
// THIS ROUTE IS A DATA-ISOLATION GUARD, not a listing. On every sign-in and
// account switch the desktop asks it what the account may access and then
// DESTRUCTIVELY deletes every locally cached space missing from the answer, so
// one account's content can never survive into another's session
// (SyncService.verifyTeamSpacesForAccount). It is fail-closed by design: a
// server that does not answer is indistinguishable from a compromised one, so
// the client refuses to validate the session rather than guess — a 404 here
// hangs the app on its loading screen, which is exactly what happened on the
// 1.9.3 rollout.
//
// That cuts both ways now that the answer is real. A space wrongly OMITTED
// deletes a colleague's local copy of shared notes; a space wrongly INCLUDED
// hands out access. So membership is re-derived from the tables on every call
// and nothing else grants it — not authorship of the space, not sharing a
// tenant.
//
// The same route also doubles as the desktop's TEAM-SCOPE CAPABILITY PROBE
// (SyncService.syncSpaces): answering anything but 404 tells the client this
// server understands `?scope=all` and `space_id`. It must stay in step with
// notes/list and folders/list, which is why lib/space-scope.ts owns the one
// membership predicate both sides use.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "../errors.js";

export interface MeSpacesDeps {
  db: TransactionalDb<ExecutableTx>;
}

/** One team's part in a space, as the desktop's `SpaceTeamRef` expects it. */
export interface SpaceTeamRef {
  id: string;
  name: string;
  /** The caller's role in that team; null when they are not in it. */
  my_role: "admin" | "member" | null;
  /** Per-assignment ceiling on what the team conveys (space_teams.access). */
  access: "admin" | "member";
}

/** A space as the desktop expects it (`DataWrap<MySpace[]>`). */
export interface MySpace {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  my_role: "admin" | "member";
  member_count: number;
  teams: SpaceTeamRef[];
  created_at: string;
  updated_at: string;
}

export interface MeSpacesResponse {
  data: MySpace[];
}

interface SpaceRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  my_role: string;
  member_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TeamRow {
  space_id: string;
  team_id: string;
  team_name: string;
  access: string;
  my_role: string | null;
}

function iso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
}

function asRole(value: string | null | undefined): "admin" | "member" | null {
  return value === "admin" ? "admin" : value === "member" ? "member" : null;
}

export const buildMeSpacesRoutes = (deps: MeSpacesDeps) =>
  async function meSpacesRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/me/spaces",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        // Defensive 401, matching capabilities.ts: the global dualAuthHook
        // should already have rejected anonymous traffic, but an account-scope
        // guard must never answer a caller it cannot attribute.
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const userId = req.user.id;

        const { spaces, teams } = await withTenant(deps.db, tenantId, async (tx) => {
          // Reachable spaces, with the caller's effective role. A team admin is
          // a space admin only where the ASSIGNMENT also says 'admin' — the cap
          // is per-assignment, so a team carrying read-only access into one
          // space cannot confer admin there just because its roster says so.
          const spacesResult = (await tx.execute(sql`
            SELECT s."id",
                   s."name",
                   s."slug",
                   s."description",
                   s."emoji",
                   s."created_at",
                   s."updated_at",
                   CASE WHEN bool_or(st."access" = 'admin' AND tm."role" = 'admin')
                        THEN 'admin' ELSE 'member' END AS "my_role",
                   (
                     SELECT count(DISTINCT m."user_id")
                       FROM "space_teams" a
                       JOIN "team_members" m ON m."team_id" = a."team_id"
                      WHERE a."space_id" = s."id"
                   ) AS "member_count"
              FROM "spaces" s
              JOIN "space_teams" st ON st."space_id" = s."id"
              JOIN "team_members" tm
                ON tm."team_id" = st."team_id" AND tm."user_id" = ${userId}::uuid
             WHERE s."deleted_at" IS NULL
             GROUP BY s."id"
             ORDER BY s."created_at" ASC, s."id" ASC
          `)) as { rows?: SpaceRow[] };
          const spaceRows = spacesResult.rows ?? [];
          if (spaceRows.length === 0) return { spaces: spaceRows, teams: [] as TeamRow[] };

          // EVERY team assigned to those spaces, not only the caller's — the
          // desktop renders the roster attribution ("via team X"), so a team
          // the caller is not in still has to appear.
          const ids = spaceRows.map((s) => s.id);
          const teamsResult = (await tx.execute(sql`
            SELECT st."space_id",
                   t."id"   AS "team_id",
                   t."name" AS "team_name",
                   st."access",
                   tm."role" AS "my_role"
              FROM "space_teams" st
              JOIN "teams" t ON t."id" = st."team_id" AND t."deleted_at" IS NULL
              LEFT JOIN "team_members" tm
                ON tm."team_id" = t."id" AND tm."user_id" = ${userId}::uuid
             WHERE st."space_id" IN (${sql.join(
               ids.map((id) => sql`${id}::uuid`),
               sql`, `,
             )})
             ORDER BY t."name" ASC
          `)) as { rows?: TeamRow[] };
          return { spaces: spaceRows, teams: teamsResult.rows ?? [] };
        });

        const teamsBySpace = new Map<string, SpaceTeamRef[]>();
        for (const row of teams) {
          const list = teamsBySpace.get(row.space_id) ?? [];
          list.push({
            id: row.team_id,
            name: row.team_name,
            my_role: asRole(row.my_role),
            access: row.access === "admin" ? "admin" : "member",
          });
          teamsBySpace.set(row.space_id, list);
        }

        const data: MySpace[] = spaces.map((s) => ({
          id: s.id,
          // One tenant, one workspace. The desktop keys its local mirror on it.
          workspace_id: tenantId,
          name: s.name,
          slug: s.slug,
          description: s.description ?? null,
          emoji: s.emoji ?? null,
          my_role: s.my_role === "admin" ? "admin" : "member",
          member_count: Number(s.member_count ?? 0),
          teams: teamsBySpace.get(s.id) ?? [],
          created_at: iso(s.created_at),
          updated_at: iso(s.updated_at),
        }));

        // Not cacheable: the client uses the answer to decide what to delete
        // locally, so a stale 200 could authorize keeping content the account
        // has since lost access to.
        reply.header("Cache-Control", "no-store");
        const body: MeSpacesResponse = { data };
        return reply.send(body);
      },
    });
  };

export default buildMeSpacesRoutes;
