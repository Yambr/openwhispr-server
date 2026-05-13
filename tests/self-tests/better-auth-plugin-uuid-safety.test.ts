// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 02.8 / D-02 — Better Auth plugin UUID-safety CI lint guard.
 *
 * Source-of-record commit: <filled at commit time — Phase 02.8 atomic commit>
 *
 * Reverts: this test goes RED if any of the following inverse patches is applied:
 *   1. A denylisted plugin (`organization`, `anonymous`) is added to apps/api/src/auth.ts
 *      `plugins:` array → those plugins import `generateId` directly from
 *      `@better-auth/core/utils/id` and bypass `advanced.database.generateId: "uuid"`.
 *      → assertion `expect(denylist).not.toContain(name)` fails.
 *   2. A plugin not on the allowlist is added without first updating this allowlist
 *      (fail-closed discipline; forces explicit review of UUID-safety semantics).
 *      → assertion `expect(ALLOWLIST).toContain(name)` fails.
 *   3. Any production source file (apps/**, packages/**) imports `generateId` from
 *      `@better-auth/core/utils/id` directly → bypasses the override.
 *      → assertion on raw-import scan fails.
 *
 * Why this exists: Phase 02.7-06 surfaced a 22P02 / 422 signup failure caused by
 * Better Auth v1.6.9's default 32-char base32 IDs being inserted into Postgres
 * `uuid` columns. Phase 02.8 fixes it with the first-class UUID mode
 * (`advanced.database.generateId: "uuid"`). This CI lint mechanises the residual
 * risk: BA plugins `organization` and `anonymous` import `generateId` directly,
 * sidestepping the override. Adding either of those (or any new untriaged plugin)
 * MUST trip this test before merge — boring discipline, fail-closed.
 *
 * No runtime BA spin-up: pure static-source assertion on apps/api/src/auth.ts and
 * a shallow grep across our app/package source for raw-import smell.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AUTH_TS = join(process.cwd(), "apps", "api", "src", "auth.ts");

// UUID-safe Better Auth plugins. Adding to this list requires verifying that
// the plugin does NOT import `generateId` from `@better-auth/core/utils/id`
// (which bypasses our `advanced.database.generateId: "uuid"` override and
// emits 32-char base32 strings into Postgres `uuid` columns → 22P02).
const ALLOWLIST: ReadonlyArray<string> = ["bearer", "genericOAuth", "jwt"];

// Plugins KNOWN to bypass `ctx.generateId` (verified by reading their source
// in node_modules at the v1.6.9 pin). Adding any of these requires Option B
// schema migration (uuid → text) FIRST per CONTEXT.md D-02.
const DENYLIST: ReadonlyArray<string> = ["organization", "anonymous"];

const RAW_IMPORT_RE = /from\s+["']@better-auth\/core\/utils\/id["']/;

function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist" || entry === ".next") continue;
      const full = join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry)) {
        // Skip test files — only production source matters for the bypass guard.
        if (/\.(test|spec)\.[a-z]+$/.test(entry)) continue;
        out.push(full);
      }
    }
  }
  return out;
}

describe("Phase 02.8 D-02 — Better Auth plugin UUID-safety lint", () => {
  const auth = readFileSync(AUTH_TS, "utf8");

  it("apps/api/src/auth.ts imports only allowlisted Better Auth plugins", () => {
    // Match `import { foo } from "better-auth/plugins/<slug>"`.
    const importRe = /from\s+["']better-auth\/plugins\/([a-z0-9-]+)["']/g;
    const slugs = new Set<string>();
    for (const m of auth.matchAll(importRe)) {
      slugs.add(m[1]);
    }
    // Slug-to-id map: plugin imports use kebab-case file slugs but emit
    // camelCase factories whose plugin id matches one of the allowlist names.
    const slugToId: Record<string, string> = {
      bearer: "bearer",
      "generic-oauth": "genericOAuth",
      jwt: "jwt",
      organization: "organization",
      anonymous: "anonymous",
    };
    for (const slug of slugs) {
      const id = slugToId[slug] ?? slug;
      expect(DENYLIST, `denylisted plugin "${id}" found in auth.ts`).not.toContain(id);
      expect(
        ALLOWLIST,
        `plugin "${id}" not on UUID-safe allowlist; verify it does not import generateId from @better-auth/core/utils/id, then add to ALLOWLIST in this test`,
      ).toContain(id);
    }
  });

  it("auth.ts does NOT import generateId directly from @better-auth/core/utils/id", () => {
    expect(RAW_IMPORT_RE.test(auth)).toBe(false);
  });

  it("auth.ts declares advanced.database.generateId === 'uuid' (closes 02.7-06 cascade tail)", () => {
    // Static-source assertion: production code MUST contain the literal config.
    // The runtime equivalent is asserted in apps/api/src/__tests__/auth-schema-mapping.test.ts.
    expect(auth).toMatch(/database:\s*\{\s*generateId:\s*["']uuid["']/);
  });

  it("no production source file imports generateId from @better-auth/core/utils/id (bypass guard)", () => {
    const roots = [join(process.cwd(), "apps"), join(process.cwd(), "packages")];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walkSourceFiles(root)) {
        const text = readFileSync(file, "utf8");
        if (RAW_IMPORT_RE.test(text)) offenders.push(file);
      }
    }
    expect(offenders, `files importing generateId directly: ${offenders.join(", ")}`).toEqual([]);
  });
});
