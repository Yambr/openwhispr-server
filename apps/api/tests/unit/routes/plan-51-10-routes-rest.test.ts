// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-10 — RED→GREEN regressions for REVIEW-INDEX.md
// api-routes-rest HIGH cluster:
//
//   HR-01: diarization filename / Content-Type interpolation →
//          request-smuggling against trusted Speaches upstream.
//   HR-02: better-auth handler reconstructed origin from raw Host
//          header + localhost fallback (open-origin / CSRF risk).
//   HR-03: desktop-signin swallowed `decodeURIComponent` errors and
//          returned the raw encoded value, weakening the scheme
//          allowlist.
//
// Source-level assertions (compatibility with existing test
// harnesses; functional verification lives in sibling integration
// tests for each route).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DIARIZATION_SRC = resolve(TEST_DIR, "../../../src/routes/diarization.ts");
const BETTER_AUTH_SRC = resolve(TEST_DIR, "../../../src/routes/better-auth-handler.ts");
const DESKTOP_SIGNIN_SRC = resolve(TEST_DIR, "../../../src/routes/desktop-signin.ts");

describe("Plan 51-10 — api-routes-rest HIGH hardening", () => {
  it("HR-01 diarization: filename / Content-Type sanitization gate is present", () => {
    const src = readFileSync(DIARIZATION_SRC, "utf8");
    // Pre-fix the file interpolated raw mimetype + filename into
    // Content-Disposition / Content-Type headers without any
    // character-class filter — request-smuggling vector.
    // Post-fix the source carries an explicit narrowing regex on
    // both values BEFORE they're folded into the multipart head.
    expect(
      /\/\^\[a-zA-Z0-9\.\+\\-\/\]\+\$\/.test\(rawMime\)/.test(src),
      "diarization.ts must narrow filePart.mimetype against an ASCII charclass before interpolation",
    ).toBe(true);
    expect(
      /rawName\.replace\(\/\[\^A-Za-z0-9\._-\]\/g/.test(src),
      "diarization.ts must strip non-safe chars from filePart.filename before interpolation",
    ).toBe(true);
  });

  it("HR-02 / CR-01 better-auth: origin no longer trusts a raw Host header", () => {
    const src = readFileSync(BETTER_AUTH_SRC, "utf8");
    // Phase 57 / Track E (api-routes-rest:CR-01) hardened HR-02 further.
    // The pre-fix allowlist branch returned the SAME attacker-controlled
    // `${proto}://${host}` value whether or not the Host matched
    // AUTH_TRUSTED_ORIGINS_EXTRA. The fix removes the allowlist branch
    // and the Host fallback entirely: buildRequestUrl reads ONLY the
    // env-derived origin. The comments still reference the env vars but
    // there must be no `req.headers.host` read inside buildRequestUrl.
    expect(/INGRESS_BASE_URL/.test(src)).toBe(true);
    const fn = src.match(/function buildRequestUrl[\s\S]+?^}/m)?.[0] ?? "";
    expect(fn, "buildRequestUrl not found").toBeTruthy();
    // Strip `//` line comments so the assertion targets executable code
    // only — the doc comment legitimately names `req.headers.host` while
    // explaining why it is no longer trusted.
    const code = fn
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(
      /req\.headers(\.host|\["host"\])/.test(code),
      "buildRequestUrl must NOT read req.headers.host — Host header is never an origin source",
    ).toBe(false);
  });

  it("HR-03 desktop-signin: decodeURIComponent failure returns undefined (no raw passthrough)", () => {
    const src = readFileSync(DESKTOP_SIGNIN_SRC, "utf8");
    // Pre-fix the catch arm returned `m[1]` (the raw encoded value)
    // which bypassed the scheme allowlist. Post-fix it returns
    // `undefined` so the caller falls back to the documented
    // default protocol.
    const m = src.match(/function extractEmbeddedProtocol[\s\S]+?^}/m);
    expect(m, "extractEmbeddedProtocol not found").toBeTruthy();
    // Inside that function body, the catch arm must NOT return
    // `m[1]`. We accept any return that doesn't reference the raw
    // match.
    expect(/catch\s*\{[\s\S]*?return\s+m\[1\]/.test(m?.[0] ?? "")).toBe(false);
  });
});
