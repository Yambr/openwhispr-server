// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 08 / Task 2 — WIRE-26 contract conformance tests for
// /api/transcriptions/* (5 routes — no search, no update per upstream
// TranscriptionsService.ts).
//
// Asserts the wire shape against a live BACKEND_URL with the seeded
// fixture user. Skip-if-unreachable semantics mirror folders.test.ts.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { signInFixture } from "../../src/helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "../../src/schemas.js";

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

const ListResponse = z.object({
  transcriptions: z.array(CloudTranscriptionShape),
});
const BatchCreateResponse = z.object({
  created: z.array(CloudTranscriptionShape),
});
// Phase 56 / Plan 05 (R11) — DELETE returns 204 No Content (empty body),
// so the prior `DeleteResponse = { ok: true }` schema was removed entirely.
const BatchDeleteResponse = z.object({ deleted: z.array(z.string()) });

function rnd(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe.skipIf(!REACHABLE)("WIRE-26 — /api/transcriptions/* (5 routes)", () => {
  it("POST /api/transcriptions/create returns CloudTranscription shape", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_transcription_id: rnd("ct"),
        text: "contract create",
      }),
    });
    // Phase 56 / Plan 05 (R11) — POST /create returns 201.
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(() => CloudTranscriptionShape.parse(body)).not.toThrow();
  });

  it("POST /api/transcriptions/create idempotent on same client_transcription_id (201, not 409)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const clientId = rnd("idem");
    const r1 = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_transcription_id: clientId,
        text: "idem first",
      }),
    });
    const r2 = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_transcription_id: clientId,
        text: "idem second",
      }),
    });
    // Phase 56 / Plan 05 (R11) — both legs 201, idempotent body match.
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.status).not.toBe(409);
    const j1 = CloudTranscriptionShape.parse(await r1.json());
    const j2 = CloudTranscriptionShape.parse(await r2.json());
    expect(j2.id).toBe(j1.id);
    expect(j2.text).toBe("idem first");
  });

  it("POST /api/transcriptions/batch-create returns { created: CloudTranscription[] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/transcriptions/batch-create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcriptions: [
          { client_transcription_id: rnd("bc1"), text: "x" },
          { client_transcription_id: rnd("bc2"), text: "y" },
        ],
      }),
    });
    // Phase 56 / Plan 05 (R11) — batch-create returns 201.
    expect(res.status).toBe(201);
    const parsed = BatchCreateResponse.parse(await res.json());
    expect(parsed.created).toHaveLength(2);
  });

  it("GET /api/transcriptions/list returns { transcriptions: CloudTranscription[] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/transcriptions/list?limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(() => ListResponse.parse(body)).not.toThrow();
  });

  it("DELETE /api/transcriptions/delete returns 204 No Content (empty body)", async () => {
    // Phase 56 / Plan 05 (R11) — DELETE returns 204 with empty body
    // (RFC 7230 §3.3.2). Prior { ok: true } body shape was removed.
    const jar = await signInFixture("fixture@conformance.test");
    const created = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_transcription_id: rnd("del"),
        text: "to delete",
      }),
    });
    const { id } = CloudTranscriptionShape.parse(await created.json());
    const del = await jar.fetch(`${BACKEND_URL}/api/transcriptions/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    expect(del.status).toBe(204);
    const text = await del.text();
    expect(text).toBe("");
  });

  it("POST /api/transcriptions/batch-delete returns { deleted: string[] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    // Create 2 rows.
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const created = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_transcription_id: rnd(`bdc-${i}`),
          text: `t${i}`,
        }),
      });
      ids.push(CloudTranscriptionShape.parse(await created.json()).id);
    }
    const res = await jar.fetch(`${BACKEND_URL}/api/transcriptions/batch-delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    expect(res.status).toBe(200);
    const body = BatchDeleteResponse.parse(await res.json());
    expect(new Set(body.deleted)).toEqual(new Set(ids));
  });

  it("401 envelope when unauthenticated on every transcriptions route", async () => {
    const probes = [
      { method: "POST", url: "/api/transcriptions/create", body: "{}" },
      { method: "POST", url: "/api/transcriptions/batch-create", body: "{}" },
      { method: "GET", url: "/api/transcriptions/list" },
      { method: "DELETE", url: "/api/transcriptions/delete", body: "{}" },
      { method: "POST", url: "/api/transcriptions/batch-delete", body: "{}" },
    ] as const;
    for (const p of probes) {
      const init: RequestInit = { method: p.method };
      if ("body" in p && p.body) {
        init.headers = { "content-type": "application/json" };
        init.body = p.body;
      }
      const res = await fetch(`${BACKEND_URL}${p.url}`, init);
      expect(res.status, `${p.method} ${p.url}`).toBe(401);
      const body = await res.json();
      expect(() => ErrorEnvelope.parse(body)).not.toThrow();
    }
  });
});
