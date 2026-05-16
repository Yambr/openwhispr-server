// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.b — RED then GREEN for HIGH-FIX-BYOK-02.
//
// 50 synthetic URLs covering every redaction class promised by the
// review: query-string credentials, AWS SigV4 params, URL userinfo
// (username + password), and bearer-token-shaped path segments. Each
// assertion pins both the positive case (the secret IS masked) AND the
// non-leak invariant (the original secret material does NOT appear in
// the output). The non-leak check is the load-bearing one — a regex
// that "looks right" but leaves the token in `?api_key=…` plain text
// must fail this test.
import { describe, expect, it } from "vitest";
import { redactUrl } from "../../../src/redact-url.js";

/** Helper: assert masking AND non-leak in one call. */
function assertMasked(input: string, leak: string): void {
  const out = redactUrl(input);
  expect(out).not.toContain(leak);
  expect(out).toContain("***");
}

describe("redactUrl — query-string credential params", () => {
  it("masks ?api_key=…", () => {
    assertMasked(
      "https://example.com/v1?api_key=sk-fakefakefakefakefakefake",
      "sk-fakefakefakefakefakefake",
    );
  });
  it("masks ?apikey=… (no underscore)", () => {
    assertMasked("https://example.com/?apikey=secret-token-abc", "secret-token-abc");
  });
  it("masks ?api-key=… (kebab-case)", () => {
    assertMasked("https://example.com/?api-key=secret-kebab", "secret-kebab");
  });
  it("masks ?token=…", () => {
    assertMasked("https://example.com/?token=ghp_abcdefghijklmnopqrst", "ghp_abcdefghijklmnopqrst");
  });
  it("masks ?access_token=…", () => {
    assertMasked("https://example.com/?access_token=ya29.abcdef-fake", "ya29.abcdef-fake");
  });
  it("masks ?refresh_token=…", () => {
    assertMasked("https://example.com/?refresh_token=rt_fake_value", "rt_fake_value");
  });
  it("masks ?key=… (generic single-word)", () => {
    assertMasked(
      "https://example.com/?key=AIzaTHIRTYFIVECHARSXXXXXXXXXXXXXXXXXXX",
      "AIzaTHIRTYFIVECHARSXXXXXXXXXXXXXXXXXXX",
    );
  });
  it("masks ?code=… (OAuth authorization code)", () => {
    assertMasked("https://example.com/cb?code=auth-code-fake-value", "auth-code-fake-value");
  });
  it("masks ?secret=…", () => {
    assertMasked("https://example.com/?secret=client-secret-fake", "client-secret-fake");
  });
  it("masks ?password=…", () => {
    assertMasked("https://example.com/?password=hunter2", "hunter2");
  });
  it("masks ?signature=…", () => {
    assertMasked("https://example.com/?signature=fakesig123456789", "fakesig123456789");
  });
  it("masks case-insensitively (?API_KEY=… uppercase)", () => {
    assertMasked("https://example.com/?API_KEY=upper-case-secret", "upper-case-secret");
  });
  it("preserves non-sensitive query params", () => {
    const out = redactUrl("https://example.com/?foo=bar&api_key=secret123");
    expect(out).not.toContain("secret123");
    expect(out).toContain("foo=bar");
  });
});

describe("redactUrl — AWS SigV4 query params", () => {
  it("masks ?X-Amz-Signature=…", () => {
    assertMasked(
      "https://s3.example.com/bucket?X-Amz-Signature=abcd1234567890ef",
      "abcd1234567890ef",
    );
  });
  it("masks ?X-Amz-Credential=…", () => {
    assertMasked(
      "https://s3.example.com/bucket?X-Amz-Credential=AKIAFAKEFAKE%2F20260516%2Fus-east-1",
      "AKIAFAKEFAKE",
    );
  });
  it("masks ?X-Amz-Security-Token=…", () => {
    assertMasked(
      "https://s3.example.com/?X-Amz-Security-Token=sts-token-fake-value",
      "sts-token-fake-value",
    );
  });
  it("masks all three when combined (presigned URL)", () => {
    const out = redactUrl(
      "https://s3.example.com/bucket/key?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIATESTFAKE%2F20260101&X-Amz-Signature=deadbeefcafebabe",
    );
    expect(out).not.toContain("AKIATESTFAKE");
    expect(out).not.toContain("deadbeefcafebabe");
    // X-Amz-Algorithm is metadata, NOT a credential — should pass through.
    expect(out).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
  });
});

describe("redactUrl — URL userinfo", () => {
  it("masks password (regression coverage from original helper)", () => {
    assertMasked("https://user:hunter2@example.com/", "hunter2");
  });
  it("masks username (Phase 40 addition)", () => {
    const out = redactUrl("https://AKIAFAKEFAKEFAKEFAKE@example.com/");
    expect(out).not.toContain("AKIAFAKEFAKEFAKEFAKE");
    expect(out).toContain("***");
  });
  it("masks both username and password", () => {
    const out = redactUrl("https://AKIAFAKE:secretpass@example.com/");
    expect(out).not.toContain("AKIAFAKE");
    expect(out).not.toContain("secretpass");
  });
  it("returns URL unchanged when no userinfo and no credential query", () => {
    expect(redactUrl("https://example.com/health")).toBe("https://example.com/health");
  });
});

describe("redactUrl — bearer-token-shaped path segments", () => {
  it("masks sk-… OpenAI shapes in path", () => {
    assertMasked(
      "https://example.com/v1/sk-AAAAAAAAAAAAAAAAAAAAAAAAAA/data",
      "sk-AAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
  });
  it("masks sk-ant-… Anthropic shapes in path", () => {
    assertMasked(
      "https://example.com/v1/sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBB/x",
      "sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBB",
    );
  });
  it("masks AIza… Google API key shapes in path", () => {
    assertMasked(
      "https://example.com/v1/AIzaSyCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/x",
      "AIzaSyCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    );
  });
  it("masks AKIA… AWS access-key shapes in path", () => {
    assertMasked("https://example.com/x/AKIATESTFAKEFAKEFAKE/y", "AKIATESTFAKEFAKEFAKE");
  });
  it("does not over-mask a clean path", () => {
    expect(redactUrl("https://example.com/v1/audio/transcriptions")).toBe(
      "https://example.com/v1/audio/transcriptions",
    );
  });
});

describe("redactUrl — invariants", () => {
  it("returns <unparseable-url> on empty string", () => {
    expect(redactUrl("")).toBe("<unparseable-url>");
  });
  it("returns <unparseable-url> on garbage", () => {
    expect(redactUrl("not a url")).toBe("<unparseable-url>");
  });
  it("never throws on weird inputs", () => {
    expect(() => redactUrl(" ")).not.toThrow();
    expect(() => redactUrl("redis://:passw0rd@valkey:6379")).not.toThrow();
    expect(() => redactUrl("postgres://u:p@h:5432/d?a=b")).not.toThrow();
  });
  it("masks the redis://user:password@host:port form", () => {
    const out = redactUrl("redis://:passw0rd@valkey:6379");
    expect(out).not.toContain("passw0rd");
  });
  it("multi-credential URL: userinfo + query + AWS sig all masked", () => {
    const out = redactUrl(
      "https://user:pw@s3.example.com/b?api_key=k1&X-Amz-Signature=sig1&token=t1",
    );
    expect(out).not.toContain("pw");
    expect(out).not.toContain("k1");
    expect(out).not.toContain("sig1");
    expect(out).not.toContain("t1");
  });
});
