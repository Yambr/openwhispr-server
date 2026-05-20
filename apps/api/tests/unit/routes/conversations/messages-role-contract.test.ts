// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 64 / Plan 01 / Task 3 — H-2 (wire-schema role-enum drift).
//
// Finding: server `MessageRoleSchema` accepted `role:"tool"`; the
// canonical `ConversationRoleSchema` (and `CloudMessageSchema`, the
// OUTPUT contract) does not — a `role:"tool"` message the server
// stored would fail the desktop client's round-trip parse.
//
// Resolution: option-a (drop `"tool"` server-side) — see verify-first.log
// H-2 advisor decision.
//
// RED (pre-fix):
//   - behavioral: POST /api/conversations/messages with `role:"tool"`
//     is ACCEPTED at the boundary (the enum has `"tool"`) → reaches the
//     handler. Post-fix it is REJECTED with a 400 at the dispatcher /
//     inline parse.
//   - pure-unit: the server-accepted role set must NOT contain a value
//     the canonical `ConversationRoleSchema` rejects. Pre-fix `"tool"`
//     breaks this.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationRoleSchema } from "@openwhispr/wire-schemas";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildConversationsMessagesRoutes } from "../../../../src/routes/conversations/messages.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MESSAGES_SRC = resolve(TEST_DIR, "../../../../src/routes/conversations/messages.ts");

describe("H-2 — conversations message role enum vs canonical contract", () => {
  it('H-2 — POST with role:"tool" is rejected at the route boundary (400)', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      req.user = { id: "00000000-0000-0000-0000-0000000000aa", email: "h2@test" };
      req.tenant = "00000000-0000-0000-0000-000000000000";
    });
    // Fake DB never reached — a rejected role fails the inline parse first.
    const fakeDb = {} as Parameters<typeof buildConversationsMessagesRoutes>[0]["db"];
    await app.register(buildConversationsMessagesRoutes({ db: fakeDb }));
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/messages",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        conversation_id: "00000000-0000-0000-0000-0000000000c1",
        role: "tool",
        content: "tool output",
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: unknown };
    expect(typeof body.error).toBe("string");
  });

  it("H-2 — server role enum agrees with canonical ConversationRoleSchema", () => {
    // The server's MessageRoleSchema is module-private (LOCKER-04
    // dead-export discipline); assert against the source text instead.
    const src = readFileSync(MESSAGES_SRC, "utf8");
    const match = src.match(/MessageRoleSchema\s*=\s*z\.enum\(\[([^\]]*)\]\)/);
    expect(match).not.toBeNull();
    const serverRoles = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/['"]/g, ""))
      .filter(Boolean);
    expect(serverRoles.length).toBeGreaterThan(0);
    // Every role the server accepts MUST parse under the canonical enum.
    for (const role of serverRoles) {
      expect(() => ConversationRoleSchema.parse(role)).not.toThrow();
    }
  });
});
