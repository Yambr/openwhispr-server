// SPDX-License-Identifier: Apache-2.0
// tests/e2e/phase-05-folders — host-side e2e for WIRE-23.
//
// Round-trips the full folders CRUD lifecycle through Traefik (TLS) →
// api → real Postgres + PgBouncer via the docker-compose stack:
//   1. create 3 folders (deterministic client_folder_ids)
//   2. idempotency retry — same id, NOT 409
//   3. list — all 3 visible
//   4. update one — verify name change
//   5. soft-delete one — list excludes
//   6. batch-create 5 more — verify in list
//
// Mirrors tests/e2e/phase-05-notes.spec.ts.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const CloudFolder = z.object({
  id: z.string(),
  client_folder_id: z.string().nullable(),
  name: z.string(),
  is_default: z.boolean(),
  sort_order: z.number(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const ListResponse = z.object({ folders: z.array(CloudFolder) });
const BatchCreateResponse = z.object({ created: z.array(CloudFolder) });
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

function rnd(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("e2e — /api/folders/* full lifecycle (real compose stack)", () => {
  it("create → idempotency → list → update → delete → batch-create round-trip", async () => {
    const jar = await signInFixture("fixture@conformance.test");

    // Create 3 folders with deterministic client_folder_ids.
    const idA = rnd("a");
    const idB = rnd("b");
    const idC = rnd("c");
    const seeds = [
      { client_folder_id: idA, name: "Personal", sort_order: 1 },
      { client_folder_id: idB, name: "Work", sort_order: 2 },
      { client_folder_id: idC, name: "Archive", sort_order: 3 },
    ];
    const createdIds: string[] = [];
    for (const seed of seeds) {
      const res = await jar.fetch(`${BACKEND_URL}/api/folders/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(seed),
      });
      expect(res.status).toBe(200);
      const folder = CloudFolder.parse(await res.json());
      createdIds.push(folder.id);
    }
    expect(new Set(createdIds).size).toBe(3);

    // Idempotency: re-create idA — same id, NOT 409.
    const retry = await jar.fetch(`${BACKEND_URL}/api/folders/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_folder_id: idA, name: "DIFFERENT" }),
    });
    expect(retry.status).toBe(200);
    expect(retry.status).not.toBe(409);
    const retryFolder = CloudFolder.parse(await retry.json());
    expect(retryFolder.id).toBe(createdIds[0]);
    expect(retryFolder.name).toBe("Personal"); // first-writer-wins.

    // List — should see at least the 3 we created.
    const list1 = await jar.fetch(`${BACKEND_URL}/api/folders/list?limit=50`);
    expect(list1.status).toBe(200);
    const list1Body = ListResponse.parse(await list1.json());
    for (const id of createdIds) {
      expect(list1Body.folders.find((f) => f.id === id)).toBeDefined();
    }

    // Update idB.
    const patch = await jar.fetch(`${BACKEND_URL}/api/folders/update`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: createdIds[1], name: "Work (renamed)" }),
    });
    expect(patch.status).toBe(200);
    const patched = CloudFolder.parse(await patch.json());
    expect(patched.name).toBe("Work (renamed)");

    // Update non-existent id → 404 envelope.
    const ghost = await jar.fetch(`${BACKEND_URL}/api/folders/update`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "11111111-2222-3333-4444-555555555555",
        name: "ghost",
      }),
    });
    expect(ghost.status).toBe(404);
    expect(() => ErrorEnvelope.parse(await ghost.json())).not.toThrow();

    // Soft-delete idC.
    const del = await jar.fetch(`${BACKEND_URL}/api/folders/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: createdIds[2] }),
    });
    expect(del.status).toBe(200);

    // List — idC excluded.
    const list2 = await jar.fetch(`${BACKEND_URL}/api/folders/list?limit=50`);
    const list2Body = ListResponse.parse(await list2.json());
    expect(list2Body.folders.find((f) => f.id === createdIds[2])).toBeUndefined();

    // Batch-create 5 more.
    const batchSeeds = Array.from({ length: 5 }, (_, i) => ({
      client_folder_id: rnd(`bc-${i}`),
      name: `Batch ${i}`,
      sort_order: 10 + i,
    }));
    const batch = await jar.fetch(`${BACKEND_URL}/api/folders/batch-create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folders: batchSeeds }),
    });
    expect(batch.status).toBe(200);
    const batchBody = BatchCreateResponse.parse(await batch.json());
    expect(batchBody.created).toHaveLength(5);

    // List again — confirm batch rows present.
    const list3 = await jar.fetch(`${BACKEND_URL}/api/folders/list?limit=100`);
    const list3Body = ListResponse.parse(await list3.json());
    for (const created of batchBody.created) {
      expect(list3Body.folders.find((f) => f.id === created.id)).toBeDefined();
    }

    // Hygiene: soft-delete all the e2e-created folders so the fixture
    // user's folder list does not balloon over repeated runs.
    const toCleanup = [
      createdIds[0],
      createdIds[1],
      ...batchBody.created.map((f) => f.id),
    ];
    for (const id of toCleanup) {
      await jar.fetch(`${BACKEND_URL}/api/folders/delete`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
    }
  });

  it("401 envelope on every folders route when unauthenticated", async () => {
    const probes: Array<{ method: string; url: string; body?: string }> = [
      { method: "POST", url: "/api/folders/create", body: "{}" },
      { method: "POST", url: "/api/folders/batch-create", body: "{}" },
      { method: "PATCH", url: "/api/folders/update", body: "{}" },
      { method: "DELETE", url: "/api/folders/delete", body: "{}" },
      { method: "GET", url: "/api/folders/list" },
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
