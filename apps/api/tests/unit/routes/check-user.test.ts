// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 03 / Task 3 — `/api/check-user` plugin tests.
//
// Strategy: register the plugin against a hand-rolled fake
// `TransactionalDb` that records executed SQL fragments + bound params
// and returns canned `rows` so we can drive the `{exists}` boolean
// without standing up testcontainers Postgres. End-to-end conformance
// against a real backend lands in Plan 06.
//
// Coverage matrix:
//   * existing email -> {exists:true}
//   * unknown email -> {exists:false}
//   * missing body field -> 400 + envelope (zod validation via schema)
//   * extra field -> 400 (.strict() on request)
//   * non-email string -> 400
//   * pre-auth: NO Authorization header -> still 200 (auth=false)
//   * tenant: query runs inside withTenant (set_config issued)

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { _resetDefaultTenantCacheForTesting } from "../../../src/lib/default-tenant.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import { buildCheckUserRoutes } from "../../../src/routes/check-user.js";

const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

function makeFakeDb(rowsFor: (sqlText: string) => unknown[]): {
  db: Parameters<typeof buildCheckUserRoutes>[0]["db"];
  recorded: RecordedQuery[];
} {
  const recorded: RecordedQuery[] = [];
  type FakeTx = { execute(query: unknown): Promise<unknown> };
  const tx: FakeTx = {
    async execute(query: unknown): Promise<unknown> {
      // Drizzle's `sql\`...\`` template returns an SQL object whose
      // internals include `queryChunks` — an interleaved array of
      // `StringChunk` (whose `.value` is a `string[]`) and `Param`
      // (whose `.value` holds the bound value) nodes. We serialise the
      // chunks for text-matching and pull primitive Param values out
      // for assertions.
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          parts.push(c);
        } else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            // StringChunk
            parts.push((v as string[]).join(""));
          } else {
            // Param
            parts.push("?");
            params.push(v);
          }
        } else {
          parts.push(String(c));
        }
      }
      const text = parts.join("");
      recorded.push({ sql: text, params });
      return { rows: rowsFor(text) };
    },
  };
  const db = {
    async transaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return { db, recorded };
}

function buildApp(deps: Parameters<typeof buildCheckUserRoutes>[0]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  app.register(buildCheckUserRoutes(deps));
  return app;
}

describe("POST /api/check-user", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
  });

  afterEach(() => {
    /* noop */
  });

  it("returns {exists:true} when the email matches a row", async () => {
    const { db, recorded } = makeFakeDb(() => [{ "?column?": 1 }]);
    const app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/check-user",
      headers: { "content-type": "application/json" },
      payload: { email: "alice@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: true });
    // First execute: set_config for tenant binding; second: SELECT.
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    const setConfigCall = recorded.find((r) => /set_config/i.test(r.sql));
    expect(setConfigCall).toBeDefined();
    await app.close();
  });

  it("returns {exists:false} when the email matches no rows", async () => {
    const { db } = makeFakeDb(() => []);
    const app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/check-user",
      headers: { "content-type": "application/json" },
      payload: { email: "nobody@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false });
    await app.close();
  });

  it("rejects missing body field with 400 + envelope", async () => {
    const { db } = makeFakeDb(() => []);
    const app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/check-user",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    await app.close();
  });

  it("rejects extra body fields with 400 (.strict on request)", async () => {
    const { db } = makeFakeDb(() => []);
    const app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/check-user",
      headers: { "content-type": "application/json" },
      payload: { email: "alice@example.com", admin: true },
    });
    expect(res.statusCode).toBe(400);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    await app.close();
  });

  it("rejects non-email string with 400", async () => {
    const { db } = makeFakeDb(() => []);
    const app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/check-user",
      headers: { "content-type": "application/json" },
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("is pre-auth: no Authorization header is fine", async () => {
    const { db } = makeFakeDb(() => []);
    const app = buildApp({ db });
    const res = await app.inject({
      method: "POST",
      url: "/api/check-user",
      headers: { "content-type": "application/json" },
      payload: { email: "alice@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false });
    await app.close();
  });

  it("query executes under the default tenant context (set_config issued)", async () => {
    const { db, recorded } = makeFakeDb(() => []);
    const app = buildApp({ db });
    await app.inject({
      method: "POST",
      url: "/api/check-user",
      headers: { "content-type": "application/json" },
      payload: { email: "trace@example.com" },
    });
    const setConfig = recorded.find((r) => /set_config/i.test(r.sql));
    expect(setConfig).toBeDefined();
    // The set_config call carries the tenant UUID as a bind param.
    // Our recorder may not surface it via .params, so we serialise
    // the SQL representation and look for the canonical UUID string.
    const wholeRecording = JSON.stringify(recorded);
    expect(wholeRecording).toContain(DEFAULT_TENANT);
    await app.close();
  });
});
