// Phase 05 / Plan 07 / Task 3 — WIRE-24 + WIRE-25 contract conformance
// tests for /api/conversations/* (5 conversation routes + dual-method
// /messages).
//
// Asserts the wire shape against a live BACKEND_URL with the seeded
// fixture user. Skip-if-unreachable semantics mirror notes/folders.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();

const CloudConversationShape = z.object({
  id: z.string(),
  client_conversation_id: z.string().nullable(),
  title: z.string(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const CloudMessageShape = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

const SearchResultShape = CloudConversationShape.extend({ score: z.number() });

const ListResponse = z.object({ conversations: z.array(CloudConversationShape) });
const ListWithMessagesResponse = z.object({
  conversations: z.array(
    CloudConversationShape.extend({ messages: z.array(CloudMessageShape) }),
  ),
});
const SearchResponse = z.object({
  conversations: z.array(SearchResultShape),
});
const MessagesListResponse = z.object({
  messages: z.array(CloudMessageShape),
});
const DeleteResponse = z.object({ ok: z.boolean() });

function rnd(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe.skipIf(!REACHABLE)(
  "WIRE-24 + WIRE-25 — /api/conversations/* (6 routes)",
  () => {
    it("POST /api/conversations/create returns CloudConversation shape", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: rnd("cc"),
          title: "contract create",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(() => CloudConversationShape.parse(body)).not.toThrow();
    });

    it("POST /api/conversations/create idempotent on same client_conversation_id (200, not 409)", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const clientId = rnd("idem");
      const r1 = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_conversation_id: clientId, title: "first" }),
      });
      const r2 = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_conversation_id: clientId, title: "second" }),
      });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r2.status).not.toBe(409);
      const j1 = CloudConversationShape.parse(await r1.json());
      const j2 = CloudConversationShape.parse(await r2.json());
      expect(j2.id).toBe(j1.id);
      expect(j2.title).toBe("first");
    });

    it("PATCH /api/conversations/update returns updated CloudConversation", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const c = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: rnd("upd"),
          title: "before",
        }),
      });
      const { id } = CloudConversationShape.parse(await c.json());
      const patch = await jar.fetch(`${BACKEND_URL}/api/conversations/update`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, title: "after" }),
      });
      expect(patch.status).toBe(200);
      const updated = CloudConversationShape.parse(await patch.json());
      expect(updated.title).toBe("after");
    });

    it("DELETE /api/conversations/delete returns { ok: true }", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const created = await jar.fetch(
        `${BACKEND_URL}/api/conversations/create`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_conversation_id: rnd("del"),
            title: "to-delete",
          }),
        },
      );
      const { id } = CloudConversationShape.parse(await created.json());
      const del = await jar.fetch(`${BACKEND_URL}/api/conversations/delete`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      expect(del.status).toBe(200);
      const delBody = await del.json();
      expect(() => DeleteResponse.parse(delBody)).not.toThrow();
    });

    it("GET /api/conversations/list returns { conversations: CloudConversation[] }", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/conversations/list?limit=5`);
      expect(res.status).toBe(200);
      const listBody = await res.json();
      expect(() => ListResponse.parse(listBody)).not.toThrow();
    });

    it("GET /api/conversations/list?include=messages embeds CloudMessage[] per conversation (D-27)", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      // Seed at least one conversation with one message.
      const c = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: rnd("incmsg"),
          title: "include-messages target",
        }),
      });
      const { id: convId } = CloudConversationShape.parse(await c.json());
      await jar.fetch(`${BACKEND_URL}/api/conversations/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: convId,
          role: "user",
          content: "hi",
          client_message_id: rnd("m"),
        }),
      });
      const res = await jar.fetch(
        `${BACKEND_URL}/api/conversations/list?include=messages&limit=20`,
      );
      expect(res.status).toBe(200);
      const parsed = ListWithMessagesResponse.parse(await res.json());
      const target = parsed.conversations.find((c) => c.id === convId);
      expect(target).toBeDefined();
      expect(target!.messages.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/conversations/search returns { conversations: SearchResult[] } with score", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: rnd("srch"),
          title: "Quarterly Roadmap Review Conformance",
        }),
      });
      const res = await jar.fetch(`${BACKEND_URL}/api/conversations/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "conformance", limit: 5 }),
      });
      expect(res.status).toBe(200);
      const searchBody = await res.json();
      expect(() => SearchResponse.parse(searchBody)).not.toThrow();
    });

    it("POST /api/conversations/messages returns CloudMessage (single)", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const c = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: rnd("hostmsg"),
          title: "host-msg",
        }),
      });
      const { id: convId } = CloudConversationShape.parse(await c.json());
      const res = await jar.fetch(`${BACKEND_URL}/api/conversations/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: convId,
          role: "user",
          content: "contract POST msg",
          client_message_id: rnd("cm"),
        }),
      });
      expect(res.status).toBe(200);
      const msgBody = await res.json();
      expect(() => CloudMessageShape.parse(msgBody)).not.toThrow();
    });

    it("POST /api/conversations/messages — metadata >4KB → 400", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const c = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: rnd("bigmeta"),
          title: "big-meta",
        }),
      });
      const { id: convId } = CloudConversationShape.parse(await c.json());
      const res = await jar.fetch(`${BACKEND_URL}/api/conversations/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: convId,
          role: "user",
          content: "x",
          metadata: { blob: "y".repeat(5000) },
        }),
      });
      expect(res.status).toBe(400);
      const errBody = await res.json();
      expect(() => ErrorEnvelope.parse(errBody)).not.toThrow();
    });

    it("GET /api/conversations/messages returns { messages: CloudMessage[] }", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const c = await jar.fetch(`${BACKEND_URL}/api/conversations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_conversation_id: rnd("listm"),
          title: "list-msgs",
        }),
      });
      const { id: convId } = CloudConversationShape.parse(await c.json());
      await jar.fetch(`${BACKEND_URL}/api/conversations/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: convId,
          role: "assistant",
          content: "ack",
          client_message_id: rnd("am"),
        }),
      });
      const res = await jar.fetch(
        `${BACKEND_URL}/api/conversations/messages?conversation_id=${convId}&limit=10`,
      );
      expect(res.status).toBe(200);
      const parsed = MessagesListResponse.parse(await res.json());
      expect(parsed.messages.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/conversations/messages — missing conversation_id → 400 envelope", async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/conversations/messages`);
      expect(res.status).toBe(400);
      const missingBody = await res.json();
      expect(() => ErrorEnvelope.parse(missingBody)).not.toThrow();
    });

    it("401 envelope when unauthenticated on every conversations route", async () => {
      const probes = [
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
      ] as const;
      for (const p of probes) {
        const init: RequestInit = { method: p.method };
        if ("body" in p && p.body) {
          init.headers = { "content-type": "application/json" };
          init.body = p.body;
        }
        const res = await fetch(`${BACKEND_URL}${p.url}`, init);
        expect(res.status, `${p.method} ${p.url}`).toBe(401);
        const probeBody = await res.json();
        expect(() => ErrorEnvelope.parse(probeBody)).not.toThrow();
      }
    });
  },
);
