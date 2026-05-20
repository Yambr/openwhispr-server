// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track D — RED then GREEN for byok:CR-01 + byok:CR-02.
//
// Regression-shape suite, kept distinct from redact-url-completeness.test.ts.
// Pins the provider-specific bearer-token shapes that the pre-fix
// `BEARER_SHAPES` set in `src/redact-url.ts` did NOT cover:
//
//   byok:CR-01 — GitHub PAT/OAuth (ghp_/gho_/ghu_/ghs_/ghr_), Tavily
//     (tvly-), Yandex (AQVN…, y0_…), and AWS STS session keys (ASIA…).
//     Tavily + Yandex are SHIPPED web-search providers in this repo
//     (apps/api/src/routes/agent/web-search.ts).
//   byok:CR-02 — the `sk-…` body-length threshold `{20,}` let short
//     LiteLLM virtual keys (8–19 char bodies) slip through unmasked.
//
// All key bodies below are obviously-fake (zero-runs / EXAMPLE strings)
// to minimise gitleaks friction. The file path is gitleaks-allowlisted
// via the `(^|/)__tests__/` + `\.test\.ts$` path rules in .gitleaks.toml.
import { describe, expect, it } from "vitest";
import { redactUrl } from "../../../src/redact-url.js";

describe("byok:CR-01 — redactUrl masks provider-specific key shapes in URL paths/query/fragments", () => {
  it.each([
    // GitHub PAT / OAuth — 5 prefixes, fixed 36+ base62 body.
    ["https://api.example/secrets/ghp_000000000000000000000000000000000000/rotate", "ghp_"],
    ["https://api.example/secrets/gho_000000000000000000000000000000000000/rotate", "gho_"],
    ["https://api.example/secrets/ghu_000000000000000000000000000000000000/rotate", "ghu_"],
    ["https://api.example/secrets/ghs_000000000000000000000000000000000000/rotate", "ghs_"],
    ["https://api.example/secrets/ghr_000000000000000000000000000000000000/rotate", "ghr_"],
    // Tavily web-search key.
    ["https://api.tavily.com/search?key=tvly-00000000000000000000000000000000", "tvly-"],
    // Yandex — folder-scoped IAM and OAuth shapes.
    ["https://yandex.example/secrets/AQVN0000000000000000abcd/rotate", "AQVN"],
    ["https://yandex.example/secrets/y0_AgAAAAA0000000000000000000000000000/rotate", "y0_"],
    // AWS STS session key (the IOSFODNN7EXAMPLE body is AWS's own docs example).
    ["https://s3.amazonaws.com/bucket?X-Amz-Cred=ASIAIOSFODNN7EXAMPLE", "ASIA"],
  ])("redacts %s containing shape %s", (url, shape) => {
    const redacted = redactUrl(url);
    // The shape prefix followed by ≥4 body chars must not survive.
    const escaped = shape.replace(/[-]/g, "\\-");
    expect(redacted).not.toMatch(new RegExp(`${escaped}[A-Za-z0-9]{4,}`));
  });

  it("redacts ghp_ embedded in a path segment", () => {
    const out = redactUrl("https://api.example/v1/ghp_000000000000000000000000000000000000/x");
    expect(out).not.toContain("ghp_000000000000000000000000000000000000");
    expect(out).toContain("***");
  });

  it("redacts tvly- carried in a URL fragment", () => {
    const out = redactUrl("https://api.example/cb#tvly-00000000000000000000000000000000");
    expect(out).not.toContain("tvly-00000000000000000000000000000000");
    expect(out).toContain("***");
  });

  it("redacts ASIA STS key in a path segment", () => {
    const out = redactUrl("https://s3.example.com/x/ASIAIOSFODNN7EXAMPLE/y");
    expect(out).not.toContain("ASIAIOSFODNN7EXAMPLE");
    expect(out).toContain("***");
  });
});

describe("byok:CR-02 — redactUrl masks short sk- bodies (≤19 chars)", () => {
  it("masks sk- with 8-char body (LiteLLM virtual-key shape)", () => {
    const redacted = redactUrl("https://litellm.example/v1/chat?key=sk-FAKEFAKE");
    expect(redacted).not.toContain("sk-FAKEFAKE");
  });
  it("masks sk- with 19-char body (boundary case)", () => {
    const redacted = redactUrl("https://litellm.example/v1/chat?key=sk-FAKEFAKEFAKEFAKEFAK");
    expect(redacted).not.toContain("sk-FAKEFAKEFAKEFAKEFAK");
  });
  it("masks short sk- key in a path segment", () => {
    const out = redactUrl("https://litellm.example/v1/sk-FAKEFAKE/data");
    expect(out).not.toContain("sk-FAKEFAKE");
    expect(out).toContain("***");
  });
});

describe("byok:CR-01 — every configured shape redacts across path / query-value / fragment placement", () => {
  // shape × placement matrix — the deterministic stand-in for the
  // fast-check property test (fast-check is not a byok-guard dependency;
  // adding it would widen Track D's blast radius beyond redact-url.ts +
  // this file). Each row asserts the shape+body never survives.
  const shapes: ReadonlyArray<readonly [string, string]> = [
    ["ghp_", "000000000000000000000000000000000000"],
    ["gho_", "000000000000000000000000000000000000"],
    ["ghu_", "000000000000000000000000000000000000"],
    ["ghs_", "000000000000000000000000000000000000"],
    ["ghr_", "000000000000000000000000000000000000"],
    ["tvly-", "00000000000000000000000000000000"],
    ["AQVN", "0000000000000000abcd"],
    ["y0_", "AgAAAAA0000000000000000000000000000"],
    ["ASIA", "IOSFODNN7EXAMPLE"],
    ["sk-", "FAKEFAKE"],
    ["sk-ant-", "api03FAKEFAKEFAKEFAKE"],
    ["AIza", "Sy00000000000000000000000000000000000"],
    ["AKIA", "IOSFODNN7EXAMPLE"],
  ];

  for (const [shape, body] of shapes) {
    const token = shape + body;
    it.each([
      [`https://api.example/p/${token}/x`, "path"],
      [`https://api.example/q?k=${token}`, "query-value"],
      [`https://api.example/cb#${token}`, "fragment"],
    ])(`redacts ${shape} in %s placement`, (url) => {
      expect(redactUrl(url)).not.toContain(token);
    });
  }
});
