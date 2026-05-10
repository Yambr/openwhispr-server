// Phase 2 / Plan 06 — AUTH-04 token rotation overlap (D-19).
//
// Validates the ≥5 min overlap window: after a forced rotation the OLD
// token must still authenticate for at least 5 minutes so 100 in-flight
// concurrent requests don't cascade-401 when the rotation header lands
// mid-flight (PITFALLS #8).
//
// Triggers rotation via the NODE_ENV=test gated `/api/_test/force-rotate`
// route (Plan 05 ships it; production builds return 404). Asserts
// 0/100 requests using the OLD token receive 401 against the
// `/api/_test/health-authed` route (also Plan 05).
import { beforeAll, describe, expect, it } from "vitest";
import { AUTH_URL, BACKEND_URL, probeBackend } from "./env.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("AUTH-04 token rotation overlap window", () => {
  let initialToken = "";

  beforeAll(async () => {
    // Sign in with the rotation-test fixture user. Better Auth's email
    // sign-in returns the bearer in the response body's `token` field.
    //
    // Phase 02.21 / Residual C — fixture email was `rotation-test@local`,
    // a non-RFC-compliant address Better Auth rejects with HTTP 400
    // INVALID_EMAIL (the `.local` TLD fails BA's email validator). The
    // canonical fixture seeded by packages/data/src/seed/conformance.ts:36
    // is `rotation-test@example.com` (RFC 2606 reserved TLD, validator-
    // safe). Switching the test to the seeded address is the targeted
    // fix; do NOT change the seed because @example.com is the correct
    // RFC-compliant choice for test fixtures.
    //
    // Origin is forwarded so Better Auth's CSRF gate accepts the POST
    // (auth.ts trustedOrigins matches AUTH_URL); X-Forwarded-For mints a
    // unique rate-limit bucket so this suite's beforeAll doesn't compete
    // with other test files for the runner-IP rate budget.
    const res = await fetch(`${AUTH_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: AUTH_URL,
        "x-forwarded-for": "10.77.77.77",
      },
      body: JSON.stringify({
        email: "rotation-test@example.com",
        password: "test-PW-12345!",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`sign-in failed: HTTP ${res.status} body=${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error("sign-in: token missing in response body");
    initialToken = body.token;
  });

  it("100 concurrent requests with T1 succeed during overlap after rotation", async () => {
    // Step 1: trigger rotation via test-only endpoint.
    const rotateRes = await fetch(`${BACKEND_URL}/api/_test/force-rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${initialToken}` },
    });
    expect(rotateRes.status).toBe(200);
    const newToken = rotateRes.headers.get("set-auth-token");
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(initialToken);

    // Step 2: fire 100 concurrent fetches with the OLD token.
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        fetch(`${BACKEND_URL}/api/_test/health-authed`, {
          headers: { authorization: `Bearer ${initialToken}` },
        }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    const fails = statuses.filter((s) => s === 401);
    // PITFALLS #8 / D-19: zero 401s during the overlap window. A single
    // 401 fails the suite — no retry budget allowed.
    expect(fails).toHaveLength(0);
    expect(statuses.every((s) => s >= 200 && s < 300)).toBe(true);
  });
});
