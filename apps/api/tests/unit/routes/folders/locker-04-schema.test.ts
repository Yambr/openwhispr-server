// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 64 / Plan 01 / Task 1 — H-1 (LOCKER-04 inv-14).
//
// RED: every folders/** route declaration MUST carry a declarative
// `schema: { body | querystring | params: <ZodSchema> }` block. Pre-fix
// the folders routes register only `config: { rateLimit }` — the
// `schema:` key is absent on all 5 → this test fails RED.
//
// Validation-coverage GUARD (NOT the RED driver) — drives `app.inject`
// with a deliberately malformed payload through the real route plugins
// and asserts a 400 with the canonical `{ error: <string> }` envelope
// still fires, proving the inline `.parse()` is preserved post-fix.
// (The repo's canonical error envelope is `{ error: <string> }` — see
// error-handler.ts:4 — NOT a `{code,message}` object.)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildFoldersCreateRoutes } from "../../../../src/routes/folders/create.js";
import { buildFoldersListRoutes } from "../../../../src/routes/folders/list.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, "../../../..");

const BODY_ROUTES = [
  "src/routes/folders/create.ts",
  "src/routes/folders/batch-create.ts",
  "src/routes/folders/delete.ts",
  "src/routes/folders/update.ts",
];

const QUERYSTRING_ROUTES = ["src/routes/folders/list.ts"];

describe("H-1 — folders LOCKER-04 inv-14 declarative schema", () => {
  it.each(BODY_ROUTES)("%s carries `schema: { body: ... }`", (rel) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).toMatch(/schema:\s*\{\s*body:/);
  });

  it.each(QUERYSTRING_ROUTES)("%s carries `schema: { querystring: ... }`", (rel) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).toMatch(/schema:\s*\{\s*querystring:/);
  });

  it("H-1 GUARD — malformed body still rejects with the canonical 400 envelope", async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      req.user = { id: "00000000-0000-0000-0000-0000000000aa", email: "h1@test" };
      req.tenant = "00000000-0000-0000-0000-000000000000";
    });
    // Fake db is never reached — a malformed body rejects before any DB call.
    const fakeDb = {} as Parameters<typeof buildFoldersCreateRoutes>[0]["db"];
    await app.register(buildFoldersCreateRoutes({ db: fakeDb }));
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/folders/create",
      headers: { "content-type": "application/json" },
      // `name` is required by FolderInputSchema — omit it.
      payload: JSON.stringify({ sort_order: 1 }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: unknown };
    expect(typeof body.error).toBe("string");
    expect((body.error as string).length).toBeGreaterThan(0);
    await app.close();
  });

  it("H-1 GUARD — malformed querystring still rejects with the canonical 400 envelope", async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      req.user = { id: "00000000-0000-0000-0000-0000000000aa", email: "h1@test" };
      req.tenant = "00000000-0000-0000-0000-000000000000";
    });
    const fakeDb = {} as Parameters<typeof buildFoldersListRoutes>[0]["db"];
    await app.register(buildFoldersListRoutes({ db: fakeDb }));
    await app.ready();

    // `before` must parse as a valid timestamp — supply garbage. The
    // semantic `parseListQuery` parse still runs and rejects with 400
    // (its non-canonical envelope is the separate, out-of-scope M-1).
    const res = await app.inject({
      method: "GET",
      url: "/api/folders/list?before=not-a-timestamp",
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
