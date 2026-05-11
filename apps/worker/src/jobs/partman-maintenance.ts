// Phase 6 Plan 06-08 — partman-maintenance BullMQ job.
//
// D-A4: System mode. Calls `partman.run_maintenance_proc()` daily. Critical
// detail (06-02 deferral): pg_partman's maintenance procedure issues
// internal COMMIT statements, which makes it incompatible with any
// connection wrapped in a Drizzle transaction. The worker MUST use a
// fresh non-transactional connection. We achieve this by acquiring a
// raw client from a SEPARATE pg.Pool (`maintenancePool`) that bypasses
// the withTenantContext HOF's transaction wrapping. That pool is owned
// by the worker process and is sized minimally (max=1).
//
// After invoking maintenance, we read newly-detached partitions from
// `partman.part_config_sub` / `pg_inherits` history and enqueue one
// audit-archive job per detached partition so the S3/MinIO export
// pipeline picks them up.

import type { Pool } from "pg";
import { z } from "zod";
import type { TypedQueue } from "../lib/typed-queue.js";
import { withSystemContext } from "../lib/with-system-context.js";
import type { auditArchiveSchema } from "./audit-archive.js";

export const partmanMaintenanceSchema = z.object({}).strict();
export type PartmanMaintenancePayload = z.infer<typeof partmanMaintenanceSchema>;

export interface PartmanMaintenanceDeps {
  /** Dedicated pool that NEVER wraps the connection in a transaction. */
  maintenancePool: Pool;
  /** Queue used to fan-out audit-archive jobs for newly-detached partitions. */
  auditArchiveQueue: Pick<TypedQueue<typeof auditArchiveSchema>, "add">;
}

/**
 * Identify partitions that were detached from `public.audit_log` by the
 * most recent partman maintenance pass. The convention used by pg_partman
 * with `retention_keep_table = true` is to ALTER TABLE ... DETACH the
 * old child but leave the table on disk. We discover these by looking
 * for tables matching the audit_log child naming convention that no
 * longer inherit from `public.audit_log`.
 */
async function discoverDetached(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname ~ '^audit_log_p[0-9]{4}_[0-9]{2}$'
        AND NOT EXISTS (
          SELECT 1
            FROM pg_inherits i
            JOIN pg_class p ON p.oid = i.inhparent
           WHERE i.inhrelid = c.oid
             AND p.relname  = 'audit_log'
        )`,
  );
  return rows.map((r) => r.table_name);
}

export function buildPartmanMaintenanceHandler(
  deps: PartmanMaintenanceDeps,
): (job: import("bullmq").Job) => Promise<{ detached: string[] }> {
  return withSystemContext(partmanMaintenanceSchema, async (): Promise<{ detached: string[] }> => {
    // Acquire a fresh client and run the maintenance procedure directly.
    // CALL semantics: partman.run_maintenance_proc() opens its own tx
    // internally (it COMMITs across child-partition operations). We must
    // NOT wrap it in BEGIN/COMMIT.
    const client = await deps.maintenancePool.connect();
    try {
      await client.query("CALL partman.run_maintenance_proc()");
    } finally {
      client.release();
    }

    const detached = await discoverDetached(deps.maintenancePool);
    for (const partition of detached) {
      await deps.auditArchiveQueue.add("audit-archive", { partition_name: partition });
    }
    return { detached };
  });
}
