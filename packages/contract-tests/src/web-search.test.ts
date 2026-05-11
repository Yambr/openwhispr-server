// Phase 05 / Plan 03 / Task 3 — POST /api/agent/web-search contract test
// (WIRE-08).
//
// Asserts the wire shape returned by /api/agent/web-search against the
// canonical response schema when run against a fully deployed compose
// stack. Route is DB-only (registry resolves at boot via
// WEB_SEARCH_PROVIDER); no LiteLLM dependency, so it's available in
// every compose profile.
//
// Coverage cases:
//   * 401 envelope on unauthenticated path (always asserted — does not
//     depend on provider config).
//   * Happy-path: gated on TAVILY_API_KEY presence in CI (env), since the
//     compose profile that ships the missing-key 503 path leaves the key
//     unset by design.
//   * Missing-key: gated on the dedicated missing-key compose profile
//     (MISSING_KEY_TEST_MODE=1), mirroring missing-key-503.test.ts.
//
// We inline the response shape locally rather than importing from
// @openwhispr/wire-schemas (which is not a contract-tests dep) — the
// schema is small + locked in BACKEND_SPEC.md, so duplication is
// preferable to expanding the contract-tests dep graph.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();
const MISSING_KEY_MODE = process.env.MISSING_KEY_TEST_MODE === "1";
const HAVE_TAVILY = typeof process.env.TAVILY_API_KEY === "string"
  && process.env.TAVILY_API_KEY.length > 0;

const WebSearchResult = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});
const WebSearchResponse = z.object({
  results: z.array(WebSearchResult),
});

describe.skipIf(!REACHABLE)("WIRE-08 — POST /api/agent/web-search", () => {
  it("returns 401 envelope when called without a session cookie or bearer", async () => {
    const res = await fetch(`${BACKEND_URL}/api/agent/web-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "test", numResults: 3 }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });

  it.skipIf(!HAVE_TAVILY)(
    "returns canonical WebSearchResponse for an authenticated user (live Tavily)",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/agent/web-search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "openwhispr", numResults: 3 }),
      });
      expect(res.status).toBe(200);
      const parsed = WebSearchResponse.parse(await res.json());
      expect(parsed.results.length).toBeLessThanOrEqual(3);
      for (const r of parsed.results) {
        expect(typeof r.title).toBe("string");
        expect(typeof r.url).toBe("string");
        expect(typeof r.snippet).toBe("string");
      }
    },
  );

  it.skipIf(!MISSING_KEY_MODE)(
    "returns 503 with actionable env-var message when provider is unconfigured (Pitfall #8 — NEVER 401)",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/agent/web-search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      });
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(401);
      const env = ErrorEnvelope.parse(await res.json());
      // Operator-actionable: must surface the env var name.
      expect(env.error).toMatch(
        /TAVILY_API_KEY|YANDEX_SEARCH_API_KEY|YANDEX_SEARCH_FOLDER_ID|not configured/i,
      );
    },
  );

  it("returns 400 envelope on empty query", async () => {
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
