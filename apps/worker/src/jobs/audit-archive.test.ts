// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — GREEN tests for audit-archive (D-A3).
//
// The exporter shell-out is replaced with a fake spawn that captures the
// argv and returns a configurable exit code. The DB pool is a real
// testcontainer so we can verify the DROP TABLE side-effect.

import { EventEmitter } from "node:events";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Job } from "bullmq";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canRunDocker } from "../lib/can-run-docker.js";
import { auditArchiveSchema, buildAuditArchiveHandler } from "./audit-archive.js";

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

interface FakeSpawnConfig {
  exitCode: number;
  stderr?: string;
}

function makeFakeSpawn(cfg: FakeSpawnConfig, captured: Array<{ cmd: string; args: string[] }>) {
  return ((cmd: string, args: string[]) => {
    captured.push({ cmd, args });
    const proc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    proc.stderr = new EventEmitter();
    proc.stdout = new EventEmitter();
    // Resolve asynchronously so the consumer attaches listeners first.
    setImmediate(() => {
      if (cfg.stderr) proc.stderr.emit("data", Buffer.from(cfg.stderr));
      proc.emit("close", cfg.exitCode);
    });
    return proc;
    // biome-ignore lint/suspicious/noExplicitAny: spawn signature mismatch in tests
  }) as any;
}

SUITE("audit-archive (D-A3)", () => {
  it("schema accepts canonical partition names and rejects junk", () => {
    expect(() => auditArchiveSchema.parse({ partition_name: PARTITION })).not.toThrow();
    expect(() => auditArchiveSchema.parse({ partition_name: "audit_log_2025_05" })).not.toThrow();
    expect(() => auditArchiveSchema.parse({ partition_name: "drop_table_users" })).toThrow();
    expect(() => auditArchiveSchema.parse({ partition_name: "audit_log_p20" })).toThrow();
  });

  it("default exporter is mc_cp when AUDIT_ARCHIVE_EXPORTER is unset", async () => {
    if (!h) throw new Error("harness");
    const captured: Array<{ cmd: string; args: string[] }> = [];
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: () => undefined,
      spawnFn: makeFakeSpawn({ exitCode: 0 }, captured),
    });
    const result = (await handler(fakeJob({ partition_name: PARTITION }))) as unknown as {
      exporter: string;
      dropped: boolean;
    };
    expect(result.exporter).toBe("mc_cp");
    expect(captured[0]?.args.join(" ")).toMatch(/mc pipe/);
    expect(result.dropped).toBe(true);
  });

  it("selects s3_cli when AUDIT_ARCHIVE_EXPORTER=s3_cli", async () => {
    if (!h) throw new Error("harness");
    const captured: Array<{ cmd: string; args: string[] }> = [];
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "AUDIT_ARCHIVE_EXPORTER" ? "s3_cli" : undefined),
      spawnFn: makeFakeSpawn({ exitCode: 0 }, captured),
    });
    await handler(fakeJob({ partition_name: PARTITION }));
    expect(captured[0]?.args.join(" ")).toMatch(/aws s3 cp/);
  });

  it("selects aws_s3 when AUDIT_ARCHIVE_EXPORTER=aws_s3", async () => {
    if (!h) throw new Error("harness");
    const captured: Array<{ cmd: string; args: string[] }> = [];
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "AUDIT_ARCHIVE_EXPORTER" ? "aws_s3" : undefined),
      spawnFn: makeFakeSpawn({ exitCode: 0 }, captured),
    });
    await handler(fakeJob({ partition_name: PARTITION }));
    expect(captured[0]?.args.join(" ")).toMatch(/aws_s3\.query_export_to_s3/);
  });

  it("selects custom exporter and invokes AUDIT_ARCHIVE_CUSTOM_SCRIPT with partition", async () => {
    if (!h) throw new Error("harness");
    const captured: Array<{ cmd: string; args: string[] }> = [];
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) =>
        k === "AUDIT_ARCHIVE_EXPORTER"
          ? "custom"
          : k === "AUDIT_ARCHIVE_CUSTOM_SCRIPT"
            ? "/usr/local/bin/my-archive"
            : undefined,
      spawnFn: makeFakeSpawn({ exitCode: 0 }, captured),
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
      spawnFn: makeFakeSpawn({ exitCode: 0 }, []),
    });
    await expect(handler(fakeJob({ partition_name: PARTITION }))).rejects.toThrow(
      /AUDIT_ARCHIVE_CUSTOM_SCRIPT/,
    );
  });

  it("drops partition on exit-code-0", async () => {
    if (!h) throw new Error("harness");
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: () => undefined,
      spawnFn: makeFakeSpawn({ exitCode: 0 }, []),
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
      env: () => undefined,
      spawnFn: makeFakeSpawn({ exitCode: 1, stderr: "minio-down" }, []),
    });
    await expect(handler(fakeJob({ partition_name: PARTITION }))).rejects.toThrow(/minio-down/);
    const { rows } = await h.pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists",
      [PARTITION],
    );
    expect(rows[0]?.exists).toBe(true);
  });

  it("AUDIT_ARCHIVE_DRY_RUN=1 keeps the partition on disk", async () => {
    if (!h) throw new Error("harness");
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: (k) => (k === "AUDIT_ARCHIVE_DRY_RUN" ? "1" : undefined),
      spawnFn: makeFakeSpawn({ exitCode: 0 }, []),
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
    // Construct with no env / no spawnFn to exercise the `??` default-branch.
    // We don't invoke the handler (real spawn would call mc) — just
    // verify construction succeeds without throwing.
    const handler = buildAuditArchiveHandler({ pool: h.pool });
    expect(typeof handler).toBe("function");
  });

  it("captures spawn 'error' event and reports failure (non-zero exit)", async () => {
    if (!h) throw new Error("harness");
    const spawnErr = ((cmd: string, args: string[]) => {
      const proc = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();
      setImmediate(() => proc.emit("error", new Error("ENOENT")));
      void cmd;
      void args;
      return proc;
      // biome-ignore lint/suspicious/noExplicitAny: spawn signature
    }) as any;
    const handler = buildAuditArchiveHandler({
      pool: h.pool,
      env: () => undefined,
      spawnFn: spawnErr,
    });
    await expect(handler(fakeJob({ partition_name: PARTITION }))).rejects.toThrow(/ENOENT|failed/);
  });

  it("rejects partition_name shapes that would enable SQL injection in DROP", async () => {
    if (!h) throw new Error("harness");
    // Schema rejects, but the inner defensive re-check ALSO rejects.
    expect(() =>
      auditArchiveSchema.parse({ partition_name: 'audit_log_p2025_05"; DROP TABLE users; --' }),
    ).toThrow();
  });
});
