// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 08 / Task 1 — transcriptions CRUD integration tests
// against real Postgres + RLS. Mirrors folders/crud.integration.test.ts.
//
// Covers: create (14-field CloudTranscription, D-24 idempotency, Pitfall
// #2 null path), list (soft-delete exclusion, keyset), delete (soft +
// 404), cross-tenant RLS isolation, client_transcription_id collision
// isolation, 401 defensive guard, D-32 invariant (no ledger writes).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { bootMigratedPostgres, buildTestApp, seedUser } from "./setup.js";

const TENANT_A = "00000000-0000-0000-0000-000000000000";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

let pool: Pool;
let shutdown: () => Promise<void>;
let userA: string;
let userB: string;
let appA: FastifyInstance;
let appB: FastifyInstance;

beforeAll(async () => {
  const booted = await bootMigratedPostgres();
  pool = booted.pool;
  shutdown = booted.shutdown.bind(booted);
  await pool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'Tenant B') ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  userA = await seedUser(pool, { tenantId: TENANT_A, email: "tx-a@test" });
  userB = await seedUser(pool, { tenantId: TENANT_B, email: "tx-b@test" });
  appA = await buildTestApp({ pool, userId: userA, tenantId: TENANT_A });
  appB = await buildTestApp({ pool, userId: userB, tenantId: TENANT_B });
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (shutdown) await shutdown();
}, 60_000);

beforeEach(async () => {
  await pool.query(`DELETE FROM transcriptions`);
});

describe("integration — transcriptions CRUD (real Postgres + RLS)", () => {
  it("create — happy path returns CloudTranscription shape (14 fields)", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_transcription_id: "client-tx-001",
        text: "hello world from the desktop",
        raw_text: "hello world from the desktop",
        provider: "groq",
        model: "whisper-large-v3",
        language: "en",
        audio_duration_ms: 4200,
        status: "completed",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const required = [
      "id",
      "client_transcription_id",
      "text",
      "raw_text",
      "word_count",
      "source",
      "provider",
      "model",
      "language",
      "audio_duration_ms",
      "status",
      "deleted_at",
      "created_at",
      "updated_at",
    ];
    for (const k of required) expect(body).toHaveProperty(k);
    expect(body.client_transcription_id).toBe("client-tx-001");
    expect(body.text).toBe("hello world from the desktop");
    expect(body.provider).toBe("groq");
    expect(body.word_count).toBe(5);
    expect(body.source).toBe("desktop");
    expect(body.status).toBe("completed");
    expect(body.deleted_at).toBeNull();
    // Leakage check — DB columns that must NOT appear on the wire.
    expect(body).not.toHaveProperty("tenant_id");
    expect(body).not.toHaveProperty("user_id");
    expect(body).not.toHaveProperty("duration_seconds");
  });

  it("create — same client_transcription_id on retry returns EXISTING row (200, D-24)", async () => {
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_transcription_id: "idem-tx",
        text: "first",
      }),
    });
    expect(r1.statusCode).toBe(200);
    const id1 = (r1.json() as { id: string }).id;

    const r2 = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_transcription_id: "idem-tx",
        text: "SECOND — ignored",
      }),
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.statusCode).not.toBe(409);
    const body2 = r2.json() as { id: string; text: string };
    expect(body2.id).toBe(id1);
    expect(body2.text).toBe("first");
  });

  it("create — null/absent client_transcription_id ALWAYS inserts (Pitfall #2)", async () => {
    const r1 = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "untitled-A" }),
    });
    const r2 = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "untitled-B" }),
    });
    const id1 = (r1.json() as { id: string }).id;
    const id2 = (r2.json() as { id: string }).id;
    expect(id1).not.toBe(id2);
  });

  it("batch-create — { transcriptions: [...] } returns { created: CloudTranscription[] }", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        transcriptions: [
          { client_transcription_id: "bt-1", text: "alpha one" },
          { client_transcription_id: "bt-2", text: "beta two three" },
          { client_transcription_id: "bt-3", text: "gamma" },
        ],
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      created: { id: string; text: string; client_transcription_id: string; word_count: number }[];
    };
    expect(body.created).toHaveLength(3);
    expect(body.created[0]!.text).toBe("alpha one");
    expect(body.created[2]!.text).toBe("gamma");
    expect(body.created[0]!.word_count).toBe(2);
    expect(body.created[2]!.word_count).toBe(1);
    // Full CloudTranscription shape per row.
    expect(body.created[0]).toHaveProperty("source");
    expect(body.created[0]).toHaveProperty("status");
    expect(body.created[0]).toHaveProperty("created_at");
  });

  it("batch-create — bare array body also accepted", async () => {
    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([
        { client_transcription_id: "bare-1", text: "x" },
        { client_transcription_id: "bare-2", text: "y" },
      ]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: unknown[] };
    expect(body.created).toHaveLength(2);
  });

  it("batch-create — 501 items → 400 envelope (D-30)", async () => {
    const items = Array.from({ length: 501 }, (_, i) => ({
      client_transcription_id: `over-${i}`,
      text: `t-${i}`,
    }));
    const res = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ transcriptions: items }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toMatch(/500/);
  });

  it("list — keyset paginated, soft-deleted excluded", async () => {
    for (let i = 0; i < 4; i++) {
      await appA.inject({
        method: "POST",
        url: "/api/transcriptions/create",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          client_transcription_id: `list-${i}`,
          text: `item ${i}`,
        }),
      });
    }
    const list = await appA.inject({
      method: "GET",
      url: "/api/transcriptions/list?limit=10",
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { transcriptions: { id: string; text: string }[] };
    expect(body.transcriptions.length).toBe(4);

    // Soft-delete the first row.
    const target = body.transcriptions[0]!.id;
    const del = await appA.inject({
      method: "DELETE",
      url: "/api/transcriptions/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: target }),
    });
    expect(del.statusCode).toBe(200);

    const list2 = await appA.inject({
      method: "GET",
      url: "/api/transcriptions/list?limit=10",
    });
    const body2 = list2.json() as { transcriptions: { id: string }[] };
    expect(body2.transcriptions.find((t) => t.id === target)).toBeUndefined();
    expect(body2.transcriptions.length).toBe(3);
  });

  it("delete — sets deleted_at; unknown id → 404", async () => {
    const create = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_transcription_id: "del-t", text: "x" }),
    });
    const { id } = create.json() as { id: string };
    const del = await appA.inject({
      method: "DELETE",
      url: "/api/transcriptions/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id }),
    });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { ok: boolean }).ok).toBe(true);

    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      `SELECT deleted_at FROM transcriptions WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();

    // Unknown id → 404.
    const ghost = await appA.inject({
      method: "DELETE",
      url: "/api/transcriptions/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111",
      }),
    });
    expect(ghost.statusCode).toBe(404);
  });

  it("RLS — tenant B cannot see / mutate tenant A's transcriptions (T-05-07)", async () => {
    const create = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_transcription_id: "a-private",
        text: "A secret",
      }),
    });
    const { id } = create.json() as { id: string };

    // B's delete → 404.
    const bDel = await appB.inject({
      method: "DELETE",
      url: "/api/transcriptions/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id }),
    });
    expect(bDel.statusCode).toBe(404);

    // B's list — invisible.
    const bList = await appB.inject({
      method: "GET",
      url: "/api/transcriptions/list",
    });
    const bBody = bList.json() as { transcriptions: { id: string }[] };
    expect(bBody.transcriptions.find((t) => t.id === id)).toBeUndefined();

    // Cross-tenant client_transcription_id reuse is legal.
    const bCreate = await appB.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        client_transcription_id: "a-private",
        text: "B own",
      }),
    });
    expect(bCreate.statusCode).toBe(200);
  });

  it("D-32 invariant — no usage_ledger rows created by CRUD operations", async () => {
    // Create + batch-create + delete + batch-delete a few rows.
    const c1 = await appA.inject({
      method: "POST",
      url: "/api/transcriptions/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ client_transcription_id: "led-1", text: "no debit" }),
    });
    const id1 = (c1.json() as { id: string }).id;

    await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        transcriptions: [
          { client_transcription_id: "led-2", text: "still no" },
          { client_transcription_id: "led-3", text: "ledger debit" },
        ],
      }),
    });

    await appA.inject({
      method: "DELETE",
      url: "/api/transcriptions/delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ id: id1 }),
    });

    await appA.inject({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ids: [id1] }),
    });

    // ZERO rows must appear in usage_ledger (D-32).
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM usage_ledger WHERE user_id = $1`,
      [userA],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("401 — missing req.user defensive guard", async () => {
    const Fastify = (await import("fastify")).default;
    const app = Fastify({ logger: false });
    const { registerErrorHandler } = await import("../../../error-handler.js");
    const { zodTypeProvider } = await import("../../../plugins/zod-type-provider.js");
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const db = drizzle(pool);
    const { buildTranscriptionsCreateRoutes } = await import("../create.js");
    await app.register(
      buildTranscriptionsCreateRoutes({
        db: db as unknown as Parameters<typeof buildTranscriptionsCreateRoutes>[0]["db"],
      }),
    );
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/transcriptions/create",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ text: "x" }),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
