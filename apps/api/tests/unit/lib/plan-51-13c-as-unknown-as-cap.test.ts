// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-13c — REVIEW api-core HIGH-02. The `as unknown as`
// cluster across `apps/api/src/**` (production source only, excludes
// `__tests__/`) is capped at 12 occurrences. Pre-fix the count was 17;
// the fastify.d.ts augmentation for `i18n?` + `language?` eliminated 5
// casts (error-handler.ts:226, locale.ts:53, better-auth-handler.ts:190,
// realtime.ts:160, i18n/init.ts:153). Every remaining cast carries an
// `issue-51-13c-*` (or older `issue-NN-*`) entry in
// `tools/lint-no-suppressions.allowlist.txt` so its load-bearing
// rationale is recoverable from version control without re-reading
// every call site.
//
// This test is a tripwire: if the count grows, the new occurrence is
// likely a regression smuggling LOCKER-02 debt back into the boot/auth
// path. Either remove the cast or add a proper allowlist entry AND raise
// the cap here with a one-line justification.

import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, "../../..");

describe("Plan 51-13c — as-unknown-as cap on apps/api/src/", () => {
  it("production-source `as unknown as` occurrences ≤ 12", () => {
    // grep returns exit 1 when no matches; capture stdout safely.
    let stdout = "";
    try {
      stdout = execSync(
        // Excludes `__tests__/` directories (test-only casts are out of
        // scope of LOCKER-02 / the HIGH finding).
        `grep -rn 'as unknown as' src --include='*.ts' | grep -v '__tests__'`,
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch (err) {
      // grep exits non-zero when no lines match — treat as zero hits.
      if ((err as { status?: number }).status !== 1) throw err;
    }
    const lines = stdout
      .split("\n")
      .filter((l) => l.trim().length > 0)
      // Skip pure-comment hits (jsdoc / `//` / `*`) — comment text never
      // forms a runtime type-assertion. The lint tool itself already
      // refuses comment hits via its own AST walk; we mirror that here.
      .filter((l) => {
        const code = l.split(":").slice(2).join(":");
        const t = code.trimStart();
        return !(t.startsWith("//") || t.startsWith("*"));
      });
    expect(lines.length).toBeLessThanOrEqual(12);
  });
});
