// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — tests for audit-archive (D-A3).
// Phase 36.a (CRIT-FIX-07) — extended for redacted-error + no-bash invariants.
//
// The exporter shell-out is replaced with a fake spawn that captures the
// argv and per-process env, and returns a configurable exit code. The DB
// pool is a real testcontainer so we can verify the DROP TABLE side-effect.

import { EventEmitter } from "node:events";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditArchiveSchema,
  buildAuditArchiveHandler,
  buildExportSteps,
  parseDbUrl,
  redactSecret,
} from "../../../src/jobs/audit-archive.js";
import { canRunDocker } from "../../../src/lib/can-run-docker.js";

const SUITE = canRunDocker() ? describe : describe.skip;
const PARTITION = "audit_log_p2025_05";

interface Harness {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}
let h: Harness | undefined;

beforeAll(async () => {
  if (!canRunDocker()) return;
  const container = await new PostgreSqlContainer("postgres:17-bookworm")
    .withDatabase("aa_test")
    .withUsername("ps")
    .withPassword("pw")
    .start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 3 });
  h = { container, pool };
}, 120_000);

afterAll(async () => {
  if (h) {
    await h.pool.end();
    await h.container.stop();
  }
}, 60_000);

beforeEach(async () => {
  if (!h) return;
  await h.pool.query(`DROP TABLE IF EXISTS public."${PARTITION}"`);
  await h.pool.query(`CREATE TABLE public."${PARTITION}" (id int)`);
});

function fakeJob(data: unknown): Job {
  return { data, queueName: "audit-archive", id: "aa-1" } as unknown as Job;
}

interface CapturedSpawn {
  cmd: string;
  args: string[];
  env?: Record<string, string | undefined>;
}

interface FakeSpawnConfig {
  /** Per-process exit codes by call order; default 0 for all. */
  exitCodes?: number[];
  /** stderr blob emitted by the FIRST process (test focuses on it). */
  stderr?: string;
  /** If true, the FIRST spawn emits an 'error' event instead of close. */
  errorOnFirst?: boolean;
}

function makeFakeSpawn(cfg: FakeSpawnConfig, captured: CapturedSpawn[]) {
  let idx = 0;
  return ((cmd: string, args: string[], opts?: { env?: Record<string, string | undefined> }) => {
    const myIdx = idx++;
    captured.push({ cmd, args, env: opts?.env });
    const proc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdout: EventEmitter & { pipe?: (target: unknown) => unknown };
      stdin: { write: () => boolean; end: () => void };
    };
    proc.stderr = new EventEmitter();
    const stdout = new EventEmitter() as EventEmitter & { pipe?: (t: unknown) => unknown };
    stdout.pipe = () => undefined; // swallow pipe() calls between stages
    proc.stdout = stdout;
    proc.stdin = {
      write: () => true,
      end: () => undefined,
    };
    setImmediate(() => {
      if (cfg.errorOnFirst && myIdx === 0) {
        proc.emit("error", new Error("ENOENT"));
        return;
      }
      if (cfg.stderr && myIdx === 0) {
        proc.stderr.emit("data", Buffer.from(cfg.stderr));
      }
      const code = cfg.exitCodes?.[myIdx] ?? 0;
      proc.emit("close", code);
    });
    return proc;
  }) as any;
}

SUITE("audit-archive (D-A3 / CRIT-FIX-07)", () => {
  it("schema accepts canonical partition names and rejects junk", () => {
    expect(() => auditArchiveSchema.parse({ partition_name: PARTITION })).not.toThrow();
    expect(() => auditArchiveSchema.parse({ partition_name: "audit_log_2025_05" })).not.toThrow();
    expect(() => auditArchiveSchema.parse({ partition_name: "drop_table_users" })).toThrow();
    expect(() => auditArchiveSchema.parse({ partition_name: "audit_log_p20" })).toThrow();
  });

  it("parseDbUrl decomposes host/port/user/password/database", () => {
    const c = parseDbUrl("postgresql://alice:s3cret%21@db.example.com:5433/openwhispr");
    expect(c).toEqual({
      host: "db.example.com",
      port: "5433",
      user: "alice",
      password: "s3cret!",
      database: "openwhispr",
    });
  });

  it("parseDbUrl applies default port for missing port (host left as-is)", () => {
    const c = parseDbUrl("postgresql://pg/mydb");
    expect(c.host).toBe("pg");
    expect(c.port).toBe("5432");
    expect(c.database).toBe("mydb");
  });

  it("redactSecret replaces every occurrence with ***", () => {
    expect(redactSecret("error: pw=s3cret host=s3cret", "s3cret")).toBe("error: pw=*** host=***");
    // Regex-special-character password is escaped safely.
    expect(redactSecret("token=$pw.5", "$pw.5")).toBe("token=***");
    expect(redactSecret("anything", "")).toBe("anything");
  });

  it("buildExportSteps(mc_cp) emits 3 stages: pg_dump | gzip | mc — no bash, no dbUrl argv", () => {
    const env = (k: string) =>
      k === "DATABASE_URL_OWNER" ? "postgresql://owner:topsecret@pg:5432/db" : undefined;
    const steps = buildExportSteps("mc_cp", PARTITION, env);
    expect(steps).toHaveLength(3);
    expect(steps[0]?.cmd).toBe("pg_dump");
    expect(steps[1]?.cmd).toBe("gzip");
    expect(steps[2]?.cmd).toBe("mc");
    // CRITICAL: no argv contains "bash" or the password.
    for (const s of steps) {
      expect(s.cmd).not.toBe("bash");
      for (const a of s.args) {
        expect(a).not.toContain("topsecret");
        expect(a).not.toMatch(/postgresql:\/\//);
      }
    }
    // Password lives in PGPASSWORD env, not argv.
    expect(steps[0]?.env?.PGPASSWORD).toBe("topsecret");
    expect(steps[0]?.env?.PGHOST).toBe("pg");
    expect(steps[0]?.env?.PGUSER).toBe("owner");
  });

  it("buildExportSteps(s3_cli) emits pg_dump | gzip | aws — no bash, no dbUrl argv", () => {
    const env = (k: string) =>
      k === "DATABASE_URL_OWNER" ? "postgresql://owner:topsecret@pg:5432/db" : undefined;
    const steps = buildExportSteps("s3_cli", PARTITION, env);
    expect(steps).toHaveLength(3);
    expect(steps[2]?.cmd).toBe("aws");
    for (const s of steps) {
      expect(s.cmd).not.toBe("bash");
      for (const a of s.args) {
        expect(a).not.toContain("topsecret");
      }
    }
  });

  it("buildExportSteps(aws_s3) emits a single psql process — no bash wrapping", () => {
    const env = (k: string) =>
      k === "DATABASE_URL_OWNER" ? "postgresql://owner:topsecret@pg:5432/db" : undefined;
    const steps = buildExportSteps("aws_s3", PARTITION, env);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.cmd).toBe("psql");
    expect(steps[0]?.cmd).not.toBe("bash");
    for (const a of steps[0]?.args ?? []) {
      expect(a).not.toContain("topsecret");
      expect(a).not.toMatch(/postgresql:\/\//);
    }
    expect(steps[0]?.env?.PGPASSWORD).toBe("topsecret");
  });

  it("default exporter is mc_cp when AUDIT_ARCHIVE_EXPORTER is unset", async () => {
    if (!h) throw new Error("harness");
    const captured: CapturedSpawn[] = [];
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "DATABASE_URL_OWNER" ? "postgresql://o:pw@pg:5432/db" : undefined),
      spawnFn: makeFakeSpawn({}, captured),
    });
    const result = (await handler(fakeJob({ partition_name: PARTITION }))) as unknown as {
      exporter: string;
      dropped: boolean;
    };
    expect(result.exporter).toBe("mc_cp");
    expect(captured.some((c) => c.cmd === "mc")).toBe(true);
    expect(captured.every((c) => c.cmd !== "bash")).toBe(true);
    expect(result.dropped).toBe(true);
  });

  it("selects s3_cli when AUDIT_ARCHIVE_EXPORTER=s3_cli", async () => {
    if (!h) throw new Error("harness");
    const captured: CapturedSpawn[] = [];
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) =>
        k === "AUDIT_ARCHIVE_EXPORTER"
          ? "s3_cli"
          : k === "DATABASE_URL_OWNER"
            ? "postgresql://o:pw@pg:5432/db"
            : undefined,
      spawnFn: makeFakeSpawn({}, captured),
    });
    await handler(fakeJob({ partition_name: PARTITION }));
    expect(captured.some((c) => c.cmd === "aws")).toBe(true);
    expect(captured.every((c) => c.cmd !== "bash")).toBe(true);
  });

  it("selects aws_s3 when AUDIT_ARCHIVE_EXPORTER=aws_s3", async () => {
    if (!h) throw new Error("harness");
    const captured: CapturedSpawn[] = [];
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) =>
        k === "AUDIT_ARCHIVE_EXPORTER"
          ? "aws_s3"
          : k === "DATABASE_URL_OWNER"
            ? "postgresql://o:pw@pg:5432/db"
            : undefined,
      spawnFn: makeFakeSpawn({}, captured),
    });
    await handler(fakeJob({ partition_name: PARTITION }));
    expect(captured[0]?.cmd).toBe("psql");
    expect(captured[0]?.args.join(" ")).toMatch(/aws_s3\.query_export_to_s3/);
    expect(captured.every((c) => c.cmd !== "bash")).toBe(true);
  });

  it("selects custom exporter and invokes AUDIT_ARCHIVE_CUSTOM_SCRIPT with partition", async () => {
    if (!h) throw new Error("harness");
    const captured: CapturedSpawn[] = [];
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) =>
        k === "AUDIT_ARCHIVE_EXPORTER"
          ? "custom"
          : k === "AUDIT_ARCHIVE_CUSTOM_SCRIPT"
            ? "/usr/local/bin/my-archive"
            : undefined,
      spawnFn: makeFakeSpawn({}, captured),
    });
    await handler(fakeJob({ partition_name: PARTITION }));
    expect(captured[0]?.cmd).toBe("/usr/local/bin/my-archive");
    expect(captured[0]?.args).toEqual([PARTITION]);
  });

  it("custom exporter requires AUDIT_ARCHIVE_CUSTOM_SCRIPT — throws otherwise", async () => {
    if (!h) throw new Error("harness");
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "AUDIT_ARCHIVE_EXPORTER" ? "custom" : undefined),
      spawnFn: makeFakeSpawn({}, []),
    });
    await expect(handler(fakeJob({ partition_name: PARTITION }))).rejects.toThrow(
      /AUDIT_ARCHIVE_CUSTOM_SCRIPT/,
    );
  });

  it("drops partition on exit-code-0", async () => {
    if (!h) throw new Error("harness");
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "DATABASE_URL_OWNER" ? "postgresql://o:pw@pg:5432/db" : undefined),
      spawnFn: makeFakeSpawn({}, []),
    });
    await handler(fakeJob({ partition_name: PARTITION }));
    const { rows } = await h.pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists",
      [PARTITION],
    );
    expect(rows[0]?.exists).toBe(false);
  });

  it("does NOT drop partition on exporter failure (BullMQ retry surface)", async () => {
    if (!h) throw new Error("harness");
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "DATABASE_URL_OWNER" ? "postgresql://o:pw@pg:5432/db" : undefined),
      spawnFn: makeFakeSpawn({ exitCodes: [1, 0, 0], stderr: "minio-down" }, []),
    });
    await expect(handler(fakeJob({ partition_name: PARTITION }))).rejects.toThrow(/minio-down/);
    const { rows } = await h.pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists",
      [PARTITION],
    );
    expect(rows[0]?.exists).toBe(true);
  });

  // -----------------------------------------------------------------------
  // CRIT-FIX-07 — the central regression-prevention test for Phase 36.a.
  // The thrown error MUST NOT contain the DB password / dbUrl, even when
  // the failing process echoes them back in stderr (e.g. pg_dump printing
  // "connection to postgresql://owner:topsecret@pg:5432/db failed").
  // -----------------------------------------------------------------------
  it("CRIT-FIX-07 — redacts password + dbUrl from thrown error on pg_dump failure", async () => {
    if (!h) throw new Error("harness");
    const FAKE_PW = "topsecret-42-X";
    const FAKE_DBURL = `postgresql://owner:${FAKE_PW}@pg:5432/db`;
    const NOISY_STDERR = `pg_dump: error: connection to ${FAKE_DBURL} failed; password ${FAKE_PW} rejected`;
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "DATABASE_URL_OWNER" ? FAKE_DBURL : undefined),
      spawnFn: makeFakeSpawn({ exitCodes: [1, 0, 0], stderr: NOISY_STDERR }, []),
    });
    let caught: unknown;
    try {
      await handler(fakeJob({ partition_name: PARTITION }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error;
    const all = `${err.message}\n${err.stack ?? ""}\n${JSON.stringify({ message: err.message })}`;
    expect(all).not.toContain(FAKE_PW);
    expect(all).not.toContain(FAKE_DBURL);
    // We still want SOME diagnostic context — the redacted placeholder is fine.
    expect(err.message).toMatch(/audit-archive exporter mc_cp failed/);
  });

  it("CRIT-FIX-07 — no spawn call uses 'bash' as command", async () => {
    if (!h) throw new Error("harness");
    const captured: CapturedSpawn[] = [];
    const FAKE_DBURL = "postgresql://owner:topsecret@pg:5432/db";
    for (const exporter of ["mc_cp", "s3_cli", "aws_s3"] as const) {
      captured.length = 0;
      const handler = buildAuditArchiveHandler({
        pool: h.pool,
        env: (k) =>
          k === "AUDIT_ARCHIVE_EXPORTER"
            ? exporter
            : k === "DATABASE_URL_OWNER"
              ? FAKE_DBURL
              : undefined,
        spawnFn: makeFakeSpawn({}, captured),
      });
      await handler(fakeJob({ partition_name: PARTITION }));
      for (const c of captured) {
        expect(c.cmd).not.toBe("bash");
        for (const arg of c.args) {
          expect(arg).not.toContain("topsecret");
          expect(arg).not.toMatch(/postgresql:\/\//);
        }
      }
      // Defence-in-depth: psql's `-c <sql>` is legitimate; bash's `-c
      // <script>` is the regression we're guarding against. Since no
      // cmd is "bash", no `-c` here can be a shell wrapper.
    }
  });

  it("AUDIT_ARCHIVE_DRY_RUN=1 keeps the partition on disk", async () => {
    if (!h) throw new Error("harness");
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) =>
        k === "AUDIT_ARCHIVE_DRY_RUN"
          ? "1"
          : k === "DATABASE_URL_OWNER"
            ? "postgresql://o:pw@pg:5432/db"
            : undefined,
      spawnFn: makeFakeSpawn({}, []),
    });
    const result = (await handler(fakeJob({ partition_name: PARTITION }))) as unknown as {
      dropped: boolean;
    };
    expect(result.dropped).toBe(false);
    const { rows } = await h.pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists",
      [PARTITION],
    );
    expect(rows[0]?.exists).toBe(true);
  });

  it("handler accepts missing env+spawnFn deps (uses defaults — branch coverage)", () => {
    if (!h) throw new Error("harness");
    const handler = buildAuditArchiveHandler({ pool: h.pool });
    expect(typeof handler).toBe("function");
  });

  it("captures spawn 'error' event and reports redacted failure", async () => {
    if (!h) throw new Error("harness");
    const FAKE_DBURL = "postgresql://owner:topsecret@pg:5432/db";
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "DATABASE_URL_OWNER" ? FAKE_DBURL : undefined),
      spawnFn: makeFakeSpawn({ errorOnFirst: true }, []),
    });
    let caught: unknown;
    try {
      await handler(fakeJob({ partition_name: PARTITION }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const all = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(all).not.toContain("topsecret");
    expect(all).not.toContain(FAKE_DBURL);
  });

  it("rejects partition_name shapes that would enable SQL injection in DROP", () => {
    expect(() =>
      auditArchiveSchema.parse({ partition_name: 'audit_log_p2025_05"; DROP TABLE users; --' }),
    ).toThrow();
  });
});
