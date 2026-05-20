// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 64 / Plan 01 / Task 1 — H-1 (LOCKER-04 inv-14).
//
// RED: every notes/** route declaration MUST carry a declarative
// `schema: { body | querystring | params: <ZodSchema> }` block. Pre-fix
// the notes routes register only `config: { rateLimit }` — the
// `schema:` key is absent on all 7 → this test fails RED.
//
// notes/delete-all is a body-less DELETE — LOCKER-04 still requires a
// `schema:` key; an empty-body schema (`z.object({}).strict()`)
// satisfies the structural rule (lint-prod-readiness checks key
// presence, not shape).
//
// Validation-coverage GUARD (NOT the RED driver) — drives `app.inject`
// with a malformed body and asserts a 400 with the canonical
// `{ error: <string> }` envelope still fires, proving the inline
// `.parse()` is preserved post-fix.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { buildNotesCreateRoutes } from "../../../../src/routes/notes/create.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, "../../../..");

const BODY_ROUTES = [
  "src/routes/notes/create.ts",
  "src/routes/notes/batch-create.ts",
  "src/routes/notes/delete.ts",
  "src/routes/notes/update.ts",
  "src/routes/notes/search.ts",
  // body-less DELETE — empty-body schema satisfies LOCKER-04.
  "src/routes/notes/delete-all.ts",
];

const QUERYSTRING_ROUTES = ["src/routes/notes/list.ts"];

describe("H-1 — notes LOCKER-04 inv-14 declarative schema", () => {
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
    app.addHook("onRequest", async (req) => {
      req.user = { id: "00000000-0000-0000-0000-0000000000aa", email: "h1@test" };
      req.tenant = "00000000-0000-0000-0000-000000000000";
    });
    const fakeDb = {} as Parameters<typeof buildNotesCreateRoutes>[0]["db"];
    await app.register(buildNotesCreateRoutes({ db: fakeDb }));
    await app.ready();

    // NoteInputSchema is `.strict()` — an unknown key is rejected at
    // parse time before any DB call.
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/create",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ content: "hi", __unknown_evil_key__: true }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: unknown };
    expect(typeof body.error).toBe("string");
    expect((body.error as string).length).toBeGreaterThan(0);
    await app.close();
  });
});
