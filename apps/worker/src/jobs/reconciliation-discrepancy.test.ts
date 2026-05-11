// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-10 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/worker/src/jobs/reconciliation-discrepancy.ts
//
// Behaviors locked by D-R3:
//   - Child-of-parent enqueue from reconciliation-daily-check
//   - Zod schema {tenant_id, since: ISO, until: ISO, drift_pct, drift_usd_cents}
//   - Tenant context (withTenantContext)
//   - Calls existing ingest-litellm-spend with explicit since/until args
//   - Idempotent on request_id re-run (ON CONFLICT DO NOTHING in usage_ledger)
import { describe, it } from "vitest";

const NOT_YET = "not yet implemented — Plan 06-10 implements reconciliation-discrepancy job (D-R3)";

describe("reconciliation-discrepancy (D-R3)", () => {
  it("is wrapped in withTenantContext", () => {
    throw new Error(NOT_YET);
  });

  it("Zod schema is {tenant_id, since: ISO, until: ISO, drift_pct, drift_usd_cents}", () => {
    throw new Error(NOT_YET);
  });

  it("rejects when since/until are not ISO8601 strings", () => {
    throw new Error(NOT_YET);
  });

  it("calls existing ingest-litellm-spend with explicit since/until window", () => {
    throw new Error(NOT_YET);
  });

  it("is a no-op on re-run over already-ingested rows (idempotent via ON CONFLICT)", () => {
    throw new Error(NOT_YET);
  });

  it("only runs when triggered as a child of reconciliation-daily-check or ingest-litellm-spend", () => {
    throw new Error(NOT_YET);
  });
});
