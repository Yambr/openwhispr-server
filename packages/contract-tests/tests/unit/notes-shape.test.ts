// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56 / Plan 02 — CONTRACT-01 extension: R8 notes CRUD wire-shape
// + status-code conformance against a live BACKEND_URL.
//
// Asserts the shape contract per /Users/dev/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md
// §R8 (Notes CRUD endpoints), specifically the three status codes that
// flipped in Phase 56-02:
//   * POST /api/notes/create        → 201 CloudNote
//   * POST /api/notes/batch-create  → 201 { created: [...] }
//   * DELETE /api/notes/delete      → 204 No Content (empty body)
//
// The remaining four endpoints (PATCH /update, GET /list, POST /search,
// DELETE /delete-all) are pinned at their existing 200 codes per spec
// and are also exercised here as a regression guard against future
// drift.
//
// Placed at packages/contract-tests/src/notes-shape.test.ts per the
// plan's explicit deliverable path; sibling Plan 56-05 has already
// broadened the vitest include pattern to `src/**/*.test.ts` so this
// colocation runs the same as tests under tests/unit/.
//
// Skip semantics: `describe.skipIf(!REACHABLE)` so when no
// docker-compose stack is reachable the suite passes cleanly (CI /
// `make contract-test` set BACKEND_URL explicitly and bring the stack
// up).

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { signInFixture } from "../../src/helpers/sign-in-fixture.js";

const REACHABLE = await probeBackend();

// Mirrors the 19-field CloudNote shape asserted by
// apps/api/tests/unit/routes/notes/__tests__/crud.integration.test.ts
// lines 87-107 (the canonical server-side fingerprint).
const CloudNote = z
  .object({
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
    transcript: z.unknown().nullable(),
    enhanced_at_content_hash: z.string().nullable(),
    participants: z.unknown().nullable(),
    calendar_event_id: z.string().nullable(),
    diarization_enabled: z.number().nullable(),
    expected_speaker_count: z.number().nullable(),
    deleted_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

const BatchCreateResponse = z.object({
  created: z.array(
    z.object({
      client_note_id: z.string(),
      id: z.string(),
    }),
  ),
});

function rnd(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe.skipIf(!REACHABLE)("R8 — /api/notes/* wire shape + status codes", () => {
  it("POST /api/notes/create returns 201 CloudNote (Phase 56-02 §R8)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_note_id: rnd("c56-02"),
        title: "phase-56-02 contract test",
        content: "wire-shape check",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const parsed = CloudNote.parse(body);
    expect(parsed.title).toBe("phase-56-02 contract test");
    expect(parsed.content).toBe("wire-shape check");
    expect(parsed.deleted_at).toBeNull();
  });

  it("POST /api/notes/batch-create returns 201 { created: [...] } (Phase 56-02 §R8)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const ids = [rnd("b56-02-1"), rnd("b56-02-2")];
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/batch-create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notes: ids.map((cid, i) => ({
          client_note_id: cid,
          title: `batch-${i}`,
          content: `body-${i}`,
        })),
      }),
    });
    expect(res.status).toBe(201);
    const parsed = BatchCreateResponse.parse(await res.json());
    expect(parsed.created).toHaveLength(2);
    expect(parsed.created.map((r) => r.client_note_id).sort()).toEqual([...ids].sort());
    for (const r of parsed.created) expect(r.id).toBeTruthy();
  });

  it("DELETE /api/notes/delete returns 204 with empty body (Phase 56-02 §R8)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    // Seed a row to delete.
    const seed = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_note_id: rnd("d56-02"),
        title: "to-be-deleted",
        content: "x",
      }),
    });
    expect(seed.status).toBe(201);
    const { id } = (await seed.json()) as { id: string };

    const del = await jar.fetch(`${BACKEND_URL}/api/notes/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    expect(del.status).toBe(204);
    // 204 carries no body per HTTP spec — assert literally empty.
    const text = await del.text();
    expect(text).toBe("");
  });

  it("PATCH /api/notes/update returns 200 CloudNote (regression — spec unchanged)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const seed = await jar.fetch(`${BACKEND_URL}/api/notes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_note_id: rnd("u56-02"),
        title: "before",
        content: "before-body",
      }),
    });
    const { id } = (await seed.json()) as { id: string };

    const patch = await jar.fetch(`${BACKEND_URL}/api/notes/update`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, title: "after" }),
    });
    expect(patch.status).toBe(200);
    const parsed = CloudNote.parse(await patch.json());
    expect(parsed.id).toBe(id);
    expect(parsed.title).toBe("after");
  });

  it("GET /api/notes/list returns 200 { notes: CloudNote[] } (regression — spec unchanged)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/list`);
    expect(res.status).toBe(200);
    const parsed = z.object({ notes: z.array(CloudNote) }).parse(await res.json());
    expect(Array.isArray(parsed.notes)).toBe(true);
  });

  it("POST /api/notes/search returns 200 { notes: CloudNote[] } (regression — spec unchanged)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "phase-56-02" }),
    });
    expect(res.status).toBe(200);
    const parsed = z.object({ notes: z.array(CloudNote) }).parse(await res.json());
    expect(Array.isArray(parsed.notes)).toBe(true);
  });

  it("DELETE /api/notes/delete-all returns 200 { deleted: number } (regression — spec unchanged)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/notes/delete-all`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const parsed = z.object({ deleted: z.number().int().nonnegative() }).parse(await res.json());
    expect(parsed.deleted).toBeGreaterThanOrEqual(0);
  });
});
