// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260524-u00 / Task A1 — RED then GREEN.
//
// `isK8sDeploymentMode` is the canonical predicate used by the BYOK guard
// itself AND (per fix #6 / Task A2) by `@openwhispr/email` to short-circuit
// SMTP_HOST loud-fail in k8s deployment mode where operators supply secrets
// via Kubernetes Secrets instead of the compose-overlay BYOK matrix.
//
// Discipline:
//   * Pure predicate over `env` — no logger, no side effects.
//   * Matches the production-code contract: case-insensitive on the value
//     ("k8s" === "K8S"), whitespace-tolerant (normEnv trim), only `k8s`
//     resolves true (every other non-empty value is false).
//   * These tests pin the export contract: if a refactor removes the
//     `export` keyword or renames the helper, Task A2's email package
//     stops compiling. The regression guard is therefore valuable beyond
//     the trivial-looking branches it covers.

import { describe, expect, it } from "vitest";
import { isK8sDeploymentMode } from "../../../src/index.js";

describe("isK8sDeploymentMode (Quick-task 260524-u00 / Task A1)", () => {
  it("returns true for the literal lowercase value 'k8s'", () => {
    expect(isK8sDeploymentMode({ OPENWHISPR_DEPLOYMENT_MODE: "k8s" })).toBe(true);
  });

  it("returns true for the uppercase value 'K8S' (case-insensitive)", () => {
    expect(isK8sDeploymentMode({ OPENWHISPR_DEPLOYMENT_MODE: "K8S" })).toBe(true);
  });

  it("returns true for value with surrounding whitespace ' k8s ' (normEnv trim)", () => {
    expect(isK8sDeploymentMode({ OPENWHISPR_DEPLOYMENT_MODE: " k8s " })).toBe(true);
  });

  it("returns false when OPENWHISPR_DEPLOYMENT_MODE is unset (default compose mode)", () => {
    expect(isK8sDeploymentMode({})).toBe(false);
  });

  it("returns false for the explicit compose-mode value 'compose'", () => {
    expect(isK8sDeploymentMode({ OPENWHISPR_DEPLOYMENT_MODE: "compose" })).toBe(false);
  });

  it("returns false for empty / whitespace-only value (normEnv -> undefined)", () => {
    expect(isK8sDeploymentMode({ OPENWHISPR_DEPLOYMENT_MODE: "" })).toBe(false);
    expect(isK8sDeploymentMode({ OPENWHISPR_DEPLOYMENT_MODE: "   " })).toBe(false);
  });
});
