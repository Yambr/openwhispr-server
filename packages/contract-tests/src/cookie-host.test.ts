// Phase 2 / Plan 06 — D-20 / AUTH-07 split-host cookie reach test.
//
// Validates that when AUTH_URL ≠ OPENWHISPR_API_URL but they share an
// eTLD+1, the session cookie set during sign-in via auth.example.test
// reaches the api.example.test endpoint (Plan 01 cookieDomainConfig
// emits Domain=.example.test). PITFALLS #5 prevention.
//
// Topology:
//   AUTH_URL=https://auth.example.test
//   OPENWHISPR_API_URL=https://api.example.test
// Both Host headers route to the same api service via the Plan 06
// dynamic.yml routers (auth-example-test, api-example-test). The test
// runner sends Host: auth.example.test for the sign-in then
// Host: api.example.test for the verification-status read, reusing the
// cookie jar.
//
// Skipped when AUTH_URL is not the example.test split-host topology —
// i.e. only runs in the contract-test profile where the env was set.
import { describe, expect, it } from "vitest";
import { BACKEND_URL, AUTH_URL, probeBackend } from "./env.js";
import { makeJarFetch } from "./helpers/cookie-jar.js";

const REACHABLE = await probeBackend();
const SPLIT_HOST =
  AUTH_URL.includes("auth.example.test") &&
  BACKEND_URL.includes("api.example.test");

describe.skipIf(!REACHABLE || !SPLIT_HOST)(
  "AUTH-07 cookie crosses split-host boundary (D-20)",
  () => {
    it("sign in via AUTH_URL → cookie reaches BACKEND_URL via shared eTLD+1", async () => {
      const jf = makeJarFetch();

      const signIn = await jf.fetch(`${AUTH_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "fixture@conformance.test",
          password: "test-PW-12345!",
        }),
      });
      expect(signIn.status).toBe(200);

      // Inspect jar — there must be at least one cookie scoped to the
      // shared eTLD+1 so it crosses to api.example.test.
      const cookies = await jf.jar.getCookies(BACKEND_URL);
      expect(cookies.length).toBeGreaterThan(0);

      const verify = await jf.fetch(
        `${BACKEND_URL}/api/auth/verification-status?email=fixture%40conformance.test`,
      );
      expect(verify.status).toBe(200);
    });
  },
);
