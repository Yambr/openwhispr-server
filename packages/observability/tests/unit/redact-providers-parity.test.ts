// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.g / HI-02 — drift-as-failure parity test.
//
// Walks apps/*/src for every `process.env.*_(API_KEY|SECRET|TOKEN|PASSWORD)`
// reference at test time, then asserts each surfaced env-var name appears
// in observability/redact.ts REDACT_PATHS. Adding a new provider env var
// to application code without updating REDACT_PATHS = test failure.
//
// Mirrors Phase 40.b's redactUrl drift-as-failure pattern (which checks
// byok-guard side) — together they enforce parity across both redaction
// layers without a shared-constants refactor.
//
// Implementation note: original draft used `git grep` for speed, but the
// pathspec resolution differs between vitest CWD and CLI shells in this
// monorepo (vitest CWD was the package, not repo root), making discovery
// silently empty. Node fs walk is CWD-independent and only ~30 ms slower.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS } from "../../src/redact.js";

const PKG_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = resolve(PKG_DIR, "..", "..");
const APPS_DIRS = ["apps/api/src", "apps/web/src", "apps/worker/src"] as const;

async function walkTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...(await walkTsFiles(full)));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function discoverSecretEnvVars(): Promise<readonly string[]> {
  const envRefRe = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\["([A-Z][A-Z0-9_]*)"\])/g;
  const suffixRe = /(API_KEY|_KEY|_SECRET|_TOKEN|_PASSWORD)$/;
  const names = new Set<string>();
  for (const rel of APPS_DIRS) {
    const files = await walkTsFiles(resolve(REPO_ROOT, rel));
    for (const file of files) {
      const text = await readFile(file, "utf-8");
      let m: RegExpExecArray | null = envRefRe.exec(text);
      while (m !== null) {
        const name = m[1] ?? m[2];
        if (name && suffixRe.test(name)) names.add(name);
        m = envRefRe.exec(text);
      }
    }
  }
  return [...names].sort();
}

/** A name is "covered" if REDACT_PATHS contains the exact name OR a wildcard. */
function isCoveredByRedactPaths(name: string): boolean {
  if (REDACT_PATHS.includes(name)) return true;
  if (REDACT_PATHS.includes(`*.${name}`)) return true;
  // Generic suffix coverage: lower-cased family tokens like "apiKey",
  // "api_key", "password", "secret" are also acceptable matches when
  // the env name lowercases to one of them (catches *_PASSWORD via the
  // bare "password" path, *_TOKEN via "token", etc.).
  const lowered = name.toLowerCase();
  for (const family of ["api_key", "password", "secret", "token", "bearer_token"]) {
    if (lowered.endsWith(family)) {
      if (REDACT_PATHS.includes(family)) return true;
    }
  }
  return false;
}

describe("REDACT_PATHS parity with apps/* secret env-var references", () => {
  it("covers every discovered process.env.*_(API_KEY|SECRET|TOKEN|PASSWORD) in apps/", async () => {
    const discovered = await discoverSecretEnvVars();
    const uncovered = discovered.filter((name) => !isCoveredByRedactPaths(name));
    expect(
      uncovered,
      `Uncovered secret env vars (add to REDACT_PATHS or family-cover): ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it("discovery surface is non-empty (defense against silent regex breakage)", async () => {
    const discovered = await discoverSecretEnvVars();
    // Phase 5+ already shipped multiple *_API_KEY references in apps/api.
    expect(discovered.length).toBeGreaterThan(0);
  });
});
