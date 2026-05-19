// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56 / Plan 05 (R11) — CONTRACT-01 conformance test for the
// /api/transcriptions/* wire surface AFTER the §R11 status-code flip
// (POST creates → 201, DELETE → 204, batch-delete atomic 404 on partial).
//
// Sibling to packages/contract-tests/tests/unit/transcriptions.test.ts
// which already covers happy-path body shapes for the 5-route surface.
// This file is the NEW deliverable mandated by the Phase 56 Plan 05
// CONTEXT (CONTRACT-01) — a dedicated wire-shape probe that asserts the
// new spec semantics in isolation so a regression on the status-code
// flip surfaces here first, with a focused error message.
//
// Lives under `src/**` per the plan's explicit instruction; the sibling
// vitest.config.ts `include` was extended to `["tests/**/*.test.ts",
// "src/**/*.test.ts"]` so this file is discovered. Suite skip-if-
// unreachable semantics (probeBackend + describe.skipIf) mirror the
// adjacent tests/unit/transcriptions.test.ts conventions.
//
// Reference: /Users/nick/openwhispr/.planning/phases/08-client-server-
// audit/SERVER-REQUIREMENTS.md §R11 (lines 430-454).

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();

const CloudTranscriptionShape = z.object({
  id: z.string(),
  client_transcription_id: z.string().nullable(),
  text: z.string(),
  raw_text: z.string().nullable(),
  word_count: z.number(),
  source: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  language: z.string().nullable(),
  audio_duration_ms: z.number().nullable(),
  status: z.string(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const BatchCreateResponse = z.object({
  created: z.array(CloudTranscriptionShape),
});

const BatchDeleteResponse = z.object({ deleted: z.array(z.string()) });

function rnd(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe.skipIf(!REACHABLE)("R11 status-code conformance — /api/transcriptions/*", () => {
  it("POST /api/transcriptions/create → 201 + CloudTranscription body", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_transcription_id: rnd("r11-cr"),
        text: "r11 create body",
      }),
    });
    // Spec §R11 — POST creates resource → 201 (not 200).
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(() => CloudTranscriptionShape.parse(body)).not.toThrow();
  });

  it("POST /api/transcriptions/create idempotent retry → 201 (NOT 200, NOT 409)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const clientId = rnd("r11-idem");
    const opts = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_transcription_id: clientId, text: "first" }),
    };
    const r1 = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, opts);
    const r2 = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      ...opts,
      body: JSON.stringify({ client_transcription_id: clientId, text: "SECOND" }),
    });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.status).not.toBe(409);
    const j1 = CloudTranscriptionShape.parse(await r1.json());
    const j2 = CloudTranscriptionShape.parse(await r2.json());
    // D-24 — same row returned, first-writer-wins on text.
    expect(j2.id).toBe(j1.id);
    expect(j2.text).toBe("first");
  });

  it("POST /api/transcriptions/batch-create → 201 + { created: CloudTranscription[] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/transcriptions/batch-create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcriptions: [
          { client_transcription_id: rnd("r11-bc1"), text: "x1" },
          { client_transcription_id: rnd("r11-bc2"), text: "x2" },
        ],
      }),
    });
    // Spec §R11 — batch wrapper of POST-create → 201.
    expect(res.status).toBe(201);
    const parsed = BatchCreateResponse.parse(await res.json());
    expect(parsed.created).toHaveLength(2);
  });

  it("DELETE /api/transcriptions/delete → 204 No Content, EMPTY body", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const created = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_transcription_id: rnd("r11-del"),
        text: "to delete",
      }),
    });
    expect(created.status).toBe(201);
    const { id } = CloudTranscriptionShape.parse(await created.json());
    const del = await jar.fetch(`${BACKEND_URL}/api/transcriptions/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    // Spec §R11 — DELETE success → 204 with empty body (RFC 7230 §3.3.2).
    expect(del.status).toBe(204);
    const text = await del.text();
    expect(text).toBe("");
  });

  it("POST /api/transcriptions/batch-delete (all-real) → 200 + { deleted: string[] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const created = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_transcription_id: rnd(`r11-bdh-${i}`),
          text: `bdh-${i}`,
        }),
      });
      expect(created.status).toBe(201);
      ids.push(CloudTranscriptionShape.parse(await created.json()).id);
    }
    const res = await jar.fetch(`${BACKEND_URL}/api/transcriptions/batch-delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    // Happy path stays 200 — only the partial-failure path 404s.
    expect(res.status).toBe(200);
    const body = BatchDeleteResponse.parse(await res.json());
    expect(new Set(body.deleted)).toEqual(new Set(ids));
  });

  it("POST /api/transcriptions/batch-delete (atomic) → 404 on ANY id missing", async () => {
    // Spec §R11 + Phase 56 CONTEXT atomicity decision — if any id in the
    // batch fails to match (missing, already-deleted, RLS-hidden), the
    // WHOLE transaction rolls back and the route returns 404.
    const jar = await signInFixture("fixture@conformance.test");
    const created = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_transcription_id: rnd("r11-bda-real"),
        text: "real",
      }),
    });
    expect(created.status).toBe(201);
    const realId = CloudTranscriptionShape.parse(await created.json()).id;
    const fakeId = "11111111-2222-4333-8444-555566667777";

    const res = await jar.fetch(`${BACKEND_URL}/api/transcriptions/batch-delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [realId, fakeId] }),
    });
    expect(res.status).toBe(404);
    const env = ErrorEnvelope.parse(await res.json());
    expect(env.error).toMatch(/transcription not found/i);

    // ATOMICITY — realId was NOT soft-deleted; it still appears on list.
    const list = await jar.fetch(`${BACKEND_URL}/api/transcriptions/list?limit=100`);
    const listBody = (await list.json()) as {
      transcriptions: { id: string }[];
    };
    expect(listBody.transcriptions.find((t) => t.id === realId)).toBeDefined();
  });
});
