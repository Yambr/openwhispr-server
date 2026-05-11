// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-07 per 06-VALIDATION.md.
//
// Production script (not yet created): tools/lint-tenant-context.ts
//
// Behavior locked by D-W4 layer 1:
//   - Scans apps/worker/src/jobs/**/*.ts
//   - FAILS (exit 1) when any handler default-export is NOT wrapped in
//     withTenantContext(...) or withSystemContext(...)
//   - PASSES (exit 0) when every job is wrapped
//
// Spawns the lint script via execa; the spawn will fail (ENOENT) until the
// script exists. That import-time failure is the RED state.
//
// TODO: real subprocess test in Plan 06-07 uses execa against fixture
// directories with un-wrapped / Tenant-wrapped / System-wrapped handler files.
import { describe, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-07 implements tools/lint-tenant-context.ts (D-W4 layer 1)";

describe("lint-tenant-context (D-W4 layer 1)", () => {
  it("EXITS 1 when a job handler default-export is NOT wrapped", () => {
    throw new Error(NOT_YET);
  });

  it("EXITS 0 when handler is wrapped in withTenantContext(schema, handler)", () => {
    throw new Error(NOT_YET);
  });

  it("EXITS 0 when handler is wrapped in withSystemContext(handler)", () => {
    throw new Error(NOT_YET);
  });

  it("stderr names the offending file and the missing wrapper", () => {
    throw new Error(NOT_YET);
  });

  it("scans apps/worker/src/jobs/**/*.ts recursively", () => {
    throw new Error(NOT_YET);
  });

  it("ignores *.test.ts files (only scans production handler files)", () => {
    throw new Error(NOT_YET);
  });
});
