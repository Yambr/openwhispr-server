// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 review HI-02 — Static guard against re-introducing
// credential-leaking bootstrap warns.
//
// The three catch arms in apps/api/src/index.ts (BullMQ email-delivery
// queue, LiteLLM client, Valkey/Redis client) historically printed
// `(err as Error).message`, which can embed credential-bearing URLs from
// ioredis / Node URL parser / LiteLLM config loader. After the HI-02 fix
// they print `redactUrl(env)` + `err.name` instead.
//
// This test is a source-level lint: it ensures no future refactor
// reintroduces `(err as Error).message` inside the bootstrap catch arms,
// and that each catch arm continues to flow through `redactUrl`. It is
// intentionally cheap (no container boot, no Fastify wiring) so it runs
// in every CI iteration.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const INDEX_PATH = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));
if (!existsSync(INDEX_PATH)) throw new Error(`source-contract path moved: ${INDEX_PATH}`);
const INDEX_SRC = readFileSync(INDEX_PATH, "utf-8");

describe("apps/api/src/index.ts bootstrap warn redaction (HI-02)", () => {
  it("imports `redactUrl` from ./lib/redact-url.js", () => {
    expect(INDEX_SRC).toMatch(/import\s*\{\s*redactUrl\s*\}\s*from\s*"\.\/lib\/redact-url\.js"/);
  });

  it("the BullMQ email-delivery catch arm calls redactUrl with VALKEY_URL", () => {
    // Slice the file around the BullMQ warn message and assert the
    // redactor wraps the env access.
    const idx = INDEX_SRC.indexOf("BullMQ email-delivery queue not constructed");
    expect(idx).toBeGreaterThan(0);
    const window = INDEX_SRC.slice(idx, idx + 600);
    expect(window).toContain("redactUrl(process.env.VALKEY_URL");
    // Negative: the literal `err.message` / `(err as Error).message` must
    // not appear in this window.
    expect(window).not.toMatch(/\(err as Error\)\.message/);
  });

  it("the LiteLLM client catch arm calls redactUrl with LITELLM_BASE_URL", () => {
    const idx = INDEX_SRC.indexOf("LiteLLM client not constructed");
    expect(idx).toBeGreaterThan(0);
    const window = INDEX_SRC.slice(idx, idx + 700);
    expect(window).toContain("redactUrl(process.env.LITELLM_BASE_URL");
    expect(window).not.toMatch(/\(err as Error\)\.message/);
  });

  it("the Valkey/Redis client catch arm calls redactUrl with VALKEY_URL", () => {
    const idx = INDEX_SRC.indexOf("Valkey client not constructed");
    expect(idx).toBeGreaterThan(0);
    const window = INDEX_SRC.slice(idx, idx + 700);
    expect(window).toContain("redactUrl(process.env.VALKEY_URL");
    expect(window).not.toMatch(/\(err as Error\)\.message/);
  });

  it("regression guard: no bootstrap catch arm in index.ts logs `(err as Error).message`", () => {
    // Defence-in-depth: a sweeping check that the specific anti-pattern
    // we eradicated does not creep back in anywhere in the file.
    expect(INDEX_SRC).not.toContain("(err as Error).message");
  });

  it("regression guard: the literal credential substring never lands in the redacted output for a sample URL", () => {
    // Smoke check the helper directly with a realistic VALKEY_URL shape.
    // If a future change loosens redactUrl this test fails before the
    // bootstrap warn ever runs in CI.
    // We re-import here (not at module top) to keep this test self-contained.
    return import("../../../src/lib/redact-url").then(({ redactUrl }) => {
      const sample = "redis://default:supersecret-valkey-pw@valkey.internal:6379";
      const redacted = redactUrl(sample);
      expect(redacted).not.toContain("supersecret-valkey-pw");
      expect(redacted).toContain("***");
    });
  });
});
