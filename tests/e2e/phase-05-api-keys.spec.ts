// tests/e2e/phase-05-api-keys — host-side e2e for WIRE-27.
//
// Round-trips the API-keys lifecycle through Traefik (TLS) → api →
// real Postgres + PgBouncer via the docker-compose stack:
//   1. create 2 keys (deterministic names) — clear-text PAK returned once
//   2. list — both visible, NEVER contains `key` or `key_hash`
//   3. revoke one — revoked_at populated, idempotent on retry
//   4. list again — revoked row still present with revoked_at set
//
// Mirrors tests/e2e/phase-05-transcriptions.spec.ts.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const ApiKey = z
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
  .strict();

const CreateApiKeyResponse = z.object({
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

const V1ListResponse = z.object({
  data: z.object({ keys: z.array(ApiKey) }),
});
const V1CreateResponse = z.object({ data: CreateApiKeyResponse });
const V1RevokeResponse = z.object({ data: ApiKey });

function rnd(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("e2e — /api/v1/keys/* full lifecycle (real compose stack)", () => {
  it("create → list (no clear-text) → revoke → list (revoked_at set) round-trip", async () => {
    const jar = await signInFixture("fixture@conformance.test");

    // 1) create two keys.
    const nameA = rnd("a");
    const nameB = rnd("b");
    const cA = await jar.fetch(`${BACKEND_URL}/api/v1/keys/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameA, scopes: ["notes:read"] }),
    });
    expect(cA.status).toBe(200);
    const keyA = V1CreateResponse.parse(await cA.json()).data;
    expect(keyA.key.startsWith("pak_")).toBe(true);

    const cB = await jar.fetch(`${BACKEND_URL}/api/v1/keys/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameB }),
    });
    expect(cB.status).toBe(200);
    const keyB = V1CreateResponse.parse(await cB.json()).data;

    // 2) list — both visible; NEVER includes clear-text or hash.
    const l1 = await jar.fetch(`${BACKEND_URL}/api/v1/keys/list`);
    expect(l1.status).toBe(200);
    const list1 = V1ListResponse.parse(await l1.json());
    const idsListed = new Set(list1.data.keys.map((k) => k.id));
    expect(idsListed.has(keyA.id)).toBe(true);
    expect(idsListed.has(keyB.id)).toBe(true);
    for (const row of list1.data.keys) {
      expect(Object.keys(row)).not.toContain("key");
      expect(Object.keys(row)).not.toContain("key_hash");
    }

    // 3) revoke keyA.
    const rev = await jar.fetch(
      `${BACKEND_URL}/api/v1/keys/${keyA.id}/revoke`,
      { method: "POST" },
    );
    expect(rev.status).toBe(200);
    const revBody = V1RevokeResponse.parse(await rev.json()).data;
    expect(revBody.id).toBe(keyA.id);
    expect(revBody.revoked_at).not.toBeNull();
    const firstRevokedAt = revBody.revoked_at;

    // Idempotent: re-revoke preserves the original timestamp.
    const revAgain = await jar.fetch(
      `${BACKEND_URL}/api/v1/keys/${keyA.id}/revoke`,
      { method: "POST" },
    );
    expect(revAgain.status).toBe(200);
    expect(V1RevokeResponse.parse(await revAgain.json()).data.revoked_at).toBe(
      firstRevokedAt,
    );

    // 4) list still includes the revoked row with revoked_at populated;
    //    keyB unchanged (revoked_at null).
    const l2 = await jar.fetch(`${BACKEND_URL}/api/v1/keys/list`);
    const list2 = V1ListResponse.parse(await l2.json());
    const foundA = list2.data.keys.find((k) => k.id === keyA.id);
    const foundB = list2.data.keys.find((k) => k.id === keyB.id);
    expect(foundA?.revoked_at).not.toBeNull();
    expect(foundB?.revoked_at).toBeNull();
  });
});
