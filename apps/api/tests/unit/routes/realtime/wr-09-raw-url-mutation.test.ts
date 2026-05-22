// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-09 regression test for realtime.ts.
// R31 — re-derived for the frame-aware relay.
//
// ORIGINAL WR-09 (pre-R31): the route mutated `req.raw.url` in place to
// inject `?user=`, parsing it via `new URL(rawUrl, "http://internal")`.
// The guard was: reject a non-relative `req.raw.url` so a foreign absolute
// URL could not have its host silently dropped.
//
// POST-R31: the frame-aware relay NO LONGER mutates `req.raw.url`. It
// derives the upstream URL via the pure `buildUpstreamUrl(deps, rawUrl,
// userId)` function, which parses the client URL ONLY to read its query
// params and ALWAYS constructs a fresh upstream URL from operator config
// (`litellm.baseUrl` or `deps.openaiRealtimeUrl`). The host is therefore
// never taken from client input — the original silent-host-drop class of
// bug is structurally impossible.
//
// This test pins that the relay does NOT regress to the `req.raw.url`
// mutation pattern and that the upstream URL is derived from operator
// config, not from the client-supplied raw URL's host/scheme.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LitellmClient } from "@openwhispr/litellm-client";
import { describe, expect, it } from "vitest";
import { buildUpstreamUrl, type RealtimeDeps } from "../../../../src/routes/realtime.js";

const ROUTE_SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "src",
  "routes",
  "realtime.ts",
);

const TEST_USER = "11111111-1111-1111-1111-111111111111";

function litellmDeps(): RealtimeDeps {
  return {
    litellm: { baseUrl: "http://litellm:4000" } as unknown as LitellmClient,
    masterKey: "sk-litellm-master-test-only",
    realtimeModel: "realtime-default",
    backend: "litellm",
    openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
  };
}

describe("realtime — WR-09 (R31) upstream URL is operator-derived, not client-host-derived", () => {
  const src = readFileSync(ROUTE_SRC, "utf8");
  const code = src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

  it("WR-09: the relay does NOT mutate req.raw.url (the old silent-host-drop pattern is gone)", () => {
    expect(code).not.toMatch(/req\.raw\.url\s*=/);
  });

  it("WR-09: a client-supplied absolute URL cannot redirect the litellm-mode upstream host", () => {
    // Even if the raw client URL were absolute and pointed at an attacker
    // host, the litellm-mode upstream is derived from `litellm.baseUrl`.
    const out = buildUpstreamUrl(
      litellmDeps(),
      "https://attacker.example/v1/realtime?intent=transcription",
      TEST_USER,
    );
    const u = new URL(out);
    expect(u.host).toBe("litellm:4000");
    expect(u.host).not.toContain("attacker");
  });

  it("WR-09: a client-supplied absolute URL cannot redirect the direct-mode upstream host", () => {
    const out = buildUpstreamUrl(
      { ...litellmDeps(), backend: "direct" },
      "https://attacker.example/v1/realtime?intent=transcription",
      TEST_USER,
    );
    const u = new URL(out);
    expect(u.host).toBe("api.openai.com");
    expect(u.host).not.toContain("attacker");
  });
});
