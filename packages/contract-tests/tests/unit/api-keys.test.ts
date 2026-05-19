// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 09 / Task 3 — WIRE-27 contract conformance tests for
// /api/v1/keys/* (3 routes: list, create, revoke).
//
// Asserts the wire shape against a live BACKEND_URL with the seeded
// fixture user. Skip-if-unreachable semantics mirror folders.test.ts.
//
// Phase 56-06 / D-3 — V1Response envelope flipped to a discriminated
// union of success/failure variants:
//
//   success: { success: true, data: T }
//   failure: { success: false, error: string, code?: string }
//
// Distinct from the rest of Phase 5 which returns the resource directly.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { signInFixture } from "../../src/helpers/sign-in-fixture.js";

const REACHABLE = await probeBackend();

const ApiKeyShape = z
  .object({
    id: z.string(),
    name: z.string(),
    key_prefix: z.string(),
    scopes: z.array(z.string()),
    last_used_at: z.string().nullable(),
    expires_at: z.string().nullable(),
    created_at: z.string(),
    revoked_at: z.string().nullable(),
  })
  .strict(); // strict() — refuses accidental `key` / `key_hash` on list shape

const CreateApiKeyResponseShape = z.object({
  id: z.string(),
  name: z.string(),
  key_prefix: z.string(),
  scopes: z.array(z.string()),
  last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  revoked_at: z.string().nullable(),
  key: z.string(),
});

// Phase 56-06 D-3 — success envelope shape. Strict so any drift back
// to the legacy `{ data: T }` literal (without `success`) is rejected
// by Zod's discriminator AND any stray `error`/`code` key on a 2xx
// response is caught by .strict().
const V1ListResponse = z
  .object({
    success: z.literal(true),
    data: z.object({ keys: z.array(ApiKeyShape) }),
  })
  .strict();
const V1CreateResponse = z
  .object({ success: z.literal(true), data: CreateApiKeyResponseShape })
  .strict();
const V1RevokeResponse = z.object({ success: z.literal(true), data: ApiKeyShape }).strict();

function rnd(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe.skipIf(!REACHABLE)("WIRE-27 — /api/v1/keys/* (3 routes)", () => {
  it("POST /api/v1/keys/create returns { success:true, data: CreateApiKeyResponse } with clear-text 'key' (D-3, D-29)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/v1/keys/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: rnd("ck"), scopes: ["notes:read"] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = V1CreateResponse.parse(json);
    expect(parsed.data.key.startsWith("pak_")).toBe(true);
    expect(parsed.data.key_prefix.length).toBe(12);
    expect(parsed.data.key_prefix).toBe(parsed.data.key.slice(0, 12));
  });

  it("GET /api/v1/keys/list returns { success:true, data: { keys: ApiKey[] } } with NO clear-text or hash", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    // Seed a key first so the list is non-empty.
    await jar.fetch(`${BACKEND_URL}/api/v1/keys/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: rnd("listed") }),
    });
    const res = await jar.fetch(`${BACKEND_URL}/api/v1/keys/list`);
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = V1ListResponse.parse(json);
    for (const row of parsed.data.keys) {
      // strict() schema would have rejected `key`/`key_hash`; this is
      // an explicit redundant assertion for the T-KEY-LEAK invariant.
      expect(Object.keys(row)).not.toContain("key");
      expect(Object.keys(row)).not.toContain("key_hash");
    }
  });

  it("POST /api/v1/keys/:id/revoke returns { success:true, data: ApiKey } with revoked_at set", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const create = await jar.fetch(`${BACKEND_URL}/api/v1/keys/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: rnd("rev") }),
    });
    const id = V1CreateResponse.parse(await create.json()).data.id;

    const res = await jar.fetch(`${BACKEND_URL}/api/v1/keys/${id}/revoke`, { method: "POST" });
    expect(res.status).toBe(200);
    const parsed = V1RevokeResponse.parse(await res.json());
    expect(parsed.data.id).toBe(id);
    expect(parsed.data.revoked_at).not.toBeNull();
  });

  it("revoke is idempotent — repeat call preserves revoked_at (200, same timestamp)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const create = await jar.fetch(`${BACKEND_URL}/api/v1/keys/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: rnd("idem-rev") }),
    });
    const id = V1CreateResponse.parse(await create.json()).data.id;

    const r1 = await jar.fetch(`${BACKEND_URL}/api/v1/keys/${id}/revoke`, { method: "POST" });
    const t1 = V1RevokeResponse.parse(await r1.json()).data.revoked_at;
    const r2 = await jar.fetch(`${BACKEND_URL}/api/v1/keys/${id}/revoke`, { method: "POST" });
    const t2 = V1RevokeResponse.parse(await r2.json()).data.revoked_at;
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(t2).toBe(t1);
  });

  it("list after revoke still includes the row with revoked_at populated", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const create = await jar.fetch(`${BACKEND_URL}/api/v1/keys/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: rnd("listed-revoked") }),
    });
    const id = V1CreateResponse.parse(await create.json()).data.id;
    await jar.fetch(`${BACKEND_URL}/api/v1/keys/${id}/revoke`, {
      method: "POST",
    });
    const list = await jar.fetch(`${BACKEND_URL}/api/v1/keys/list`);
    const parsed = V1ListResponse.parse(await list.json());
    const found = parsed.data.keys.find((k) => k.id === id);
    expect(found).toBeDefined();
    expect(found?.revoked_at).not.toBeNull();
  });
});
