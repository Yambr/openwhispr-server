// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-01 / Task 1 — validateJitBoot boot validator tests.
//
// Mirrors the validateLitellmBoot pattern in litellm.test.ts. The boot
// validator is the SINGLE JSON.parse site for OIDC_TENANT_MAPPING /
// OIDC_ROLE_MAPPING and lives in config/ alongside validateLitellmBoot /
// validateEncryptionBoot (architectural co-location of the loud-fail gate,
// NOT a LOCKER-01 mandate — LOCKER-01 only restricts NODE_ENV branching).
//
// The guard MUST:
//   - valid mapping JSON                  → return parsed objects
//   - malformed OIDC_TENANT_MAPPING JSON  → onFail (default exit 78), names var
//   - malformed OIDC_ROLE_MAPPING JSON    → onFail, names var
//   - role value outside admin|member|viewer → onFail (zod)
//   - absent mapping vars                 → {tenantMapping:undefined, roleMapping:undefined}
//   - onFail is injectable (unit tests pass a throwing stub, not process.exit)

import { describe, expect, it, vi } from "vitest";
import { validateJitBoot } from "../../../src/config/oidc-jit-boot.js";

type Env = NodeJS.ProcessEnv;

function envOf(partial: Record<string, string | undefined>): Env {
  return partial as unknown as Env;
}

function callValidate(env: Env): {
  result?: ReturnType<typeof validateJitBoot>;
  failure?: string;
} {
  let failure: string | undefined;
  const onFail = vi.fn((message: string): never => {
    failure = message;
    throw new Error("__refuse__");
  }) as unknown as (message: string) => never;
  try {
    const result = validateJitBoot(env, onFail);
    return { result };
  } catch {
    return { failure };
  }
}

describe("validateJitBoot", () => {
  it("returns parsed tenantMapping + roleMapping on valid JSON", () => {
    const { result } = callValidate(
      envOf({
        OIDC_TENANT_MAPPING: '{"acme.example":"acme"}',
        OIDC_ROLE_MAPPING: '{"openwhispr-engineering":"member","openwhispr-admin":"admin"}',
      }),
    );
    expect(result).toEqual({
      tenantMapping: { "acme.example": "acme" },
      roleMapping: { "openwhispr-engineering": "member", "openwhispr-admin": "admin" },
    });
  });

  it("returns {tenantMapping:undefined, roleMapping:undefined} when both mapping vars absent", () => {
    const { result } = callValidate(envOf({}));
    expect(result).toEqual({ tenantMapping: undefined, roleMapping: undefined });
  });

  it("REFUSES on malformed OIDC_TENANT_MAPPING JSON and names the var", () => {
    const { result, failure } = callValidate(envOf({ OIDC_TENANT_MAPPING: "{not valid json" }));
    expect(result).toBeUndefined();
    expect(failure).toContain("OIDC_TENANT_MAPPING");
  });

  it("REFUSES on malformed OIDC_ROLE_MAPPING JSON and names the var", () => {
    const { result, failure } = callValidate(envOf({ OIDC_ROLE_MAPPING: "[broken" }));
    expect(result).toBeUndefined();
    expect(failure).toContain("OIDC_ROLE_MAPPING");
  });

  it("REFUSES when a role value is outside admin|member|viewer (zod)", () => {
    const { result, failure } = callValidate(
      envOf({ OIDC_ROLE_MAPPING: '{"some-group":"superuser"}' }),
    );
    expect(result).toBeUndefined();
    expect(failure).toContain("OIDC_ROLE_MAPPING");
  });

  it("REFUSES when OIDC_TENANT_MAPPING is not a string→string object (zod)", () => {
    const { result, failure } = callValidate(envOf({ OIDC_TENANT_MAPPING: '{"acme.example":42}' }));
    expect(result).toBeUndefined();
    expect(failure).toContain("OIDC_TENANT_MAPPING");
  });

  it("accepts admin, member, and viewer role values", () => {
    const { result } = callValidate(
      envOf({
        OIDC_ROLE_MAPPING: '{"a":"admin","m":"member","v":"viewer"}',
      }),
    );
    expect(result?.roleMapping).toEqual({ a: "admin", m: "member", v: "viewer" });
  });

  it("defaults onFail to a process.exit(78)-shaped fail when omitted (uses process.env)", () => {
    // We do not actually trip the default (would exit the test runner); we
    // assert the signature accepts being called with just env on valid input.
    const result = validateJitBoot(envOf({ OIDC_TENANT_MAPPING: '{"acme.example":"acme"}' }));
    expect(result.tenantMapping).toEqual({ "acme.example": "acme" });
  });
});
