// SPDX-License-Identifier: FSL-1.1-ALv2
// Searching inside a shared space.
//
// "Keep the team's notes in one place" is only true if you can find them there.
// Search carried the pre-spaces owner-only predicate, so a note a colleague
// wrote in a shared space was visible in the tree and invisible to search —
// the worst kind of gap, because nothing reports it: you simply conclude the
// note is not there.
//
// The negative case is the one that must not regress: search must not become a
// way to read a colleague's PERSONAL notes by guessing a word in them.

import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../../src/plugins/zod-type-provider.js";
import { buildNotesSearchRoutes } from "../../../../../src/routes/notes/search.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

const TENANT = "00000000-0000-0000-0000-000000000000";
const SLUG_PREFIX = "ssearch-";

let pool: Pool;
let authorId: string;
let mateId: string;
let strangerId: string;
let mateApp: FastifyInstance;
let strangerApp: FastifyInstance;
let spaceId: string;

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
  await app.register(zodTypeProvider);
  app.addHook("preHandler", async (req) => {
    (req as { user?: unknown }).user = { id: userId, email: "x@test" };
    (req as { tenant?: unknown }).tenant = TENANT;
  });
  const db = drizzle(pool);
  await app.register(
    buildNotesSearchRoutes({
      db: db as unknown as Parameters<typeof buildNotesSearchRoutes>[0]["db"],
    }),
  );
  await app.ready();
  return app;
}

async function search(app: FastifyInstance, query: string): Promise<string[]> {
  const res = await app.inject({ method: "POST", url: "/api/notes/search", payload: { query } });
  expect(res.statusCode).toBe(200);
  const { notes } = res.json() as { notes: { client_note_id: string }[] };
  return notes.map((n) => n.client_note_id).sort();
}

beforeAll(async () => {
  pool = await getSharedRoutePool();
  authorId = await seedUser("space-search-author@test");
  mateId = await seedUser("space-search-mate@test");
  strangerId = await seedUser("space-search-stranger@test");
  mateApp = await appFor(mateId);
  strangerApp = await appFor(strangerId);
}, 180_000);

afterAll(async () => {
  for (const app of [mateApp, strangerApp]) if (app) await app.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes WHERE user_id = ANY($1::uuid[])`, [
    [authorId, mateId, strangerId],
  ]);
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

  const teamId = (
    await pool.query<{ id: string }>(
      `INSERT INTO teams (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, 'Searchers', $2, $3) RETURNING id`,
      [TENANT, `${SLUG_PREFIX}searchers`, authorId],
    )
  ).rows[0]!.id;
  spaceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO spaces (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, 'Searchers space', $2, $3) RETURNING id`,
      [TENANT, `${SLUG_PREFIX}searchers-space`, authorId],
    )
  ).rows[0]!.id;
  await pool.query(
    `INSERT INTO space_teams (tenant_id, space_id, team_id, access) VALUES ($1, $2, $3, 'member')`,
    [TENANT, spaceId, teamId],
  );
  for (const uid of [authorId, mateId]) {
    await pool.query(
      `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
      [TENANT, teamId, uid],
    );
  }

  await pool.query(
    `INSERT INTO notes (tenant_id, user_id, client_note_id, title, content, space_id)
       VALUES ($1, $2, 'shared-hit', 'Quarterly', 'quarterly review notes', $3)`,
    [TENANT, authorId, spaceId],
  );
  await pool.query(
    `INSERT INTO notes (tenant_id, user_id, client_note_id, title, content)
       VALUES ($1, $2, 'private-hit', 'Quarterly', 'quarterly review notes')`,
    [TENANT, authorId],
  );
});

describe("integration — POST /api/notes/search across spaces", () => {
  it("finds a colleague's note in a space the caller can open", async () => {
    // Visible in the tree but missing from search is the worst kind of gap:
    // nothing reports it, you just conclude the note is not there.
    expect(await search(mateApp, "quarterly")).toEqual(["shared-hit"]);
  });

  it("never surfaces a colleague's personal note", async () => {
    // Both notes contain the term; only the shared one may come back. Search
    // must not become a way to read someone's private tree by guessing a word.
    const found = await search(mateApp, "quarterly");
    expect(found).not.toContain("private-hit");
  });

  it("returns nothing to someone outside the space", async () => {
    expect(await search(strangerApp, "quarterly")).toEqual([]);
  });
});
