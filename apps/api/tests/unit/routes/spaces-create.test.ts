// SPDX-License-Identifier: FSL-1.1-ALv2
// Creating a team and a space — the flow an employee actually walks.
//
// The decision this encodes: ANY employee may create a space, because the
// alternative (admins only) means shared notes happen at the speed of a ticket
// queue, and the tenant is one company where everyone is already a vetted
// identity from the directory.
//
// Two invariants matter more than the CRUD:
//   * You cannot create a space you cannot see. Naming only teams you are not
//     in would produce a space that vanishes from your own list the moment it
//     is created — a confusing, silent self-lockout.
//   * The creator can manage what they created, without needing to be an admin
//     of some team first.
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import { buildMeSpacesRoutes } from "../../../src/routes/me-spaces.js";
import { buildSpacesRoutes } from "../../../src/routes/spaces.js";
import { buildTeamsRoutes } from "../../../src/routes/teams.js";
import { getSharedRoutePool } from "../../support/shared-route-pool.js";

const TENANT = "00000000-0000-0000-0000-000000000000";
const SLUG_PREFIX = "screate-";

let pool: Pool;
let founderId: string;
let colleagueId: string;
let apps: FastifyInstance[] = [];

async function seedUser(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT, email],
  );
  return rows[0]!.id;
}

async function appFor(userId: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  // These routes declare Zod schemas (LOCKER-04); without the provider Fastify
  // tries to read them as JSON Schema and refuses to build the route.
  await app.register(zodTypeProvider);
  app.addHook("preHandler", async (req) => {
    (req as { user?: unknown }).user = { id: userId, email: "x@test" };
    (req as { tenant?: unknown }).tenant = TENANT;
  });
  const db = drizzle(pool);
  await app.register(buildTeamsRoutes({ db }));
  await app.register(buildSpacesRoutes({ db }));
  await app.register(buildMeSpacesRoutes({ db }));
  await app.ready();
  apps.push(app);
  return app;
}

beforeAll(async () => {
  pool = await getSharedRoutePool();
  founderId = await seedUser("space-founder@test");
  colleagueId = await seedUser("space-colleague@test");
}, 180_000);

afterEach(async () => {
  for (const app of apps) await app.close();
  apps = [];
});

beforeEach(async () => {
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
});

async function createTeam(app: FastifyInstance, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/workspaces/${TENANT}/teams`,
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { data: { id: string } }).data.id;
}

describe("creating a team", () => {
  it("makes the creator an admin member straight away", async () => {
    const app = await appFor(founderId);

    const teamId = await createTeam(app, `${SLUG_PREFIX}Research`);

    const { rows } = await pool.query<{ role: string }>(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, founderId],
    );
    // Otherwise the founder would have to be added to their own team by
    // somebody who is already in it — and nobody is.
    expect(rows[0]?.role).toBe("admin");
  });

  it("lists the workspace's teams", async () => {
    const app = await appFor(founderId);
    await createTeam(app, `${SLUG_PREFIX}Research`);

    const res = await app.inject({ method: "GET", url: `/api/workspaces/${TENANT}/teams` });

    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { name: string; member_count: number }[] };
    expect(data.map((t) => t.name)).toContain(`${SLUG_PREFIX}Research`);
    expect(data.find((t) => t.name === `${SLUG_PREFIX}Research`)?.member_count).toBe(1);
  });
});

describe("adding a colleague to a team", () => {
  it("grants them the space the team can open", async () => {
    const founderApp = await appFor(founderId);
    const teamId = await createTeam(founderApp, `${SLUG_PREFIX}Research`);
    const created = await founderApp.inject({
      method: "POST",
      url: `/api/workspaces/${TENANT}/spaces`,
      payload: { name: `${SLUG_PREFIX}Research space`, team_ids: [teamId] },
    });
    expect(created.statusCode).toBe(201);

    const colleagueApp = await appFor(colleagueId);
    const before = await colleagueApp.inject({ method: "GET", url: "/api/me/spaces" });
    expect((before.json() as { data: unknown[] }).data).toEqual([]);

    const added = await founderApp.inject({
      method: "POST",
      url: `/api/teams/${teamId}/members`,
      payload: { user_id: colleagueId },
    });
    expect(added.statusCode).toBe(201);

    const after = await colleagueApp.inject({ method: "GET", url: "/api/me/spaces" });
    const spaces = (after.json() as { data: { name: string }[] }).data;
    expect(spaces.map((s) => s.name)).toEqual([`${SLUG_PREFIX}Research space`]);
  });
});

describe("creating a space", () => {
  it("appears in the creator's own list, managed by them", async () => {
    const app = await appFor(founderId);
    const teamId = await createTeam(app, `${SLUG_PREFIX}Research`);

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${TENANT}/spaces`,
      payload: { name: `${SLUG_PREFIX}Research space`, emoji: "🔬", team_ids: [teamId] },
    });

    expect(res.statusCode).toBe(201);
    const space = (res.json() as { data: { id: string; my_role: string } }).data;
    expect(space.my_role).toBe("admin");

    const mine = await app.inject({ method: "GET", url: "/api/me/spaces" });
    const listed = (mine.json() as { data: { id: string; my_role: string; emoji: string }[] }).data;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(space.id);
    expect(listed[0]!.emoji).toBe("🔬");
    // The creator manages what they created, without first being made an admin
    // of some team by somebody else.
    expect(listed[0]!.my_role).toBe("admin");
  });

  it("refuses a space the creator would not be able to see", async () => {
    const founderApp = await appFor(founderId);
    const colleagueApp = await appFor(colleagueId);
    // A team the founder is NOT in.
    const foreignTeam = await createTeam(colleagueApp, `${SLUG_PREFIX}Legal`);

    const res = await founderApp.inject({
      method: "POST",
      url: `/api/workspaces/${TENANT}/spaces`,
      payload: { name: `${SLUG_PREFIX}Invisible`, team_ids: [foreignTeam] },
    });

    // Creating it would produce a space that vanishes from your list the moment
    // it exists — a silent self-lockout, not a useful outcome.
    expect(res.statusCode).toBe(400);
    const { rows } = await pool.query(`SELECT 1 FROM spaces WHERE slug LIKE $1`, [
      `${SLUG_PREFIX}invisible%`,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("refuses a space with no teams at all", async () => {
    const app = await appFor(founderId);

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${TENANT}/spaces`,
      payload: { name: `${SLUG_PREFIX}Orphan`, team_ids: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("refuses a workspace that is not this tenant", async () => {
    const app = await appFor(founderId);
    const teamId = await createTeam(app, `${SLUG_PREFIX}Research`);

    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/11111111-1111-4111-8111-111111111111/spaces",
      payload: { name: `${SLUG_PREFIX}Elsewhere`, team_ids: [teamId] },
    });

    // There is exactly one workspace here. A different id is either a stale
    // client or someone probing; neither should reach the insert.
    expect(res.statusCode).toBe(404);
  });
});
