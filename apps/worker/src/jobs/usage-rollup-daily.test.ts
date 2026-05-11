// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-10 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/worker/src/jobs/usage-rollup-daily.ts
//
// Behaviors locked by D-W5 (queue inventory):
//   - System dispatcher reads tenants list (no per-tenant context)
//   - Per-tenant child enqueue with {tenant_id, date}
//   - Cron `5 0 * * *` UTC
//   - Children run under withTenantContext
import { describe, it } from "vitest";

const NOT_YET = "not yet implemented — Plan 06-10 implements usage-rollup-daily job (D-W5)";

describe("usage-rollup-daily dispatcher (D-W5 — System mode)", () => {
  it("is wrapped in withSystemContext (no app.tenant_id GUC)", () => {
    throw new Error(NOT_YET);
  });

  it("reads tenants list using postgres_owner role", () => {
    throw new Error(NOT_YET);
  });

  it("enqueues one child job per tenant with {tenant_id, date}", () => {
    throw new Error(NOT_YET);
  });

  it("is scheduled via upsertJobScheduler with cron '5 0 * * *' UTC", () => {
    throw new Error(NOT_YET);
  });
});

describe("usage-rollup-daily child (Tenant mode)", () => {
  it("is wrapped in withTenantContext", () => {
    throw new Error(NOT_YET);
  });

  it("Zod schema is {tenant_id, date}", () => {
    throw new Error(NOT_YET);
  });

  it("rolls up usage_ledger rows for the (tenant_id, date) bucket idempotently", () => {
    throw new Error(NOT_YET);
  });
});
