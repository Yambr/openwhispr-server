// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-11 — RED→GREEN for REVIEW-INDEX.md web HIGH
// (javascript: vector in <a href={loki}>). Source-level: the
// observability client wraps every external URL in
// `safeExternalHref()` which whitelists http(s).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(TEST_DIR, "../../src/components/screens/admin/ObservabilityClient.tsx");

describe("Plan 51-11 — observability external-href whitelist", () => {
  it("source defines `safeExternalHref` with an http(s) check", () => {
    const src = readFileSync(SRC, "utf8");
    expect(/function\s+safeExternalHref/.test(src)).toBe(true);
    expect(/u\.protocol\s*===\s*"http:"/.test(src)).toBe(true);
    expect(/u\.protocol\s*===\s*"https:"/.test(src)).toBe(true);
  });

  it("source: tempo / mimir / loki / grafana all flow through safeExternalHref", () => {
    const src = readFileSync(SRC, "utf8");
    expect(/const\s+grafana\s*=\s*safeExternalHref\(env\.grafana\)/.test(src)).toBe(true);
    expect(/const\s+tempo\s*=\s*safeExternalHref\(env\.tempo\)/.test(src)).toBe(true);
    expect(/const\s+mimir\s*=\s*safeExternalHref\(env\.mimir\)/.test(src)).toBe(true);
    expect(/const\s+loki\s*=\s*safeExternalHref\(env\.loki\)/.test(src)).toBe(true);
  });

  it("source: trimSlash() (the unsafe pre-fix helper) is gone", () => {
    const src = readFileSync(SRC, "utf8");
    expect(/function\s+trimSlash/.test(src)).toBe(false);
  });
});
