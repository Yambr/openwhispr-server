// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — GREEN tests for virtual-key-rotation (D-W5, D-A6 #8/#9).
//
// Real Postgres testcontainer; LiteLLM client + user-key lookup are
// dependency-injected stubs (network boundary — permitted by CLAUDE.md).
// Verifies audit_log rows are inserted on the same transaction the HOF
// installs.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canRunDocker } from "../lib/can-run-docker.js";
import {
  buildVirtualKeyRotationHandler,
  type LiteLlmKeyClient,
  type UserKeyLookup,
  virtualKeyRotationSchema,
} from "./virtual-key-rotation.js";

const SUITE = canRunDocker() ? describe : describe.skip;
const TENANT = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

interface Harness {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}
let h: Harness | undefined;

beforeAll(async () => {
  if (!canRunDocker()) return;
  const container = await new PostgreSqlContainer("postgres:17-bookworm")
    .withDatabase("vkr_test")
    .withUsername("postgres_super")
    .withPassword("pw")
    .start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 4 });
  // Minimal audit_log shape — we don't apply migrations here; the
  // production CHECK constraint is enforced at the data-package level
  // and exercised by Plan 06-05's audit-log integration tests. Here we
  // only need to verify INSERTs land with the right action + payload.
  await pool.query(
    `CREATE TABLE audit_log (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id uuid NOT NULL,
       actor_user_id uuid,
       action text NOT NULL,
       payload jsonb NOT NULL DEFAULT '{}'::jsonb,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  h = { container, pool };
}, 120_000);

afterAll(async () => {
  if (h) {
    await h.pool.end();
    await h.container.stop();
  }
}, 60_000);

function fakeJob(data: unknown): Job {
  return { data, queueName: "virtual-key-rotation", id: "vkr-1" } as unknown as Job;
}

function makeStubs(opts: { priorKeyId: string | null }) {
  const events: string[] = [];
  const litellm: LiteLlmKeyClient = {
    async generateKey() {
      events.push("generateKey");
      return { key_id: "key_new_abc" };
    },
    async deleteKey({ key_id }) {
      events.push(`deleteKey:${key_id}`);
    },
  };
  let stored: string | null = null;
  const userKeyLookup: UserKeyLookup = {
    async loadCurrentKeyId() {
      return opts.priorKeyId;
    },
    async storeNewKeyId(_user, newKey) {
      stored = newKey;
    },
  };
  return {
    litellm,
    userKeyLookup,
    events,
    get stored() {
      return stored;
    },
  };
}

SUITE("virtual-key-rotation (D-W5)", () => {
  it("schema rejects reason outside enum", () => {
    expect(() =>
      virtualKeyRotationSchema.parse({ tenant_id: TENANT, user_id: USER, reason: "weird" }),
    ).toThrow();
  });

  it("schema accepts {scheduled,compromised,manual}", () => {
    for (const reason of ["scheduled", "compromised", "manual"] as const) {
      const parsed = virtualKeyRotationSchema.parse({
        tenant_id: TENANT,
        user_id: USER,
        reason,
      });
      expect(parsed.reason).toBe(reason);
    }
  });

  it("first-time rotation: only key.issued audit row (no prior key to revoke)", async () => {
    if (!h) throw new Error("harness");
    await h.pool.query("DELETE FROM audit_log");
    const stubs = makeStubs({ priorKeyId: null });
    const handler = buildVirtualKeyRotationHandler({
      pool: h.pool,
      litellm: stubs.litellm,
      userKeyLookup: stubs.userKeyLookup,
    });
    await handler(fakeJob({ tenant_id: TENANT, user_id: USER, reason: "scheduled" }));
    const { rows } = await h.pool.query<{
      action: string;
      payload: { key_id?: string; reason?: string };
    }>("SELECT action, payload FROM audit_log ORDER BY created_at");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("key.issued");
    expect(rows[0]?.payload.key_id).toBe("key_new_abc");
    expect(stubs.events).toEqual(["generateKey"]);
    expect(stubs.stored).toBe("key_new_abc");
  });

  it("rotation with prior key: emits key.issued + key.revoked (with reason)", async () => {
    if (!h) throw new Error("harness");
    await h.pool.query("DELETE FROM audit_log");
    const stubs = makeStubs({ priorKeyId: "key_old_xyz" });
    const handler = buildVirtualKeyRotationHandler({
      pool: h.pool,
      litellm: stubs.litellm,
      userKeyLookup: stubs.userKeyLookup,
    });
    await handler(fakeJob({ tenant_id: TENANT, user_id: USER, reason: "compromised" }));
    const { rows } = await h.pool.query<{
      action: string;
      payload: { key_id?: string; reason?: string };
    }>("SELECT action, payload FROM audit_log ORDER BY created_at");
    expect(rows.map((r) => r.action)).toEqual(["key.issued", "key.revoked"]);
    expect(rows[1]?.payload.key_id).toBe("key_old_xyz");
    expect(rows[1]?.payload.reason).toBe("compromised");
    expect(stubs.events).toEqual(["generateKey", "deleteKey:key_old_xyz"]);
  });

  it("audit payload never carries the raw key secret (only key_id alias)", async () => {
    if (!h) throw new Error("harness");
    await h.pool.query("DELETE FROM audit_log");
    const stubs = makeStubs({ priorKeyId: "old" });
    const handler = buildVirtualKeyRotationHandler({
      pool: h.pool,
      litellm: stubs.litellm,
      userKeyLookup: stubs.userKeyLookup,
    });
    await handler(fakeJob({ tenant_id: TENANT, user_id: USER, reason: "manual" }));
    const { rows } = await h.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_log",
    );
    for (const r of rows) {
      const keys = Object.keys(r.payload);
      expect(keys).not.toContain("key");
      expect(keys).not.toContain("secret");
      expect(keys).not.toContain("api_key");
    }
  });
});
