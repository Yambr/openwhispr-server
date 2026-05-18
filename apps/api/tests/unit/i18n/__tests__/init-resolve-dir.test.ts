// SPDX-License-Identifier: FSL-1.1-ALv2
// BUG-53-36 — branch coverage for resolveLocalesDir() in i18n/init.ts.
//
// Branches:
//   - LOCALES_DIR env set + non-empty → return env value
//   - LOCALES_DIR env unset → fall through to filesystem layout probe
//   - LOCALES_DIR env empty string → same fall-through (length check)
//   - dist-layout `i18n/locales/en.json` present → return that path
//   - dist-layout missing → catch → return source-tree path

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLocalesDir } from "../../../../src/i18n/init.js";

describe("resolveLocalesDir — branch coverage", () => {
  let prevLocalesDir: string | undefined;

  beforeEach(() => {
    prevLocalesDir = process.env.LOCALES_DIR;
  });

  afterEach(() => {
    if (prevLocalesDir === undefined) delete process.env.LOCALES_DIR;
    else process.env.LOCALES_DIR = prevLocalesDir;
  });

  it("returns the LOCALES_DIR env value when set and non-empty", () => {
    process.env.LOCALES_DIR = "/etc/openwhispr/locales";
    expect(resolveLocalesDir()).toBe("/etc/openwhispr/locales");
  });

  it("falls through when LOCALES_DIR is the empty string", () => {
    process.env.LOCALES_DIR = "";
    const result = resolveLocalesDir();
    // Must NOT be the empty string; the empty-check forces fall-through
    // to the filesystem probe (either dist layout or source-tree path).
    expect(result.length).toBeGreaterThan(0);
    expect(result.endsWith("locales")).toBe(true);
  });

  it("falls through to source-tree path when LOCALES_DIR is unset", () => {
    delete process.env.LOCALES_DIR;
    const result = resolveLocalesDir();
    // Source tree layout — the source path ends with `src/i18n/locales`
    // under vitest. (Under tsup'd dist build the path would end with
    // `dist/i18n/locales`, but vitest reads source.)
    expect(result.endsWith("locales")).toBe(true);
    // The dist-layout probe catches ENOENT for the en.json under
    // `i18n/locales`; coverage requires we exercise the catch arm at
    // least once. Vitest runs against src/** so the catch arm fires.
  });
});
