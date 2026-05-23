// SPDX-License-Identifier: FSL-1.1-ALv2
// Regression: apps/web shipped without a favicon (see commits ff08fbf7,
// 79c7d361, 6729941a — CI healthcheck was swapped off /favicon.ico because
// the asset did not exist). Advisor verdict: ship a real `icon.svg` via the
// Next.js App Router file convention + a `manifest.ts` that references it;
// keep the `/`-based docker healthcheck as the liveness probe.
//
// This test asserts the two artefacts exist and are well-formed so the
// product cannot silently regress to a 404 favicon again.
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../../../src/app/manifest";

const APP_DIR = resolve(__dirname, "../../../../src/app");

describe("apps/web favicon + manifest wiring", () => {
  it("ships a non-empty icon.svg under app/ (Next.js auto-wires favicon)", () => {
    const iconPath = resolve(APP_DIR, "icon.svg");
    const stats = statSync(iconPath);
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);
    expect(stats.size).toBeLessThan(4096);
    const contents = readFileSync(iconPath, "utf8");
    expect(contents).toMatch(/<svg[\s>]/);
    expect(contents).toMatch(/<\/svg>/);
  });

  it("exports a manifest with at least one icon entry referencing the SVG", () => {
    const m = manifest();
    expect(m.name).toBe("OpenWhispr");
    expect(m.short_name).toBe("OpenWhispr");
    expect(m.display).toBe("standalone");
    expect(Array.isArray(m.icons)).toBe(true);
    expect(m.icons?.length ?? 0).toBeGreaterThanOrEqual(1);
    const svgEntry = m.icons?.find((i) => i.type === "image/svg+xml");
    expect(svgEntry).toBeDefined();
    expect(svgEntry?.src).toMatch(/icon\.svg$/);
    expect(m.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
