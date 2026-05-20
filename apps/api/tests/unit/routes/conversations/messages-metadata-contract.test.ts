// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 64 / Plan 01 / Task 4 — H-3 (wire-schema metadata-shape drift).
//
// Finding: server `MessageInputSchema.metadata` was
// `z.record(z.string(), z.unknown())` — it accepted nested
// objects/arrays the canonical `MetadataSchema` (bounded keys, scalar
// values, 4 KiB cap) rejects. A client could persist a metadata shape
// the desktop's round-trip parse later rejects.
//
// Fix: the server adopts the canonical `MetadataSchema` from
// `@openwhispr/wire-schemas` (which Task 4's GREEN also `export`s).
//
// RED (pre-fix): POST a nested-object metadata value is ACCEPTED at the
// boundary (z.unknown() lets it through) → reaches the handler. Post-fix
// it is REJECTED with a 400 at the inline parse.

import { MetadataSchema } from "@openwhispr/wire-schemas";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildConversationsMessagesRoutes } from "../../../../src/routes/conversations/messages.js";

describe("H-3 — conversations message metadata vs canonical contract", () => {
  it("H-3 — POST with a nested-object metadata value is rejected (400)", async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      req.user = { id: "00000000-0000-0000-0000-0000000000aa", email: "h3@test" };
      req.tenant = "00000000-0000-0000-0000-000000000000";
    });
    // Fake DB never reached — a rejected metadata shape fails the inline
    // parse before any DB access.
    const fakeDb = {} as Parameters<typeof buildConversationsMessagesRoutes>[0]["db"];
    await app.register(buildConversationsMessagesRoutes({ db: fakeDb }));
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/messages",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        conversation_id: "00000000-0000-0000-0000-0000000000c1",
        role: "user",
        content: "hi",
        metadata: { evil: { nested: [{ deep: true }] } },
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: unknown };
    expect(typeof body.error).toBe("string");
  });

  it("H-3 — canonical MetadataSchema parses flat scalars, rejects nesting", () => {
    // MetadataSchema must be exported from @openwhispr/wire-schemas
    // (the GREEN step adds the `export` keyword). This import doubles as
    // the export-needed RED signal.
    expect(() => MetadataSchema.parse({ a: "string", b: 42, c: true })).not.toThrow();
    expect(() => MetadataSchema.parse({ evil: { nested: true } })).toThrow();
    expect(() => MetadataSchema.parse({ evil: [1, 2, 3] })).toThrow();
  });
});
