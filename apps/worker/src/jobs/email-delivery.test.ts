// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-10 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/worker/src/jobs/email-delivery.ts
//
// Behaviors locked by D-W5 (queue inventory) + D-A7 (payload conventions):
//   - Tenant context (withTenantContext wrap)
//   - Zod schema: {tenant_id, to, template_id, locale, variables, request_id}
//   - No PII (recipient email, variables) appears in logs (pino redact at D-T4 covers it)
//   - Idempotent on request_id re-run
import { describe, it } from "vitest";

const NOT_YET = "not yet implemented — Plan 06-10 implements email-delivery job (D-W5)";

describe("email-delivery job (D-W5)", () => {
  it("is wrapped in withTenantContext (Tenant mode)", () => {
    throw new Error(NOT_YET);
  });

  it("rejects job.data missing tenant_id", () => {
    throw new Error(NOT_YET);
  });

  it("validates Zod schema {tenant_id, to, template_id, locale, variables, request_id}", () => {
    throw new Error(NOT_YET);
  });

  it("does NOT log recipient email in plaintext (pino redact)", () => {
    throw new Error(NOT_YET);
  });

  it("does NOT log template variables in plaintext (pino redact)", () => {
    throw new Error(NOT_YET);
  });

  it("is idempotent on request_id re-run (re-enqueue is a no-op)", () => {
    throw new Error(NOT_YET);
  });
});
