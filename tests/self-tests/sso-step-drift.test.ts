// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 47 / Plan 47-01 / L6 — SSO step-string drift self-test.
// Phase 69 / Plan 69-06 — flipped to real-step mode.
//
// Originally closed L6 from `.planning/qa-audit/2026-05-16-test-layering.md`
// while `tests/e2e-cjm/steps/sso.steps.ts` was placeholder-only. Phase 69 (v3)
// shipped the REAL JIT step implementations (live-Keycloak undici + the desktop
// bearer deep-link), so the old "step file is still placeholder-only" guard
// (which asserted no `undici` / no `fetch(` appeared) has INVERTED and is
// removed. What remains is the genuinely durable drift sentinel: every
// Given/When/Then line in the feature MUST have an exactly-matching step
// binding (modulo the cucumber-expression `{string}`/`{int}` normalization and
// the And/But keyword folding). A renamed step on either side trips vitest at
// lint speed instead of surfacing only at the next live e2e run.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

function readSteps(): string {
  return readFileSync(resolve(REPO_ROOT, "tests/e2e-cjm/steps/sso.steps.ts"), "utf8");
}

function readFeature(): string {
  return readFileSync(
    resolve(REPO_ROOT, "tests/e2e-cjm/features/sso/keycloak-oidc.feature"),
    "utf8",
  );
}

/**
 * Extract the literal step-text strings registered by the step file via
 * `Given("…", …)`, `When("…", …)`, `Then("…", …)`. Cucumber expression
 * params `{string}` / `{int}` are preserved as-is.
 */
// biome-ignore lint/suspicious/noExportsInTest: helper consumed by sibling tests via path import
export function extractStepBindings(source: string): string[] {
  const out: string[] = [];
  const re = /\b(?:Given|When|Then)\(\s*(?:`([^`]+)`|"((?:[^"\\]|\\.)+)")/g;
  for (const m of source.matchAll(re)) {
    const tpl = m[1];
    const dbl = m[2];
    if (tpl !== undefined) out.push(tpl);
    else if (dbl !== undefined) out.push(dbl.replace(/\\"/g, '"'));
  }
  return out;
}

/**
 * Extract the Gherkin step lines from a `.feature` body. Returns just
 * the step text after the keyword, with any quoted literals normalized
 * to `{string}` and bare numeric literals normalized to `{int}` — so a
 * step file binding `"name {string}"` matches a feature line
 * `name "Alice"`.
 */
// biome-ignore lint/suspicious/noExportsInTest: helper consumed by sibling tests via path import
export function extractFeatureSteps(source: string): string[] {
  const out: string[] = [];
  for (const raw of source.split("\n")) {
    const m = /^\s*(Given|When|Then|And|But)\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const text = m[2].replace(/"[^"]*"/g, "{string}").replace(/\b\d+\b/g, "{int}");
    out.push(text);
  }
  return out;
}

describe("SSO step-string drift (Phase 47 / L6 → Phase 69 real-step mode)", () => {
  it("step file ships at least one binding per @cjm-sso scenario", () => {
    const bindings = extractStepBindings(readSteps());
    // 7 scenarios (1.1/1.2/1.3/1.4/1.5a/1.5b/1.6); each declares ≥ 1 Given +
    // When + Then. Some bindings are shared (e.g. the audit-log Then), so the
    // unique-binding count is slightly below 3×7 — assert a conservative floor.
    expect(bindings.length).toBeGreaterThanOrEqual(12);
  });

  it("EVERY Given/When/Then step in the feature has an exact matching binding", () => {
    // Real-step mode: the steps are implemented, so strict equality holds
    // (modulo {string}/{int} normalization + And/But folding). A renamed step
    // on either the feature or the step file trips this immediately.
    const bindings = new Set(extractStepBindings(readSteps()));
    const featureSteps = extractFeatureSteps(readFeature());
    const missing = featureSteps.filter((step) => !bindings.has(step));
    expect(missing, `feature steps with no matching binding: ${missing.join(" | ")}`).toEqual([]);
  });

  it("the step file is a REAL implementation (drives undici against the live IdP)", () => {
    // The inverse of the old placeholder-only guard: the real steps MUST use
    // undici and MUST NOT carry the Phase-18 PENDING throw.
    const src = readSteps();
    expect(src).toMatch(/\bundici\b/);
    expect(src).not.toMatch(/ships in Phase 19/);
  });
});
