// SPDX-License-Identifier: FSL-1.1-ALv2
// R22 — `buildDesktopBridgeRedirect` unit tests.
//
// The desktop auth-bridge listens on a FIXED loopback address; the
// verify-email-complete route 302-redirects there with the session
// bearer. These tests pin the server-fixed redirect target and the
// token-encoding contract.

import { describe, expect, it } from "vitest";
import { buildDesktopBridgeRedirect } from "../../../src/config/desktop-bridge.js";

describe("buildDesktopBridgeRedirect", () => {
  it("targets the fixed desktop-bridge loopback callback URL", () => {
    const url = buildDesktopBridgeRedirect("plain-token");
    expect(url).toBe("http://127.0.0.1:5199/oauth/callback?bearer_token=plain-token");
  });

  it("url-encodes a token carrying URL-significant characters", () => {
    // Signed-cookie tokens contain a `.`; base64 tokens may carry `+/=`.
    const token = "a.b+c/d=e";
    const url = buildDesktopBridgeRedirect(token);
    expect(url).toBe(
      `http://127.0.0.1:5199/oauth/callback?bearer_token=${encodeURIComponent(token)}`,
    );
    // The encoded value round-trips back to the exact token.
    expect(new URL(url).searchParams.get("bearer_token")).toBe(token);
  });

  it("always emits the loopback origin + /oauth/callback path", () => {
    const parsed = new URL(buildDesktopBridgeRedirect("x"));
    expect(parsed.protocol).toBe("http:");
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.port).toBe("5199");
    expect(parsed.pathname).toBe("/oauth/callback");
  });

  it("the bearer_token is the only query parameter", () => {
    const parsed = new URL(buildDesktopBridgeRedirect("tok"));
    expect([...parsed.searchParams.keys()]).toEqual(["bearer_token"]);
  });
});
