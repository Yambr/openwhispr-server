// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-02 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/worker/src/jobs/audit-archive.ts
//
// Behaviors locked by D-A3 (S3 archive of detached partitions):
//   - System mode (withSystemContext)
//   - Receives {partition_name} from partman-maintenance after detach
//   - Selects exporter per env AUDIT_ARCHIVE_EXPORTER:
//       default: 'mc_cp' (MinIO mc cp)
//       'aws_s3': aws_s3.query_export_to_s3
//       's3_cli': COPY ... TO PROGRAM 'aws s3 cp -'
//       'custom': operator-supplied script path
//   - On success drops the partition from the cluster
//   - On failure leaves the partition in place (retry on next run)
import { describe, it } from "vitest";

const NOT_YET = "not yet implemented — Plan 06-02 implements audit-archive job (D-A3)";

describe("audit-archive (D-A3)", () => {
  it("is wrapped in withSystemContext", () => {
    throw new Error(NOT_YET);
  });

  it("Zod schema is {partition_name: string}", () => {
    throw new Error(NOT_YET);
  });

  it("default exporter is 'mc_cp' (MinIO mc copy) when AUDIT_ARCHIVE_EXPORTER is unset", () => {
    throw new Error(NOT_YET);
  });

  it("selects aws_s3 exporter when AUDIT_ARCHIVE_EXPORTER=aws_s3", () => {
    throw new Error(NOT_YET);
  });

  it("selects s3_cli exporter when AUDIT_ARCHIVE_EXPORTER=s3_cli", () => {
    throw new Error(NOT_YET);
  });

  it("selects custom exporter script when AUDIT_ARCHIVE_EXPORTER=custom", () => {
    throw new Error(NOT_YET);
  });

  it("drops the partition on successful export", () => {
    throw new Error(NOT_YET);
  });

  it("does NOT drop the partition on export failure (safe retry)", () => {
    throw new Error(NOT_YET);
  });

  it("retention default keeps 13 months hot (12 months + 1 buffer)", () => {
    throw new Error(NOT_YET);
  });
});
