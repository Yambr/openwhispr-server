// SPDX-License-Identifier: FSL-1.1-ALv2
// Push-side wire contract for folders — the space-scope fields.
//
// Once GET /api/me/spaces answers 200 the desktop's team-space capability flag
// flips on, and from then on EVERY folder push carries an explicit scope pair:
// `{ workspace_id: null, space_id: null }` for a personal row
// (SyncService.pushScopeFields → resolvePushScope). `FolderInputSchema` is
// declared `.strict()` and knew neither key, so every create and every batch
// answered 400 and folder sync stopped dead.
//
// Non-null scope is a DIFFERENT case and must stay loud: this deployment has no
// spaces, so a row claiming one is a client/server disagreement. Accepting it
// silently would file team content into a personal folder, which is exactly the
// kind of quiet mis-scoping the desktop's purge logic cannot undo.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/folders/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

let pool: Pool;
let userId: string;
let app: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [DEFAULT_TENANT_ID, "folders-space-scope@test"],
  );
  userId = r.rows[0]!.id;
  app = await buildTestApp({ pool, userId });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM folders WHERE user_id = $1`, [userId]);
});

describe("integration — folders push carrying explicit null space scope", () => {
  it("accepts POST /api/folders/create with workspace_id and space_id null", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/folders/create",
      payload: {
        name: "Personal",
        client_folder_id: "scope-create-1",
        is_default: false,
        sort_order: 0,
        workspace_id: null,
        space_id: null,
      },
    });

    expect(res.statusCode).toBe(201);
    const folder = res.json() as { workspace_id: string | null; space_id: string | null };
    expect(folder.workspace_id).toBeNull();
    expect(folder.space_id).toBeNull();
  });

  it("accepts POST /api/folders/batch-create with the same scope pair", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/folders/batch-create",
      payload: {
        folders: [
          {
            name: "Batch A",
            client_folder_id: "scope-batch-1",
            is_default: false,
            sort_order: 0,
            workspace_id: null,
            space_id: null,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const { created } = res.json() as { created: { client_folder_id: string }[] };
    expect(created.map((f) => f.client_folder_id)).toEqual(["scope-batch-1"]);
  });

  it("refuses a non-null space_id rather than filing the row as personal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/folders/create",
      payload: {
        name: "Team folder",
        client_folder_id: "scope-create-2",
        space_id: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(res.statusCode).toBe(400);
  });
});
