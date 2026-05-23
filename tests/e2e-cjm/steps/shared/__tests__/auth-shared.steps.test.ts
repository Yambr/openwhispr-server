// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase r34 / quick — vitest unit coverage for the canonical
// `Given "a signed-in user"` shared step. Per
// `feedback_cjm_steps_need_unit_tests`, every steps/*.steps.ts gets
// sibling vitest coverage with the HTTP boundary mocked.
//
// Asserts:
//   1. Exactly ONE `Given("a signed-in user", ...)` definition exists
//      across the steps tree (the duplicate-step-defs defect this
//      refactor closes).
//   2. The shared step writes ctx.cookie from the signedInAs result.

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const here = resolve(fileURLToPath(import.meta.url), "..");
// __tests__ → shared → steps
const stepsRoot = resolve(here, "..", "..");

describe("auth-shared.steps.ts — canonical `Given a signed-in user`", () => {
  it("is declared exactly once across tests/e2e-cjm/steps/**/*.steps.ts", async () => {
    const files: string[] = [];
    for await (const f of glob("**/*.steps.ts", {
      cwd: stepsRoot,
      exclude: ["**/__tests__/**", "**/node_modules/**"],
    })) {
      files.push(resolve(stepsRoot, f));
    }
    const hits: Array<{ file: string; line: number }> = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((ln, idx) => {
        if (/Given\(\s*["'`]a signed-in user["'`]/.test(ln)) {
          hits.push({ file: f, line: idx + 1 });
        }
      });
    }
    expect(
      hits,
      `Expected 1 definition, found ${hits.length}: ${hits.map((h) => `${h.file}:${h.line}`).join(", ")}`,
    ).toHaveLength(1);
    expect(hits[0].file).toMatch(/steps[/\\]shared[/\\]auth-shared\.steps\.ts$/);
  });

  it("writes ctx.cookie from signedInAs result", async () => {
    // Mock the fixtures barrel BEFORE importing the shared steps file so
    // the Given() registration captures our spy handler. We re-implement
    // a tiny Given() that records the handler, then invoke it manually.
    const recorded: Array<{ pattern: string; fn: (...args: unknown[]) => unknown }> = [];
    vi.doMock("../../../support/fixtures", () => ({
      Given: (pattern: string, fn: (...args: unknown[]) => unknown) => {
        recorded.push({ pattern, fn });
      },
      freshTenant: (t: string) => ({
        tenantId: t,
        email: `e2e+${t.slice(0, 8)}@local.test`,
        password: "p",
        displayName: "d",
      }),
      signedInAs: vi.fn(async () => "session=abc123"),
    }));

    await import("../auth-shared.steps.js");

    const given = recorded.find((r) => r.pattern === "a signed-in user");
    expect(given, "shared step did not register").toBeDefined();

    const fixtures = {
      apiBaseURL: "https://api.test",
      mailpitApiUrl: "https://mp.test",
      tenantId: "00000000-0000-0000-0000-0000000000aa",
    };
    const ctx = {
      apiBaseURL: "https://api.test",
      mailpitApiUrl: "https://mp.test",
      tenantId: "00000000-0000-0000-0000-0000000000aa",
      cookie: undefined as string | undefined,
    };
    // playwright-bdd handler shape: (fixtures, ctx, ...args).
    await given!.fn.call({}, fixtures, ctx);
    expect(ctx.cookie).toBe("session=abc123");

    vi.doUnmock("../../../support/fixtures");
  });
});
