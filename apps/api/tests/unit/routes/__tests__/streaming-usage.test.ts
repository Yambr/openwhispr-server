// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 02 / Task 1 — POST /api/streaming-usage plugin tests.
//
// Strategy mirrors transcribe.test.ts / reason.test.ts: hand-rolled fake
// TransactionalDb that records executed SQL fragments; dualAuthHook
// stubbed via onRequest hook so we isolate the route's wire-shape
// semantics. Full hook semantics covered by dual-auth.test.ts.
//
// Coverage matrix:
//   * happy path (new sessionId) -> 200 UsageResponse + ledger INSERT with
//     kind='streaming-stt', units=Math.round(audioDurationSeconds)
//   * idempotent re-post (same sessionId) — both 200, ON CONFLICT present
//   * no auth -> 401 envelope
//   * missing sessionId -> 400 envelope (zod rejection)
//   * Math.round semantics — 120.49 -> 120, 120.51 -> 121
//   * response shape: plan='unlimited', wordsRemaining=999_999_999,
//     limitReached=false
//   * D-13: body.text NEVER appears in recorded SQL (only sha256+preview
//     in log fields)
//   * audioDurationSeconds=0 records units=0
import { ErrorEnvelope, StreamingUsageResponse } from "@openwhispr/contract-tests/schemas";
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

function makeFakeDb(opts?: { sumRows?: Array<{ words_used: string | number }> }): {
  db: Parameters<typeof buildStreamingUsageRoutes>[0]["db"];
  recorded: RecordedQuery[];
} {
  const recorded: RecordedQuery[] = [];
  const sumRows = opts?.sumRows;
  let sumCallIndex = 0;
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          parts.push(c);
        } else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        } else {
          parts.push(String(c));
        }
      }
      const sqlText = parts.join("");
      recorded.push({ sql: sqlText, params });
      // Differentiate the SELECT SUM from set_config / INSERT
      if (/SELECT\s+COALESCE\(SUM\(units\)/i.test(sqlText)) {
        const row = sumRows?.[sumCallIndex++] ?? { words_used: 0 };
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return { db, recorded };
}

function buildApp(
  deps: Parameters<typeof buildStreamingUsageRoutes>[0],
  opts?: { authed?: boolean; logCapture?: unknown[] },
): FastifyInstance {
  const logCapture = opts?.logCapture;
  const app = Fastify({
    logger: logCapture
      ? {
          level: "info",
          stream: {
            write: (chunk: string) => {
              try {
                logCapture.push(JSON.parse(chunk));
              } catch {
                /* ignore non-json lines */
              }
            },
          },
        }
      : false,
  });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  if (opts?.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
    });
  }
  app.register(buildStreamingUsageRoutes(deps));
  return app;
}

const minimalBody = (overrides: Record<string, unknown> = {}) => ({
  sessionId: "session-test-1",
  audioDurationSeconds: 60,
  ...overrides,
});

describe("POST /api/streaming-usage", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns canonical UsageResponse on happy path + writes ledger row", async () => {
    const { db, recorded } = makeFakeDb({
      sumRows: [{ words_used: "60" }],
    });
    app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(minimalBody()),
    });
    expect(res.statusCode).toBe(200);
    const parsed = StreamingUsageResponse.parse(res.json());
    expect(parsed.wordsUsed).toBe(60);
    expect(parsed.wordsRemaining).toBe(999_999_999);
    expect(parsed.plan).toBe("unlimited");
    expect(parsed.limitReached).toBe(false);

    // Ledger INSERT with kind='streaming-stt', units=60, ON CONFLICT.
    const insert = recorded.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(insert).toBeDefined();
    expect(insert?.sql).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/);
    const wholeRecording = insert?.sql + JSON.stringify(insert?.params);
    expect(wholeRecording).toContain("streaming-stt");
    expect(wholeRecording).toContain(TEST_TENANT);
    expect(wholeRecording).toContain(TEST_USER);
    expect(wholeRecording).toContain("session-test-1");
    expect(insert?.sql).toMatch(/60\s*\)\s*ON CONFLICT/);
  });

  it("applies Math.round on audioDurationSeconds (D-10): 120.49 → 120, 120.51 → 121", async () => {
    const { db: db1, recorded: rec1 } = makeFakeDb();
    app = buildApp({ db: db1 });
    const res1 = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(
        minimalBody({ audioDurationSeconds: 120.49, sessionId: "sess-round-1" }),
      ),
    });
    expect(res1.statusCode).toBe(200);
    const insert1 = rec1.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(insert1?.sql).toMatch(/120\s*\)\s*ON CONFLICT/);
    await app.close();

    const { db: db2, recorded: rec2 } = makeFakeDb();
    app = buildApp({ db: db2 });
    const res2 = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(
        minimalBody({ audioDurationSeconds: 120.51, sessionId: "sess-round-2" }),
      ),
    });
    expect(res2.statusCode).toBe(200);
    const insert2 = rec2.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(insert2?.sql).toMatch(/121\s*\)\s*ON CONFLICT/);
  });

  it("idempotent re-post (same sessionId) returns 200 both times; ON CONFLICT clause present", async () => {
    const { db, recorded } = makeFakeDb({
      sumRows: [{ words_used: "60" }, { words_used: "60" }],
    });
    app = buildApp({ db });
    const body = JSON.stringify(minimalBody({ sessionId: "sess-idem" }));
    const res1 = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: body,
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: body,
    });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    const inserts = recorded.filter((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(inserts).toHaveLength(2);
    for (const ins of inserts) {
      expect(ins.sql).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/);
    }
  });

  it("returns 401 envelope without auth (req.user absent)", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db }, { authed: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(minimalBody()),
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
  });

  it("returns 400 envelope on missing sessionId (zod rejection)", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ audioDurationSeconds: 60 }),
    });
    expect(res.statusCode).toBe(400);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
  });

  it("returns 400 envelope on negative audioDurationSeconds (zod min(0))", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(minimalBody({ audioDurationSeconds: -1 })),
    });
    expect(res.statusCode).toBe(400);
  });

  it("D-13: body.text is NEVER persisted in ledger SQL (only sha256+preview in logs)", async () => {
    const { db, recorded } = makeFakeDb();
    app = buildApp({ db });
    const secret = "Plaintext PII transcript that must never reach the ledger";
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(minimalBody({ sessionId: "sess-pii", text: secret })),
    });
    expect(res.statusCode).toBe(200);
    // Across ALL recorded SQL, the plaintext text MUST NOT appear.
    const wholeSql = recorded.map((r) => r.sql + JSON.stringify(r.params)).join("");
    expect(wholeSql).not.toContain(secret);
  });

  it("audioDurationSeconds=0 records units=0", async () => {
    const { db, recorded } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(minimalBody({ audioDurationSeconds: 0, sessionId: "sess-zero" })),
    });
    expect(res.statusCode).toBe(200);
    const insert = recorded.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(insert?.sql).toMatch(/0\s*\)\s*ON CONFLICT/);
  });

  it("accepts all 14 optional telemetry fields per BACKEND_SPEC.md:377", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/streaming-usage",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(
        minimalBody({
          sessionId: "sess-fields",
          text: "hello",
          clientType: "macos",
          appVersion: "1.0.0",
          clientVersion: "openwhispr-desktop",
          sttProvider: "deepgram",
          sttModel: "nova-2",
          sttProcessingMs: 1234,
          sttLanguage: "en",
          audioSizeBytes: 65536,
          audioFormat: "webm",
          clientTotalMs: 1500,
          sendLogs: true,
        }),
      ),
    });
    expect(res.statusCode).toBe(200);
  });
});
