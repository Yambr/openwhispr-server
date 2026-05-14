// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — CRUD integration tests (create + update +
// delete) against real Postgres + RLS.
//
// Covers:
//   * create — happy path round-trips a NoteInput → CloudNote shape;
//     all 19 upstream fields land correctly.
//   * create — same client_note_id on retry returns existing row
//     (200, NOT 409) per D-24 / Pattern 1.
//   * create — null client_note_id ALWAYS inserts new row (Pitfall #2).
//   * update — PATCH advances updated_at, mutates only owner's row.
//   * update — non-existent id → 404.
//   * delete — sets deleted_at; subsequent list excludes the row.
//   * RLS cross-tenant isolation: tenant B cannot see / mutate tenant A's
//     notes (FORCE-RLS proof).

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bootMigratedPostgres,
  buildTestApp,
  seedUser,
} from "../../../../../src/routes/notes/__tests__/setup.js";

const TENANT_A = "00000000-0000-0000-0000-000000000000";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

let pool: Pool;
let shutdown: () => Promise<void>;
let userA: string;
let userB: string;
let appA: FastifyInstance;
let appB: FastifyInstance;

beforeAll(async () => {
  const booted = await bootMigratedPostgres();
  pool = booted.pool;
  shutdown = booted.shutdown.bind(booted);
  // Seed tenants explicitly — tenant A is the default seeded by 0000_initial;
  // tenant B must be inserted.
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Tenant B') ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "crud-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "crud-b@test" });
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
  appB = await buildTestApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM notes`);
});

describe("integration — notes CRUD (real Postgres + RLS)", () => {
  it("create — happy path returns CloudNote shape with all 19 fields", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_note_id: "client-001",
        title: "Meeting notes",
        content: "Discussed quarterly roadmap",
        note_type: "meeting",
        audio_duration_seconds: 1234.5,
        diarization_enabled: 1,
        expected_speaker_count: 3,
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // Verify the 19 upstream CloudNote fields are present.
    const required = [
      "id",
      "client_note_id",
      "title",
      "content",
      "enhanced_content",
      "note_type",
      "enhancement_prompt",
      "source_file",
      "audio_duration_seconds",
      "folder_id",
      "transcript",
      "enhanced_at_content_hash",
      "participants",
      "calendar_event_id",
      "diarization_enabled",
      "expected_speaker_count",
      "deleted_at",
      "created_at",
      "updated_at",
    ];
    for (const k of required) expect(body).toHaveProperty(k);
    expect(body.client_note_id).toBe("client-001");
    expect(body.note_type).toBe("meeting");
    expect(body.audio_duration_seconds).toBe(1234.5);
    expect(body.diarization_enabled).toBe(1);
    expect(body.deleted_at).toBeNull();
  });

  it("create — same client_note_id on retry returns EXISTING row (200, NOT 409, D-24)", async () => {
    const payload = JSON.stringify({
      client_note_id: "idem-1",
      title: "first",
      content: "first content",
    });
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(r1.statusCode).toBe(200);
    const id1 = (r1.json() as { id: string }).id;

    // Retry with same client_note_id but DIFFERENT title — must return
    // the existing row, not overwrite.
    const r2 = await appA.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_note_id: "idem-1",
        title: "SECOND attempt — must be ignored",
        content: "different",
      }),
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.statusCode).not.toBe(409);
    const body2 = r2.json() as { id: string; title: string; content: string };
    expect(body2.id).toBe(id1);
    expect(body2.title).toBe("first");
    expect(body2.content).toBe("first content");
  });

  it("create — null client_note_id ALWAYS inserts (Pitfall #2)", async () => {
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ title: "untitled-A", content: "" }),
    });
    const r2 = await appA.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ title: "untitled-B", content: "" }),
    });
    const id1 = (r1.json() as { id: string }).id;
    const id2 = (r2.json() as { id: string }).id;
    expect(id1).not.toBe(id2);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notes WHERE user_id = $1 AND client_note_id IS NULL`,
      [userA],
    );
    expect(rows[0]?.n).toBe("2");
  });

  it("update — PATCH advances updated_at and mutates only owner's fields", async () => {
    const create = await appA.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_note_id: "upd-1",
        title: "old",
        content: "old content",
      }),
    });
    const { id, updated_at: oldUpdated } = create.json() as {
      id: string;
      updated_at: string;
    };
    await new Promise((r) => setTimeout(r, 25));

    const patch = await appA.inject({
      method: "PATCH",
      url: "/api/notes/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id, title: "new", content: "new content" }),
    });
    expect(patch.statusCode).toBe(200);
    const updated = patch.json() as {
      id: string;
      title: string;
      content: string;
      updated_at: string;
    };
    expect(updated.id).toBe(id);
    expect(updated.title).toBe("new");
    expect(updated.content).toBe("new content");
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(new Date(oldUpdated).getTime());
  });

  it("update — unknown id returns 404", async () => {
    const res = await appA.inject({
      method: "PATCH",
      url: "/api/notes/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
        title: "ghost",
      }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("delete — sets deleted_at; subsequent list excludes the row", async () => {
    const create = await appA.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_note_id: "del-1", title: "to-delete" }),
    });
    const { id } = create.json() as { id: string };
    const del = await appA.inject({
      method: "DELETE",
      url: "/api/notes/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id }),
    });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { ok: boolean }).ok).toBe(true);

    // Verify row still in DB but with deleted_at set.
    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM notes WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();

    // List MUST exclude.
    const list = await appA.inject({ method: "GET", url: "/api/notes/list" });
    const listBody = list.json() as { notes: { id: string }[] };
    expect(listBody.notes.find((n) => n.id === id)).toBeUndefined();
  });

  it("delete — unknown id returns 404", async () => {
    const res = await appA.inject({
      method: "DELETE",
      url: "/api/notes/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("RLS — tenant B cannot see or mutate tenant A's notes (T-05-07 mitigation)", async () => {
    // A creates a note.
    const create = await appA.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_note_id: "a-private", title: "A secret" }),
    });
    const { id } = create.json() as { id: string };

    // B's update attempt → 404 (RLS makes A's row invisible).
    const bUpdate = await appB.inject({
      method: "PATCH",
      url: "/api/notes/update",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id, title: "B's mutation" }),
    });
    expect(bUpdate.statusCode).toBe(404);

    // B's delete attempt → 404.
    const bDel = await appB.inject({
      method: "DELETE",
      url: "/api/notes/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id }),
    });
    expect(bDel.statusCode).toBe(404);

    // B's list does not contain A's note.
    const bList = await appB.inject({ method: "GET", url: "/api/notes/list" });
    const bBody = bList.json() as { notes: { id: string }[] };
    expect(bBody.notes.find((n) => n.id === id)).toBeUndefined();

    // Cross-tenant collision: B can also use client_note_id 'a-private'
    // (partial UNIQUE is scoped per (tenant_id, user_id, client_note_id)).
    const bCreate = await appB.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_note_id: "a-private", title: "B's own" }),
    });
    expect(bCreate.statusCode).toBe(200);

    // A's original row is still there with original title.
    const aList = await appA.inject({ method: "GET", url: "/api/notes/list" });
    const aBody = aList.json() as { notes: { id: string; title: string }[] };
    const aRow = aBody.notes.find((n) => n.id === id);
    expect(aRow?.title).toBe("A secret");
  });

  it("401 — missing req.user defensive guard", async () => {
    const Fastify = (await import("fastify")).default;
    const app = Fastify({ logger: false });
    const { registerErrorHandler } = await import("../../../../../src/error-handler");
    const { zodTypeProvider } = await import("../../../../../src/plugins/zod-type-provider");
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const db = drizzle(pool);
    const { buildNotesCreateRoutes } = await import("../../../../../src/routes/notes/create");
    await app.register(
      buildNotesCreateRoutes({
        db: db as unknown as Parameters<typeof buildNotesCreateRoutes>[0]["db"],
      }),
    );
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/notes/create",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ title: "x" }),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
