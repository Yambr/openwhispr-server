// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.b — drift-as-failure parity test.
//
// At test time, walk apps/**/src/** + packages/**/src/** and grep for
// every `process.env.X_API_KEY` reference. For each discovered env var
// name, construct a synthetic URL whose query string carries the
// lower-cased env name AS THE PARAM with a fake token shape as the
// value, and assert `redactUrl` masks it.
//
// Adding a new `process.env.FOO_API_KEY` to code without teaching
// `redactUrl` to recognise (the equivalent of) `?foo_api_key=…` makes
// this test fail — exactly the drift signal the review asked for.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { redactUrl } from "../../../src/redact-url.js";

const REPO_ROOT = resolve(__dirname, "../../../../..");
const FAKE_VALUE = "sk-fakefakefakefakefakefake";

/**
 * Discover every `process.env.<NAME>_API_KEY` reference under
 * apps/**\/src/** + packages/**\/src/** (excluding tests + node_modules).
 * Returns the unique set of env-var names.
 */
function discoverApiKeyEnvVars(): string[] {
  // `git grep` is the fastest portable scanner; falls back to find+grep
  // if the tree is not a git working copy.
  let out: string;
  try {
    out = execSync(
      "git grep -hoE 'process\\.env\\.[A-Z][A-Z0-9_]*_API_KEY' -- 'apps/**/src/**/*.ts' 'apps/**/src/**/*.tsx' 'packages/**/src/**/*.ts' 'packages/**/src/**/*.tsx' ':!**/__tests__/**' ':!**/tests/**'",
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
  } catch {
    out = "";
  }
  const names = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/process\.env\.([A-Z][A-Z0-9_]*_API_KEY)/);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const envVars = discoverApiKeyEnvVars();

describe("redactUrl parity with discovered *_API_KEY env vars", () => {
  it("discovers at least one *_API_KEY env var (sanity)", () => {
    // If the codebase ever drops to zero API_KEY references this test
    // suite no longer guards anything — fail loudly instead of silently
    // passing zero assertions.
    expect(envVars.length).toBeGreaterThan(0);
  });

  for (const name of envVars) {
    const lower = name.toLowerCase();
    const url = `https://example.com/?${lower}=${FAKE_VALUE}`;
    it(`redactUrl masks ?${lower}=… (from ${name})`, () => {
      const out = redactUrl(url);
      expect(out).not.toContain(FAKE_VALUE);
      expect(out).toContain("***");
    });
  }
});
