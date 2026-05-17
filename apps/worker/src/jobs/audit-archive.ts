// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — audit-archive BullMQ job.
// Phase 36.a (CRIT-FIX-07) — DATABASE_URL removed from argv. The previous
// implementation passed the full connection string (including password)
// as a positional argument to pg_dump / psql under `bash -c '...'`, which
// leaked credentials into `ps auxww`, BullMQ `failedReason`, container
// /proc/<pid>/cmdline, OOM coredumps, and stderr-tail in thrown errors.
//
// The new pipeline:
//   1. Parse `dbUrl` ONCE into {host,port,user,password,database} via URL.
//   2. Spawn each pipeline stage with argv-array form (no shell), passing
//      libpq connection details via PG* env (PGPASSWORD never appears in
//      argv). Stages are chained with stdout→stdin via node:stream.
//   3. Capture stderr per-stage. On any non-zero exit, throw an error whose
//      .message + .stack have the password redacted (replaced with `***`).
//
// D-A3: System mode. Receives `{partition_name}` from partman-maintenance
// after a partition is detached. Reads `AUDIT_ARCHIVE_EXPORTER` to choose
// the export adapter:
//   - mc_cp (default): pg_dump | gzip | mc pipe minio/.../<partition>.sql.gz
//   - s3_cli:          pg_dump | gzip | aws s3 cp - s3://.../<partition>.sql.gz
//   - aws_s3:          psql -c "SELECT aws_s3.query_export_to_s3(...)"  (RDS-only)
//   - custom:          spawn $AUDIT_ARCHIVE_CUSTOM_SCRIPT <partition>
//
// Critical safety: we ONLY DROP the partition after the exporter exits 0.
// On exporter failure we leave the partition detached on disk and re-throw
// (redacted) so BullMQ retries. AUDIT_ARCHIVE_DRY_RUN=1 detaches+exports
// but does not drop — operator runbook safety valve.

import type { ChildProcessByStdio, spawn as nodeSpawn } from "node:child_process";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
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
  spawnFn?: typeof nodeSpawn;
}

export interface SpawnResult {
  code: number;
  stderr: string;
}

/**
 * Parsed connection info from a libpq URI. We pass these via PG* env
 * variables to child processes — credentials never appear in argv.
 */
export interface ConnInfo {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/**
 * Single pipeline stage: a process to spawn with argv-array form. `env`
 * (when present) is merged over process.env for the child. No shell.
 */
export interface PipelineStep {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Parse a libpq URI into discrete connection components. Throws on
 * unparseable input. The password is decoded from percent-encoded form
 * (URL.password preserves the encoding; we decode to match libpq).
 */
export function parseDbUrl(dbUrl: string): ConnInfo {
  const u = new URL(dbUrl);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    database: decodeURIComponent(u.pathname.replace(/^\//, "") || ""),
  };
}

/**
 * Redact occurrences of a secret string inside a free-form text blob. Used
 * to scrub stderr captured from child processes before it lands in thrown
 * errors / BullMQ failedReason / Loki logs.
 *
 * Implementation note: `secret` is escaped for regex use because the
 * password may contain regex metacharacters ($, ., etc.).
 */
export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "g"), "***");
}

function resolveExporter(env: (k: string) => string | undefined): Exporter {
  const v = env("AUDIT_ARCHIVE_EXPORTER");
  if (v === "s3_cli" || v === "aws_s3" || v === "custom" || v === "mc_cp") return v;
  return "mc_cp";
}

/**
 * Build the pipeline steps for a given exporter. Returns an array of
 * processes to spawn; the runtime chains stdout→stdin of stage N into
 * stage N+1. The terminal stage has no stdout consumer.
 *
 * The connection password is passed via PGPASSWORD env. PGHOST/PGPORT/
 * PGUSER/PGDATABASE are likewise env-side. NEVER argv-side.
 */
/**
 * Phase 51 / Plan 51-09 (REVIEW worker HIGH on audit-archive SQL
 * interpolation). Pre-fix, `AUDIT_ARCHIVE_BUCKET` was interpolated
 * verbatim into both an `aws_s3.query_export_to_s3('…', '${bucket}',
 * …)` SQL literal AND `s3://${bucket}/…` URL forms. A malicious env
 * value like `; DROP TABLE audit_log;--` (operator-set, not user-set,
 * but the threat model includes a compromised env injection point)
 * would have escaped the SQL string literal. Validate at the boundary
 * with a strict pattern.
 *
 * S3 bucket-name spec: 3..63 chars, lowercase alphanumeric, dots and
 * hyphens. MinIO accepts the same shape. We allow dots even though
 * RFC-1123 forbids them in DNS labels — many MinIO setups use them.
 */
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PARTITION_RE = /^[a-z][a-z0-9_]{0,62}$/;

function assertSafeBucket(bucket: string): void {
  if (!BUCKET_RE.test(bucket)) {
    throw new Error(
      `AUDIT_ARCHIVE_BUCKET rejected: must match ${BUCKET_RE.source} (S3 bucket spec). got: ${JSON.stringify(bucket)}`,
    );
  }
}

function assertSafePartition(partition: string): void {
  if (!PARTITION_RE.test(partition)) {
    throw new Error(
      `partition name rejected: must match ${PARTITION_RE.source} (Postgres-safe identifier). got: ${JSON.stringify(partition)}`,
    );
  }
}

export function buildExportSteps(
  exporter: Exporter,
  partition: string,
  env: (k: string) => string | undefined,
): PipelineStep[] {
  const dbUrl = env("AUDIT_ARCHIVE_DATABASE_URL") ?? env("DATABASE_URL_OWNER") ?? "";
  const bucket = env("AUDIT_ARCHIVE_BUCKET") ?? "openwhispr";
  // Phase 51 / Plan 51-09 — validate every value that ends up
  // interpolated into a SQL literal or a shell argument BEFORE we
  // start spawning processes.
  assertSafeBucket(bucket);
  assertSafePartition(partition);

  if (exporter === "custom") {
    const script = env("AUDIT_ARCHIVE_CUSTOM_SCRIPT");
    if (!script) {
      throw new Error("AUDIT_ARCHIVE_EXPORTER=custom requires AUDIT_ARCHIVE_CUSTOM_SCRIPT");
    }
    return [{ cmd: script, args: [partition] }];
  }

  const conn = parseDbUrl(dbUrl);
  const pgEnv: Record<string, string> = {
    PGHOST: conn.host,
    PGPORT: conn.port,
    PGUSER: conn.user,
    PGPASSWORD: conn.password,
    PGDATABASE: conn.database,
  };

  switch (exporter) {
    case "mc_cp":
      return [
        {
          cmd: "pg_dump",
          args: [`--table=public.${partition}`, "--data-only"],
          env: pgEnv,
        },
        { cmd: "gzip", args: ["-c"] },
        { cmd: "mc", args: ["pipe", `minio/${bucket}/audit-archive/${partition}.sql.gz`] },
      ];
    case "s3_cli":
      return [
        {
          cmd: "pg_dump",
          args: [`--table=public.${partition}`, "--data-only"],
          env: pgEnv,
        },
        { cmd: "gzip", args: ["-c"] },
        { cmd: "aws", args: ["s3", "cp", "-", `s3://${bucket}/audit-archive/${partition}.sql.gz`] },
      ];
    case "aws_s3":
      // Postgres-side export via RDS aws_s3 extension. Single psql process,
      // SQL passed as a `-c` argument (not via shell). PGPASSWORD via env.
      return [
        {
          cmd: "psql",
          args: [
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            `SELECT aws_s3.query_export_to_s3('SELECT * FROM public.${partition}', '${bucket}', 'audit-archive/${partition}.csv', 'us-east-1')`,
          ],
          env: pgEnv,
        },
      ];
  }
}

/** Internal: minimal shape we need from a spawned child process. */
type SpawnedChild = ChildProcessByStdio<Writable | null, Readable | null, Readable | null>;

/**
 * Execute a single child process (argv-array form, no shell). Resolves with
 * its exit code + captured stderr after `close`. The `env` from the step is
 * merged over `process.env`; absent → child inherits process.env unchanged.
 */
function spawnStep(
  step: PipelineStep,
  spawnImpl: typeof nodeSpawn,
  stdinPipe: "pipe" | "ignore",
): { proc: SpawnedChild; closed: Promise<SpawnResult> } {
  const childEnv = step.env ? { ...process.env, ...step.env } : process.env;
  const proc = spawnImpl(step.cmd, step.args, {
    shell: false,
    stdio: [stdinPipe, "pipe", "pipe"],
    env: childEnv,
  }) as SpawnedChild;
  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const closed = new Promise<SpawnResult>((resolve) => {
    proc.on("close", (code) => resolve({ code: code ?? -1, stderr }));
    proc.on("error", (err) => resolve({ code: -1, stderr: String(err) }));
  });
  return { proc, closed };
}

/**
 * Run a multi-stage pipeline: stage[0].stdout → stage[1].stdin → ...
 * Awaits ALL stages' close events. Returns the FIRST non-zero result, or
 * the last stage's result on full success. Stderr of every stage is
 * concatenated into the returned SpawnResult so operators get full
 * context when a stage upstream of the failing one also printed warnings.
 */
export async function runPipeline(
  steps: PipelineStep[],
  spawnImpl: typeof nodeSpawn = spawn,
): Promise<SpawnResult> {
  const children: Array<{ proc: SpawnedChild; closed: Promise<SpawnResult> }> = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    /* c8 ignore next — defensive: steps[i] is always defined inside [0,length). */
    if (!step) continue;
    const stdinPipe = i === 0 ? "ignore" : "pipe";
    const c = spawnStep(step, spawnImpl, stdinPipe);
    children.push(c);
    if (i > 0) {
      const prev = children[i - 1];
      /* c8 ignore next — defensive: stdio:'pipe' on prev.stdout + c.stdin always sets both. */
      if (prev?.proc.stdout && c.proc.stdin) {
        prev.proc.stdout.pipe(c.proc.stdin);
      }
    }
  }
  const results = await Promise.all(children.map((c) => c.closed));
  const aggStderr = results
    .map((r) => r.stderr)
    .filter((s) => s.length > 0)
    .join("\n");
  const firstFail = results.find((r) => r.code !== 0);
  if (firstFail) {
    return { code: firstFail.code, stderr: aggStderr || firstFail.stderr };
  }
  const last = results[results.length - 1];
  return { code: last?.code ?? -1, stderr: aggStderr };
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
      // statement and the SQL passed via -c (no DDL identifier param API).
      const exporter = resolveExporter(env);
      const steps = buildExportSteps(exporter, data.partition_name, env);
      // Capture the password once so we can redact stderr blobs before
      // they land in thrown errors. For `custom` exporters we have no
      // dbUrl env to parse — password is empty, redactSecret is a no-op.
      const dbUrl = env("AUDIT_ARCHIVE_DATABASE_URL") ?? env("DATABASE_URL_OWNER") ?? "";
      const password = dbUrl ? parseDbUrl(dbUrl).password : "";

      const result = await runPipeline(steps, spawnImpl);
      if (result.code !== 0) {
        // Leave partition in place; BullMQ will retry. ALWAYS redact the
        // password (and the full dbUrl, in case any stage echoed it back)
        // before letting the error escape this function.
        const redactedStderr = redactSecret(
          redactSecret(result.stderr.slice(0, 512), password),
          dbUrl,
        );
        throw new Error(
          `audit-archive exporter ${exporter} failed (code=${result.code}): ${redactedStderr}`,
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
