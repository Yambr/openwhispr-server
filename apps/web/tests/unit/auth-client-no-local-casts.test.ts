// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-11b — REVIEW web HIGH HI-06.
//
// Three auth screens used to extend Better Auth's inferred type at the
// call site via `as unknown as { ... }`, violating CLAUDE.md
// DISCIPLINE rule 12 (no type-suppression). The shape is now
// centralised in `src/lib/auth-client.ts` via `ExtendedAuthClient`.
// This test pins:
//   - the three screens contain no `as unknown as` cast
//   - auth-client.ts declares the four extension members
//     (signIn.email, signIn.social, sendVerificationEmail, verifyEmail).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, "../..");

const SCREENS = [
  "src/components/screens/auth/SignInForm.tsx",
  "src/components/screens/auth/OidcButtons.tsx",
  "src/components/screens/auth/VerifyEmailClient.tsx",
];

describe("Plan 51-11b — auth-client extension type unification", () => {
  // Strip line + block comments — the post-fix narrative legitimately
  // mentions `as unknown as` in prose. The regression we pin is "no
  // live cast expression".
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it.each(SCREENS)("%s has no `as unknown as` call-site cast", (rel) => {
    const src = stripComments(readFileSync(resolve(ROOT, rel), "utf8"));
    expect(src).not.toMatch(/\bas\s+unknown\s+as\b/);
  });

  it("auth-client.ts declares ExtendedAuthClient extensions", () => {
    const src = readFileSync(resolve(ROOT, "src/lib/auth-client.ts"), "utf8");
    // Members of ExtendedAuthClient that the call sites consume:
    expect(src).toMatch(/SignInEmail\b/);
    expect(src).toMatch(/SignInSocial\b/);
    expect(src).toMatch(/SendVerificationEmail\b/);
    expect(src).toMatch(/VerifyEmailFn\b/);
    expect(src).toMatch(/ExtendedAuthClient\b/);
  });
});
