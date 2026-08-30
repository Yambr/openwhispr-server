// SPDX-License-Identifier: FSL-1.1-ALv2
// Desktop wire contract for GET /api/notes/list — team-scope query params and
// the delta cursor.
//
// WHY THIS EXISTS. `GET /api/me/spaces` is BOTH the desktop's account-scope
// guard and its team-scope capability probe (SyncService.syncSpaces). A 404
// hangs sign-in; a 200 — which this server has answered since 1.2.10 — flips
// `teamSpacesCapability` on, and from that moment every pull is issued in the
// team-capable form: `?scope=all` plus the `before_id` / `since_id` keyset
// tie-breakers built by services/noteListQuery.ts. The `.strict()` querystring
// schema rejected all three as "Unrecognized key", so note sync died wholesale.
// There is no third answer for /api/me/spaces, so accepting these params is
// mandatory regardless of whether team spaces are ever implemented.
//
// THE DELTA CASE IS OLDER AND INDEPENDENT. The client advances its `since`
// cursor with `last.updated_at` (SyncService.pullNotes) and expects rows
// ordered so that the LAST row of a page is the newest one applied. The server
// filtered and ordered by `created_at`, so an edit to an old note never
// reached a second device at all.

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
    [DEFAULT_TENANT_ID, "list-desktop-wire@test"],
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

interface SeededNote {
  id: string;
  created_at: string;
  updated_at: string;
}

async function seedNote(opts: {
  clientNoteId: string;
  createdAt: Date;
  updatedAt: Date;
}): Promise<SeededNote> {
  const { rows } = await pool.query<{ id: string; created_at: Date; updated_at: Date }>(
    `INSERT INTO notes (tenant_id, user_id, client_note_id, title, content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at, updated_at`,
    [
      DEFAULT_TENANT_ID,
      userId,
      opts.clientNoteId,
      opts.clientNoteId,
      `Content of ${opts.clientNoteId}`,
      opts.createdAt,
      opts.updatedAt,
    ],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

describe("integration — GET /api/notes/list, desktop team-scope query params", () => {
  it("accepts ?scope=all instead of rejecting it as an unrecognized key", async () => {
    await seedNote({
      clientNoteId: "scoped",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await app.inject({ method: "GET", url: "/api/notes/list?scope=all" });

    expect(res.statusCode).toBe(200);
    const { notes } = res.json() as { notes: { client_note_id: string }[] };
    // No spaces exist yet, so "all" is the caller's personal rows — the same
    // answer, not an error.
    expect(notes.map((n) => n.client_note_id)).toEqual(["scoped"]);
  });

  it("uses before_id to page past rows sharing one created_at", async () => {
    const sameInstant = new Date("2026-01-01T00:00:00.000Z");
    const seeded = [
      await seedNote({ clientNoteId: "tied-1", createdAt: sameInstant, updatedAt: sameInstant }),
      await seedNote({ clientNoteId: "tied-2", createdAt: sameInstant, updatedAt: sameInstant }),
      await seedNote({ clientNoteId: "tied-3", createdAt: sameInstant, updatedAt: sameInstant }),
    ];

    // Page one, exactly as the desktop asks for it.
    const page1 = await app.inject({
      method: "GET",
      url: "/api/notes/list?limit=2&scope=all",
    });
    expect(page1.statusCode).toBe(200);
    const first = (page1.json() as { notes: { id: string; created_at: string }[] }).notes;
    expect(first).toHaveLength(2);

    // The client carries the LAST row of the page forward as its next cursor.
    const cursor = first[1]!;
    const page2 = await app.inject({
      method: "GET",
      url: `/api/notes/list?limit=2&before=${cursor.created_at}&before_id=${cursor.id}&scope=all`,
    });

    expect(page2.statusCode).toBe(200);
    const second = (page2.json() as { notes: { id: string }[] }).notes;
    // Without the id tie-breaker, `created_at < cursor` matches nothing among
    // rows that share the instant and the third note is lost forever.
    expect(second).toHaveLength(1);
    const delivered = [...first, ...second].map((n) => n.id).sort();
    expect(delivered).toEqual(seeded.map((n) => n.id).sort());
  });

  it("emits ISO 8601 timestamps the client can hand straight back as a cursor", async () => {
    await seedNote({
      clientNoteId: "iso",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    const res = await app.inject({ method: "GET", url: "/api/notes/list?scope=all" });

    const { notes } = res.json() as { notes: { created_at: string; updated_at: string }[] };
    const note = notes[0]!;
    // The list path reads rows through raw `tx.execute`, so node-postgres hands
    // back timestamps as PG text ("2026-01-01 00:00:00+00"), not Date objects.
    // CloudNoteSchema declares ISO 8601, the create/update paths emit ISO, and
    // the client round-trips this exact value into `?before=` / `?since=` — a
    // PG-text cursor comes back through URL decoding with its `+00` turned into
    // a space and 400s the very next page.
    expect(note.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(note.updated_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("carries the space-scope fields and the owner the client backfills from", async () => {
    await seedNote({
      clientNoteId: "shaped",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await app.inject({ method: "GET", url: "/api/notes/list?scope=all" });

    const { notes } = res.json() as {
      notes: {
        workspace_id: string | null;
        space_id: string | null;
        user_id: string | null;
        updated_by_user_id: string | null;
      }[];
    };
    const note = notes[0]!;
    // Personal rows carry explicit nulls for scope; `user_id` is real because
    // SyncService.pullNotes reads `cloudNote.user_id!` to backfill the local
    // owner column.
    expect(note.workspace_id).toBeNull();
    expect(note.space_id).toBeNull();
    expect(note.user_id).toBe(userId);
    expect(note.updated_by_user_id).toBeNull();
  });
});

describe("integration — GET /api/notes/list, delta pull by ?since", () => {
  it("returns a long-existing note that was edited after the cursor", async () => {
    await seedNote({
      clientNoteId: "old-note-edited-today",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-30T00:00:00.000Z"),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/notes/list?since=2026-08-29T00:00:00.000Z&scope=all",
    });

    expect(res.statusCode).toBe(200);
    const { notes } = res.json() as { notes: { client_note_id: string }[] };
    // The client's cursor is an `updated_at`, so a delta window keyed on
    // `created_at` would silently drop every edit to an older note.
    expect(notes.map((n) => n.client_note_id)).toEqual(["old-note-edited-today"]);
  });

  it("excludes a note whose last edit predates the cursor", async () => {
    await seedNote({
      clientNoteId: "untouched-since-cursor",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/notes/list?since=2026-08-29T00:00:00.000Z&scope=all",
    });

    const { notes } = res.json() as { notes: unknown[] };
    expect(notes).toHaveLength(0);
  });

  it("orders a delta page oldest-edit first so the last row is the next cursor", async () => {
    await seedNote({
      clientNoteId: "edited-second",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-30T02:00:00.000Z"),
    });
    await seedNote({
      clientNoteId: "edited-first",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-08-30T01:00:00.000Z"),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/notes/list?since=2026-08-29T00:00:00.000Z&scope=all",
    });

    const { notes } = res.json() as { notes: { client_note_id: string }[] };
    // SyncService.pullNotes takes the LAST row of the page as the next cursor.
    // Descending order would hand it the oldest edit and re-request the page
    // forever; ascending order advances.
    expect(notes.map((n) => n.client_note_id)).toEqual(["edited-first", "edited-second"]);
  });

  it("uses since_id to page past rows sharing one updated_at", async () => {
    const sameInstant = new Date("2026-08-30T01:00:00.000Z");
    const a = await seedNote({
      clientNoteId: "tied-a",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: sameInstant,
    });
    const b = await seedNote({
      clientNoteId: "tied-b",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: sameInstant,
    });
    // Whichever id sorts first is page one; the other must still be reachable.
    const [firstId, secondClientId] = a.id < b.id ? [a.id, "tied-b"] : [b.id, "tied-a"];

    const res = await app.inject({
      method: "GET",
      url: `/api/notes/list?since=${sameInstant.toISOString()}&since_id=${firstId}&scope=all`,
    });

    expect(res.statusCode).toBe(200);
    const { notes } = res.json() as { notes: { client_note_id: string }[] };
    // Without the id tie-breaker a strict `updated_at >` comparison drops both
    // rows and the edit is lost; with it, the second row is still delivered.
    expect(notes.map((n) => n.client_note_id)).toEqual([secondClientId]);
  });
});
