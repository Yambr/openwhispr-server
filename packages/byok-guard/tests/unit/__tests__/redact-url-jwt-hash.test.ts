// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-02 — RED→GREEN for REVIEW-INDEX.md CR-10
// (byok-guard CR-01 + CR-02).
//
// The pre-publication review found that the byok-guard `redactUrl` —
// even though it does the "full sweep" of credential params and
// bearer-shaped path segments — never inspects:
//   (1) JWT shapes (eyJ…).eyJ…).<sig>) anywhere in the URL.
//   (2) The URL fragment (#access_token=…) used by OAuth2 implicit flow.
//
// These two omissions matter because:
//   * Better Auth session tokens are JWTs that can leak verbatim into
//     URL paths / query values when intermediate code paths concatenate
//     `?Bearer ey…` etc.
//   * Implicit-flow access tokens travel in the `#` fragment by spec.
//     The URL constructor preserves the fragment unchanged, so a
//     redactor that ignores `u.hash` leaks the token verbatim.
//
// Both behaviors are asserted here; both must fail on main.

import { describe, expect, it } from "vitest";
import { redactUrl } from "../../../src/redact-url.js";

describe("Plan 51-02 — redactUrl masks JWT shapes + URL fragment", () => {
  describe("JWT shapes (eyJ.eyJ.sig)", () => {
    it("masks a JWT embedded in the path", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.dGVzdC1zaWduYXR1cmU";
      const out = redactUrl(`https://api.example.com/v1/${jwt}`);
      expect(out).not.toContain(jwt);
      expect(out).toContain("***");
    });

    it("masks a JWT in a query-string VALUE even when the param name is innocuous", () => {
      const jwt =
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjE1MTYyMzkwMjJ9.signature-bytes-here";
      // `next` is NOT in the credential-param allowlist — the value
      // happens to be a JWT. A token-shape sweep on values must still
      // catch it.
      const out = redactUrl(`https://example.com/cb?next=${encodeURIComponent(jwt)}`);
      expect(out).not.toContain(jwt);
    });
  });

  describe("URL fragment (#access_token=…)", () => {
    it("masks a credential param in the hash fragment (OAuth2 implicit flow)", () => {
      const tok =
        "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJleGFtcGxlIn0.0F7sFhKkVnFhV4cTzZHJzVZSXk_xH7r3Yc8m";
      const out = redactUrl(
        `https://app.example.com/cb#access_token=${tok}&token_type=Bearer&expires_in=3600`,
      );
      expect(out).not.toContain(tok);
      // Other innocuous fragment params are allowed to remain (we only
      // mask credential-named keys); but the credential MUST be gone.
    });

    it("masks an opaque bearer-shape that appears in the hash even without a key=value form", () => {
      const tok = "sk-ant-AAAAAAAAAAAAAAAAAAAAAAAA";
      const out = redactUrl(`https://example.com/page#${tok}`);
      expect(out).not.toContain(tok);
    });
  });
});
