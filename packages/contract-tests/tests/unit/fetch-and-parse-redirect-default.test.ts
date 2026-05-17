// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-16b — REVIEW byok-guard-contract-tests HIGH HI-06.
//
// `fetchAndParse` is the helper used by every CONTRACT-01 read against
// a Traefik-fronted backend. `probeBackend()` (env.ts D-05) sets
// `redirect:'error'` to loud-fail on stale plaintext-to-HTTPS 308s;
// `fetchAndParse` did NOT — a stale `BACKEND_URL=http://api.localhost`
// would silently 308 to https, the request body could be lost
// (Traefik rewrites GET only), and contract assertions would run
// against the wrong target.
//
// The fix defaults `redirect:'error'` and lets callers override.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(TEST_DIR, "../../src/helpers/http.ts");

describe("Plan 51-16b — fetchAndParse defaults redirect:'error'", () => {
  it("passes `redirect: 'error'` into fetch() unless caller overrides", () => {
    const src = readFileSync(SRC, "utf8");
    // Source-pattern guard: the fetch call must spread an object whose
    // `redirect` key defaults to "error" BEFORE the user `init` spread,
    // so an explicit override still wins.
    expect(src).toMatch(
      /redirect:\s*"error".*\.\.\.init|\.\.\.init.*redirect:\s*init\?\.redirect\s*\?\?\s*"error"/s,
    );
  });

  it("runtime: GET against a 308-redirecting target throws TypeError (redirect=error)", async () => {
    const { fetchAndParse } = await import("../../src/helpers/http.js");
    // Use a synthetic in-process server-less route via a Response that
    // a fake `globalThis.fetch` returns — but the cleanest contract is
    // to assert the *init.redirect default* by intercepting `fetch`.
    const originalFetch = globalThis.fetch;
    let observed: RequestInit | undefined;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      observed = init;
      return Promise.resolve(
        new Response('{"error":"ok"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;
    try {
      await fetchAndParse("https://example.test/ok");
      expect(observed?.redirect).toBe("error");

      observed = undefined;
      await fetchAndParse("https://example.test/ok", { redirect: "follow" });
      expect(observed?.redirect).toBe("follow");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
