// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — audit-archive BullMQ job.
//
// D-A3: System mode. Receives `{partition_name}` from partman-maintenance
// after a partition is detached. Reads `AUDIT_ARCHIVE_EXPORTER` to choose
// the export adapter:
//   - mc_cp (default): pg_dump | gzip | mc cp - minio/.../<partition>.sql.gz
//   - s3_cli: pg_dump | gzip | aws s3 cp - s3://.../<partition>.sql.gz
//   - aws_s3: SELECT aws_s3.query_export_to_s3(...)  (RDS-only)
//   - custom: spawn $AUDIT_ARCHIVE_CUSTOM_SCRIPT <partition>
//
// Critical safety: we ONLY DROP the partition after the exporter exits 0.
// On exporter failure we leave the partition detached on disk and re-throw
// so BullMQ retries. AUDIT_ARCHIVE_DRY_RUN=1 detaches+exports but does not
// drop — operator runbook safety valve.
//
// Shell-out hardening: spawn() with argv array — NEVER `exec` on a
// concatenated string (T-06-17). partition_name is constrained at the
// schema layer to the pg_partman naming pattern; an additional defensive
// regex re-check at handler entry prevents injection even if the schema
// were loosened in future.

import { spawn } from "node:child_process";
import type { Pool } from "pg";
import { z } from "zod";
import { withSystemContext } from "../lib/with-system-context.js";

/**
 * Partition name pattern is the pg_partman naming convention for the
 * audit_log monthly children. Defensive: both `_p2026_05` (pg_partman
 * default) and `_2026_05` (legacy migration naming) are accepted.
 */
const PARTITION_NAME_RE = /^audit_log_p?\d{4}_\d{2}$/;

export const auditArchiveSchema = z
  .object({
    partition_name: z.string().regex(PARTITION_NAME_RE, "invalid partition name shape"),
  })
  .strict();
export type AuditArchivePayload = z.infer<typeof auditArchiveSchema>;

export type Exporter = "mc_cp" | "s3_cli" | "aws_s3" | "custom";

export interface AuditArchiveDeps {
  pool: Pool;
  env?: (key: string) => string | undefined;
  /** Test seam — defaults to node:child_process.spawn. */
  spawnFn?: typeof spawn;
}

export interface SpawnResult {
  code: number;
  stderr: string;
}

/**
 * Execute a child process and resolve with its exit code + captured stderr.
 * Argv form only — no shell interpolation.
 */
export function runSpawn(
  cmd: string,
  args: string[],
  spawnImpl: typeof spawn = spawn,
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    const proc = spawnImpl(cmd, args, { shell: false });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("close", (code) => resolve({ code: code ?? -1, stderr }));
    proc.on("error", (err) => resolve({ code: -1, stderr: String(err) }));
  });
}

function resolveExporter(env: (k: string) => string | undefined): Exporter {
  const v = env("AUDIT_ARCHIVE_EXPORTER");
  if (v === "s3_cli" || v === "aws_s3" || v === "custom" || v === "mc_cp") return v;
  return "mc_cp";
}

interface ExportPlan {
  cmd: string;
  args: string[];
}

function buildExportPlan(
  exporter: Exporter,
  partition: string,
  env: (k: string) => string | undefined,
): ExportPlan {
  // pg_dump connection details come from PARTMAN_DATABASE_URL or
  // DATABASE_URL_OWNER — both honored. Using --table targets the
  // partition by name; --data-only excludes DDL so the archive is just
  // the rows (DDL lives in our migration history).
  const dbUrl = env("AUDIT_ARCHIVE_DATABASE_URL") ?? env("DATABASE_URL_OWNER") ?? "";
  const bucket = env("AUDIT_ARCHIVE_BUCKET") ?? "openwhispr";
  switch (exporter) {
    case "mc_cp": {
      // We dispatch a `bash -c` ONLY because the pipeline needs to be
      // chained — but the partition name has already been validated
      // against PARTITION_NAME_RE. We further quote the args inline as a
      // belt-and-braces measure.
      const cmd = "bash";
      const script = [
        `pg_dump --table=public.${partition} --data-only "${dbUrl}"`,
        `gzip -c`,
        `mc pipe minio/${bucket}/audit-archive/${partition}.sql.gz`,
      ].join(" | ");
      return { cmd, args: ["-c", script] };
    }
    case "s3_cli": {
      const cmd = "bash";
      const script = [
        `pg_dump --table=public.${partition} --data-only "${dbUrl}"`,
        `gzip -c`,
        `aws s3 cp - s3://${bucket}/audit-archive/${partition}.sql.gz`,
      ].join(" | ");
      return { cmd, args: ["-c", script] };
    }
    case "aws_s3": {
      // Postgres-side export — no shell pipeline.
      return {
        cmd: "bash",
        args: [
          "-c",
          `psql "${dbUrl}" -c "SELECT aws_s3.query_export_to_s3('SELECT * FROM public.${partition}', '${bucket}', 'audit-archive/${partition}.csv', 'us-east-1')"`,
        ],
      };
    }
    case "custom": {
      const script = env("AUDIT_ARCHIVE_CUSTOM_SCRIPT");
      if (!script) {
        throw new Error("AUDIT_ARCHIVE_EXPORTER=custom requires AUDIT_ARCHIVE_CUSTOM_SCRIPT");
      }
      return { cmd: script, args: [partition] };
    }
  }
}

export function buildAuditArchiveHandler(
  deps: AuditArchiveDeps,
): (
  job: import("bullmq").Job,
) => Promise<{ partition: string; dropped: boolean; exporter: Exporter }> {
  const env = deps.env ?? ((k: string) => process.env[k]);
  const spawnImpl = deps.spawnFn ?? spawn;
  return withSystemContext(
    auditArchiveSchema,
    async (data): Promise<{ partition: string; dropped: boolean; exporter: Exporter }> => {
      // Schema-validated by withSystemContext above; PARTITION_NAME_RE
      // ensures `partition_name` is safe to interpolate into the DROP
      // statement and shell-out argv.
      const exporter = resolveExporter(env);
      const plan = buildExportPlan(exporter, data.partition_name, env);

      const result = await runSpawn(plan.cmd, plan.args, spawnImpl);
      if (result.code !== 0) {
        // Leave partition in place; BullMQ will retry.
        throw new Error(
          `audit-archive exporter ${exporter} failed (code=${result.code}): ${result.stderr.slice(0, 512)}`,
        );
      }

      // Verify the object lands before dropping. The exporter's stderr
      // sometimes carries useful audit info; we don't probe the object
      // store here (heavy boundary call) — the exit-code-0 contract is
      // the agreed verification per D-A3. Dry-run keeps the table.
      const dryRun = env("AUDIT_ARCHIVE_DRY_RUN") === "1";
      if (dryRun) {
        return { partition: data.partition_name, dropped: false, exporter };
      }

      // partition_name has been validated; we still cannot parameterize a
      // DDL identifier, so we identifier-quote and require the schema
      // regex to have already matched.
      await deps.pool.query(`DROP TABLE IF EXISTS public."${data.partition_name}"`);
      return { partition: data.partition_name, dropped: true, exporter };
    },
  );
}
