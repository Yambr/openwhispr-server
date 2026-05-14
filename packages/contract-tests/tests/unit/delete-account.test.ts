// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 06 — DELETE /api/auth/delete-account contract test
// (WIRE-03 / D-11).
//
// Cascade verification (D-11): after a successful DELETE, the SAME
// cookie jar must be unable to read /api/auth/verification-status — the
// session was invalidated as part of the cascade. The test re-uses the
// jar and asserts 401 + envelope.
import { describe, expect, it } from "vitest";
import { AUTH_URL, BACKEND_URL, probeBackend } from "../../src/env.js";
import { makeJarFetch } from "../../src/helpers/cookie-jar.js";
import { fetchAndParse } from "../../src/helpers/http.js";
import { FIXTURE_PASSWORD } from "../../src/helpers/sign-in-fixture.js";
import { DeleteAccountResponse, ErrorEnvelope } from "../../src/schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("DELETE /api/auth/delete-account", () => {
  it("cookie → 200; same jar then verification-status → 401 (cascade)", async () => {
    // Sign up a transient user — DELETE is destructive, so we cannot reuse
    // the long-lived `fixture@conformance.test` (subsequent runs would 401
    // on sign-in once the row is gone). Better Auth's sign-up/email path
    // returns the session cookie directly so we can DELETE in the same jar.
    const transientEmail = `delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@conformance.test`;
    const jf = makeJarFetch();
    const signUp = await jf.fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: AUTH_URL,
      },
      body: JSON.stringify({
        email: transientEmail,
        password: FIXTURE_PASSWORD,
        name: "Delete Test User",
      }),
    });
    if (!signUp.ok) {
      const text = await signUp.text();
      throw new Error(
        `sign-up(${transientEmail}) failed: ${signUp.status} body=${text.slice(0, 200)}`,
      );
    }

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
