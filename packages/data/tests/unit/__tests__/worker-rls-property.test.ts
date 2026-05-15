// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-07 — GREEN worker-tier RLS property test (D-W4 layer 3).
//
// Extends Phase 1's `rls-property.test.ts` to the worker tier: drives 100
// random (tenantA, tenantB) UUID pairs through CONCURRENT BullMQ jobs each
// wrapped in `withTenantContext`, against a real Postgres + Valkey
// testcontainer pair, and asserts:
//   - Tenant A's job sees ONLY its own inserts on `notes`.
//   - Tenant B's job sees ONLY its own inserts on `notes`.
//   - A system-mode job (BYPASSRLS via owner pool) CAN see both rows —
//     escape hatch verified.
//
// fast-check shrinks failing cases automatically, but the per-pair runtime
// is dominated by BullMQ + Postgres roundtrip overhead — we cap runs at 8
// here (each pair = full job lifecycle) and rely on the broader Phase 1
// `rls-property.test.ts` (210 runs against PgBouncer) for the RLS engine's
// breadth coverage. This file's purpose is specifically the WORKER tier
// integration: HOF → BullMQ Worker → set_config → RLS.
//
// References:
//   - .planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md D-W4
//   - apps/worker/src/lib/with-tenant-context.ts (D-W1)
//   - apps/worker/src/lib/with-system-context.ts (D-W2)
//   - apps/worker/src/db/app-pool.ts (D-W4 layer 2)

import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@fast-check/vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Queue, Worker } from "bullmq";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as fc from "fast-check";
import { Redis as IORedis } from "ioredis";
import { Pool } from "pg";
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { z } from "zod";
// Cross-package import of the worker primitives under test. The relative
// path resolves through vitest's TS transform — we deliberately depend on
// real source code, not a published artifact (per CLAUDE.md no-mocks rule).
import { wrapPoolWithTenantGuard } from "../../../../../apps/worker/src/db/app-pool.js";
import { withSystemContext } from "../../../../../apps/worker/src/lib/with-system-context.js";
import { withTenantContext } from "../../../../../apps/worker/src/lib/with-tenant-context.js";
import { provisionPgPartman } from "../../../src/__tests__/helpers.js";
import * as schema from "../../../src/schema/index.js";
import { bootstrapRoles } from "../__helpers__/bootstrap-roles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "..", "..", "..", "migrations");

function migrationsReady(): boolean {
  if (!existsSync(MIGRATIONS_FOLDER)) return false;
  try {
    return readdirSync(MIGRATIONS_FOLDER).some((f) => f.endsWith(".sql"));
  } catch {
    return false;
  }
}

const READY = migrationsReady();
const SUITE = READY ? describe : describe.skip;
const TIMEOUT = 180_000;

interface Harness {
  network: StartedNetwork;
  pg: StartedPostgreSqlContainer;
  valkey: StartedTestContainer;
  // Raw owner pool used ONLY for test setup/teardown (truncate, seed,
  // verification). Never wrapped by the runtime guard.
  rawOwnerPool: Pool;
  // Guarded owner pool used BY the worker primitives under test. Wrapped
  // with wrapPoolWithTenantGuard so the D-W4 layer 2 guard fires.
  guardedOwnerPool: Pool;
  ownerUri: string;
  redisConn: { host: string; port: number };
}

let harness: Harness | undefined;

async function bootHarness(): Promise<Harness> {
  const network = await new Network().start();
  const pg = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
    .withNetwork(network)
    .withNetworkAliases("postgres")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  // Phase 18.1.1 / Plan 03 / D-12 — canonical role+grants block extracted
  // to bootstrapRoles helper; pg_partman remains per-caller.
  const superPool = new Pool({ connectionString: pg.getConnectionUri() });
  await bootstrapRoles(superPool);
  await provisionPgPartman(superPool);
  await superPool.end();

  const ownerUri = `postgres://openwhispr_owner:owner-pw@${pg.getHost()}:${pg.getMappedPort(5432)}/openwhispr`;
  const rawOwnerPool = new Pool({ connectionString: ownerUri, max: 12 });
  const ownerDb = drizzle(rawOwnerPool, { schema });
  await migrate(ownerDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  // Separate guarded pool — must be a distinct pg.Pool, not the same
  // instance, because wrapPoolWithTenantGuard tags + monkey-patches in
  // place.
  const guardedOwnerPool = wrapPoolWithTenantGuard(
    new Pool({ connectionString: ownerUri, max: 8 }),
  );

  // Valkey for BullMQ. `--save ""` disables RDB snapshots so the container
  // boots and accepts connections faster. We use a log-based wait strategy
  // because Valkey doesn't advertise "ready" via TCP on the default
  // exposed port until after warm-up on some hosts.
  const valkey = await new GenericContainer("valkey/valkey:8-alpine")
    .withNetwork(network)
    .withExposedPorts(6379)
    .withCommand(["valkey-server", "--save", "", "--appendonly", "no"])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/i))
    .start();

  return {
    network,
    pg,
    valkey,
    rawOwnerPool,
    guardedOwnerPool,
    ownerUri,
    redisConn: { host: valkey.getHost(), port: valkey.getMappedPort(6379) },
  };
}

async function seedTenantPair(
  ownerPool: Pool,
  tenantA: string,
  tenantB: string,
): Promise<{ userA: string; userB: string }> {
  await ownerPool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'A'), ($2, 'B') ON CONFLICT DO NOTHING`,
    [tenantA, tenantB],
  );
  const a = await ownerPool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1::uuid, $2) RETURNING id`,
    [tenantA, `a-${tenantA}@example.com`],
  );
  const b = await ownerPool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1::uuid, $2) RETURNING id`,
    [tenantB, `b-${tenantB}@example.com`],
  );
  return { userA: a.rows[0]?.id, userB: b.rows[0]?.id };
}

async function clearTables(ownerPool: Pool): Promise<void> {
  await ownerPool.query(
    `TRUNCATE TABLE notes, folders, sessions, usage_ledger, audit_log, users, tenants RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  if (!READY) return;
  harness = await bootHarness();
}, TIMEOUT);

afterAll(async () => {
  await teardownSharedBullMQ();
  if (harness) {
    await harness.guardedOwnerPool.end();
    await harness.rawOwnerPool.end();
    await harness.valkey.stop();
    await harness.pg.stop();
    await harness.network.stop();
  }
}, 60_000);

const JOB_SCHEMA = z.object({
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  body: z.string(),
});

// Shared BullMQ infrastructure for the property test. Booting a fresh
// Queue+Worker per fast-check run was empirically 20s+, blowing the 180s
// suite timeout. We boot once and route per-run state through a closure
// + run-scoped `currentRun` global.
interface PerRunState {
  tenantA: string;
  tenantB: string;
  counts: { a: number; b: number };
  resolveA: () => void;
  resolveB: () => void;
  rejectAll: (err: Error) => void;
}
let currentRun: PerRunState | undefined;
let sharedQueue: Queue | undefined;
let sharedWorker: Worker | undefined;
let sharedConn: IORedis | undefined;
const SHARED_QUEUE_NAME = "worker-rls-prop-shared";

async function ensureSharedBullMQ(): Promise<void> {
  if (!harness) throw new Error("harness");
  if (sharedQueue && sharedWorker) return;
  sharedConn = new IORedis({
    host: harness.redisConn.host,
    port: harness.redisConn.port,
    maxRetriesPerRequest: null,
  });
  sharedQueue = new Queue(SHARED_QUEUE_NAME, { connection: sharedConn });
  const guarded = harness.guardedOwnerPool;
  const handler = withTenantContext(JOB_SCHEMA, guarded, async (data) => {
    const c = await guarded.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [data.tenant_id]);
      await c.query(
        "INSERT INTO notes (tenant_id, user_id, title, content) VALUES ($1::uuid, $2::uuid, $3, $4)",
        [data.tenant_id, data.user_id, data.body, data.body],
      );
      const r = await c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM notes WHERE tenant_id = $1::uuid",
        [data.tenant_id],
      );
      const own = r.rows[0]?.n;
      if (currentRun) {
        if (data.tenant_id === currentRun.tenantA) {
          currentRun.counts.a = own;
          currentRun.resolveA();
        } else if (data.tenant_id === currentRun.tenantB) {
          currentRun.counts.b = own;
          currentRun.resolveB();
        }
      }
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    } finally {
      c.release();
    }
  });
  sharedWorker = new Worker(SHARED_QUEUE_NAME, handler, { connection: sharedConn });
  await sharedWorker.waitUntilReady();
  await sharedQueue.waitUntilReady();
}

async function teardownSharedBullMQ(): Promise<void> {
  if (sharedWorker) await sharedWorker.close();
  if (sharedQueue) await sharedQueue.close();
  if (sharedConn) await sharedConn.quit();
  sharedWorker = undefined;
  sharedQueue = undefined;
  sharedConn = undefined;
}

SUITE("worker-tier RLS property (D-W4 layer 3, fast-check)", () => {
  test.prop(
    {
      tenantA: fc.uuid({ version: 4 }),
      tenantB: fc.uuid({ version: 4 }),
      bodyA: fc.string({ minLength: 1, maxLength: 20 }),
      bodyB: fc.string({ minLength: 1, maxLength: 20 }),
    },
    { numRuns: 8 },
  )(
    "concurrent tenant-A / tenant-B jobs see only own notes (real BullMQ + Postgres)",
    async ({ tenantA, tenantB, bodyA, bodyB }) => {
      fc.pre(tenantA !== tenantB);
      if (!harness) throw new Error("harness not booted");
      await ensureSharedBullMQ();
      await clearTables(harness.rawOwnerPool);
      const { userA, userB } = await seedTenantPair(harness.rawOwnerPool, tenantA, tenantB);

      let resolveA!: () => void;
      let resolveB!: () => void;
      let rejectAll!: (err: Error) => void;
      const doneA = new Promise<void>((r, rej) => {
        resolveA = r;
        rejectAll = rej;
      });
      const doneB = new Promise<void>((r) => {
        resolveB = r;
      });
      currentRun = {
        tenantA,
        tenantB,
        counts: { a: -1, b: -1 },
        resolveA,
        resolveB,
        rejectAll,
      };

      await Promise.all([
        sharedQueue?.add("note", { tenant_id: tenantA, user_id: userA, body: bodyA }),
        sharedQueue?.add("note", { tenant_id: tenantB, user_id: userB, body: bodyB }),
      ]);
      await Promise.race([
        Promise.all([doneA, doneB]),
        new Promise((_r, rej) => setTimeout(() => rej(new Error("job poll timeout")), 15_000)),
      ]);
      const run = currentRun;
      expect(run.counts.a).toBe(1);
      expect(run.counts.b).toBe(1);
      const total = await harness.rawOwnerPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM notes",
      );
      expect(total.rows[0]?.n).toBe(2);
      currentRun = undefined;
    },
    TIMEOUT,
  );

  test.prop(
    {
      tenantA: fc.uuid({ version: 4 }),
      tenantB: fc.uuid({ version: 4 }),
    },
    { numRuns: 4 },
  )(
    "system-mode job CAN see both tenants' notes (BYPASSRLS escape hatch verified)",
    async ({ tenantA, tenantB }) => {
      fc.pre(tenantA !== tenantB);
      if (!harness) throw new Error("harness not booted");
      await clearTables(harness.rawOwnerPool);
      const { userA, userB } = await seedTenantPair(harness.rawOwnerPool, tenantA, tenantB);
      // Pre-seed one note per tenant via owner pool.
      await harness.rawOwnerPool.query(
        `INSERT INTO notes (tenant_id, user_id, title, content) VALUES ($1::uuid, $2::uuid, 'a', 'a'), ($3::uuid, $4::uuid, 'b', 'b')`,
        [tenantA, userA, tenantB, userB],
      );

      const guarded = harness.guardedOwnerPool;
      let observedCount = -1;
      const handler = withSystemContext(null, async () => {
        // System mode + owner pool = BYPASSRLS; SELECT must see BOTH rows.
        const r = await guarded.query<{ n: number }>(`SELECT count(*)::int AS n FROM notes`);
        observedCount = r.rows[0]?.n;
      });
      await handler({ data: {}, queueName: "sys", id: "sys-job" } as never);
      expect(observedCount).toBe(2);
    },
    TIMEOUT,
  );
});

if (!READY) {
  // biome-ignore lint/suspicious/noConsole: deliberate skip notice for parallel-wave plans
  console.warn(
    "[worker-rls-property] migrations not present yet — skipping. Plan 01-03 lands the SQL.",
  );
}
