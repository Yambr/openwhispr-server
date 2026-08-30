// SPDX-License-Identifier: FSL-1.1-ALv2
// Team-space isolation — the security core of shared notes.
//
// THIS IS THE TEST THAT MATTERS. Row-level security in this database is
// TENANT-scoped only (migration 0033: `notes_isolation` compares `tenant_id`);
// per-user separation has always lived in the handlers' own `WHERE user_id =`
// predicate. Team spaces widen that predicate for the first time, so a mistake
// here is not a cosmetic bug — it is one employee reading another's notes,
// and RLS will not catch it. Hence: written before the feature, and covering
// the negative case first.
//
// The contract:
//   * A note with `space_id IS NULL` is personal. Visible to its owner, to
//     nobody else, exactly as before spaces existed.
//   * A note in a space is visible to every member of every team assigned to
//     that space, and to nobody else — not even to a member of a DIFFERENT
//     space in the same tenant.
//   * Losing team membership removes access on the next request. There is no
//     cached grant.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/notes/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
/** Namespaces this file's fixtures inside the shared test database. */
const SLUG_PREFIX = "iso-";

let pool: Pool;
/** Member of the team assigned to the space. */
let insiderId: string;
/** Same tenant, no team membership at all. */
let outsiderId: string;
let insiderApp: FastifyInstance;
let outsiderApp: FastifyInstance;
let spaceId: string;
let teamId: string;

async function seedUser(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [DEFAULT_TENANT_ID, email],
  );
  return rows[0]!.id;
}

/** A note owned by `ownerId`, filed either personally or into a space. */
async function seedNote(opts: {
  ownerId: string;
  clientNoteId: string;
  spaceId?: string | null;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO notes (tenant_id, user_id, client_note_id, title, content, space_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
    [
      DEFAULT_TENANT_ID,
      opts.ownerId,
      opts.clientNoteId,
      opts.clientNoteId,
      `Content of ${opts.clientNoteId}`,
      opts.spaceId ?? null,
    ],
  );
  return rows[0]!.id;
}

async function listClientNoteIds(app: FastifyInstance): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: "/api/notes/list?scope=all" });
  expect(res.statusCode).toBe(200);
  const { notes } = res.json() as { notes: { client_note_id: string }[] };
  return notes.map((n) => n.client_note_id).sort();
}

beforeAll(async () => {
  pool = await getSharedRoutePool();
  insiderId = await seedUser("space-insider@test");
  outsiderId = await seedUser("space-outsider@test");
  insiderApp = await buildTestApp({ pool, userId: insiderId });
  outsiderApp = await buildTestApp({ pool, userId: outsiderId });
}, 180_000);

afterAll(async () => {
  if (insiderApp) await insiderApp.close();
  if (outsiderApp) await outsiderApp.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes WHERE user_id = ANY($1::uuid[])`, [[insiderId, outsiderId]]);
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

  const team = await pool.query<{ id: string }>(
    `INSERT INTO teams (tenant_id, name, slug, created_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
    [DEFAULT_TENANT_ID, "Analytics", `${SLUG_PREFIX}analytics`, insiderId],
  );
  teamId = team.rows[0]!.id;

  const space = await pool.query<{ id: string }>(
    `INSERT INTO spaces (tenant_id, name, slug, created_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
    [DEFAULT_TENANT_ID, "Analytics space", `${SLUG_PREFIX}analytics-space`, insiderId],
  );
  spaceId = space.rows[0]!.id;

  await pool.query(
    `INSERT INTO space_teams (tenant_id, space_id, team_id, access) VALUES ($1, $2, $3, 'member')`,
    [DEFAULT_TENANT_ID, spaceId, teamId],
  );
  await pool.query(
    `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
    [DEFAULT_TENANT_ID, teamId, insiderId],
  );
});

describe("integration — team-space isolation on GET /api/notes/list", () => {
  it("hides a space note from a user in no team of that space", async () => {
    await seedNote({ ownerId: insiderId, clientNoteId: "space-note", spaceId });
    await seedNote({ ownerId: outsiderId, clientNoteId: "outsider-personal" });

    // The outsider is in the SAME tenant, so tenant RLS lets the row through;
    // only the handler predicate stands between them and it.
    expect(await listClientNoteIds(outsiderApp)).toEqual(["outsider-personal"]);
  });

  it("shows the space note to a member of an assigned team", async () => {
    await seedNote({ ownerId: insiderId, clientNoteId: "space-note", spaceId });

    expect(await listClientNoteIds(insiderApp)).toEqual(["space-note"]);
  });

  it("shows a space note authored by someone else to a fellow member", async () => {
    // Shared notes are the point: authorship must not gate visibility, and the
    // `user_id = me` predicate that predates spaces would have hidden this.
    await pool.query(
      `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
      [DEFAULT_TENANT_ID, teamId, outsiderId],
    );
    await seedNote({ ownerId: insiderId, clientNoteId: "authored-by-insider", spaceId });

    expect(await listClientNoteIds(outsiderApp)).toEqual(["authored-by-insider"]);
  });

  it("keeps personal notes personal even between members of the same space", async () => {
    await pool.query(
      `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
      [DEFAULT_TENANT_ID, teamId, outsiderId],
    );
    await seedNote({ ownerId: insiderId, clientNoteId: "insider-personal" });
    await seedNote({ ownerId: insiderId, clientNoteId: "shared", spaceId });

    // Sharing a space grants the space, never the other person's private tree.
    expect(await listClientNoteIds(outsiderApp)).toEqual(["shared"]);
  });

  it("revokes access as soon as the membership row is gone", async () => {
    await seedNote({ ownerId: insiderId, clientNoteId: "space-note", spaceId });
    expect(await listClientNoteIds(insiderApp)).toEqual(["space-note"]);

    await pool.query(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, [
      teamId,
      insiderId,
    ]);

    // No cached grant: the very next request re-derives access.
    expect(await listClientNoteIds(insiderApp)).toEqual([]);
  });

  it("does not leak between two spaces in the same tenant", async () => {
    const otherTeam = await pool.query<{ id: string }>(
      `INSERT INTO teams (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
      [DEFAULT_TENANT_ID, "Finance", `${SLUG_PREFIX}finance`, outsiderId],
    );
    const otherSpace = await pool.query<{ id: string }>(
      `INSERT INTO spaces (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
      [DEFAULT_TENANT_ID, "Finance space", `${SLUG_PREFIX}finance-space`, outsiderId],
    );
    await pool.query(
      `INSERT INTO space_teams (tenant_id, space_id, team_id, access) VALUES ($1, $2, $3, 'member')`,
      [DEFAULT_TENANT_ID, otherSpace.rows[0]!.id, otherTeam.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
      [DEFAULT_TENANT_ID, otherTeam.rows[0]!.id, outsiderId],
    );

    await seedNote({ ownerId: insiderId, clientNoteId: "analytics-note", spaceId });
    await seedNote({
      ownerId: outsiderId,
      clientNoteId: "finance-note",
      spaceId: otherSpace.rows[0]!.id,
    });

    expect(await listClientNoteIds(insiderApp)).toEqual(["analytics-note"]);
    expect(await listClientNoteIds(outsiderApp)).toEqual(["finance-note"]);
  });
});
