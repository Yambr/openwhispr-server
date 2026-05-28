// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-01 / Task 1 — readJitConfig loader tests.
//
// Pure function on `env`; no I/O, no DB. Mirrors the oidc-providers.test.ts
// env-permutation idiom (tests inject a stub env, never mutate the global).
//
// JIT silently DISABLES when OIDC_TENANT_CLAIM is unset (returns null),
// mirroring oidc-providers' `if (!oidcConfigured(env)) return []` early-out.
// The JSON.parse of the mapping vars is delegated to validateJitBoot (config/
// boot validator) — readJitConfig receives ALREADY-PARSED objects.

import { describe, expect, it } from "vitest";
import { readJitConfig } from "../../../../src/lib/oidc-jit-config.js";

type Env = NodeJS.ProcessEnv;

function envOf(partial: Record<string, string | undefined>): Env {
  return partial as unknown as Env;
}

describe("readJitConfig — JIT disable gate", () => {
  it("returns null when OIDC_TENANT_CLAIM is unset (JIT disabled)", () => {
    expect(readJitConfig(envOf({}))).toBeNull();
  });

  it("returns null when OIDC_TENANT_CLAIM is empty string", () => {
    expect(readJitConfig(envOf({ OIDC_TENANT_CLAIM: "" }))).toBeNull();
  });
});

describe("readJitConfig — email_domain mode + defaults", () => {
  it("returns a JitConfig with documented defaults when only OIDC_TENANT_CLAIM=email_domain set", () => {
    const cfg = readJitConfig(envOf({ OIDC_TENANT_CLAIM: "email_domain" }));
    expect(cfg).not.toBeNull();
    expect(cfg).toEqual({
      tenantClaim: "email_domain",
      tenantMapping: undefined,
      groupClaim: "groups",
      roleMapping: undefined,
      rolePriority: ["admin", "member", "viewer"],
      defaultRole: null,
      revocationMode: "downgrade_to_default",
    });
  });
});

describe("readJitConfig — full 7-var config", () => {
  it("reflects every var on the JitConfig (worked acme example env)", () => {
    const cfg = readJitConfig(
      envOf({
        OIDC_TENANT_CLAIM: "email_domain",
        OIDC_TENANT_MAPPING: '{"acme.example":"acme"}',
        OIDC_GROUP_CLAIM: "groups",
        OIDC_ROLE_MAPPING: '{"openwhispr-admin":"admin","openwhispr-engineering":"member"}',
        OIDC_ROLE_PRIORITY: "admin > member > viewer",
        OIDC_DEFAULT_ROLE: "null",
        OIDC_REVOCATION_MODE: "downgrade_to_default",
      }),
    );
    expect(cfg).toEqual({
      tenantClaim: "email_domain",
      tenantMapping: { "acme.example": "acme" },
      groupClaim: "groups",
      roleMapping: { "openwhispr-admin": "admin", "openwhispr-engineering": "member" },
      rolePriority: ["admin", "member", "viewer"],
      defaultRole: null,
      revocationMode: "downgrade_to_default",
    });
  });

  it("reads a named tenant claim + custom group claim", () => {
    const cfg = readJitConfig(
      envOf({
        OIDC_TENANT_CLAIM: "tenant",
        OIDC_TENANT_MAPPING: '{"acme":"acme"}',
        OIDC_GROUP_CLAIM: "memberOf",
      }),
    );
    expect(cfg?.tenantClaim).toBe("tenant");
    expect(cfg?.groupClaim).toBe("memberOf");
    expect(cfg?.tenantMapping).toEqual({ acme: "acme" });
  });
});

describe("readJitConfig — OIDC_ROLE_PRIORITY parsing", () => {
  it("parses 'admin > member > viewer' into an ordered array", () => {
    const cfg = readJitConfig(
      envOf({ OIDC_TENANT_CLAIM: "email_domain", OIDC_ROLE_PRIORITY: "admin > member > viewer" }),
    );
    expect(cfg?.rolePriority).toEqual(["admin", "member", "viewer"]);
  });

  it("parses a custom priority order tolerant of irregular whitespace", () => {
    const cfg = readJitConfig(
      envOf({ OIDC_TENANT_CLAIM: "email_domain", OIDC_ROLE_PRIORITY: "viewer>admin>member" }),
    );
    expect(cfg?.rolePriority).toEqual(["viewer", "admin", "member"]);
  });
});

describe("readJitConfig — OIDC_DEFAULT_ROLE", () => {
  it("maps the literal string 'null' to null", () => {
    const cfg = readJitConfig(
      envOf({ OIDC_TENANT_CLAIM: "email_domain", OIDC_DEFAULT_ROLE: "null" }),
    );
    expect(cfg?.defaultRole).toBeNull();
  });

  it("keeps a concrete default role string", () => {
    const cfg = readJitConfig(
      envOf({ OIDC_TENANT_CLAIM: "email_domain", OIDC_DEFAULT_ROLE: "viewer" }),
    );
    expect(cfg?.defaultRole).toBe("viewer");
  });

  it("defaults to null when OIDC_DEFAULT_ROLE is unset", () => {
    const cfg = readJitConfig(envOf({ OIDC_TENANT_CLAIM: "email_domain" }));
    expect(cfg?.defaultRole).toBeNull();
  });
});

describe("readJitConfig — OIDC_REVOCATION_MODE", () => {
  it("defaults to downgrade_to_default", () => {
    const cfg = readJitConfig(envOf({ OIDC_TENANT_CLAIM: "email_domain" }));
    expect(cfg?.revocationMode).toBe("downgrade_to_default");
  });

  it("honors an explicit revocation mode value", () => {
    const cfg = readJitConfig(
      envOf({ OIDC_TENANT_CLAIM: "email_domain", OIDC_REVOCATION_MODE: "keep_role" }),
    );
    expect(cfg?.revocationMode).toBe("keep_role");
  });
});

describe("readJitConfig — mapping vars arrive pre-parsed (delegated to validateJitBoot)", () => {
  it("exposes tenantMapping as a parsed object, not a raw JSON string", () => {
    const cfg = readJitConfig(
      envOf({ OIDC_TENANT_CLAIM: "email_domain", OIDC_TENANT_MAPPING: '{"acme.example":"acme"}' }),
    );
    expect(typeof cfg?.tenantMapping).toBe("object");
    expect(cfg?.tenantMapping).toEqual({ "acme.example": "acme" });
  });

  it("exposes roleMapping as a parsed object, not a raw JSON string", () => {
    const cfg = readJitConfig(
      envOf({ OIDC_TENANT_CLAIM: "email_domain", OIDC_ROLE_MAPPING: '{"g":"member"}' }),
    );
    expect(typeof cfg?.roleMapping).toBe("object");
    expect(cfg?.roleMapping).toEqual({ g: "member" });
  });
});
