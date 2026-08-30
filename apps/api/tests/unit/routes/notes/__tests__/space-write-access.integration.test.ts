// SPDX-License-Identifier: FSL-1.1-ALv2
// Writing INTO a team space — the other half of the isolation contract.
//
// Reading is guarded by lib/space-scope.ts. Writing needs its own check and a
// different failure mode: a caller who names a space they cannot reach is not
// sending a malformed request, they are attempting an access they do not have.
// Answering 400 would tell them their payload was wrong; 403 says what is true.
//
// Silently dropping the scope is the one thing that must never happen. The
// desktop treats its push as authoritative and marks the row synced, so a note
// accepted "into" a space and quietly filed as personal is content the author
// believes is shared and nobody else can see — with no error anywhere.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/notes/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SLUG_PREFIX = "wacc-";

let pool: Pool;
let memberId: string;
let strangerId: string;
let memberApp: FastifyInstance;
let strangerApp: FastifyInstance;
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

beforeAll(async () => {
  pool = await getSharedRoutePool();
  memberId = await seedUser("space-write-member@test");
  strangerId = await seedUser("space-write-stranger@test");
  memberApp = await buildTestApp({ pool, userId: memberId });
  strangerApp = await buildTestApp({ pool, userId: strangerId });
}, 180_000);

afterAll(async () => {
  if (memberApp) await memberApp.close();
  if (strangerApp) await strangerApp.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes WHERE user_id = ANY($1::uuid[])`, [[memberId, strangerId]]);
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
         VALUES ($1, 'Writers', $2, $3) RETURNING id`,
      [DEFAULT_TENANT_ID, `${SLUG_PREFIX}writers`, memberId],
    )
  ).rows[0]!.id;
  spaceId = (
    await pool.query<{ id: string }>(
      `INSERT INTO spaces (tenant_id, name, slug, created_by_user_id)
         VALUES ($1, 'Writers space', $2, $3) RETURNING id`,
      [DEFAULT_TENANT_ID, `${SLUG_PREFIX}writers-space`, memberId],
    )
  ).rows[0]!.id;
  await pool.query(
    `INSERT INTO space_teams (tenant_id, space_id, team_id, access) VALUES ($1, $2, $3, 'member')`,
    [DEFAULT_TENANT_ID, spaceId, teamId],
  );
  await pool.query(
    `INSERT INTO team_members (tenant_id, team_id, user_id, role) VALUES ($1, $2, $3, 'member')`,
    [DEFAULT_TENANT_ID, teamId, memberId],
  );
});

describe("integration — writing a note into a team space", () => {
  it("files the note into the space for a member, and says so in the response", async () => {
    const res = await memberApp.inject({
      method: "POST",
      url: "/api/notes/create",
      payload: {
        client_note_id: "into-space",
        content: "shared",
        workspace_id: DEFAULT_TENANT_ID,
        space_id: spaceId,
      },
    });

    expect(res.statusCode).toBe(201);
    const note = res.json() as { space_id: string | null; workspace_id: string | null };
    expect(note.space_id).toBe(spaceId);
    expect(note.workspace_id).toBe(DEFAULT_TENANT_ID);

    const { rows } = await pool.query<{ space_id: string | null }>(
      `SELECT space_id FROM notes WHERE client_note_id = 'into-space'`,
    );
    expect(rows[0]!.space_id).toBe(spaceId);
  });

  it("refuses with 403 when the caller is in no team of that space", async () => {
    const res = await strangerApp.inject({
      method: "POST",
      url: "/api/notes/create",
      payload: { client_note_id: "trespass", content: "x", space_id: spaceId },
    });

    expect(res.statusCode).toBe(403);
    // And nothing was written under any scope.
    const { rows } = await pool.query(`SELECT 1 FROM notes WHERE client_note_id = 'trespass'`);
    expect(rows).toHaveLength(0);
  });

  it("refuses a space that does not exist rather than filing the note as personal", async () => {
    const res = await memberApp.inject({
      method: "POST",
      url: "/api/notes/create",
      payload: {
        client_note_id: "ghost-space",
        content: "x",
        space_id: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(res.statusCode).toBe(403);
    const { rows } = await pool.query(`SELECT 1 FROM notes WHERE client_note_id = 'ghost-space'`);
    expect(rows).toHaveLength(0);
  });

  it("still accepts an explicit personal scope", async () => {
    const res = await memberApp.inject({
      method: "POST",
      url: "/api/notes/create",
      payload: {
        client_note_id: "personal",
        content: "x",
        workspace_id: null,
        space_id: null,
      },
    });

    expect(res.statusCode).toBe(201);
    expect((res.json() as { space_id: string | null }).space_id).toBeNull();
  });

  it("carries the scope through batch-create, refusing the whole batch on trespass", async () => {
    const ok = await memberApp.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      payload: { notes: [{ client_note_id: "batch-in-space", content: "x", space_id: spaceId }] },
    });
    expect(ok.statusCode).toBe(201);

    const denied = await strangerApp.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      payload: { notes: [{ client_note_id: "batch-trespass", content: "x", space_id: spaceId }] },
    });
    expect(denied.statusCode).toBe(403);

    const { rows } = await pool.query(
      `SELECT 1 FROM notes WHERE client_note_id = 'batch-trespass'`,
    );
    expect(rows).toHaveLength(0);
  });
});
