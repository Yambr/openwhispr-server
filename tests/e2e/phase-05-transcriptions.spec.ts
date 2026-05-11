// tests/e2e/phase-05-transcriptions — host-side e2e for WIRE-26.
//
// Round-trips the full transcriptions CRUD lifecycle through Traefik
// (TLS) → api → real Postgres + PgBouncer via the docker-compose stack:
//   1. create 3 transcriptions (deterministic client_transcription_ids)
//   2. idempotency retry — same id, NOT 409
//   3. list — all 3 visible
//   4. soft-delete one — list excludes
//   5. batch-delete remaining — list empty
//
// Mirrors tests/e2e/phase-05-folders.spec.ts.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const CloudTranscription = z.object({
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
  transcriptions: z.array(CloudTranscription),
});
const BatchDeleteResponse = z.object({ deleted: z.array(z.string()) });
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

function rnd(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("e2e — /api/transcriptions/* full lifecycle (real compose stack)", () => {
  it("create → idempotency → list → soft-delete → batch-delete round-trip", async () => {
    const jar = await signInFixture("fixture@conformance.test");

    // Create 3 transcriptions.
    const idA = rnd("a");
    const idB = rnd("b");
    const idC = rnd("c");
    const seeds = [
      { client_transcription_id: idA, text: "first transcript" },
      { client_transcription_id: idB, text: "second transcript here" },
      { client_transcription_id: idC, text: "third one" },
    ];
    const createdIds: string[] = [];
    for (const seed of seeds) {
      const res = await jar.fetch(
        `${BACKEND_URL}/api/transcriptions/create`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(seed),
        },
      );
      expect(res.status).toBe(200);
      const tx = CloudTranscription.parse(await res.json());
      createdIds.push(tx.id);
    }
    expect(new Set(createdIds).size).toBe(3);

    // Idempotency: re-create idA — same id, NOT 409.
    const retry = await jar.fetch(`${BACKEND_URL}/api/transcriptions/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_transcription_id: idA,
        text: "DIFFERENT",
      }),
    });
    expect(retry.status).toBe(200);
    expect(retry.status).not.toBe(409);
    const retryTx = CloudTranscription.parse(await retry.json());
    expect(retryTx.id).toBe(createdIds[0]);
    expect(retryTx.text).toBe("first transcript"); // first-writer-wins.

    // List — should see at least the 3 we created.
    const list1 = await jar.fetch(
      `${BACKEND_URL}/api/transcriptions/list?limit=50`,
    );
    expect(list1.status).toBe(200);
    const list1Body = ListResponse.parse(await list1.json());
    for (const id of createdIds) {
      expect(list1Body.transcriptions.find((t) => t.id === id)).toBeDefined();
    }

    // Soft-delete idA.
    const del = await jar.fetch(`${BACKEND_URL}/api/transcriptions/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: createdIds[0] }),
    });
    expect(del.status).toBe(200);

    // List — idA excluded.
    const list2 = await jar.fetch(
      `${BACKEND_URL}/api/transcriptions/list?limit=50`,
    );
    const list2Body = ListResponse.parse(await list2.json());
    expect(
      list2Body.transcriptions.find((t) => t.id === createdIds[0]),
    ).toBeUndefined();

    // batch-delete remaining 2.
    const remaining = [createdIds[1]!, createdIds[2]!];
    const batchDel = await jar.fetch(
      `${BACKEND_URL}/api/transcriptions/batch-delete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: remaining }),
      },
    );
    expect(batchDel.status).toBe(200);
    const batchDelBody = BatchDeleteResponse.parse(await batchDel.json());
    expect(new Set(batchDelBody.deleted)).toEqual(new Set(remaining));

    // List — all gone.
    const list3 = await jar.fetch(
      `${BACKEND_URL}/api/transcriptions/list?limit=50`,
    );
    const list3Body = ListResponse.parse(await list3.json());
    for (const id of createdIds) {
      expect(list3Body.transcriptions.find((t) => t.id === id)).toBeUndefined();
    }

    // Delete non-existent id → 404 envelope.
    const ghost = await jar.fetch(`${BACKEND_URL}/api/transcriptions/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(ghost.status).toBe(404);
    expect(() => ErrorEnvelope.parse(await ghost.json())).not.toThrow();
  });

  it("401 envelope on every transcriptions route when unauthenticated", async () => {
    const probes: Array<{ method: string; url: string; body?: string }> = [
      { method: "POST", url: "/api/transcriptions/create", body: "{}" },
      { method: "POST", url: "/api/transcriptions/batch-create", body: "{}" },
      { method: "GET", url: "/api/transcriptions/list" },
      { method: "DELETE", url: "/api/transcriptions/delete", body: "{}" },
      { method: "POST", url: "/api/transcriptions/batch-delete", body: "{}" },
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
