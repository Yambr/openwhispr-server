// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260524-u00 / Task A3 — RED then GREEN.
//
// CJS-safe `import.meta.url` guard for the worker bundle.
//
// The worker bundles via tsup with format: ["cjs"] (apps/worker/tsup.config.ts).
// In a CJS bundle `import.meta` is undefined at runtime — touching
// `import.meta.url` throws `TypeError: Cannot read properties of undefined
// (reading 'url')` BEFORE the worker can even open a Valkey connection.
//
// The fix mirrors apps/api/scripts/check-default-secrets.ts:32-36 — a typeof
// guard that prefers ESM's `import.meta.url` when present, falls back to
// CJS's runtime-injected `__dirname`, and degrades to empty string only when
// neither is available.
//
// This test exercises the pure helper `resolveHere(meta, dirname)` directly:
// passing different (meta, dirname) tuples covers ESM, CJS, and "neither
// available" paths without monkey-patching globals or transpiling the file
// to CJS at test time.
//
// Why a pure helper instead of vi.stubGlobal(import.meta, undefined): in
// vitest's ESM runner, `import.meta` is read-only and the stub cannot
// reliably remove it. The pure helper is also the path the runtime-CJS
// bundle calls into, so testing it directly is the strongest signal.

import { describe, expect, it } from "vitest";
import { _resolveHere } from "../../../../src/i18n/template-renderer.js";

describe("_resolveHere (Quick-task 260524-u00 / Task A3 — CJS guard)", () => {
  it("ESM context: returns dirname(fileURLToPath(meta.url)) when meta.url is a string", () => {
    const result = _resolveHere(
      { url: "file:///app/apps/worker/dist/i18n/template-renderer.js" } as ImportMeta,
      undefined,
    );
    // Resolved via fileURLToPath + dirname — should be "/app/apps/worker/dist/i18n"
    expect(result).toBe("/app/apps/worker/dist/i18n");
  });

  it("CJS context (meta undefined): falls back to provided __dirname", () => {
    const result = _resolveHere(undefined, "/app/apps/worker/dist");
    expect(result).toBe("/app/apps/worker/dist");
  });

  it("CJS context (meta with non-string url): falls back to provided __dirname", () => {
    // tsup's CJS bundle emits `import.meta = {}` (empty object) on some
    // configurations. The guard should treat any non-string url as absent.
    const result = _resolveHere({ url: undefined } as unknown as ImportMeta, "/app/dist");
    expect(result).toBe("/app/dist");
  });

  it("degenerate case (no meta, no dirname): returns empty string (loud-fail downstream)", () => {
    // resolveLocalesDir falls through to its readFileSync probe which will
    // throw with a meaningful "ENOENT" path — better than crashing at the
    // module-init dirname() call with an opaque TypeError.
    const result = _resolveHere(undefined, undefined);
    expect(result).toBe("");
  });

  it("real call-site signature: ESM (this test's own import.meta) yields a non-empty path", () => {
    // Smoke check that the helper accepts the SHAPE of the production
    // call-site, not just synthetic objects.
    const result = _resolveHere(import.meta as ImportMeta, undefined);
    expect(result).toMatch(/i18n.+__tests__$/);
    expect(result.length).toBeGreaterThan(0);
  });
});
