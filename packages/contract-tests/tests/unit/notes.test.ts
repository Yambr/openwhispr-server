// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 3 — WIRE-22 contract conformance tests for
// /api/notes/* (all 7 routes).
//
// Asserts the wire shape against a live BACKEND_URL with the seeded
// fixture user. Skip-if-unreachable semantics mirror other CONTRACT-01
// suites — when no backend is up, the suite passes cleanly.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { signInFixture } from "../../src/helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "../../src/schemas.js";

const REACHABLE = await probeBackend();

const CloudNoteShape = z.object({
  id: z.string(),
  client_note_id: z.string().nullable(),
  title: z.string().nullable(),
  content: z.string(),
  enhanced_content: z.string().nullable(),
  note_type: z.string(),
  enhancement_prompt: z.string().nullable(),
  source_file: z.string().nullable(),
  audio_duration_seconds: z.number().nullable(),
  folder_id: z.string().nullable(),
  transcript: z.string().nullable(),
  enhanced_at_content_hash: z.string().nullable(),
  participants: z.string().nullable(),
  calendar_event_id: z.string().nullable(),
  diarization_enabled: z.number().nullable(),
  expected_speaker_count: z.number().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const SearchResultShape = CloudNoteShape.extend({ score: z.number() });

const ListResponse = z.object({ notes: z.array(CloudNoteShape) });
const SearchResponse = z.object({ notes: z.array(SearchResultShape) });
const BatchCreateResponse = z.object({
  created: z.array(z.object({ client_note_id: z.string(), id: z.string() })),
});
const DeleteResponse = z.object({ ok: z.boolean() });
const DeleteAllResponse = z.object({ deleted: z.number() });

function rnd(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe.skipIf(!REACHABLE)("WIRE-22 — /api/notes/* (all 7 routes)", () => {
  it("POST /api/notes/create returns CloudNote shape", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_note_id: rnd("c"),
        title: "contract create",
        content: "create content",
      }),
    });
    expect(res.status).toBe(200);
    expect(() => CloudNoteShape.parse(await res.json())).not.toThrow();
  });

  it("POST /api/notes/create idempotent on same client_note_id (200, not 409)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const clientId = rnd("idem");
    const body = JSON.stringify({ client_note_id: clientId, title: "idem first" });
    const r1 = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const r2 = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_note_id: clientId, title: "idem second" }),
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.status).not.toBe(409);
    const j1 = CloudNoteShape.parse(await r1.json());
    const j2 = CloudNoteShape.parse(await r2.json());
    expect(j2.id).toBe(j1.id);
    expect(j2.title).toBe("idem first");
  });

  it("POST /api/notes/batch-create returns { created: [{client_note_id, id}] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/batch-create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notes: [
          { client_note_id: rnd("bc1"), title: "x" },
          { client_note_id: rnd("bc2"), title: "y" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const parsed = BatchCreateResponse.parse(await res.json());
    expect(parsed.created).toHaveLength(2);
  });

  it("PATCH /api/notes/update returns updated CloudNote", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const created = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_note_id: rnd("upd"), title: "before" }),
    });
    const { id } = CloudNoteShape.parse(await created.json());
    const patch = await jar.fetch(`${BACKEND_URL}/api/notes/update`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, title: "after" }),
    });
    expect(patch.status).toBe(200);
    const updated = CloudNoteShape.parse(await patch.json());
    expect(updated.title).toBe("after");
  });

  it("DELETE /api/notes/delete returns { ok: true }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const created = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_note_id: rnd("del"), title: "to delete" }),
    });
    const { id } = CloudNoteShape.parse(await created.json());
    const del = await jar.fetch(`${BACKEND_URL}/api/notes/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    expect(del.status).toBe(200);
    expect(() => DeleteResponse.parse(await del.json())).not.toThrow();
  });

  it("GET /api/notes/list returns { notes: CloudNote[] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/list?limit=5`);
    expect(res.status).toBe(200);
    expect(() => ListResponse.parse(await res.json())).not.toThrow();
  });

  it("POST /api/notes/search returns { notes: SearchResult[] } with numeric score", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    // Seed a known phrase first.
    await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_note_id: rnd("search"),
        title: "contract-search needle phrase",
        content: "contract-search needle phrase body",
      }),
    });
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "contract-search needle" }),
    });
    expect(res.status).toBe(200);
    expect(() => SearchResponse.parse(await res.json())).not.toThrow();
  });

  it("POST /api/notes/search returns 400 envelope on empty query", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(res.status).toBe(400);
    expect(() => ErrorEnvelope.parse(await res.json())).not.toThrow();
  });

  it("DELETE /api/notes/delete-all returns { deleted: number }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/delete-all`, {
      method: "DELETE",
    });
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(() => DeleteAllResponse.parse(await res.json())).not.toThrow();
    } else {
      // 400 envelope from the 1000-row cap.
      expect(() => ErrorEnvelope.parse(await res.json())).not.toThrow();
    }
  });

  it("401 envelope when unauthenticated on every notes route", async () => {
    const probes = [
      { method: "POST", url: "/api/notes/create", body: "{}" },
      { method: "POST", url: "/api/notes/batch-create", body: "{}" },
      { method: "PATCH", url: "/api/notes/update", body: "{}" },
      { method: "DELETE", url: "/api/notes/delete", body: "{}" },
      { method: "DELETE", url: "/api/notes/delete-all" },
      { method: "GET", url: "/api/notes/list" },
      { method: "POST", url: "/api/notes/search", body: '{"query":"x"}' },
    ] as const;
    for (const p of probes) {
      const init: RequestInit = { method: p.method };
      if ("body" in p && p.body) {
        init.headers = { "content-type": "application/json" };
        init.body = p.body;
      }
      const res = await fetch(`${BACKEND_URL}${p.url}`, init);
      expect(res.status, `${p.method} ${p.url}`).toBe(401);
      expect(() => ErrorEnvelope.parse(await res.json())).not.toThrow();
    }
  });
});
