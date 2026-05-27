// SPDX-License-Identifier: FSL-1.1-ALv2
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Quick 260527-pj6 — explicit project name pins the per-workspace
    // evidence-fragment filename. See tools/test-evidence-projects-manifest.json.
    name: "test-probe",
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/probe.ts"],
      all: false,
    },
  },
});
