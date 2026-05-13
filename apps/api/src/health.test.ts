// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 — health smoke test (replaces Phase 0 placeholder).
// buildApp is now async; the response shape is `{status:"ok"}` per the
// HealthResponse zod schema in @openwhispr/contract-tests.
import { describe, expect, it } from "vitest";
import { buildApp } from "./index.js";

describe("GET /api/health", () => {
  it("returns 200 with status:'ok' (rate-limit-exempt, auth-exempt)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
