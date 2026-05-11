// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-10 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/worker/src/jobs/virtual-key-rotation.ts
//
// Behaviors locked by D-W5 + D-A6:
//   - Tenant context (withTenantContext)
//   - Zod schema {tenant_id, user_id, reason: 'scheduled'|'compromised'|'manual'}
//   - Emits audit_log row action=key.issued (D-A6 #8)
//   - Emits audit_log row action=key.revoked (D-A6 #9)
//   - Cron `0 3 * * 0` weekly + on-demand from /api/admin/keys/rotate
import { describe, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-10 implements virtual-key-rotation job (D-W5 + D-A6 #8/#9)";

describe("virtual-key-rotation (D-W5)", () => {
  it("is wrapped in withTenantContext", () => {
    throw new Error(NOT_YET);
  });

  it("Zod schema is {tenant_id, user_id, reason: 'scheduled' | 'compromised' | 'manual'}", () => {
    throw new Error(NOT_YET);
  });

  it("rejects reason values outside the enum", () => {
    throw new Error(NOT_YET);
  });

  it("emits audit_log row with action=key.issued (D-A6 #8)", () => {
    throw new Error(NOT_YET);
  });

  it("emits audit_log row with action=key.revoked (D-A6 #9)", () => {
    throw new Error(NOT_YET);
  });

  it("payload.key_id is the LiteLLM key id, NEVER the secret (D-A7)", () => {
    throw new Error(NOT_YET);
  });

  it("is scheduled via upsertJobScheduler with cron '0 3 * * 0' weekly", () => {
    throw new Error(NOT_YET);
  });

  it("can be triggered on-demand from /api/admin/keys/rotate", () => {
    throw new Error(NOT_YET);
  });
});
