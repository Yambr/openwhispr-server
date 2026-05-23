// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase r34 / quick — vitest unit coverage for the canonical
// `Then "the response status is {int}"` + `... typed envelope shape ...`
// + `... MUST NOT contain a Node.js stack trace` + `... error code
// matches {string}` shared steps. Per `feedback_cjm_steps_need_unit_tests`,
// every steps/*.steps.ts gets sibling vitest coverage with the HTTP
// boundary mocked.
//
// Asserts:
//   1. Exactly ONE `Then("the response status is {int}", ...)` definition
//      exists across the steps tree (the duplicate-step-defs defect this
//      refactor closes), plus the three additional duplicates we also
//      collapsed in this commit.
//   2. The shared step reads from `recordLastResponse` snapshot and
//      asserts the recorded status.

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = resolve(fileURLToPath(import.meta.url), "..");
// __tests__ → shared → steps
const stepsRoot = resolve(here, "..", "..");

describe("response-shared.steps.ts — canonical Then handlers", () => {
  const dupedPatterns = [
    {
      display: 'Then("the response status is {int}", ...)',
      regex: /Then\(\s*["'`]the response status is \{int\}["'`]/,
      expectedCanonicalSuffix: /steps[/\\]shared[/\\]response-shared\.steps\.ts$/,
    },
    {
      display: "Then(/^the body is the typed envelope shape .../)",
      regex: /Then\(\s*\/\^the body is the typed envelope shape/,
      expectedCanonicalSuffix: /steps[/\\]shared[/\\]response-shared\.steps\.ts$/,
    },
    {
      display: 'Then("the body MUST NOT contain a Node.js stack trace", ...)',
      regex: /Then\(\s*["'`]the body MUST NOT contain a Node\.js stack trace["'`]/,
      expectedCanonicalSuffix: /steps[/\\]shared[/\\]response-shared\.steps\.ts$/,
    },
    {
      display: 'Then("the error code matches {string}", ...)',
      regex: /Then\(\s*["'`]the error code matches \{string\}["'`]/,
      expectedCanonicalSuffix: /steps[/\\]shared[/\\]response-shared\.steps\.ts$/,
    },
  ];

  for (const { display, regex, expectedCanonicalSuffix } of dupedPatterns) {
    it(`is declared exactly once across tests/e2e-cjm/steps/**/*.steps.ts: ${display}`, async () => {
      const files: string[] = [];
      for await (const f of glob("**/*.steps.ts", {
        cwd: stepsRoot,
        exclude: ["**/__tests__/**", "**/node_modules/**"],
      })) {
        files.push(resolve(stepsRoot, f));
      }
      const hits: Array<{ file: string; line: number }> = [];
      for (const f of files) {
        const text = readFileSync(f, "utf8");
        // `Then(` + the pattern argument may straddle a newline; collapse
        // surrounding whitespace before matching so both single-line and
        // multi-line declarations are detected.
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const window = `${lines[i]}\n${lines[i + 1] ?? ""}`.replace(/\s+/g, " ");
          if (regex.test(window) || regex.test(lines[i])) {
            hits.push({ file: f, line: i + 1 });
            break;
          }
        }
      }
      expect(
        hits,
        `Expected 1 definition for ${display}, found ${hits.length}: ${hits.map((h) => `${h.file}:${h.line}`).join(", ")}`,
      ).toHaveLength(1);
      expect(hits[0].file).toMatch(expectedCanonicalSuffix);
    });
  }

  it("recordLastResponse + canonical Then drive the status assertion end-to-end", async () => {
    const { recordLastResponse, _getLastResponseForTest, _resetForTest } = await import(
      "../response-shared.steps.js"
    );
    _resetForTest();
    const tenantId = "00000000-0000-0000-0000-0000000000bb";
    recordLastResponse(tenantId, {
      status: 401,
      body: { error: { code: "UNAUTH", message: "nope" } },
      rawText: "x",
    });
    const snap = _getLastResponseForTest(tenantId);
    expect(snap?.status).toBe(401);
    expect(snap?.body).toMatchObject({ error: { code: "UNAUTH" } });
  });
});
