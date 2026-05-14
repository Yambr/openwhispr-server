// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 02 / Task 1 — ledger idempotency property test (route level).
//
// Property: for N random sessionIds * M retries each, the route returns
// 200 on every call AND the ledger INSERT SQL it emits is shaped exactly
// as `INSERT … ON CONFLICT (request_id) DO NOTHING`. The schema-level
// property test (packages/data/src/__tests__/usage-ledger-idempotency.test.ts)
// covers the real-Postgres first-writer-wins replay semantics; this file
// covers the ROUTE-level contract — the route is the producer of the
// idempotent INSERT and must emit it in every code path including
// adversarial input shapes.
//
// Pure-JS property loop (no fast-check dep at the apps/api layer); 100
// random sessionIds * 2 retries each = 200 inserts, every one must
// carry the ON CONFLICT clause.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildStreamingUsageRoutes } from "../../../../src/routes/streaming-usage.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

function makeFakeDb(): {
  db: Parameters<typeof buildStreamingUsageRoutes>[0]["db"];
  recorded: RecordedQuery[];
} {
  const recorded: RecordedQuery[] = [];
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string"))
            parts.push((v as string[]).join(""));
          else {
            parts.push("?");
            params.push(v);
          }
        } else {
          parts.push("?");
          params.push(c);
        }
      }
      const sqlText = parts.join("");
      recorded.push({ sql: sqlText, params });
      if (/SELECT\s+COALESCE\(SUM\(units\)/i.test(sqlText)) {
        return { rows: [{ words_used: 0 }] };
      }
      return { rows: [] };
    },
  };
  return {
    db: {
      async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
        return cb(tx);
      },
    },
    recorded,
  };
}

function buildApp(deps: Parameters<typeof buildStreamingUsageRoutes>[0]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    req.user = { id: TEST_USER, email: "fixture@conformance.test" };
    req.tenant = TEST_TENANT;
  });
  app.register(buildStreamingUsageRoutes(deps));
  return app;
}

function randomSessionId(i: number): string {
  return `prop-${i}-${Math.random().toString(36).slice(2, 14)}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("ledger-idempotency — property: every INSERT carries ON CONFLICT", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("100 random sessionIds × 2 retries = 200 inserts; every one has ON CONFLICT (request_id) DO NOTHING", async () => {
    const { db, recorded } = makeFakeDb();
    app = buildApp({ db });

    const N = 100;
    for (let i = 0; i < N; i++) {
      const sessionId = randomSessionId(i);
      const duration = 1 + Math.floor(Math.random() * 300);
      const payload = JSON.stringify({
        sessionId,
        audioDurationSeconds: duration,
      });
      const r1 = await app.inject({
        method: "POST",
        url: "/api/streaming-usage",
        headers: { "content-type": "application/json" },
        payload,
      });
      const r2 = await app.inject({
        method: "POST",
        url: "/api/streaming-usage",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
    }

    const inserts = recorded.filter((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(inserts.length).toBe(2 * N); // first + retry per sessionId

    let withOnConflict = 0;
    for (const ins of inserts) {
      if (/ON CONFLICT \(request_id\) DO NOTHING/.test(ins.sql)) {
        withOnConflict++;
      }
    }
    expect(withOnConflict).toBe(2 * N);
  });

  it("adversarial sessionId shapes (unicode, spaces, very long) — every INSERT still emits ON CONFLICT", async () => {
    const { db, recorded } = makeFakeDb();
    app = buildApp({ db });

    const adversarial = [
      "session with spaces",
      "\u0421\u0435\u0441\u0441\u0438\u044f-2026", // "Sessiya-2026" written as ASCII unicode escapes — keeps source bytes English-only while exercising cyrillic sessionId at runtime
      "🎙️-emoji-session",
      "x".repeat(500), // long
      "session\twith\ttabs",
      'session"with"quotes',
      "session'with'apostrophes",
      "session;DROP TABLE--", // SQL injection canary; drizzle parameterizes
    ];

    for (const sessionId of adversarial) {
      const r = await app.inject({
        method: "POST",
        url: "/api/streaming-usage",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ sessionId, audioDurationSeconds: 10 }),
      });
      expect(r.statusCode).toBe(200);
    }

    const inserts = recorded.filter((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(inserts).toHaveLength(adversarial.length);
    for (const ins of inserts) {
      expect(ins.sql).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/);
    }
    // Defense-in-depth: drizzle's sql template parameterizes — the
    // injection canary MUST land as a bound param, not as raw SQL text.
    const injectionInsert = recorded.find((r) => JSON.stringify(r.params).includes("DROP TABLE"));
    expect(injectionInsert).toBeDefined();
    // The raw SQL text must NOT contain DROP TABLE.
    expect(injectionInsert?.sql).not.toMatch(/DROP TABLE/);
  });
});
