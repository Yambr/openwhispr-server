// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 69 / Plan 69-02 / Task 2 — no-PII zod payload schemas for the 3
// SSO just-in-time provisioning audit actions (D-69-2).
//
// The shapes (copied verbatim from 69-DECISIONS.md §D-69-2):
//   sso.jit.user.created -> { tenant_id, role, tenant_claim_mode,
//                             matched_group_hash? }
//   sso.jit.role.updated -> { tenant_id, before, after, reason }
//   sso.jit.rejected     -> { tenant_id, code }
//
// FORBIDDEN in any payload: email, name, sub, raw groups, email_domain
// literal. Each schema is `.strict()` so PII / unknown keys are REJECTED
// (not silently stripped), and recordAudit's FORBIDDEN_AUDIT_KEYS sweep is
// the runtime defence-in-depth.
//
// Pure unit test — no DB. The exhaustive `satisfies Record<AuditAction>`
// union is enforced at compile time (tsc --noEmit in the verify step);
// here we assert the runtime parse/reject behaviour of the 3 schemas.

import { describe, expect, it } from "vitest";
import { auditPayloadSchemas } from "../../../src/lib/audit.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64); // sha256 hex (64 chars)

describe("sso.jit.user.created payload schema (no-PII, D-69-2)", () => {
  const schema = auditPayloadSchemas["sso.jit.user.created"];

  it("accepts the canonical shape (email_domain mode, no group hash)", () => {
    expect(() =>
      schema.parse({ tenant_id: TENANT, role: "member", tenant_claim_mode: "email_domain" }),
    ).not.toThrow();
  });

  it("accepts named_claim mode with an optional matched_group_hash", () => {
    expect(() =>
      schema.parse({
        tenant_id: TENANT,
        role: "admin",
        tenant_claim_mode: "named_claim",
        matched_group_hash: HASH,
      }),
    ).not.toThrow();
  });

  it("rejects an unknown role", () => {
    expect(() =>
      schema.parse({ tenant_id: TENANT, role: "superuser", tenant_claim_mode: "email_domain" }),
    ).toThrow();
  });

  it("rejects an unknown tenant_claim_mode", () => {
    expect(() =>
      schema.parse({ tenant_id: TENANT, role: "member", tenant_claim_mode: "ldap_dn" }),
    ).toThrow();
  });

  it("rejects a matched_group_hash that is not 64-hex", () => {
    expect(() =>
      schema.parse({
        tenant_id: TENANT,
        role: "member",
        tenant_claim_mode: "named_claim",
        matched_group_hash: "tooshort",
      }),
    ).toThrow();
  });

  it.each([
    "email",
    "name",
    "sub",
    "groups",
    "email_domain",
  ])("rejects the PII / forbidden key %s (.strict)", (piiKey) => {
    expect(() =>
      schema.parse({
        tenant_id: TENANT,
        role: "member",
        tenant_claim_mode: "email_domain",
        [piiKey]: "leak",
      }),
    ).toThrow();
  });
});

describe("sso.jit.role.updated payload schema (no-PII, D-69-2)", () => {
  const schema = auditPayloadSchemas["sso.jit.role.updated"];

  it("accepts the canonical shape", () => {
    expect(() =>
      schema.parse({
        tenant_id: TENANT,
        before: "admin",
        after: "viewer",
        reason: "revocation_downgrade",
      }),
    ).not.toThrow();
  });

  it("accepts reason=group_change", () => {
    expect(() =>
      schema.parse({
        tenant_id: TENANT,
        before: "viewer",
        after: "member",
        reason: "group_change",
      }),
    ).not.toThrow();
  });

  it("rejects an unknown reason", () => {
    expect(() =>
      schema.parse({ tenant_id: TENANT, before: "admin", after: "viewer", reason: "whim" }),
    ).toThrow();
  });

  it("rejects an unknown before/after role", () => {
    expect(() =>
      schema.parse({
        tenant_id: TENANT,
        before: "root",
        after: "viewer",
        reason: "group_change",
      }),
    ).toThrow();
  });

  it.each([
    "email",
    "name",
    "sub",
    "groups",
  ])("rejects the PII / forbidden key %s (.strict)", (piiKey) => {
    expect(() =>
      schema.parse({
        tenant_id: TENANT,
        before: "admin",
        after: "viewer",
        reason: "group_change",
        [piiKey]: "leak",
      }),
    ).toThrow();
  });
});

describe("sso.jit.rejected payload schema (no-PII, D-69-2)", () => {
  const schema = auditPayloadSchemas["sso.jit.rejected"];

  const CODES = [
    "forbidden_missing_tenant_claim",
    "forbidden_unknown_tenant",
    "forbidden_no_role_mapping",
    "forbidden_tenant_mismatch",
    "invalid_oidc_profile",
  ] as const;

  it.each(CODES)("accepts rejection code %s", (code) => {
    expect(() => schema.parse({ tenant_id: TENANT, code })).not.toThrow();
  });

  it("rejects an unknown rejection code", () => {
    expect(() => schema.parse({ tenant_id: TENANT, code: "forbidden_mystery" })).toThrow();
  });

  it.each([
    "email",
    "name",
    "sub",
    "groups",
    "email_domain",
  ])("rejects the PII / forbidden key %s (.strict)", (piiKey) => {
    expect(() =>
      schema.parse({
        tenant_id: TENANT,
        code: "forbidden_tenant_mismatch",
        [piiKey]: "leak",
      }),
    ).toThrow();
  });
});

describe("auditPayloadSchemas exhaustiveness (21 actions)", () => {
  it("contains the 3 new sso.jit.* keys", () => {
    expect(auditPayloadSchemas).toHaveProperty("sso.jit.user.created");
    expect(auditPayloadSchemas).toHaveProperty("sso.jit.role.updated");
    expect(auditPayloadSchemas).toHaveProperty("sso.jit.rejected");
  });

  it("declares a schema for all 21 audit actions", () => {
    expect(Object.keys(auditPayloadSchemas)).toHaveLength(21);
  });
});
