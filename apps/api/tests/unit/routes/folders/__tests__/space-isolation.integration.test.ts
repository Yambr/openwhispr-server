// SPDX-License-Identifier: FSL-1.1-ALv2
// Team-space isolation for folders.
//
// The same security predicate as notes, asserted separately because it is a
// separate query: a folder tree is what makes a space usable, and a folder
// leaking is a directory listing of a team's work even before a single note
// leaks. See lib/space-scope.ts and the notes twin of this file.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/folders/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
/** Namespaces this file's fixtures inside the shared test database. */
const SLUG_PREFIX = "fiso-";

let pool: Pool;
let insiderId: string;
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

async function seedFolder(opts: {
  ownerId: string;
  clientFolderId: string;
  spaceId?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO folders (tenant_id, user_id, client_folder_id, name, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
    [
      DEFAULT_TENANT_ID,
      opts.ownerId,
      opts.clientFolderId,
      opts.clientFolderId,
      opts.spaceId ?? null,
    ],
  );
}

async function listClientFolderIds(app: FastifyInstance): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: "/api/folders/list?scope=all" });
  expect(res.statusCode).toBe(200);
  const { folders } = res.json() as { folders: { client_folder_id: string }[] };
  return folders.map((f) => f.client_folder_id).sort();
}

beforeAll(async () => {
  pool = await getSharedRoutePool();
  insiderId = await seedUser("folder-space-insider@test");
  outsiderId = await seedUser("folder-space-outsider@test");
  insiderApp = await buildTestApp({ pool, userId: insiderId });
  outsiderApp = await buildTestApp({ pool, userId: outsiderId });
}, 180_000);

afterAll(async () => {
  if (insiderApp) await insiderApp.close();
  if (outsiderApp) await outsiderApp.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM folders WHERE user_id = ANY($1::uuid[])`, [
    [insiderId, outsiderId],
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

  teamId = (
    await pool.query<{ id: string }>(
      `INSERT INTO teams (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, 'Analytics', $2, $3) RETURNING id`,
      [DEFAULT_TENANT_ID, `${SLUG_PREFIX}analytics`, insiderId],
    )
  ).rows[0]!.id;
  spaceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO spaces (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, 'Analytics space', $2, $3) RETURNING id`,
      [DEFAULT_TENANT_ID, `${SLUG_PREFIX}analytics-space`, insiderId],
    )
  ).rows[0]!.id;
  await pool.query(
    `INSERT INTO space_teams (tenant_id, space_id, team_id, access) VALUES ($1, $2, $3, 'member')`,
    [DEFAULT_TENANT_ID, spaceId, teamId],
  );
  await pool.query(
    `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
    [DEFAULT_TENANT_ID, teamId, insiderId],
  );
});

describe("integration — team-space isolation on GET /api/folders/list", () => {
  it("hides a space folder from a user in no team of that space", async () => {
    await seedFolder({ ownerId: insiderId, clientFolderId: "space-folder", spaceId });
    await seedFolder({ ownerId: outsiderId, clientFolderId: "outsider-personal" });

    expect(await listClientFolderIds(outsiderApp)).toEqual(["outsider-personal"]);
  });

  it("hides a space folder the caller AUTHORED once their membership is gone", async () => {
    // The discriminating case. A folder the caller owns passes the old
    // `user_id = me` predicate, so only a space-aware predicate can withhold it
    // — and this is the shape access revocation actually takes: you created the
    // folder, then you were removed from the team.
    await pool.query(
      `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
      [DEFAULT_TENANT_ID, teamId, outsiderId],
    );
    await seedFolder({ ownerId: outsiderId, clientFolderId: "authored-then-revoked", spaceId });
    expect(await listClientFolderIds(outsiderApp)).toEqual(["authored-then-revoked"]);

    await pool.query(`DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`, [
      teamId,
      outsiderId,
    ]);

    expect(await listClientFolderIds(outsiderApp)).toEqual([]);
  });

  it("shows a space folder created by someone else to a fellow member", async () => {
    await pool.query(
      `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
      [DEFAULT_TENANT_ID, teamId, outsiderId],
    );
    await seedFolder({ ownerId: insiderId, clientFolderId: "shared-folder", spaceId });

    expect(await listClientFolderIds(outsiderApp)).toEqual(["shared-folder"]);
  });

  it("withholds space folders from a client that did not ask for scope", async () => {
    await seedFolder({ ownerId: insiderId, clientFolderId: "space-folder", spaceId });
    await seedFolder({ ownerId: insiderId, clientFolderId: "personal-folder" });

    // No `?scope=all` means a client that cannot place a space row and would
    // file it into the personal tree — de-scoping shared content silently.
    const res = await insiderApp.inject({ method: "GET", url: "/api/folders/list" });
    const { folders } = res.json() as { folders: { client_folder_id: string }[] };
    expect(folders.map((f) => f.client_folder_id)).toEqual(["personal-folder"]);
  });
});
