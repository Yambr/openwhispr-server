// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-09 — RED→GREEN for REVIEW-INDEX.md worker HIGH:
// audit-archive `AUDIT_ARCHIVE_BUCKET` was interpolated verbatim into
// an `aws_s3.query_export_to_s3('…', '<bucket>', …)` SQL literal AND
// into `s3://<bucket>/…` URL forms. A malicious env value with a
// single-quote + `; DROP …` payload would escape the SQL literal.

import { describe, expect, it } from "vitest";
import { buildExportSteps } from "../../../src/jobs/audit-archive.js";

describe("Plan 51-09 — audit-archive bucket validation", () => {
  function envOf(map: Record<string, string>): (k: string) => string | undefined {
    return (k: string) => map[k];
  }

  it("rejects SQL-injection payload in AUDIT_ARCHIVE_BUCKET", () => {
    expect(() =>
      buildExportSteps(
        "aws_s3",
        "audit_log_p2026_05_17",
        envOf({
          DATABASE_URL_OWNER: "postgres://u:p@h:5432/d",
          AUDIT_ARCHIVE_BUCKET: "'; DROP TABLE audit_log;--",
        }),
      ),
    ).toThrow(/AUDIT_ARCHIVE_BUCKET rejected/);
  });

  it("rejects bucket with uppercase letters (S3 spec — must be lowercase)", () => {
    expect(() =>
      buildExportSteps(
        "s3_cli",
        "audit_log_p2026_05_17",
        envOf({ DATABASE_URL_OWNER: "postgres://u:p@h:5432/d", AUDIT_ARCHIVE_BUCKET: "MyBucket" }),
      ),
    ).toThrow(/AUDIT_ARCHIVE_BUCKET rejected/);
  });

  it("rejects bucket with shell-metacharacters", () => {
    expect(() =>
      buildExportSteps(
        "mc_cp",
        "audit_log_p2026_05_17",
        envOf({
          DATABASE_URL_OWNER: "postgres://u:p@h:5432/d",
          AUDIT_ARCHIVE_BUCKET: "ok; rm -rf /tmp",
        }),
      ),
    ).toThrow(/AUDIT_ARCHIVE_BUCKET rejected/);
  });

  it("rejects partition with quote-injection", () => {
    expect(() =>
      buildExportSteps(
        "aws_s3",
        "x'; DROP TABLE audit_log;--",
        envOf({
          DATABASE_URL_OWNER: "postgres://u:p@h:5432/d",
          AUDIT_ARCHIVE_BUCKET: "openwhispr",
        }),
      ),
    ).toThrow(/partition name rejected/);
  });

  it("accepts a canonical bucket + partition", () => {
    expect(() =>
      buildExportSteps(
        "aws_s3",
        "audit_log_p2026_05_17",
        envOf({
          DATABASE_URL_OWNER: "postgres://u:p@h:5432/d",
          AUDIT_ARCHIVE_BUCKET: "openwhispr",
        }),
      ),
    ).not.toThrow();
  });
});
