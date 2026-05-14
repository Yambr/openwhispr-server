// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 — health smoke test (replaces Phase 0 placeholder).
// buildApp is now async; the response shape is `{status:"ok"}` per the
// HealthResponse zod schema in @openwhispr/contract-tests.
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/index.js";

describe("GET /api/health", () => {
  it("returns 200 with status:'ok' + migrations_completed (rate-limit-exempt, auth-exempt)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; migrations_completed: boolean };
    expect(body.status).toBe("ok");
    // Plan 13-01 / Task 13-01-05 — `/api/health` now carries the
    // `migrations_completed` field. buildApp() called with no opts wires
    // no migrationsCheck, so the field reports `false` (operator-actionable
    // signal that no DB-backed migration probe was attached at boot).
    expect(body).toHaveProperty("migrations_completed");
    expect(typeof body.migrations_completed).toBe("boolean");
    expect(body.migrations_completed).toBe(false);
    await app.close();
  });
});
