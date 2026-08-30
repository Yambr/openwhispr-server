// SPDX-License-Identifier: FSL-1.1-ALv2
// GET /api/me/spaces — now backed by real spaces.
//
// The route already existed as the account-scope guard, answering a constant
// empty list because no space could exist (see me-spaces.ts). It keeps that
// job: the desktop still uses the answer to DESTRUCTIVELY purge every locally
// cached space missing from it, so the response has to be right in both
// directions — a space wrongly omitted deletes a colleague's local copy of
// shared notes, and a space wrongly included hands out access.
//
// Membership is what makes a space appear: the caller is in a team, and that
// team is assigned to the space. Nothing else grants it — not authorship of the
// space, not being in the same tenant.
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { buildMeSpacesRoutes } from "../../../src/routes/me-spaces.js";
import { getSharedRoutePool } from "../../support/shared-route-pool.js";

const TENANT = "00000000-0000-0000-0000-000000000000";
/** Namespaces this file's fixtures inside the shared test database. */
const SLUG_PREFIX = "mysp-";

let pool: Pool;
let memberId: string;
let strangerId: string;
let spaceId: string;
let teamId: string;
let app: FastifyInstance;

async function seedUser(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT, email],
  );
  return rows[0]!.id;
}

async function buildApp(userId: string): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false });
  registerErrorHandler(instance);
  instance.addHook("preHandler", async (req) => {
    (req as { user?: unknown }).user = { id: userId, email: "x@test" };
    (req as { tenant?: unknown }).tenant = TENANT;
  });
  await instance.register(buildMeSpacesRoutes({ db: drizzle(pool) }));
  await instance.ready();
  return instance;
}

interface MySpace {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  my_role: string;
  member_count: number;
  teams: { id: string; name: string; access?: string }[];
}

async function mySpaces(userId: string): Promise<MySpace[]> {
  app = await buildApp(userId);
  const res = await app.inject({ method: "GET", url: "/api/me/spaces" });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: MySpace[] }).data;
}

beforeAll(async () => {
  pool = await getSharedRoutePool();
  memberId = await seedUser("myspaces-member@test");
  strangerId = await seedUser("myspaces-stranger@test");
}, 180_000);

afterEach(async () => {
  await app?.close();
});

beforeEach(async () => {
  // Scoped to THIS file's rows. vitest runs files in parallel against one
  // shared container, so a blanket `DELETE FROM spaces` would delete a sibling
  // suite's fixtures mid-assertion — and a flaky isolation test is worse than
  // no isolation test. Every row this file creates carries the prefix below.
  await pool.query(
    `DELETE FROM space_teams WHERE space_id IN (SELECT id FROM spaces WHERE slug LIKE $1)`,
    [`${SLUG_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE slug LIKE $1)`,
    [`${SLUG_PREFIX}%`],
  );
  await pool.query(`DELETE FROM spaces WHERE slug LIKE $1`, [`${SLUG_PREFIX}%`]);
  await pool.query(`DELETE FROM teams  WHERE slug LIKE $1`, [`${SLUG_PREFIX}%`]);

  teamId = (
    await pool.query<{ id: string }>(
      `INSERT INTO teams (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, 'Analytics', '${SLUG_PREFIX}analytics', $2) RETURNING id`,
      [TENANT, memberId],
    )
  ).rows[0]!.id;
  spaceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO spaces (tenant_id, name, slug, description, emoji, created_by_user_id)
         VALUES ($1, 'Analytics space', '${SLUG_PREFIX}analytics-space', 'shared notes', '📊', $2)
         RETURNING id`,
      [TENANT, memberId],
    )
  ).rows[0]!.id;
  await pool.query(
    `INSERT INTO space_teams (tenant_id, space_id, team_id, access) VALUES ($1, $2, $3, 'member')`,
    [TENANT, spaceId, teamId],
  );
  await pool.query(
    `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
    [TENANT, teamId, memberId],
  );
});

describe("GET /api/me/spaces with real spaces", () => {
  it("lists a space the caller reaches through a team", async () => {
    const spaces = await mySpaces(memberId);

    expect(spaces).toHaveLength(1);
    const space = spaces[0]!;
    expect(space.id).toBe(spaceId);
    // One tenant, one workspace — the client keys its local mirror on this.
    expect(space.workspace_id).toBe(TENANT);
    expect(space.name).toBe("Analytics space");
    expect(space.slug).toBe(`${SLUG_PREFIX}analytics-space`);
    expect(space.teams.map((t) => t.name)).toEqual(["Analytics"]);
  });

  it("omits the space entirely for someone in no assigned team", async () => {
    // The stranger is in the same tenant and the space is right there in the
    // table; only membership keeps it out of the answer.
    expect(await mySpaces(strangerId)).toEqual([]);
  });

  it("counts every distinct person the space reaches", async () => {
    await pool.query(
      `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
      [TENANT, teamId, strangerId],
    );

    expect((await mySpaces(memberId))[0]!.member_count).toBe(2);
  });

  it("reports the caller's own role, capped by the team's assignment", async () => {
    // A team admin is a space admin only when the assignment says 'admin' —
    // the cap is per-assignment, not per-team.
    await pool.query(`UPDATE team_members SET role = 'admin' WHERE team_id = $1 AND user_id = $2`, [
      teamId,
      memberId,
    ]);

    expect((await mySpaces(memberId))[0]!.my_role).toBe("member");

    await pool.query(`UPDATE space_teams SET access = 'admin' WHERE space_id = $1`, [spaceId]);
    await app.close();
    expect((await mySpaces(memberId))[0]!.my_role).toBe("admin");
  });

  it("drops a soft-deleted space from the answer", async () => {
    await pool.query(`UPDATE spaces SET deleted_at = now() WHERE id = $1`, [spaceId]);

    // The desktop purges what is missing here, which is exactly what should
    // happen to a deleted space's local mirror.
    expect(await mySpaces(memberId)).toEqual([]);
  });
});
