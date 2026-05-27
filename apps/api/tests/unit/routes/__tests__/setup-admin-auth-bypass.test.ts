// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-01 — RED→GREEN regression for REVIEW-INDEX.md CR-3.
//
// The `/api/setup/admin` route mutates state BEFORE any admin exists,
// therefore it MUST opt out of the global dualAuthHook the same way its
// sister route `/api/setup-state` does (Phase 35 / CRIT-FIX-04). The
// other unit tests at ./setup-admin.test.ts register the route on an
// app WITHOUT the dualAuthHook so they never exercise this contract.
//
// This test asserts the opt-out two ways:
//  (a) statically — Fastify's `findRoute` exposes `config.auth === false`
//      so the orchestrator-side audit + the lint surface can confirm.
//  (b) dynamically — register a stand-in `dualAuthHook` that emits 401
//      on every authed request and assert POST /api/setup/admin still
//      reaches the handler.
//
// CLAUDE.md: tests precede production code. On main this file fails
// because setup-admin.ts:152 declares `config: { rateLimit: ... }` with
// no `auth: false`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SetupAdminDeps } from "../../../../src/routes/setup-admin.js";
import { buildSetupAdminRoutes } from "../../../../src/routes/setup-admin.js";

const SETUP_ADMIN_SRC = fileURLToPath(
  new URL("../../../../src/routes/setup-admin.ts", import.meta.url),
);

// Minimal stub: the handler is reached only when the stand-in hook
// passes through. We never actually exercise the real handler here —
// the test asserts ROUTING behavior, not handler behavior.
const STUB_DEPS: SetupAdminDeps = {
  // Test stops at the auth hook boundary — neither db nor pool is ever
  // touched. `as any` is permitted in test code (biome explicit-any rule
  // is off for tests/).
  db: {} as any,
  ownerPool: {} as any,
  signUpEmail: async () => ({ data: null, error: { message: "stub" } }),
};

async function buildAppWithFakeAuthHook(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Quick-task 260527-im6 — the setup-admin route now declares
  // `schema: { body }` (pre-emptive LOCKER-04 migration). Register the
  // zod-type-provider compilers here so Fastify can build the
  // validation schema at registration time.
  const { zodTypeProvider } = await import("../../../../src/plugins/zod-type-provider.js");
  await app.register(zodTypeProvider);

  // Stand-in for `buildDualAuthHook` — emits 401 unless the route opted
  // out via `req.routeOptions.config.auth === false`. This is the exact
  // contract the real `dual-auth.ts:136` honors.
  app.addHook("onRequest", async function fakeDualAuthHook(req: FastifyRequest) {
    if (req.routeOptions?.url === undefined) return;
    if (req.routeOptions?.config?.auth === false) return;
    // No session header => 401 (the actual contract on main).
    const err: Error & { statusCode?: number } = new Error("unauthenticated");
    err.statusCode = 401;
    throw err;
  });

  await app.register(buildSetupAdminRoutes(STUB_DEPS));
  await app.ready();
  return app;
}

describe("Plan 51-01 — /api/setup/admin opts out of dualAuthHook", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildAppWithFakeAuthHook();
  });
  afterAll(async () => {
    await app?.close();
  });

  it("(a) static: route declaration carries config.auth === false", () => {
    // Source-level assertion: the route declaration in setup-admin.ts
    // must include `auth: false` in its `config` block. fastify v5's
    // `findRoute` does not surface `config` through a stable accessor,
    // so we read the file. The pattern is narrow enough that a future
    // change to use a builder still has to keep the same literal.
    const src = readFileSync(SETUP_ADMIN_SRC, "utf8");
    expect(
      /config:\s*\{[^}]*\bauth:\s*false\b/s.test(src),
      "setup-admin.ts must declare `config: { auth: false, ... }` on /api/setup/admin (sister-route pattern: setup-state.ts:75)",
    ).toBe(true);
  });

  it("(b) dynamic: POST passes through the dualAuthHook without a session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/setup/admin",
      payload: { email: "x@example.test", password: "Pw!12345", workspace: "w" },
    });
    // We do NOT assert 200/201 — the stub deps don't satisfy the
    // handler. We assert ONLY that the auth hook didn't 401. Any
    // non-401 means routing reached the handler.
    expect(res.statusCode, `expected hook to bypass; got ${res.statusCode} ${res.body}`).not.toBe(
      401,
    );
  });
});
