// SPDX-License-Identifier: FSL-1.1-ALv2
// Body size on the batch endpoints the desktop actually fills.
//
// The desktop pushes notes in fixed chunks of 50 (SyncService BATCH_SIZE) and
// a synced note carries its `content`, `enhanced_content` and `transcript`.
// Fastify's global bodyLimit default is 1 MiB, which a handful of meeting
// transcripts clears on its own — the client got "Request body is too large",
// treated the chunk as failed, and retried the same oversized chunk forever.
// Nothing on the client side can split it: the batch size is a constant in a
// build we do not control.
//
// The limit is raised ON THE BATCH ROUTES, not globally. These are the only
// endpoints that aggregate rows, they already carry the tightest rate limit
// (5/min), and a global raise would hand every other endpoint the same
// multi-megabyte buffer for nothing.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/notes/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const FASTIFY_DEFAULT_BODY_LIMIT = 1024 * 1024;

let pool: Pool;
let userId: string;
let app: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [DEFAULT_TENANT_ID, "notes-body-size@test"],
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

describe("integration — POST /api/notes/batch-create body size", () => {
  it("accepts a chunk of transcript-bearing notes past Fastify's 1 MiB default", async () => {
    // Four notes with a ~600 KB transcript each — a plausible morning of
    // recorded meetings, and well inside the per-note schema caps.
    const transcript = "word ".repeat(120_000);
    const notes = [0, 1, 2, 3].map((i) => ({
      client_note_id: `big-${i}`,
      title: `Meeting ${i}`,
      content: "summary",
      transcript,
      workspace_id: null,
      space_id: null,
    }));
    const payload = JSON.stringify({ notes });
    expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(FASTIFY_DEFAULT_BODY_LIMIT);

    const res = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      headers: { "content-type": "application/json" },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const { created } = res.json() as { created: { client_note_id: string }[] };
    expect(created).toHaveLength(4);
  });
});
