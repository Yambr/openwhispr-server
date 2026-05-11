// tests/e2e/phase-05-web-search — host-side e2e for
// WIRE-08 (POST /api/agent/web-search).
//
// Round-trips the route through Traefik (TLS) → api → real Postgres +
// PgBouncer + Valkey + the bundled WEB_SEARCH_PROVIDER's adapter.
//
// Two assertions:
//   1. Tavily branch: if TAVILY_API_KEY is set in the compose env, the
//      route returns 200 + canonical WebSearchResponse.
//   2. Yandex stub branch: forcing WEB_SEARCH_PROVIDER=yandex via the
//      compose's env file would produce 503 "yandex provider pending";
//      we cannot mutate compose env from here, so we exercise the stub
//      contract by HTTP-asserting the route's missing-key 503 envelope
//      shape against the running stack — provider depends on
//      WEB_SEARCH_PROVIDER in the live compose. Both branches share
//      the e2e gate (E2E=1 + reachable compose stack).
//
// 401 envelope: asserted unconditionally — unauthenticated calls must
// 401 regardless of provider configuration.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL } from "./compose-helper.js";
import { signInFixture } from "./sign-in.js";

const WebSearchResponse = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    }),
  ),
});
const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();

const HAVE_TAVILY = typeof process.env.TAVILY_API_KEY === "string"
  && process.env.TAVILY_API_KEY.length > 0;

describe("e2e — POST /api/agent/web-search (real compose stack)", () => {
  it("returns 401 envelope on the unauthenticated path", async () => {
    const res = await fetch(`${BACKEND_URL}/api/agent/web-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "anything", numResults: 3 }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });

  it.skipIf(!HAVE_TAVILY)(
    "returns canonical WebSearchResponse round-tripped via Traefik+TLS (Tavily live)",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/agent/web-search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "openwhispr backend", numResults: 3 }),
      });
      expect(res.status).toBe(200);
      const parsed = WebSearchResponse.parse(await res.json());
      expect(parsed.results.length).toBeLessThanOrEqual(3);
      // Each result must be normalized to the provider-agnostic shape.
      for (const r of parsed.results) {
        expect(typeof r.title).toBe("string");
        expect(typeof r.url).toBe("string");
        expect(typeof r.snippet).toBe("string");
      }
    },
  );

  it.skipIf(HAVE_TAVILY)(
    "returns 503 with operator-actionable envelope when no provider key is wired (covers Yandex stub branch too)",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/agent/web-search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "test", numResults: 3 }),
      });
      expect(res.status).toBe(503);
      const env = ErrorEnvelope.parse(await res.json());
      // Either branch — Tavily missing-key OR Yandex stub-pending.
      expect(env.error).toMatch(
        /TAVILY_API_KEY|YANDEX_SEARCH_API_KEY|yandex provider pending|not configured/i,
      );
    },
  );

  it("returns 400 envelope on empty query (gate before any upstream call)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/agent/web-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
