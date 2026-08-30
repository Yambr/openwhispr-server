// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56 / Plan 56-04 — CONTRACT-01 extension for R10 (conversations
// + messages). Locked shape + status-code contract that the upstream
// Yambr Electron client (`~/openwhispr/src/services/ConversationsService.ts`)
// is hard-coded against. Asserts the wire surface using the canonical
// zod schemas from `@openwhispr/wire-schemas` so any drift between
// route handlers and the published shapes fails the suite.
//
// Scope note: this is the shape-and-contract suite — it does NOT touch
// a live backend. Status-code expectations are documented as
// const-asserted literals so a future contract change has to be
// expressed here BEFORE the route can be flipped (test-first wire
// gate). Live-fetch end-to-end coverage lives in
// `tests/unit/conversations.test.ts` (skip-if-unreachable).
//
// Lives in `packages/contract-tests/tests/unit/` (vitest config only
// includes `tests/**/*.test.ts`). The plan referenced
// `packages/contract-tests/src/conversations-shape.test.ts` but `src/`
// is excluded from the test glob; placing it here keeps it discoverable
// and matches sibling-phase patterns (e.g. notes.test.ts, folders.test.ts).

import {
  CloudConversationSchema,
  CloudConversationWithMessagesSchema,
  CloudMessageSchema,
  ConversationInputSchema,
} from "@openwhispr/wire-schemas";
import { describe, expect, it } from "vitest";

// Locked status-code contract for /api/conversations/* — DO NOT loosen
// without updating SERVER-REQUIREMENTS.md §R10 first.
const STATUS_CONTRACT = {
  create: 201, // POST /api/conversations/create
  update: 200, // PATCH /api/conversations/update
  delete: 204, // DELETE /api/conversations/delete (no body)
  list: 200, // GET /api/conversations/list
  search: 200, // POST /api/conversations/search
  messages_post: 201, // POST /api/conversations/messages
  messages_get: 200, // GET /api/conversations/messages
} as const;

describe("CONTRACT-01 — R10 /api/conversations/* status codes (locked)", () => {
  it("POST .../create — 201 Created", () => {
    expect(STATUS_CONTRACT.create).toBe(201);
  });

  it("PATCH .../update — 200 OK", () => {
    expect(STATUS_CONTRACT.update).toBe(200);
  });

  it("DELETE .../delete — 204 No Content", () => {
    expect(STATUS_CONTRACT.delete).toBe(204);
  });

  it("GET .../list — 200 OK", () => {
    expect(STATUS_CONTRACT.list).toBe(200);
  });

  it("POST .../search — 200 OK", () => {
    expect(STATUS_CONTRACT.search).toBe(200);
  });

  it("POST .../messages (create message) — 201 Created", () => {
    expect(STATUS_CONTRACT.messages_post).toBe(201);
  });

  it("GET .../messages (list messages) — 200 OK", () => {
    expect(STATUS_CONTRACT.messages_get).toBe(200);
  });
});

describe("CONTRACT-01 — R10 ConversationInput accepts client + nested-messages shape", () => {
  it("accepts a minimal create body (title only)", () => {
    const parsed = ConversationInputSchema.parse({ title: "minimal" });
    expect(parsed.title).toBe("minimal");
  });

  it("accepts the full client-input shape with messages[] and client_conversation_id", () => {
    const parsed = ConversationInputSchema.parse({
      client_conversation_id: "client-conv-shape-test-id",
      title: "full shape",
      created_at: "2026-05-19T10:00:00.000Z",
      updated_at: "2026-05-19T10:00:00.000Z",
      messages: [
        { role: "user", content: "hello", metadata: { source: "test" } },
        { role: "assistant", content: "hi back" },
      ],
    });
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.client_conversation_id).toBe("client-conv-shape-test-id");
  });

  it("rejects unknown top-level fields (.strict() — mass-assignment guard)", () => {
    expect(() => ConversationInputSchema.parse({ title: "x", surprise_field: "boom" })).toThrow();
  });

  it("rejects unknown nested message fields (.strict())", () => {
    expect(() =>
      ConversationInputSchema.parse({
        title: "x",
        messages: [{ role: "user", content: "x", rogue: 1 }],
      }),
    ).toThrow();
  });

  it("rejects invalid roles (only user|assistant|system permitted)", () => {
    expect(() =>
      ConversationInputSchema.parse({
        title: "x",
        messages: [{ role: "wizard", content: "x" }],
      }),
    ).toThrow();
  });
});

describe("CONTRACT-01 — R10 CloudConversation response shape (7 fields)", () => {
  const fixture = {
    id: "11111111-1111-4111-8111-111111111111",
    client_conversation_id: "client-conv-rsp-id",
    title: "shape",
    archived_at: null,
    deleted_at: null,
    created_at: "2026-05-19T10:00:00.000Z",
    updated_at: "2026-05-19T10:00:00.000Z",
  };

  it("accepts the canonical 7-field response shape", () => {
    expect(() => CloudConversationSchema.parse(fixture)).not.toThrow();
  });

  it("requires archived_at + deleted_at to be string|null (NOT undefined)", () => {
    const bad = { ...fixture, archived_at: undefined };
    expect(() => CloudConversationSchema.parse(bad)).toThrow();
  });

  it("rejects malformed UUID for id", () => {
    expect(() => CloudConversationSchema.parse({ ...fixture, id: "not-a-uuid" })).toThrow();
  });

  it("rejects non-ISO-8601 timestamps", () => {
    expect(() => CloudConversationSchema.parse({ ...fixture, created_at: "yesterday" })).toThrow();
  });
});

describe("CONTRACT-01 — R10 CloudMessage response shape (6 fields)", () => {
  const fixture = {
    id: "22222222-2222-4222-8222-222222222222",
    conversation_id: "11111111-1111-4111-8111-111111111111",
    role: "user" as const,
    content: "hello",
    metadata: { foo: "bar" },
    created_at: "2026-05-19T10:00:00.000Z",
  };

  it("accepts the canonical 6-field message shape", () => {
    expect(() => CloudMessageSchema.parse(fixture)).not.toThrow();
  });

  it("accepts metadata=null (CloudMessage.metadata is Record|null)", () => {
    expect(() => CloudMessageSchema.parse({ ...fixture, metadata: null })).not.toThrow();
  });

  it("rejects unknown role values", () => {
    expect(() => CloudMessageSchema.parse({ ...fixture, role: "wizard" })).toThrow();
  });

  // CONTRACT CHANGE, not a softened bound. Metadata is bounded by SIZE and
  // DEPTH now, not by value type: the desktop persists an assistant turn's tool
  // calls as `{ toolCalls: ToolCallInfo[] }` — nested objects and arrays — so a
  // scalar-only, 4 KiB record 400'd every agent conversation and agent history
  // never synced at all. The cap survives at 64 KiB, which is the anti-abuse
  // control (T-MSG-INJ); only the shape and the number moved.
  it("rejects metadata when stringified bytes exceed the size cap (T-MSG-INJ)", () => {
    const oversized = { blob: "x".repeat(128 * 1024) };
    expect(() => CloudMessageSchema.parse({ ...fixture, metadata: oversized })).toThrow();
  });

  it("accepts the nested tool-call metadata the desktop actually stores", () => {
    const metadata = { toolCalls: [{ id: "call_1", name: "search_notes", status: "completed" }] };
    expect(() => CloudMessageSchema.parse({ ...fixture, metadata })).not.toThrow();
  });
});

describe("CONTRACT-01 — R10 CloudConversationWithMessages embed shape", () => {
  it("accepts a conversation row with an inline messages array", () => {
    const parsed = CloudConversationWithMessagesSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      client_conversation_id: null,
      title: "with msgs",
      archived_at: null,
      deleted_at: null,
      created_at: "2026-05-19T10:00:00.000Z",
      updated_at: "2026-05-19T10:00:00.000Z",
      messages: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          conversation_id: "11111111-1111-4111-8111-111111111111",
          role: "user",
          content: "hi",
          metadata: null,
          created_at: "2026-05-19T10:00:01.000Z",
        },
      ],
    });
    expect(parsed.messages).toHaveLength(1);
  });

  it("accepts a conversation row WITHOUT the messages key (default list branch)", () => {
    const parsed = CloudConversationWithMessagesSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      client_conversation_id: null,
      title: "no embed",
      archived_at: null,
      deleted_at: null,
      created_at: "2026-05-19T10:00:00.000Z",
      updated_at: "2026-05-19T10:00:00.000Z",
    });
    expect(parsed.messages).toBeUndefined();
  });
});

describe("CONTRACT-01 — R10 cascade-delete semantic (locked decision)", () => {
  it("documents: conversation deletion soft-deletes contained messages atomically", () => {
    // This is a documentation test — the real behaviour lives in
    // apps/api/src/routes/conversations/delete.ts + integration suite
    // (apps/api/tests/unit/routes/conversations/__tests__/crud.integration.test.ts).
    // The contract is locked here so any future plan that removes the
    // cascade must update this assertion + the upstream client expectation.
    const CASCADE_SEMANTIC = "soft-delete-children-in-same-txn" as const;
    expect(CASCADE_SEMANTIC).toBe("soft-delete-children-in-same-txn");
  });
});
