// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — batch-create integration tests.
//
// Covers:
//   * happy path — 3 notes returned in input order with {client_note_id, id}.
//   * idempotency — same client_note_id batch retries are no-ops on the
//     ON CONFLICT path.
//   * D-30 — 501-item batch → 400 envelope.
//   * canonical wrapper { notes: [...] } AND bare array [...] both accepted.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/notes/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

// Phase 18.1.2 / Plan 05 / Cluster #2 sub-cluster 2b — shared-pg
// migration (Option A canon — see conversations/__tests__/crud
// header for full rationale).

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
    [DEFAULT_TENANT_ID, "batch@test"],
  );
  userId = r.rows[0]!.id;
  app = await buildTestApp({ pool, userId });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes`);
});

describe("integration — POST /api/notes/batch-create", () => {
  it("happy path — accepts { notes: [...] } wrapper and returns { created: [...] }", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        notes: [
          { client_note_id: "b-1", title: "one" },
          { client_note_id: "b-2", title: "two" },
          { client_note_id: "b-3", title: "three" },
        ],
      }),
    });
    // Phase 56-02 / R8 — batch-create returns 201 Created.
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      created: { client_note_id: string; id: string }[];
    };
    expect(body.created).toHaveLength(3);
    expect(body.created.map((r) => r.client_note_id)).toEqual(["b-1", "b-2", "b-3"]);
    for (const r of body.created) expect(r.id).toBeTruthy();
  });

  it("R37 — accepts a free-text note_type + SQLite-form created_at and normalizes note_type", async () => {
    // The immutable client syncs a raw SQLite note: `note_type` is the
    // unconstrained free-text column (here "note", outside the canonical
    // enum) and `created_at` is the space-separated SQLite form. Both
    // were 400 before R37/R35. The route accepts them; note_type is
    // normalized to a canonical value so the strict CloudNote response
    // schema is satisfiable.
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        notes: [
          {
            client_note_id: "r37-1",
            title: "r37",
            content: "c",
            note_type: "note",
            source_file: null,
            audio_duration_seconds: null,
            enhanced_content: null,
            enhancement_prompt: null,
            enhanced_at_content_hash: null,
            transcript: null,
            created_at: "2026-05-22 17:20:40",
            updated_at: "2026-05-22 17:20:40",
          },
        ],
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      created: { client_note_id: string; id: string }[];
    };
    expect(body.created).toHaveLength(1);
    expect(body.created[0]?.client_note_id).toBe("r37-1");
    expect(body.created[0]?.id).toBeTruthy();
    // batch-create returns the lightweight {client_note_id, id} shape;
    // verify the stored row's note_type was normalized via the
    // full-CloudNote list endpoint.
    const list = await app.inject({ method: "GET", url: "/api/notes/list" });
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { notes: { client_note_id: string; note_type: string }[] })
      .notes;
    const r37 = listed.find((n) => n.client_note_id === "r37-1");
    expect(r37).toBeDefined();
    // the free-text "note" was normalized to the canonical default.
    expect(r37?.note_type).toBe("personal");
  });

  it("accepts a bare array body (forward-compat with plan <behavior>)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([
        { client_note_id: "arr-1", title: "x" },
        { client_note_id: "arr-2", title: "y" },
      ]),
    });
    // Phase 56-02 / R8 — batch-create returns 201 Created.
    expect(res.statusCode).toBe(201);
    const { created } = res.json() as { created: { client_note_id: string }[] };
    expect(created.map((c) => c.client_note_id)).toEqual(["arr-1", "arr-2"]);
  });

  it("idempotency — re-batching the same client_note_ids preserves first-writer-wins per row", async () => {
    const payload = JSON.stringify({
      notes: [
        { client_note_id: "idem-A", title: "first-A" },
        { client_note_id: "idem-B", title: "first-B" },
      ],
    });
    const r1 = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      headers: { "content-type": "application/json" },
      payload,
    });
    // Phase 56-02 / R8 — batch-create returns 201 Created.
    expect(r1.statusCode).toBe(201);
    const ids1 = (r1.json() as { created: { client_note_id: string; id: string }[] }).created.map(
      (c) => c.id,
    );

    const r2 = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        notes: [
          { client_note_id: "idem-A", title: "SECOND-A" },
          { client_note_id: "idem-B", title: "SECOND-B" },
        ],
      }),
    });
    // Phase 56-02 / R8 — idempotent retry also returns 201.
    expect(r2.statusCode).toBe(201);
    const ids2 = (r2.json() as { created: { client_note_id: string; id: string }[] }).created.map(
      (c) => c.id,
    );
    expect(ids2).toEqual(ids1); // same row IDs preserved.

    // Verify the row contents are first-writer-wins.
    const { rows } = await pool.query<{ client_note_id: string; title: string }>(
      `SELECT client_note_id, title FROM notes WHERE user_id = $1 ORDER BY client_note_id`,
      [userId],
    );
    expect(rows).toEqual([
      { client_note_id: "idem-A", title: "first-A" },
      { client_note_id: "idem-B", title: "first-B" },
    ]);
  });

  it("D-30 — 501-item batch returns 400 envelope", async () => {
    const notes = Array.from({ length: 501 }, (_, i) => ({
      client_note_id: `huge-${i}`,
      title: `t-${i}`,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ notes }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/500/);
    // 500 = MAX_BATCH_SIZE in route.
  });

  it("500-item batch is the boundary that succeeds", async () => {
    const notes = Array.from({ length: 500 }, (_, i) => ({
      client_note_id: `edge-${i}`,
      title: `t-${i}`,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ notes }),
    });
    // Phase 56-02 / R8 — batch-create returns 201 Created.
    expect(res.statusCode).toBe(201);
    const body = res.json() as { created: { client_note_id: string }[] };
    expect(body.created).toHaveLength(500);
  });
});
