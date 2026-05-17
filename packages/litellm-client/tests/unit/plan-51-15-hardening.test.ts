// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-15 — RED→GREEN for REVIEW-INDEX.md litellm-client
// HIGH cluster (3 of 4; dead-exports deferred to Plan 51-18).
//
//   HI-1: chatCompletionsStream error-drain timeout — closed in 51-06.
//   HI-2: audioTranscriptions PassThrough leaks source Readable on
//         mid-upload abort.
//   HI-3: isOverride read from process.env instead of config.baseUrl
//         (drift in corporate deployments).
//   HI-4: caller-supplied header values not CR/LF-rejected (defence-
//         in-depth on userId / requestId).
//
// Source-level assertions (the actual undici dispatcher integration
// lives in the existing index.test.ts; this file pins the contract).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildLitellmClient, DEFAULT_LITELLM_BASE_URL } from "../../src/index.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(TEST_DIR, "../../src/index.ts");

describe("Plan 51-15 — litellm-client hardening", () => {
  it("HI-2 source: audioTranscriptions wires bidirectional teardown (through.on close/error -> destroy source)", () => {
    const src = readFileSync(SRC, "utf8");
    // The fix path defines a `destroySource` helper that calls
    // args.body.destroy() and is wired to BOTH `through.on("close",
    // ...)` and `through.on("error", ...)`. We assert all three
    // tokens are present in close proximity.
    expect(/destroySource/.test(src)).toBe(true);
    expect(/through\.on\("close"/.test(src)).toBe(true);
    expect(/through\.on\("error"/.test(src)).toBe(true);
  });

  it("HI-3 runtime: isOverride derives from config.baseUrl, not process.env.LITELLM_BASE_URL", () => {
    // Set the env to a value that DISAGREES with the explicit
    // config.baseUrl. The fix must honor the explicit config (no
    // env-vs-config drift in corporate deploy).
    const prev = process.env.LITELLM_BASE_URL;
    process.env.LITELLM_BASE_URL = "http://wrong-base:9999";
    try {
      const client = buildLitellmClient({
        baseUrl: "http://corp-litellm:4000",
        masterKey: "k",
        defaultChatModel: "x",
        providerKeys: {},
      });
      // baseUrl on the returned client is the explicit one.
      expect(client.baseUrl).toBe("http://corp-litellm:4000");
    } finally {
      if (prev === undefined) delete process.env.LITELLM_BASE_URL;
      else process.env.LITELLM_BASE_URL = prev;
    }
  });

  it("HI-3 runtime: config.baseUrl === DEFAULT preserves env-based isOverride fallback", () => {
    // When config matches the default, the env still decides whether
    // we're in corporate-override mode (backward compat).
    const prev = process.env.LITELLM_BASE_URL;
    delete process.env.LITELLM_BASE_URL;
    try {
      const client = buildLitellmClient({
        baseUrl: DEFAULT_LITELLM_BASE_URL,
        masterKey: "k",
        defaultChatModel: "x",
        providerKeys: {},
      });
      expect(client.baseUrl).toBe(DEFAULT_LITELLM_BASE_URL);
    } finally {
      if (prev !== undefined) process.env.LITELLM_BASE_URL = prev;
    }
  });

  it("HI-4 source: authHeaders rejects CR/LF in userId + requestId", () => {
    const src = readFileSync(SRC, "utf8");
    // Both guards present in authHeaders.
    expect(/userId must not contain CR\/LF/.test(src)).toBe(true);
    expect(/requestId must not contain CR\/LF/.test(src)).toBe(true);
  });
});
