// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 06 — OAuth multi-channel scheme matrix (D-18 / AUTH-02).
//
// Loops 4 schemes through the full OAuth flow and asserts the FINAL
// redirect emits `<scheme>://?bearer_token=<urlsafe>` echoing the
// requested scheme verbatim. Reject case: javascript: callback is
// 400 + global error envelope (NEVER 302 to a rejected scheme).
//
// The custom override scheme `mycorp-whispr` requires
// OPENWHISPR_PROTOCOL=mycorp-whispr in the contract-test profile env so
// the api recognises it as an allowed protocol.
import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { ErrorEnvelope } from "../../src/schemas.js";

const REACHABLE = await probeBackend();

const BUILTIN_SCHEMES = ["openwhispr", "openwhispr-dev", "openwhispr-staging"] as const;
const OVERRIDE_SCHEME = process.env.OPENWHISPR_PROTOCOL ?? "mycorp-whispr";

const ALL_SCHEMES = [...BUILTIN_SCHEMES, OVERRIDE_SCHEME] as const;

/**
 * Follow up to N hops manually via fetch{redirect:"manual"} so we can
 * inspect the FINAL Location, not just the first /authorize hop. The
 * fixture-idp 302's straight to the API callback which then 302's to
 * the channel scheme — so 2-3 hops is enough.
 */
async function followToFinal(
  initialUrl: string,
  cookies: string[] = [],
  maxHops = 5,
): Promise<{ status: number; location: string | null; body: unknown }> {
  let url = initialUrl;
  let status = 0;
  let location: string | null = null;
  for (let i = 0; i < maxHops; i++) {
    const headers: Record<string, string> = {};
    if (cookies.length > 0) headers.cookie = cookies.join("; ");
    const res = await fetch(url, { redirect: "manual", headers });
    status = res.status;
    location = res.headers.get("location");
    // Capture set-cookie for follow-on hops.
    const setCookies =
      typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
      "function"
        ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : [];
    for (const sc of setCookies) cookies.push(sc.split(";")[0] ?? "");
    if (status >= 300 && status < 400 && location) {
      // If location uses a custom scheme, terminate — fetch can't follow.
      if (!/^https?:/i.test(location)) {
        return { status, location, body: undefined };
      }
      url = location;
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status, location, body };
    }
    return { status, location, body: await res.text() };
  }
  return { status, location, body: undefined };
}

describe.skipIf(!REACHABLE)("AUTH-02 channel-scheme echo (D-18 multi-channel matrix)", () => {
  it.each(ALL_SCHEMES)("echoes %s in final desktop redirect", async (scheme) => {
    const cb = `${scheme}://callback`;
    const url =
      `${BACKEND_URL}/api/desktop-signin/oidc?` +
      `callbackURL=${encodeURIComponent(cb)}&protocol=${scheme}`;
    const final = await followToFinal(url);
    // Final hop should be a redirect with a custom-scheme Location.
    expect([301, 302, 303, 307, 308]).toContain(final.status);
    expect(final.location).not.toBeNull();
    if (final.location) {
      const re = new RegExp(`^${scheme}://\\??.*bearer_token=[A-Za-z0-9_\\-%]+`);
      expect(final.location).toMatch(re);
    }
  });

  it("rejects javascript: callback with 400 + global error envelope", async () => {
    const url =
      `${BACKEND_URL}/api/desktop-signin/oidc?` +
      `callbackURL=${encodeURIComponent("javascript:alert(1)")}&protocol=javascript`;
    const res = await fetch(url, { redirect: "manual" });
    expect(res.status).toBe(400);
    const body = await res.json();
    ErrorEnvelope.parse(body);
    // Plan 05 emits exactly {error:"invalid callback scheme"} — strict.
    expect(body).toEqual({ error: "invalid callback scheme" });
  });
});
