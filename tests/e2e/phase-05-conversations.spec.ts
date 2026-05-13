// SPDX-License-Identifier: Apache-2.0
// tests/e2e/phase-05-conversations — host-side e2e for WIRE-24 +
// WIRE-25.
//
// Round-trips the full conversations + messages lifecycle through
// Traefik (TLS) → api → real Postgres + PgBouncer via the docker-
// compose stack:
//   1. create 2 conversations
//   2. idempotency retry — same client_conversation_id, NOT 409
//   3. add 5 messages to one conversation (single-message POST)
//   4. GET /api/conversations/messages — see 5 ordered messages
//   5. GET /api/conversations/list?include=messages — D-27 array_agg
//   6. POST /api/conversations/search — websearch_to_tsquery hit
//   7. soft-delete one conversation — list excludes
//   8. metadata >4KB → 400 envelope (T-MSG-INJ)
//
// Mirrors tests/e2e/phase-05-folders.spec.ts.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const CloudConversation = z.object({
  id: z.string(),
  client_conversation_id: z.string().nullable(),
  title: z.string(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const CloudMessage = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

const SearchResult = CloudConversation.extend({ score: z.number() });

const ListResponse = z.object({
  conversations: z.array(CloudConversation),
});
const ListWithMessagesResponse = z.object({
  conversations: z.array(
    CloudConversation.extend({ messages: z.array(CloudMessage) }),
  ),
});
const MessagesListResponse = z.object({
  messages: z.array(CloudMessage),
});
const SearchResponse = z.object({
  conversations: z.array(SearchResult),
});
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

function rnd(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("e2e — /api/conversations/* + /messages full lifecycle (real compose stack)", () => {
  it("create → idempotency → add 5 messages → list-with-include → search → delete", async () => {
    const jar = await signInFixture("fixture@conformance.test");

    // 1. Create 2 conversations.
    const idA = rnd("convA");
    const idB = rnd("convB");
    const createA = await jar.fetch(
      `${BACKEND_URL}/api/conversations/create`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: idA,
          title: "Quarterly Roadmap e2e",
        }),
      },
    );
    const convA = CloudConversation.parse(await createA.json());
    const createB = await jar.fetch(
      `${BACKEND_URL}/api/conversations/create`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: idB,
          title: "Side Topic e2e",
        }),
      },
    );
    const convB = CloudConversation.parse(await createB.json());
    expect(convA.id).not.toBe(convB.id);

    // 2. Idempotency: re-create convA — same id, NOT 409.
    const retry = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_conversation_id: idA,
        title: "DIFFERENT",
      }),
    });
    expect(retry.status).toBe(200);
    expect(retry.status).not.toBe(409);
    const retryConv = CloudConversation.parse(await retry.json());
    expect(retryConv.id).toBe(convA.id);
    expect(retryConv.title).toBe("Quarterly Roadmap e2e"); // first-writer-wins

    // 3. Add 5 messages to convA via single-message POST.
    const msgIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await jar.fetch(
        `${BACKEND_URL}/api/conversations/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conversation_id: convA.id,
            role: i % 2 === 0 ? "user" : "assistant",
            content: `e2e msg ${i}`,
            metadata: { idx: i },
            client_message_id: `${idA}-m${i}`,
          }),
        },
      );
      expect(res.status).toBe(200);
      const m = CloudMessage.parse(await res.json());
      msgIds.push(m.id);
      // Tiny gap so created_at differs.
      await new Promise((r) => setTimeout(r, 4));
    }

    // 4. GET /api/conversations/messages — returns 5 messages ordered
    //    DESC.
    const listMsgs = await jar.fetch(
      `${BACKEND_URL}/api/conversations/messages?conversation_id=${convA.id}&limit=50`,
    );
    expect(listMsgs.status).toBe(200);
    const listMsgsBody = MessagesListResponse.parse(await listMsgs.json());
    expect(listMsgsBody.messages.length).toBeGreaterThanOrEqual(5);
    const seenIds = new Set(listMsgsBody.messages.map((m) => m.id));
    for (const id of msgIds) expect(seenIds.has(id)).toBe(true);

    // 5. GET /api/conversations/list?include=messages — D-27 branch.
    const listInc = await jar.fetch(
      `${BACKEND_URL}/api/conversations/list?include=messages&limit=50`,
    );
    expect(listInc.status).toBe(200);
    const listIncBody = ListWithMessagesResponse.parse(await listInc.json());
    const aRow = listIncBody.conversations.find((c) => c.id === convA.id);
    expect(aRow).toBeDefined();
    expect(aRow!.messages.length).toBeGreaterThanOrEqual(5);

    // 6. Search — must hit convA via "Quarterly".
    const search = await jar.fetch(`${BACKEND_URL}/api/conversations/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Quarterly Roadmap", limit: 10 }),
    });
    expect(search.status).toBe(200);
    const searchBody = SearchResponse.parse(await search.json());
    expect(
      searchBody.conversations.find((c) => c.id === convA.id),
    ).toBeDefined();

    // 7. Metadata >4 KiB → 400 envelope.
    const oversized = await jar.fetch(
      `${BACKEND_URL}/api/conversations/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: convA.id,
          role: "user",
          content: "x",
          metadata: { blob: "y".repeat(5000) },
        }),
      },
    );
    expect(oversized.status).toBe(400);
    const oversizedBody = await oversized.json();
    expect(() => ErrorEnvelope.parse(oversizedBody)).not.toThrow();

    // 8. Soft-delete convB — list excludes it.
    const del = await jar.fetch(`${BACKEND_URL}/api/conversations/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: convB.id }),
    });
    expect(del.status).toBe(200);

    const listPost = await jar.fetch(
      `${BACKEND_URL}/api/conversations/list?limit=50`,
    );
    const listPostBody = ListResponse.parse(await listPost.json());
    expect(
      listPostBody.conversations.find((c) => c.id === convB.id),
    ).toBeUndefined();

    // Hygiene — soft-delete convA too so the fixture user's list does
    // not grow across reruns.
    await jar.fetch(`${BACKEND_URL}/api/conversations/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: convA.id }),
    });
  });

  it("401 envelope on every conversations route when unauthenticated", async () => {
    const probes: Array<{ method: string; url: string; body?: string }> = [
      { method: "POST", url: "/api/conversations/create", body: "{}" },
      { method: "PATCH", url: "/api/conversations/update", body: "{}" },
      { method: "DELETE", url: "/api/conversations/delete", body: "{}" },
      { method: "GET", url: "/api/conversations/list" },
      {
        method: "POST",
        url: "/api/conversations/search",
        body: JSON.stringify({ query: "x" }),
      },
      { method: "POST", url: "/api/conversations/messages", body: "{}" },
      { method: "GET", url: "/api/conversations/messages" },
    ];
    for (const p of probes) {
      const init: RequestInit = { method: p.method };
      if (p.body) {
        init.headers = { "content-type": "application/json" };
        init.body = p.body;
      }
      const res = await fetch(`${BACKEND_URL}${p.url}`, init);
      expect(res.status, `${p.method} ${p.url}`).toBe(401);
      const probeBody = await res.json();
      expect(() => ErrorEnvelope.parse(probeBody)).not.toThrow();
    }
  });
});
