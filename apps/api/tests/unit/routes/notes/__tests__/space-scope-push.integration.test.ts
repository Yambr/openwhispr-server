// SPDX-License-Identifier: FSL-1.1-ALv2
// Push-side wire contract for notes — the space-scope fields.
//
// Mirrors folders/__tests__/space-scope-push.integration.test.ts. Every note
// push carries `{ workspace_id: null, space_id: null }` once the desktop's
// team-space capability flag is on, and `NoteInputSchema.strict()` rejected
// both keys.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/notes/__tests__/setup.js";
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
    [DEFAULT_TENANT_ID, "notes-space-scope@test"],
  );
  userId = r.rows[0]!.id;
  app = await buildTestApp({ pool, userId });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes WHERE user_id = $1`, [userId]);
});

describe("integration — notes push carrying explicit null space scope", () => {
  it("accepts POST /api/notes/create with workspace_id and space_id null", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/create",
      payload: {
        client_note_id: "scope-note-1",
        title: "Personal note",
        content: "body",
        workspace_id: null,
        space_id: null,
      },
    });

    expect(res.statusCode).toBe(201);
    const note = res.json() as { workspace_id: string | null; space_id: string | null };
    expect(note.workspace_id).toBeNull();
    expect(note.space_id).toBeNull();
  });

  it("accepts POST /api/notes/batch-create with the same scope pair", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      payload: {
        notes: [
          {
            client_note_id: "scope-note-2",
            title: "Batched",
            content: "body",
            workspace_id: null,
            space_id: null,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const { created } = res.json() as { created: { client_note_id: string }[] };
    expect(created.map((n) => n.client_note_id)).toEqual(["scope-note-2"]);
  });

  it("accepts PATCH /api/notes/update carrying the scope pair", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/notes/create",
      payload: { client_note_id: "scope-note-3", title: "Before", content: "body" },
    });
    const { id } = created.json() as { id: string };

    const res = await app.inject({
      method: "PATCH",
      url: "/api/notes/update",
      payload: { id, title: "After", workspace_id: null, space_id: null },
    });

    expect(res.statusCode).toBe(200);
  });

  it("refuses an unreachable space on update too, instead of ignoring it", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/notes/create",
      payload: { client_note_id: "scope-note-5", title: "Before", content: "body" },
    });
    const { id } = created.json() as { id: string };

    const res = await app.inject({
      method: "PATCH",
      url: "/api/notes/update",
      payload: { id, space_id: "11111111-1111-4111-8111-111111111111" },
    });

    // The update body is not `.strict()`, so before the scope pair was declared
    // this key was accepted and silently dropped — the client would believe the
    // note had moved into a space that does not exist.
    expect(res.statusCode).toBe(403);
  });

  it("refuses an unreachable space rather than filing the row as personal", async () => {
    // CONTRACT CHANGE, not a softened expectation. While no space could exist,
    // a non-null `space_id` was a 400: the payload described something the
    // deployment had no concept of. Spaces exist now, so naming one is a
    // well-formed request that may or may not be permitted — an unreachable
    // space is a 403 (assertSpaceWritable). What has NOT changed is the thing
    // that matters: the row is never quietly filed as personal.
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/create",
      payload: {
        client_note_id: "scope-note-4",
        content: "body",
        space_id: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(res.statusCode).toBe(403);
  });
});
