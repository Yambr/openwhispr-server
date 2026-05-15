// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 07 / Task 2 — list?include=messages integration tests.
//
// Validates D-27 array_agg branch:
//   * Each conversation row carries `messages: CloudMessage[]` ordered
//     (created_at ASC, id ASC).
//   * Per-conversation cap of 100 messages (T-AGG-MEM mitigation,
//     RESEARCH Open Q#2).
//   * Soft-deleted messages excluded.
//   * Conversations with zero messages return `messages: []`.
//   * Default (no `include`) branch unchanged: no `messages` key.

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../../../../src/routes/conversations/__tests__/setup.js";
import { getSharedRoutePool } from "../../../../support/shared-route-pool.js";

// Phase 18.1.2 / Plan 05 / Cluster #2 sub-cluster 2a — shared-pg migration
// (Option A canon — see crud.integration.test.ts header for the full
// rationale). HARD RULE: production-tree setup.ts left untouched;
// `buildTestApp` still imported from there.

const TENANT_A = "00000000-0000-0000-0000-000000000000";

let pool: Pool;
let userA: string;
let appA: FastifyInstance;

beforeAll(async () => {
  pool = await getSharedRoutePool();
  const ra = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [TENANT_A, "list-inc@test"],
  );
  userA = ra.rows[0]!.id;
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM messages`);
  await pool.query(`DELETE FROM conversations`);
});

async function createConversation(title: string): Promise<string> {
  const res = await appA.inject({
    method: "POST",
    url: "/api/conversations/create",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ title }),
  });
  return (res.json() as { id: string }).id;
}

async function insertMessage(opts: {
  conversationId: string;
  role: string;
  content: string;
  createdAt?: Date;
  deletedAt?: Date | null;
}): Promise<string> {
  // RLS requires GUC — set within this txn.
  const client = await pool.connect();
  try {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO messages
         (conversation_id, tenant_id, user_id, role, content, metadata, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, COALESCE($6, NOW()), NOW(), $7)
       RETURNING id`,
      [
        opts.conversationId,
        TENANT_A,
        userA,
        opts.role,
        opts.content,
        opts.createdAt ?? null,
        opts.deletedAt ?? null,
      ],
    );
    return rows[0]?.id;
  } finally {
    client.release();
  }
}

describe("integration — GET /api/conversations/list?include=messages (D-27)", () => {
  it("default (no include) — response rows do NOT carry `messages` key", async () => {
    const cid = await createConversation("plain");
    await insertMessage({ conversationId: cid, role: "user", content: "hi" });

    const res = await appA.inject({
      method: "GET",
      url: "/api/conversations/list",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversations: Array<Record<string, unknown>>;
    };
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]).not.toHaveProperty("messages");
  });

  it("include=messages — embeds CloudMessage[] ordered ASC (created_at, id)", async () => {
    const cid = await createConversation("with-messages");
    const base = Date.now();
    const m1 = await insertMessage({
      conversationId: cid,
      role: "user",
      content: "first",
      createdAt: new Date(base + 1),
    });
    const m2 = await insertMessage({
      conversationId: cid,
      role: "assistant",
      content: "second",
      createdAt: new Date(base + 2),
    });
    const m3 = await insertMessage({
      conversationId: cid,
      role: "user",
      content: "third",
      createdAt: new Date(base + 3),
    });

    const res = await appA.inject({
      method: "GET",
      url: "/api/conversations/list?include=messages",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversations: Array<{
        id: string;
        messages: Array<{ id: string; role: string; content: string }>;
      }>;
    };
    expect(body.conversations).toHaveLength(1);
    const conv = body.conversations[0]!;
    expect(conv.id).toBe(cid);
    expect(conv.messages.map((m) => m.id)).toEqual([m1, m2, m3]);
    expect(conv.messages.map((m) => m.content)).toEqual(["first", "second", "third"]);
    // CloudMessage shape: 6 fields per packages/wire-schemas.
    for (const m of conv.messages) {
      expect(m).toHaveProperty("id");
      expect(m).toHaveProperty("conversation_id");
      expect(m).toHaveProperty("role");
      expect(m).toHaveProperty("content");
      expect(m).toHaveProperty("metadata");
      expect(m).toHaveProperty("created_at");
    }
  });

  it("include=messages — caps per-conversation messages at 100 (T-AGG-MEM)", async () => {
    const cid = await createConversation("cap-test");
    const base = Date.now() - 200_000;
    // Insert 150 messages — only first 100 (by ASC) should be returned.
    for (let i = 0; i < 150; i++) {
      await insertMessage({
        conversationId: cid,
        role: "user",
        content: `msg-${i.toString().padStart(3, "0")}`,
        createdAt: new Date(base + i * 10),
      });
    }
    const res = await appA.inject({
      method: "GET",
      url: "/api/conversations/list?include=messages",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversations: Array<{ messages: Array<{ content: string }> }>;
    };
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]?.messages).toHaveLength(100);
    expect(body.conversations[0]?.messages[0]?.content).toBe("msg-000");
    expect(body.conversations[0]?.messages[99]?.content).toBe("msg-099");
  });

  it("include=messages — soft-deleted messages excluded from aggregation", async () => {
    const cid = await createConversation("with-soft-delete");
    const base = Date.now();
    await insertMessage({
      conversationId: cid,
      role: "user",
      content: "kept",
      createdAt: new Date(base + 1),
    });
    await insertMessage({
      conversationId: cid,
      role: "assistant",
      content: "tombstoned",
      createdAt: new Date(base + 2),
      deletedAt: new Date(base + 5),
    });

    const res = await appA.inject({
      method: "GET",
      url: "/api/conversations/list?include=messages",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversations: Array<{ messages: Array<{ content: string }> }>;
    };
    expect(body.conversations[0]?.messages.map((m) => m.content)).toEqual(["kept"]);
  });

  it("include=messages — conversation with zero messages returns empty array", async () => {
    await createConversation("empty");
    const res = await appA.inject({
      method: "GET",
      url: "/api/conversations/list?include=messages",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversations: Array<{ messages: unknown[] }>;
    };
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]?.messages).toEqual([]);
  });

  it("include not 'messages' is treated as the default branch (no embed)", async () => {
    const cid = await createConversation("plain-too");
    await insertMessage({
      conversationId: cid,
      role: "user",
      content: "x",
    });
    const res = await appA.inject({
      method: "GET",
      url: "/api/conversations/list?include=other",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      conversations: Array<Record<string, unknown>>;
    };
    expect(body.conversations[0]).not.toHaveProperty("messages");
  });
});
