// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 52 / Plan 52-04 — pin three type-system-only fixes:
//
//   pyannote-client.ts:71,94 (TS2564) — `bodyText` is installed via
//   Object.defineProperty (same Phase 37 CRIT-FIX-09 carve-out as
//   litellm-client; see plan 52-01). `declare readonly` silences the
//   diagnostic without altering runtime layout.
//
//   pyannote-client.ts:229 (TS2322) — undici 7.x narrowed the `request`
//   body union; the interface declared `NodeJS.ReadableStream | Buffer`
//   but undici accepts the concrete `Readable` from node:stream. Switch
//   the type and add the import.
//
//   argon2-keys.ts:29,38 (TS2748) — `@node-rs/argon2` exports `Algorithm`
//   as an ambient const enum; `verbatimModuleSyntax: true` refuses
//   const-enum access. RFC 9106 §3.1 pins Argon2id wire-value at 2, so
//   a local `const ARGON2_ID = 2 as const` mirror is the safest
//   type-system-only fix.
//
// Source-pattern test per Phase 51 precedent.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../../src/lib");

describe("Plan 52-04 — pyannote-client + argon2-keys typecheck", () => {
  const pyannote = readFileSync(resolve(SRC, "pyannote-client.ts"), "utf8");
  const argon2 = readFileSync(resolve(SRC, "argon2-keys.ts"), "utf8");

  it("pyannote-client uses `declare readonly bodyText` on both error classes", () => {
    const hits = pyannote.match(/private\s+declare\s+readonly\s+bodyText:\s*string/g) ?? [];
    expect(hits.length).toBe(2);
    // Pre-fix shape must not return.
    expect(pyannote).not.toMatch(/^\s*private\s+readonly\s+bodyText:\s*string;/m);
  });

  it("pyannote-client uploadToPresignedUrl body type is `Readable | Buffer`", () => {
    expect(pyannote).toMatch(/body:\s*Readable\s*\|\s*Buffer/);
    expect(pyannote).toMatch(/import\s+type\s*\{\s*Readable\s*\}\s+from\s+"node:stream"/);
    // The ambient form must not return.
    expect(pyannote).not.toMatch(/NodeJS\.ReadableStream\s*\|\s*Buffer/);
  });

  it("argon2-keys uses local ARGON2_ID = 2 mirror instead of Algorithm const-enum", () => {
    expect(argon2).toMatch(/const\s+ARGON2_ID\s*=\s*2\s+as\s+const/);
    expect(argon2).toMatch(/algorithm:\s*ARGON2_ID/);
    // The const-enum import + usage must be gone.
    expect(argon2).not.toMatch(/import\s*\{\s*Algorithm\s*,/);
    expect(argon2).not.toMatch(/Algorithm\.Argon2id/);
  });
});
