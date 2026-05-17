// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-11b — REVIEW web HIGH HI-03.
//
// `internalApiUrl()` + `DEFAULT_INTERNAL_API_URL = "http://api:3000"`
// was duplicated across 7 files (auth-server, auth-actions, 5 RSC
// pages). A typo in one of the env-var names would silently desync.
// The fix consolidates into a single helper at
// `apps/web/src/lib/internal-api.ts`; this test pins the contract:
//   - the helper exists and exports `internalApiUrl()`
//   - no duplicate `DEFAULT_INTERNAL_API_URL` literal survives in the
//     7 call-site files
//   - all 7 call sites import from the central module.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, "../..");

const CALL_SITES = [
  "src/lib/auth-server.ts",
  "src/lib/auth-actions.ts",
  "src/app/(auth)/app/page.tsx",
  "src/app/(auth)/app/notes/page.tsx",
  "src/app/(auth)/app/transcriptions/page.tsx",
  "src/app/(auth)/app/conversations/page.tsx",
  "src/app/(auth)/app/conversations/[id]/page.tsx",
];

describe("Plan 51-11b — INTERNAL_API_URL helper dedup", () => {
  it("central module exists at src/lib/internal-api.ts", () => {
    const src = readFileSync(resolve(ROOT, "src/lib/internal-api.ts"), "utf8");
    expect(src).toMatch(/export\s+function\s+internalApiUrl\b/);
  });

  it.each(CALL_SITES)("call site %s has no local DEFAULT_INTERNAL_API_URL", (rel) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).not.toMatch(/^const\s+DEFAULT_INTERNAL_API_URL\b/m);
    expect(src).not.toMatch(/^function\s+internalApiUrl\b/m);
  });

  it.each(CALL_SITES)("call site %s imports internalApiUrl from the central module", (rel) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).toMatch(
      /from\s+["']@\/lib\/internal-api["']|from\s+["'][./]+lib\/internal-api["']/,
    );
  });
});
