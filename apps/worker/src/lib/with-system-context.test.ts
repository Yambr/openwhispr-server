// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-07 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/worker/src/lib/with-system-context.ts
//
// Behaviors locked by D-W2 (escape hatch for cross-tenant jobs):
//   - Does NOT issue SET LOCAL app.tenant_id GUC
//   - Uses postgres_owner pool (BYPASSRLS role)
//   - Pino MDC tag {mode: 'system'}
//   - AsyncLocalStorage flag set to 'system' so the app-pool runtime guard
//     (D-W4 layer 2) skips its TenantContextMissingError raise
//
// Used by: ingest-litellm-spend, reconciliation-daily-check, audit-archive,
// partman-maintenance, usage-rollup-daily (dispatcher only).
import { describe, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-07 implements apps/worker/src/lib/with-system-context.ts (D-W2)";

describe("withSystemContext (D-W2)", () => {
  it("does NOT execute SET LOCAL app.tenant_id (no GUC bound)", () => {
    throw new Error(NOT_YET);
  });

  it("uses postgres_owner pool (BYPASSRLS role)", () => {
    throw new Error(NOT_YET);
  });

  it("attaches pino MDC tag {mode: 'system'} to handler logs", () => {
    throw new Error(NOT_YET);
  });

  it("sets AsyncLocalStorage flag mode='system' for the app-pool guard (D-W4 layer 2)", () => {
    throw new Error(NOT_YET);
  });

  it("opens OTel span named bullmq.job.<queue> WITHOUT tenant_id attribute", () => {
    throw new Error(NOT_YET);
  });

  it("does not COMMIT/ROLLBACK an outer transaction (system jobs manage their own txns)", () => {
    throw new Error(NOT_YET);
  });
});
