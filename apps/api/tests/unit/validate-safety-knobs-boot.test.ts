// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track F — api-core:CR-01 regression.
//
// validateSafetyKnobsBoot() refuses to start (exit 78 EX_CONFIG, matching
// validateEncryptionBoot / validateAuthBoot / validateIngressBoot) when ANY
// of the production safety knobs is set to a truthy value while
// NODE_ENV=production. The knobs disable anti-abuse / email-verification /
// session-cookie-cache controls — all
// legitimate dev/test/load-test affordances but dangerous in production.
// Pre-fix the knobs only WARN-logged and continued.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateSafetyKnobsBoot } from "../../src/config/safety-knobs.js";

const KNOBS = [
  "OPENWHISPR_DISABLE_RATE_LIMIT",
  "OPENWHISPR_DISABLE_EMAIL_VERIFICATION",
  "OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE",
] as const;

describe("api-core:CR-01 — production safety knobs exit 78 when set in production", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      ...Object.fromEntries(KNOBS.map((k) => [k, process.env[k]])),
    };
    for (const k of KNOBS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it.each([
    ["OPENWHISPR_DISABLE_RATE_LIMIT", "1"],
    ["OPENWHISPR_DISABLE_RATE_LIMIT", "true"],
    ["OPENWHISPR_DISABLE_EMAIL_VERIFICATION", "1"],
    ["OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE", "1"],
  ])("exits 78 when %s=%s and NODE_ENV=production", (knob, val) => {
    process.env.NODE_ENV = "production";
    process.env[knob] = val;
    expect(() => validateSafetyKnobsBoot()).toThrow(/EX_CONFIG.*production/);
  });

  it("names the offending knob in the failure message", () => {
    process.env.NODE_ENV = "production";
    process.env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION = "1";
    expect(() => validateSafetyKnobsBoot()).toThrow(/OPENWHISPR_DISABLE_EMAIL_VERIFICATION/);
  });

  it("returns OK when knob set and NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "1";
    expect(validateSafetyKnobsBoot()).toEqual({ ok: true });
  });

  it("returns OK when knob unset and NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
    expect(validateSafetyKnobsBoot()).toEqual({ ok: true });
  });
});
