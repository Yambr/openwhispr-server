// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-02 / Task 3 — GET /api/capabilities tests.
//
// DB-fake pattern (mirror of web-search.integration.test.ts). The
// capabilities handler's only DB interaction is a single `SELECT status
// FROM setup_state WHERE id = 1`; the fake records the executed SQL
// and returns a configurable status row, which lets us:
//
//   * Exercise the 401 / shape / ETag / 304 / cross-tenant / status-flip
//     behaviour deterministically and quickly (no testcontainer boot).
//   * Avoid the pre-existing apps/api/src/routes/* integration-test
//     harness limitation: the shared `bootMigratedPostgres` helper in
//     `apps/api/src/routes/notes/__tests__/setup.ts` does NOT provision
//     the `partman` schema, so migration 0014 (audit_log partitioning)
//     fails with SQLSTATE 3F000 the moment any apps/api integration
//     test reaches it. The canonical fix lives in
//     packages/data/src/__tests__/helpers.ts (uses the
//     `openwhispr/postgres:17.5-pgpartman` image) which apps/api cannot
//     cross-import per the worktree contract. Building that image
//     locally is also blocked: prior plans documented Docker Hub TLS
//     handshake timeouts in this environment.
//
// CLAUDE.md "no mocks of internal logic" permits process-boundary
// fakes (DB driver = process boundary). The handler's SQL is asserted
// verbatim, which is how web-search.integration.test.ts establishes
// the same contract.

import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../error-handler.js";
import { buildCapabilitiesRoutes } from "../capabilities.js";

const TENANT_A = "00000000-0000-0000-0000-000000000000";
const TENANT_B = "11111111-1111-1111-1111-111111111111";
const USER = { id: "22222222-2222-2222-2222-222222222222", email: "a@example.com" };

interface RecordedQuery {
  sqlText: string;
}

function makeFakeDb(initialStatus: "pending" | "completed" | "skipped_legacy" | null): {
  db: Parameters<typeof buildCapabilitiesRoutes>[0]["db"];
  recorded: RecordedQuery[];
  setStatus: (s: "pending" | "completed" | "skipped_legacy" | null) => void;
} {
  let status = initialStatus;
  const recorded: RecordedQuery[] = [];
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          parts.push(c);
        } else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
          }
        } else {
          parts.push(String(c));
        }
      }
      const sqlText = parts.join("");
      recorded.push({ sqlText });
      // Match SELECT status FROM setup_state WHERE id = 1
      if (/SELECT status FROM setup_state/i.test(sqlText)) {
        return { rows: status === null ? [] : [{ status }] };
      }
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return {
    db: db as unknown as Parameters<typeof buildCapabilitiesRoutes>[0]["db"],
    recorded,
    setStatus(s) {
      status = s;
    },
  };
}

async function buildApp(opts: {
  db: Parameters<typeof buildCapabilitiesRoutes>[0]["db"];
  env: NodeJS.ProcessEnv;
  user?: { id: string; email: string };
  tenantId?: string;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  if (opts.user && opts.tenantId) {
    const { user, tenantId } = opts;
    app.addHook("onRequest", async (req) => {
      req.user = user;
      req.tenant = tenantId;
    });
  }
  await app.register(buildCapabilitiesRoutes({ db: opts.db, env: opts.env }));
  await app.ready();
  return app;
}

describe("GET /api/capabilities", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 401 for an anonymous request (no session)", async () => {
    const { db } = makeFakeDb("pending");
    app = await buildApp({ db, env: {} as NodeJS.ProcessEnv });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with the Phase-12 minimal payload shape for an authed request", async () => {
    const { db, recorded } = makeFakeDb("pending");
    const env = {
      LITELLM_MASTER_KEY: "sk-litellm",
      OPENAI_API_KEY: "sk-openai",
    } as NodeJS.ProcessEnv;
    app = await buildApp({ db, env, user: USER, tenantId: TENANT_A });

    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["auth", "features"]);
    const auth = body.auth as Record<string, unknown>;
    expect(Object.keys(auth).sort()).toEqual(["emailVerification", "providers", "setup"]);
    const setup = auth.setup as Record<string, unknown>;
    expect(Object.keys(setup)).toEqual(["status"]);
    expect(setup.status).toBe("pending");
    expect(auth.providers).toEqual([]);
    const features = body.features as Record<string, unknown>;
    expect(Object.keys(features).sort()).toEqual(["agent", "realtime", "transcribe"]);
    expect(features).toEqual({ transcribe: true, agent: true, realtime: true });

    // Verify the handler executed the canonical setup_state SELECT.
    const setupSelect = recorded.find((r) => /SELECT status FROM setup_state/i.test(r.sqlText));
    expect(setupSelect).toBeDefined();
    expect(setupSelect!.sqlText).toMatch(/WHERE id = 1/i);
  });

  it("treats a missing setup_state row as 'pending' (defensive robustness)", async () => {
    const { db } = makeFakeDb(null);
    app = await buildApp({
      db,
      env: {} as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { auth: { setup: { status: string } } };
    expect(body.auth.setup.status).toBe("pending");
  });

  it("derives features from env: missing LITELLM_MASTER_KEY → all features false", async () => {
    const { db } = makeFakeDb("pending");
    app = await buildApp({
      db,
      env: {} as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { features: Record<string, boolean> };
    expect(body.features).toEqual({ transcribe: false, agent: false, realtime: false });
  });

  it("realtime requires both LITELLM_MASTER_KEY AND OPENAI_API_KEY", async () => {
    const { db } = makeFakeDb("pending");
    app = await buildApp({
      db,
      env: { LITELLM_MASTER_KEY: "sk" } as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });
    const res = await app.inject({ method: "GET", url: "/api/capabilities" });
    const body = res.json() as { features: Record<string, boolean> };
    expect(body.features).toEqual({ transcribe: true, agent: true, realtime: false });
  });

  it("emits Cache-Control: private, max-age=30 + weak ETag; matching If-None-Match → 304", async () => {
    const { db } = makeFakeDb("pending");
    app = await buildApp({
      db,
      env: {} as NodeJS.ProcessEnv,
      user: USER,
      tenantId: TENANT_A,
    });

    const first = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, max-age=30");
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^W\/"[a-f0-9]{16}"$/);

    const second = await app.inject({
      method: "GET",
      url: "/api/capabilities",
      headers: { "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers.etag).toBe(etag);
  });

  it("emits DIFFERENT ETags for two different tenants under the same env+status", async () => {
    const env = {} as NodeJS.ProcessEnv;
    const { db: dbA } = makeFakeDb("pending");
    const { db: dbB } = makeFakeDb("pending");
    const appA = await buildApp({ db: dbA, env, user: USER, tenantId: TENANT_A });
    const appB = await buildApp({ db: dbB, env, user: USER, tenantId: TENANT_B });
    try {
      const resA = await appA.inject({ method: "GET", url: "/api/capabilities" });
      const resB = await appB.inject({ method: "GET", url: "/api/capabilities" });
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);
      expect(resA.headers.etag).not.toBe(resB.headers.etag);
    } finally {
      await appA.close();
      await appB.close();
    }
  });

  it("ETag changes when setup_state.status flips pending → completed (same tenant, same env)", async () => {
    const env = {} as NodeJS.ProcessEnv;
    const { db, setStatus } = makeFakeDb("pending");
    app = await buildApp({ db, env, user: USER, tenantId: TENANT_A });

    const before = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(before.statusCode).toBe(200);
    expect((before.json() as { auth: { setup: { status: string } } }).auth.setup.status).toBe(
      "pending",
    );
    const etagBefore = before.headers.etag as string;

    setStatus("completed");

    const after = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { auth: { setup: { status: string } } }).auth.setup.status).toBe(
      "completed",
    );
    const etagAfter = after.headers.etag as string;
    expect(etagAfter).not.toBe(etagBefore);
  });

  // Sanity: the handler builds the SQL via drizzle's `sql` template,
  // so we use a stable surface. Probe with a real `sql` invocation to
  // demonstrate the chunk-walker captures the literal SQL the same way
  // production reads it. drizzle wraps literals in `StringChunk` objects
  // with a `value: string[]` field — same surface as web-search's fake.
  it("sql-template chunk-walker captures literal SELECT/WHERE in setup_state query", () => {
    const q = sql`SELECT status FROM setup_state WHERE id = 1`;
    const chunks = (q as unknown as { queryChunks: unknown[] }).queryChunks;
    expect(Array.isArray(chunks)).toBe(true);
    const parts: string[] = [];
    for (const c of chunks) {
      if (typeof c === "string") {
        parts.push(c);
      } else if (c && typeof c === "object" && "value" in c) {
        const v = (c as { value: unknown }).value;
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          parts.push((v as string[]).join(""));
        }
      }
    }
    const txt = parts.join("");
    expect(txt).toMatch(/SELECT status FROM setup_state/i);
    expect(txt).toMatch(/WHERE id = 1/i);
  });
});
