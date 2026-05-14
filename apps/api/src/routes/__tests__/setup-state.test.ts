// SPDX-License-Identifier: Apache-2.0
// Phase 12 / Plan 12-02 / Task 5 — GET /api/setup-state tests.
//
// DB-fake pattern (same rationale as capabilities.test.ts — see that
// file's header for the apps/api integration-harness limitation).
//
// Coverage matrix:
//   1. Default pending status -> 200 {status:'pending'}, Object.keys === ['status'].
//   2. status='completed' -> 200 {status:'completed'}.
//   3. status='skipped_legacy' -> 200 {status:'skipped_legacy'}.
//   4. No row case -> 200 {status:'pending'} (defensive default).
//   5. Anonymous request -> 200 (auth NOT required).
//   6. Rate-limit: 31 requests within 60s from one IP -> 31st returns 429.
//   7. Info-leak gate: body has EXACTLY ['status'] keys; no tenant id,
//      no completedAt, no createdAt, no env-derived fields.
//   8. Cache-Control: no-store (no max-age, no public, no private).

import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../error-handler.js";
import { buildSetupStateRoutes } from "../setup-state.js";

function makeFakeDb(initialStatus: "pending" | "completed" | "skipped_legacy" | null): {
  db: Parameters<typeof buildSetupStateRoutes>[0]["db"];
  setStatus: (s: "pending" | "completed" | "skipped_legacy" | null) => void;
} {
  let status = initialStatus;
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
          }
        }
      }
      const sqlText = parts.join("");
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
    db: db as unknown as Parameters<typeof buildSetupStateRoutes>[0]["db"],
    setStatus(s) {
      status = s;
    },
  };
}

async function buildApp(opts: {
  db: Parameters<typeof buildSetupStateRoutes>[0]["db"];
  withRateLimit?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  if (opts.withRateLimit) {
    // Register the actual Fastify rate-limit plugin so the per-route
    // `config.rateLimit` is honored. In-process backend (no Redis).
    await app.register(rateLimit, { global: false });
  }
  await app.register(buildSetupStateRoutes({ db: opts.db }));
  await app.ready();
  return app;
}

describe("GET /api/setup-state — public, boolean-shaped status", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 200 + {status:'pending'} on a fresh migrated DB (default singleton row)", async () => {
    const { db } = makeFakeDb("pending");
    app = await buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toEqual({ status: "pending" });
    expect(Object.keys(body)).toEqual(["status"]);
  });

  it("returns 200 + {status:'completed'} when the singleton was claimed", async () => {
    const { db } = makeFakeDb("completed");
    app = await buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "completed" });
  });

  it("returns 200 + {status:'skipped_legacy'} on a v1-upgrade install", async () => {
    const { db } = makeFakeDb("skipped_legacy");
    app = await buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "skipped_legacy" });
  });

  it("returns 200 + {status:'pending'} as defensive default when the row is missing", async () => {
    const { db } = makeFakeDb(null);
    app = await buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "pending" });
  });

  it("requires NO authentication — anonymous request returns 200 (no req.user / req.tenant stamped)", async () => {
    const { db } = makeFakeDb("pending");
    app = await buildApp({ db });
    // Explicitly NO onRequest hook to stamp req.user — handler must not
    // care. Verifies T-12.02-05 (the wizard's /setup RSC fetch
    // succeeds before any admin user exists).
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
  });

  it("enforces per-IP rate-limit: the 31st request within the window returns 429", async () => {
    const { db } = makeFakeDb("pending");
    app = await buildApp({ db, withRateLimit: true });
    // 30 requests from the same IP — all succeed.
    for (let i = 0; i < 30; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/setup-state",
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
      expect(r.statusCode).toBe(200);
    }
    const tripped = await app.inject({
      method: "GET",
      url: "/api/setup-state",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(tripped.statusCode).toBe(429);
  });

  it("info-leak gate: response body has EXACTLY ['status'] keys — no PII, no env, no timestamps", async () => {
    const { db } = makeFakeDb("completed");
    app = await buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["status"]);
    // Belt-and-braces — none of these field names may appear in the
    // serialized body.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/tenant/i);
    expect(serialised).not.toMatch(/completedAt|completed_at/);
    expect(serialised).not.toMatch(/createdAt|created_at/);
    expect(serialised).not.toMatch(/email/i);
    expect(serialised).not.toMatch(/user/i);
    expect(serialised).not.toMatch(/env/i);
  });

  it("emits Cache-Control: no-store with no max-age / public / private directives", async () => {
    const { db } = makeFakeDb("pending");
    app = await buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    const cc = res.headers["cache-control"];
    expect(cc).toBe("no-store");
    expect(cc).not.toMatch(/max-age/);
    expect(cc).not.toMatch(/public/);
    expect(cc).not.toMatch(/private/);
  });
});
