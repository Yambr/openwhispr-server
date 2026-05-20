// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-04.
//
// `AdminShell` shipped with NO sign-out control — a stale assumption from
// the retired Traefik-basic-auth admin model. The current model is
// `users.role='admin'` (enforced by `checkAdminAccess()` / admin-guard),
// so an admin signs out via Better Auth `signOut()` like any other user.
// HI-04 adds an in-product sign-out button to the AdminShell header,
// mirroring `AppShell.handleSignOut` (signOut() → router.push("/sign-in")).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SHELL_SRC = resolve(TEST_DIR, "../../../../src/components/screens/AdminShell.tsx");

describe("HI-04 — AdminShell must offer an in-product sign-out control", () => {
  const src = readFileSync(SHELL_SRC, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("HI-04: imports Better Auth signOut from auth-client", () => {
    expect(
      /import\s*\{[^}]*\bsignOut\b[^}]*\}\s*from\s*["']@\/lib\/auth-client["']/.test(code),
    ).toBe(true);
  });

  it("HI-04: defines a handleSignOut handler that routes to /sign-in", () => {
    expect(/signOut\(\)/.test(code)).toBe(true);
    expect(/router\.push\(["']\/sign-in["']\)/.test(code)).toBe(true);
  });

  it("HI-04: header renders a sign-out Button", () => {
    expect(/<Button[^>]*onClick=\{handleSignOut\}/.test(code)).toBe(true);
  });

  it("HI-04: no stale 'NO sign-out button' / Traefik-basic-auth comment remains", () => {
    expect(/NO sign-out button/.test(src)).toBe(false);
    expect(/Traefik basic-auth/.test(src)).toBe(false);
  });
});
