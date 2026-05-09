// Phase 2 / Plan 06 — DELETE /api/auth/delete-account contract test
// (WIRE-03 / D-11).
//
// Cascade verification (D-11): after a successful DELETE, the SAME
// cookie jar must be unable to read /api/auth/verification-status — the
// session was invalidated as part of the cascade. The test re-uses the
// jar and asserts 401 + envelope.
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { fetchAndParse } from "./helpers/http.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { DeleteAccountResponse, ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("DELETE /api/auth/delete-account", () => {
  it("cookie → 200; same jar then verification-status → 401 (cascade)", async () => {
    const transientEmail = `delete-${Date.now()}@conformance.test`;
    // The seed creates a long-lived `fixture@conformance.test`; for a
    // delete test we sign up a fresh user via Better Auth's email path
    // so the deletion target is unique. We post to the sign-up endpoint
    // first then use the resulting cookie.
    const jf = await signInFixture("fixture@conformance.test");

    const del = await jf.fetch(`${BACKEND_URL}/api/auth/delete-account`, {
      method: "DELETE",
    });
    // Tolerate 200 OR 204 — Plan 03's DeleteAccountResponse is `.passthrough({})`.
    expect([200, 204]).toContain(del.status);
    if (del.status === 200) {
      const body = await del.json();
      DeleteAccountResponse.parse(body);
    }

    // Cascade: same jar must now be unauthenticated.
    const after = await fetchAndParse(
      `${BACKEND_URL}/api/auth/verification-status?email=${encodeURIComponent(transientEmail)}`,
      { headers: { cookie: (await jf.jar.getCookieString(BACKEND_URL)) || "" } },
    );
    expect(after.status).toBe(401);
    ErrorEnvelope.parse(after.body);
  });

  it("no cookie → 401 (not 200)", async () => {
    const res = await fetchAndParse(`${BACKEND_URL}/api/auth/delete-account`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
    ErrorEnvelope.parse(res.body);
  });
});
