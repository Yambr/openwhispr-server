// SPDX-License-Identifier: Apache-2.0
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
import {
  bootMigratedPostgres,
  buildTestApp,
  seedUser,
} from "../../../../../src/routes/notes/__tests__/setup.js";

let pool: Pool;
let shutdown: () => Promise<void>;
let userId: string;
let app: FastifyInstance;

beforeAll(async () => {
  const booted = await bootMigratedPostgres();
  pool = booted.pool;
  shutdown = booted.shutdown.bind(booted);
  userId = await seedUser(pool, { email: "batch@test" });
  app = await buildTestApp({ pool, userId });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (shutdown) await shutdown();
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
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      created: { client_note_id: string; id: string }[];
    };
    expect(body.created).toHaveLength(3);
    expect(body.created.map((r) => r.client_note_id)).toEqual(["b-1", "b-2", "b-3"]);
    for (const r of body.created) expect(r.id).toBeTruthy();
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
    expect(res.statusCode).toBe(200);
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
    expect(r1.statusCode).toBe(200);
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
    expect(r2.statusCode).toBe(200);
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
    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: { client_note_id: string }[] };
    expect(body.created).toHaveLength(500);
  });
});
