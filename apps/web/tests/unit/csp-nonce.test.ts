// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-04 — RED→GREEN for REVIEW-INDEX.md CR-5.
//
// Pre-publication review found that apps/web/next.config.ts ships
// `script-src 'self' 'unsafe-inline'` globally on every route. A
// comment in the file acknowledged "Long-term we should switch to
// per-request nonces" — and this is the long-term fix.
//
// Strategy: middleware generates a per-request nonce (random 16
// bytes, base64url). Middleware sets:
//   * `x-nonce` on the FORWARDED request header (so RSC can read it
//     via `headers()` if it ever needs to render a literal
//     <script nonce={...}>).
//   * `Content-Security-Policy` on the RESPONSE header with the same
//     nonce in `script-src 'self' 'nonce-{value}'`. The
//     `next.config.ts` global CSP header is removed because middleware
//     CSP supersedes it.
//
// This file asserts (a) the middleware source contains the nonce
// generation + CSP wiring, and (b) `next.config.ts` no longer carries
// `'unsafe-inline'` in `script-src`. Functional middleware tests
// (NextRequest → NextResponse) require the Next runtime and live in
// the existing middleware test file — out of scope here.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIDDLEWARE_SRC = resolve(TEST_DIR, "../../src/middleware.ts");
const NEXT_CONFIG_SRC = resolve(TEST_DIR, "../../next.config.ts");

describe("Plan 51-04 — CSP per-request nonce", () => {
  it("middleware: generates a per-request nonce and forwards it as x-nonce", () => {
    const src = readFileSync(MIDDLEWARE_SRC, "utf8");
    // Either `crypto.randomUUID`, `crypto.getRandomValues`, or
    // `randomBytes` is acceptable — we just need PROOF the middleware
    // generates fresh bytes per request. base64url encoding is the
    // canonical CSP nonce form.
    expect(/x-nonce/i.test(src)).toBe(true);
    expect(
      /crypto\.(getRandomValues|randomUUID)|randomBytes|webcrypto/.test(src),
      "middleware must generate per-request entropy for the nonce",
    ).toBe(true);
  });

  it("middleware: emits Content-Security-Policy header containing `nonce-`", () => {
    const src = readFileSync(MIDDLEWARE_SRC, "utf8");
    // The middleware sets the CSP header on the NextResponse so the
    // generated nonce makes it into the wire response.
    expect(/Content-Security-Policy/i.test(src)).toBe(true);
    expect(/nonce-/.test(src)).toBe(true);
  });

  it("next.config.ts: script-src no longer contains 'unsafe-inline'", () => {
    const src = readFileSync(NEXT_CONFIG_SRC, "utf8");
    // Strip line comments first — the file may continue to NARRATE the
    // old unsafe-inline allowance in JSDoc / rationale.
    const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // Look only at lines that participate in `script-src ...` literals.
    const scriptSrcLines = stripped
      .split(/\n/)
      .filter((l) => /script-src/.test(l))
      .join(" ");
    expect(/'unsafe-inline'/.test(scriptSrcLines)).toBe(false);
  });
});
