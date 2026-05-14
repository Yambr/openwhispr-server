// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-02 / Task 5 — GET /api/setup-state tests.
//
// D-12.02-EX1 close-out: replaces the prior makeFakeDb pattern (which
// violated CLAUDE.md's no-mocks-of-internal-logic rule — drizzle's
// transaction/execute IS internal logic, the process boundary lives at
// the libpq driver) with a real Postgres testcontainer. The shared
// inline harness lives at apps/api/src/routes/__tests__/setup.ts; it
// mirrors apps/api/src/lib/audit.test.ts's proven pattern for booting
// PG + pg_partman + the full migration set 0000..0017.
//
// Coverage matrix (preserved verbatim from the previous fake-driven
// suite):
//   1. Default pending status -> 200 {status:'pending'}, Object.keys === ['status'].
//   2. status='completed' -> 200 {status:'completed'}.
//   3. status='skipped_legacy' -> 200 {status:'skipped_legacy'}.
//   4. No row case -> 200 {status:'pending'} (defensive default).
//   5. Anonymous request -> 200 (auth NOT required).
//   6. Rate-limit: 31 requests within 60s from one IP -> 31st returns 429.
//   7. Info-leak gate: body has EXACTLY ['status'] keys; no tenant id,
//      no completedAt, no createdAt, no env-derived fields.
//   8. Cache-Control: no-store (no max-age, no public, no private).
//
// One container shared across the file (`beforeAll` boot is ~5-10s; a
// per-test container would balloon CI runtime to multiple minutes). Each
// test resets setup_state via `resetSetupState` to keep cases independent.

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type BootedPostgres,
  bootMigratedPostgres,
  buildSetupStateApp,
  resetSetupState,
} from "../../../../src/routes/__tests__/setup.js";

let booted: BootedPostgres;

beforeAll(async () => {
  booted = await bootMigratedPostgres();
}, 180_000);

afterAll(async () => {
  await booted?.shutdown();
});

describe("GET /api/setup-state — public, boolean-shaped status", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 200 + {status:'pending'} on a fresh migrated DB (default singleton row)", async () => {
    await resetSetupState(booted.ownerPool, "pending");
    app = await buildSetupStateApp({ db: booted.db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toEqual({ status: "pending" });
    expect(Object.keys(body)).toEqual(["status"]);
  });

  it("returns 200 + {status:'completed'} when the singleton was claimed", async () => {
    await resetSetupState(booted.ownerPool, "completed");
    app = await buildSetupStateApp({ db: booted.db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "completed" });
  });

  it("returns 200 + {status:'skipped_legacy'} on a v1-upgrade install", async () => {
    await resetSetupState(booted.ownerPool, "skipped_legacy");
    app = await buildSetupStateApp({ db: booted.db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "skipped_legacy" });
  });

  it("returns 200 + {status:'pending'} as defensive default when the row is missing", async () => {
    await resetSetupState(booted.ownerPool, "missing");
    app = await buildSetupStateApp({ db: booted.db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "pending" });
    // Restore the row for downstream tests.
    await resetSetupState(booted.ownerPool, "pending");
  });

  it("requires NO authentication — anonymous request returns 200 (no req.user / req.tenant stamped)", async () => {
    await resetSetupState(booted.ownerPool, "pending");
    app = await buildSetupStateApp({ db: booted.db });
    // Explicitly NO onRequest hook to stamp req.user — handler must not
    // care. Verifies T-12.02-05 (the wizard's /setup RSC fetch
    // succeeds before any admin user exists).
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
  });

  it("enforces per-IP rate-limit: the 31st request within the window returns 429", async () => {
    await resetSetupState(booted.ownerPool, "pending");
    app = await buildSetupStateApp({ db: booted.db, withRateLimit: true });
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
    await resetSetupState(booted.ownerPool, "completed");
    app = await buildSetupStateApp({ db: booted.db });
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
    await resetSetupState(booted.ownerPool, "pending");
    app = await buildSetupStateApp({ db: booted.db });
    const res = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(res.statusCode).toBe(200);
    const cc = res.headers["cache-control"];
    expect(cc).toBe("no-store");
    expect(cc).not.toMatch(/max-age/);
    expect(cc).not.toMatch(/public/);
    expect(cc).not.toMatch(/private/);
  });
});
