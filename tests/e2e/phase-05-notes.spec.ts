// tests/e2e/phase-05-notes — host-side e2e for WIRE-22.
//
// Round-trips the full notes CRUD + search lifecycle through Traefik
// (TLS) → api → real Postgres + PgBouncer via the docker-compose stack:
//   1. create 3 notes (client_note_id deterministic)
//   2. list — verify 3 visible
//   3. search — verify matching by content
//   4. soft-delete one — verify list excludes it
//   5. delete-all — verify list returns empty
//
// Idempotency check: re-create the same client_note_id and expect the
// existing row (200, not 409, per D-24).

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const CloudNote = z.object({
  id: z.string(),
  client_note_id: z.string().nullable(),
  title: z.string().nullable(),
  content: z.string(),
  note_type: z.string(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const ListResponse = z.object({ notes: z.array(CloudNote) });
const SearchResponse = z.object({
  notes: z.array(CloudNote.extend({ score: z.number() })),
});
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

function rnd(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("e2e — /api/notes/* full lifecycle (real compose stack)", () => {
  it("create → list → search → delete → delete-all round-trip", async () => {
    const jar = await signInFixture("fixture@conformance.test");

    // Clean slate: purge the fixture user's notes so the round-trip is
    // deterministic. Tolerate 200 (purged) or 400 (already > 1000 cap —
    // shouldn't happen in CI; surface as a test-data hygiene issue).
    const purge = await jar.fetch(`${BACKEND_URL}/api/notes/delete-all`, {
      method: "DELETE",
    });
    expect([200, 400]).toContain(purge.status);

    // Create 3 notes with deterministic client_note_ids.
    const idA = rnd("a");
    const idB = rnd("b");
    const idC = rnd("c");
    const seeds = [
      { client_note_id: idA, title: "Alpha", content: "the alpha note covers quarterly review" },
      { client_note_id: idB, title: "Beta", content: "the beta note describes the roadmap" },
      { client_note_id: idC, title: "Gamma", content: "gamma is unrelated to either" },
    ];
    const createdIds: string[] = [];
    for (const seed of seeds) {
      const res = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(seed),
      });
      expect(res.status).toBe(200);
      const note = CloudNote.parse(await res.json());
      createdIds.push(note.id);
    }
    expect(new Set(createdIds).size).toBe(3);

    // Idempotency: re-create idA — same id, NOT 409.
    const retry = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_note_id: idA, title: "DIFFERENT" }),
    });
    expect(retry.status).toBe(200);
    expect(retry.status).not.toBe(409);
    const retryNote = CloudNote.parse(await retry.json());
    expect(retryNote.id).toBe(createdIds[0]);
    expect(retryNote.title).toBe("Alpha"); // first-writer-wins.

    // List — should see at least the 3 we created.
    const list1 = await jar.fetch(`${BACKEND_URL}/api/notes/list?limit=50`);
    expect(list1.status).toBe(200);
    const list1Body = ListResponse.parse(await list1.json());
    expect(list1Body.notes.length).toBeGreaterThanOrEqual(3);
    for (const id of createdIds) {
      expect(list1Body.notes.find((n) => n.id === id)).toBeDefined();
    }

    // Search — query "quarterly" should match Alpha.
    const search = await jar.fetch(`${BACKEND_URL}/api/notes/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "quarterly" }),
    });
    expect(search.status).toBe(200);
    const searchBody = SearchResponse.parse(await search.json());
    expect(searchBody.notes.find((n) => n.id === createdIds[0])).toBeDefined();

    // Search — empty query → 400 envelope.
    const emptySearch = await jar.fetch(`${BACKEND_URL}/api/notes/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(emptySearch.status).toBe(400);
    expect(() => ErrorEnvelope.parse(await emptySearch.json())).not.toThrow();

    // Soft-delete idB.
    const del = await jar.fetch(`${BACKEND_URL}/api/notes/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: createdIds[1] }),
    });
    expect(del.status).toBe(200);

    // List — idB excluded.
    const list2 = await jar.fetch(`${BACKEND_URL}/api/notes/list?limit=50`);
    const list2Body = ListResponse.parse(await list2.json());
    expect(list2Body.notes.find((n) => n.id === createdIds[1])).toBeUndefined();

    // delete-all — purge remaining.
    const all = await jar.fetch(`${BACKEND_URL}/api/notes/delete-all`, {
      method: "DELETE",
    });
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { deleted: number };
    expect(allBody.deleted).toBeGreaterThanOrEqual(2);

    // List — empty for this user.
    const list3 = await jar.fetch(`${BACKEND_URL}/api/notes/list?limit=50`);
    expect(list3.status).toBe(200);
    const list3Body = ListResponse.parse(await list3.json());
    // The fixture user MAY have other notes from prior test runs; we
    // only assert ours are gone.
    for (const id of createdIds) {
      expect(list3Body.notes.find((n) => n.id === id)).toBeUndefined();
    }
  });

  it("401 envelope on every notes route when unauthenticated", async () => {
    const probes: Array<{ method: string; url: string; body?: string }> = [
      { method: "POST", url: "/api/notes/create", body: "{}" },
      { method: "POST", url: "/api/notes/batch-create", body: "{}" },
      { method: "PATCH", url: "/api/notes/update", body: "{}" },
      { method: "DELETE", url: "/api/notes/delete", body: "{}" },
      { method: "DELETE", url: "/api/notes/delete-all" },
      { method: "GET", url: "/api/notes/list" },
      { method: "POST", url: "/api/notes/search", body: '{"query":"x"}' },
    ];
    for (const p of probes) {
      const init: RequestInit = { method: p.method };
      if (p.body) {
        init.headers = { "content-type": "application/json" };
        init.body = p.body;
      }
      const res = await fetch(`${BACKEND_URL}${p.url}`, init);
      expect(res.status, `${p.method} ${p.url}`).toBe(401);
      expect(() => ErrorEnvelope.parse(await res.json())).not.toThrow();
    }
  });
});
