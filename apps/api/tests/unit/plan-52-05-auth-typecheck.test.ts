// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-05 — pin two type-system-only fixes in auth.ts.
//
//   auth.ts:213 (TS7022) — `fallbackLog`'s `child()` return type
//   referenced `typeof fallbackLog` while the const was being
//   initialized, producing implicit-any on the self-reference. Fix
//   declares an explicit `FallbackLog` interface so the cycle is
//   broken; the exported const annotates against it.
//
//   auth.ts:295 (TS4104) — `oidcProviders` is
//   `readonly OidcProviderRegistration[]`, but Better Auth's
//   `genericOAuth.config` parameter is the mutable shape
//   `GenericOAuthConfig[]`. Spread `[...oidcProviders]` into a fresh
//   mutable array to drop the readonly modifier.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const AUTH = resolve(__dirname, "../../src/auth.ts");

describe("Plan 52-05 — auth.ts typecheck", () => {
  const src = readFileSync(AUTH, "utf8");

  it("declares FallbackLog interface and uses it for fallbackLog annotation", () => {
    expect(src).toMatch(/interface\s+FallbackLog\s*\{/);
    expect(src).toMatch(/export\s+const\s+fallbackLog:\s*FallbackLog\s*=/);
    // Pre-fix self-reference must not return.
    expect(src).not.toMatch(/child\(\):\s*typeof\s+fallbackLog/);
  });

  it("builds genericOAuth.config as a fresh mutable array (drops the readonly modifier)", () => {
    // Phase 69 / Plan 69-03 — the readonly→mutable fix is now expressed via
    // `oidcProviders.map(...)`, which returns a fresh mutable
    // GenericOAuthConfig[] (and attaches the JIT mapProfileToUser seam per
    // provider). `.map()` drops the `readonly` modifier exactly as the prior
    // `[...oidcProviders]` spread did, so the TS4104 fix intent is preserved.
    expect(src).toMatch(/config:\s*oidcProviders\.map\(/);
    // Pre-fix direct readonly pass must not return.
    expect(src).not.toMatch(/config:\s*oidcProviders\s*,/);
  });
});
