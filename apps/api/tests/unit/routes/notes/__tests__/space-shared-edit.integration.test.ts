// SPDX-License-Identifier: FSL-1.1-ALv2
// Editing and deleting a note inside a shared space.
//
// A space where you can read a colleague's note but never touch it is a
// read-only archive, not a shared tree — and the desktop offers no hint that an
// edit will fail, so the user simply loses the change. `update` and `delete`
// still carried the pre-spaces `user_id = me` predicate, which answers 404 for
// a note you can plainly see.
//
// Deleting is the sharper half: a member removing a colleague's note is real
// data loss, so it is asserted deliberately rather than inherited. The rule is
// the same one reading uses — reach the space, act in it — because a second,
// stricter rule for writes would mean the space's contents are visible to
// people who cannot maintain them, and somebody would have to be nominated to
// clean up after everyone.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/notes/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

const TENANT = "00000000-0000-0000-0000-000000000000";
const SLUG_PREFIX = "sedit-";

let pool: Pool;
let authorId: string;
let mateId: string;
let strangerId: string;
let authorApp: FastifyInstance;
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

async function seedSharedNote(clientNoteId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO notes (tenant_id, user_id, client_note_id, title, content, space_id)
       VALUES ($1, $2, $3, 'Before', 'body', $4) RETURNING id`,
    [TENANT, authorId, clientNoteId, spaceId],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  pool = await getSharedRoutePool();
  authorId = await seedUser("shared-edit-author@test");
  mateId = await seedUser("shared-edit-mate@test");
  strangerId = await seedUser("shared-edit-stranger@test");
  authorApp = await buildTestApp({ pool, userId: authorId });
  mateApp = await buildTestApp({ pool, userId: mateId });
  strangerApp = await buildTestApp({ pool, userId: strangerId });
}, 180_000);

afterAll(async () => {
  for (const app of [authorApp, mateApp, strangerApp]) if (app) await app.close();
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
         VALUES ($1, 'Shared', $2, $3) RETURNING id`,
      [TENANT, `${SLUG_PREFIX}shared`, authorId],
    )
  ).rows[0]!.id;
  spaceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO spaces (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, 'Shared space', $2, $3) RETURNING id`,
      [TENANT, `${SLUG_PREFIX}shared-space`, authorId],
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
});

describe("integration — editing a colleague's note in a shared space", () => {
  it("lets a fellow member edit it", async () => {
    const id = await seedSharedNote("shared-note");

    const res = await mateApp.inject({
      method: "PATCH",
      url: "/api/notes/update",
      payload: { id, title: "After" },
    });

    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query<{ title: string }>(`SELECT title FROM notes WHERE id = $1`, [
      id,
    ]);
    expect(rows[0]!.title).toBe("After");
  });

  it("still hides it from someone outside the space", async () => {
    const id = await seedSharedNote("shared-note");

    const res = await strangerApp.inject({
      method: "PATCH",
      url: "/api/notes/update",
      payload: { id, title: "Intruder" },
    });

    expect(res.statusCode).toBe(404);
    const { rows } = await pool.query<{ title: string }>(`SELECT title FROM notes WHERE id = $1`, [
      id,
    ]);
    expect(rows[0]!.title).toBe("Before");
  });

  it("leaves a colleague's PERSONAL note untouchable", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO notes (tenant_id, user_id, client_note_id, title, content)
         VALUES ($1, $2, 'private', 'Before', 'body') RETURNING id`,
      [TENANT, authorId],
    );
    const id = rows[0]!.id;

    const res = await mateApp.inject({
      method: "PATCH",
      url: "/api/notes/update",
      payload: { id, title: "Nope" },
    });

    // Sharing a space grants the space, never the other person's private tree.
    expect(res.statusCode).toBe(404);
  });

  it("lets a fellow member delete a shared note", async () => {
    const id = await seedSharedNote("shared-note");

    const res = await mateApp.inject({
      method: "DELETE",
      url: "/api/notes/delete",
      payload: { id },
    });

    expect(res.statusCode).toBeLessThan(300);
    const { rows } = await pool.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM notes WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.deleted_at).not.toBeNull();
  });

  it("refuses a delete from outside the space", async () => {
    const id = await seedSharedNote("shared-note");

    const res = await strangerApp.inject({
      method: "DELETE",
      url: "/api/notes/delete",
      payload: { id },
    });

    expect(res.statusCode).toBe(404);
    const { rows } = await pool.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM notes WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.deleted_at).toBeNull();
  });
});
