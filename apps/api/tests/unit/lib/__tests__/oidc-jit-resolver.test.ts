// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-01 / Task 2 — resolveJitDecision pure resolver tests.
//
// resolveJitDecision is a PURE function (no env read, no DB, no Better Auth):
// (claims, cfg, existing?) → JitDecision discriminated union. D-69-1: the SAME
// function is reused by the web mapProfileToUser seam AND the desktop bearer-mint
// projection in later waves, so it must be 100% branch-covered here.
//
// Cases (SPEC-ldap-keycloak.md:78-104 worked example + :137-145 failure modes):
//   acme example → {ok:true, tenantId:"acme", role:"member"}
//   mode 1 forbidden_missing_tenant_claim   mode 2 forbidden_unknown_tenant
//   mode 3 forbidden_no_role_mapping        mode 4 tie-break via OIDC_ROLE_PRIORITY
//   mode 5 revocation downgrade (200, downgraded)   mode 6 forbidden_tenant_mismatch
//   mode 7 invalid_oidc_profile (defensive coercion)

import { describe, expect, it } from "vitest";
import type { JitConfig } from "../../../../src/lib/oidc-jit-config.js";
import { resolveJitDecision } from "../../../../src/lib/oidc-jit-resolver.js";

const ACME_CFG: JitConfig = {
  tenantClaim: "email_domain",
  tenantMapping: { "acme.example": "acme" },
  groupClaim: "groups",
  roleMapping: { "openwhispr-admin": "admin", "openwhispr-engineering": "member" },
  rolePriority: ["admin", "member", "viewer"],
  defaultRole: null,
  revocationMode: "downgrade_to_default",
};

function cfg(overrides: Partial<JitConfig> = {}): JitConfig {
  return { ...ACME_CFG, ...overrides };
}

describe("resolveJitDecision — worked acme example", () => {
  it("resolves alice@acme.example + engineering group to tenant acme, role member", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["openwhispr-engineering", "okta-everyone"] },
      ACME_CFG,
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "member" });
  });
});

describe("resolveJitDecision — tenant resolution modes", () => {
  it("email_domain mode derives the tenant key from the email domain", () => {
    const decision = resolveJitDecision(
      { email: "bob@acme.example", groups: ["openwhispr-engineering"] },
      ACME_CFG,
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "member" });
  });

  it("named-claim mode reads claims[tenantClaim] then maps through tenantMapping", () => {
    const decision = resolveJitDecision(
      { tenant: "acme-key", groups: ["eng"] },
      cfg({
        tenantClaim: "tenant",
        tenantMapping: { "acme-key": "acme" },
        roleMapping: { eng: "member" },
      }),
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "member" });
  });
});

describe("resolveJitDecision — rejection codes", () => {
  it("mode 1: email_domain mode but no email → forbidden_missing_tenant_claim", () => {
    const decision = resolveJitDecision({ groups: ["openwhispr-engineering"] }, ACME_CFG);
    expect(decision).toEqual({ ok: false, code: "forbidden_missing_tenant_claim" });
  });

  it("mode 1: named-claim mode but claim missing → forbidden_missing_tenant_claim", () => {
    const decision = resolveJitDecision(
      { groups: ["eng"] },
      cfg({ tenantClaim: "tenant", tenantMapping: { x: "acme" }, roleMapping: { eng: "member" } }),
    );
    expect(decision).toEqual({ ok: false, code: "forbidden_missing_tenant_claim" });
  });

  it("mode 2: tenant value not in tenantMapping → forbidden_unknown_tenant", () => {
    const decision = resolveJitDecision(
      { email: "carol@globex.example", groups: ["openwhispr-engineering"] },
      ACME_CFG,
    );
    expect(decision).toEqual({ ok: false, code: "forbidden_unknown_tenant" });
  });

  it("mode 2: named-claim value not in tenantMapping → forbidden_unknown_tenant", () => {
    const decision = resolveJitDecision(
      { tenant: "unknown", groups: ["eng"] },
      cfg({
        tenantClaim: "tenant",
        tenantMapping: { "acme-key": "acme" },
        roleMapping: { eng: "member" },
      }),
    );
    expect(decision).toEqual({ ok: false, code: "forbidden_unknown_tenant" });
  });

  it("mode 3: no group matches AND defaultRole===null → forbidden_no_role_mapping", () => {
    const decision = resolveJitDecision(
      { email: "dan@acme.example", groups: ["okta-everyone"] },
      ACME_CFG,
    );
    expect(decision).toEqual({ ok: false, code: "forbidden_no_role_mapping" });
  });

  it("mode 3: no groups claim at all AND defaultRole===null → forbidden_no_role_mapping", () => {
    const decision = resolveJitDecision({ email: "eve@acme.example" }, ACME_CFG);
    expect(decision).toEqual({ ok: false, code: "forbidden_no_role_mapping" });
  });

  it("mode 6: returning user, tenant claim changed → forbidden_tenant_mismatch", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["openwhispr-engineering"] },
      ACME_CFG,
      { tenantId: "globex", role: "member" },
    );
    expect(decision).toEqual({ ok: false, code: "forbidden_tenant_mismatch" });
  });

  it("mode 7: groups claim is a number (structurally broken) → invalid_oidc_profile", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: 42 as unknown as string[] },
      ACME_CFG,
    );
    expect(decision).toEqual({ ok: false, code: "invalid_oidc_profile" });
  });

  it("mode 7: claims is null (not an object) → invalid_oidc_profile", () => {
    const decision = resolveJitDecision(null as unknown as Record<string, unknown>, ACME_CFG);
    expect(decision).toEqual({ ok: false, code: "invalid_oidc_profile" });
  });

  it("mode 7: email is not a string in email_domain mode → invalid_oidc_profile", () => {
    const decision = resolveJitDecision(
      { email: 123 as unknown as string, groups: ["openwhispr-engineering"] },
      ACME_CFG,
    );
    expect(decision).toEqual({ ok: false, code: "invalid_oidc_profile" });
  });

  it("mode 7: email_domain mode with an email lacking @ → invalid_oidc_profile", () => {
    const decision = resolveJitDecision(
      { email: "no-at-sign", groups: ["openwhispr-engineering"] },
      ACME_CFG,
    );
    expect(decision).toEqual({ ok: false, code: "invalid_oidc_profile" });
  });

  it("mode 7: named-claim tenant value is not a string → invalid_oidc_profile", () => {
    const decision = resolveJitDecision(
      { tenant: 999 as unknown as string, groups: ["eng"] },
      cfg({ tenantClaim: "tenant", tenantMapping: { x: "acme" }, roleMapping: { eng: "member" } }),
    );
    expect(decision).toEqual({ ok: false, code: "invalid_oidc_profile" });
  });
});

describe("resolveJitDecision — role tie-break (mode 4)", () => {
  it("picks the highest-priority role when groups map to both admin and member", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["openwhispr-admin", "openwhispr-engineering"] },
      ACME_CFG,
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "admin" });
  });

  it("honors a custom OIDC_ROLE_PRIORITY ordering", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["g-admin", "g-viewer"] },
      cfg({
        roleMapping: { "g-admin": "admin", "g-viewer": "viewer" },
        rolePriority: ["viewer", "member", "admin"],
      }),
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "viewer" });
  });

  it("ranks a matched role absent from rolePriority below every listed role", () => {
    // viewer is NOT in rolePriority → ranks lowest; member (listed) wins.
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["g-member", "g-viewer"] },
      cfg({
        roleMapping: { "g-member": "member", "g-viewer": "viewer" },
        rolePriority: ["admin", "member"],
      }),
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "member" });
  });
});

describe("resolveJitDecision — default role (no group match, defaultRole non-null)", () => {
  it("assigns defaultRole when no group maps and defaultRole is set", () => {
    const decision = resolveJitDecision(
      { email: "frank@acme.example", groups: ["okta-everyone"] },
      cfg({ defaultRole: "member" }),
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "member" });
  });
});

describe("resolveJitDecision — invalid OIDC_DEFAULT_ROLE", () => {
  it("rejects with forbidden_no_role_mapping when defaultRole is outside admin|member|viewer", () => {
    const decision = resolveJitDecision(
      { email: "frank@acme.example", groups: ["okta-everyone"] },
      cfg({ defaultRole: "superuser" }),
    );
    expect(decision).toEqual({ ok: false, code: "forbidden_no_role_mapping" });
  });
});

describe("resolveJitDecision — revocation downgrade (mode 5)", () => {
  it("downgrades a returning admin to defaultRole when admin group is revoked", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["okta-everyone"] },
      cfg({ defaultRole: "viewer", revocationMode: "downgrade_to_default" }),
      { tenantId: "acme", role: "admin" },
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "viewer", downgraded: true });
  });

  it("does not set downgraded when the resolved role still matches the existing role", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["openwhispr-engineering"] },
      ACME_CFG,
      { tenantId: "acme", role: "member" },
    );
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "member" });
  });

  it("does not downgrade when existing role was not admin (member kept on regular re-sync)", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["openwhispr-engineering"] },
      cfg({ defaultRole: "viewer" }),
      { tenantId: "acme", role: "viewer" },
    );
    // resolves to member from the engineering group; not a downgrade of admin
    expect(decision).toEqual({ ok: true, tenantId: "acme", role: "member" });
  });
});

describe("resolveJitDecision — missing tenantMapping is treated as unknown tenant", () => {
  it("rejects with forbidden_unknown_tenant when tenantMapping is undefined", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["openwhispr-engineering"] },
      cfg({ tenantMapping: undefined }),
    );
    expect(decision).toEqual({ ok: false, code: "forbidden_unknown_tenant" });
  });
});

describe("resolveJitDecision — roleMapping absent", () => {
  it("rejects with forbidden_no_role_mapping when roleMapping undefined and defaultRole null", () => {
    const decision = resolveJitDecision(
      { email: "alice@acme.example", groups: ["openwhispr-engineering"] },
      cfg({ roleMapping: undefined }),
    );
    expect(decision).toEqual({ ok: false, code: "forbidden_no_role_mapping" });
  });
});
