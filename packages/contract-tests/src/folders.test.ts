// Phase 05 / Plan 06 / Task 2 — WIRE-23 contract conformance tests for
// /api/folders/* (5 routes — no search, no delete-all per upstream
// FoldersService.ts).
//
// Asserts the wire shape against a live BACKEND_URL with the seeded
// fixture user. Skip-if-unreachable semantics mirror packages/contract-
// tests/src/notes.test.ts.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();

const CloudFolderShape = z.object({
  id: z.string(),
  client_folder_id: z.string().nullable(),
  name: z.string(),
  is_default: z.boolean(),
  sort_order: z.number(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const ListResponse = z.object({ folders: z.array(CloudFolderShape) });
const BatchCreateResponse = z.object({
  created: z.array(CloudFolderShape),
});
const DeleteResponse = z.object({ ok: z.boolean() });

function rnd(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe.skipIf(!REACHABLE)("WIRE-23 — /api/folders/* (5 routes)", () => {
  it("POST /api/folders/create returns CloudFolder shape", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/folders/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_folder_id: rnd("cf"),
        name: "contract create",
      }),
    });
    expect(res.status).toBe(200);
    expect(() => CloudFolderShape.parse(await res.json())).not.toThrow();
  });

  it("POST /api/folders/create idempotent on same client_folder_id (200, not 409)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const clientId = rnd("idem");
    const r1 = await jar.fetch(`${BACKEND_URL}/api/folders/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_folder_id: clientId, name: "idem first" }),
    });
    const r2 = await jar.fetch(`${BACKEND_URL}/api/folders/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_folder_id: clientId, name: "idem second" }),
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.status).not.toBe(409);
    const j1 = CloudFolderShape.parse(await r1.json());
    const j2 = CloudFolderShape.parse(await r2.json());
    expect(j2.id).toBe(j1.id);
    expect(j2.name).toBe("idem first");
  });

  it("POST /api/folders/batch-create returns { created: CloudFolder[] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/folders/batch-create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        folders: [
          { client_folder_id: rnd("bc1"), name: "x" },
          { client_folder_id: rnd("bc2"), name: "y" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const parsed = BatchCreateResponse.parse(await res.json());
    expect(parsed.created).toHaveLength(2);
  });

  it("PATCH /api/folders/update returns updated CloudFolder", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const created = await jar.fetch(`${BACKEND_URL}/api/folders/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_folder_id: rnd("upd"), name: "before" }),
    });
    const { id } = CloudFolderShape.parse(await created.json());
    const patch = await jar.fetch(`${BACKEND_URL}/api/folders/update`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name: "after" }),
    });
    expect(patch.status).toBe(200);
    const updated = CloudFolderShape.parse(await patch.json());
    expect(updated.name).toBe("after");
  });

  it("DELETE /api/folders/delete returns { ok: true }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const created = await jar.fetch(`${BACKEND_URL}/api/folders/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_folder_id: rnd("del"), name: "to delete" }),
    });
    const { id } = CloudFolderShape.parse(await created.json());
    const del = await jar.fetch(`${BACKEND_URL}/api/folders/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    expect(del.status).toBe(200);
    expect(() => DeleteResponse.parse(await del.json())).not.toThrow();
  });

  it("GET /api/folders/list returns { folders: CloudFolder[] }", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/folders/list?limit=5`);
    expect(res.status).toBe(200);
    expect(() => ListResponse.parse(await res.json())).not.toThrow();
  });

  it("401 envelope when unauthenticated on every folders route", async () => {
    const probes = [
      { method: "POST", url: "/api/folders/create", body: "{}" },
      { method: "POST", url: "/api/folders/batch-create", body: "{}" },
      { method: "PATCH", url: "/api/folders/update", body: "{}" },
      { method: "DELETE", url: "/api/folders/delete", body: "{}" },
      { method: "GET", url: "/api/folders/list" },
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
