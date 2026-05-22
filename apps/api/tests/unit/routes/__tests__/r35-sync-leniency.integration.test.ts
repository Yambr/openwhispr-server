// SPDX-License-Identifier: FSL-1.1-ALv2
// R35 (quick-task 20260522) — integration test for cloud-sync POST
// endpoints accepting the immutable desktop client's body.
//
// Real Postgres 17.5 testcontainer + production Drizzle migrations. Boots
// Fastify with the four sync routes mounted on a real Drizzle handle and a
// real `withTenant` transaction, then asserts:
//   - POST /api/transcriptions/batch-create with a SQLite-form created_at
//     AND a non-enum status ("synced") -> 201 { created: [...] }, the row
//     stores a canonical TranscriptionStatus enum value.
//   - POST /api/notes/batch-create with SQLite-form created_at/updated_at
//     -> 201 { created: [{ client_note_id, id }] }.
//   - POST /api/folders/batch-create (control — no datetime input field)
//     -> 201 { created: [CloudFolder...] } with client_folder_id echo.
//   - POST /api/conversations/create with SQLite-form created_at/updated_at
//     -> 201 CloudConversation with client_conversation_id echo.
//
// Mirrors usage.integration.test.ts — shared `getSharedPostgres()`
// fixture, idempotent Drizzle migrate, TRUNCATE per-file, unique emails,
// `onRequest` hook injecting req.user/req.tenant (the same auth seam the
// other route integration tests use).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildConversationsCreateRoutes } from "../../../../src/routes/conversations/create.js";
import { buildFoldersBatchCreateRoutes } from "../../../../src/routes/folders/batch-create.js";
import { buildNotesBatchCreateRoutes } from "../../../../src/routes/notes/batch-create.js";
import { buildTranscriptionsBatchCreateRoutes } from "../../../../src/routes/transcriptions/batch-create.js";
import {
  bootstrapSharedRoles,
  getSharedPostgres,
  provisionPgPartman,
} from "../../../support/shared-pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/tests/unit/routes/__tests__ -> repo root -> packages/data/migrations
const MIGRATIONS_FOLDER = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "data",
  "migrations",
);

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const EMAIL = "r35-sync-leniency@example.com";

let container: StartedPostgreSqlContainer;
let pool: Pool;
let userId: string;
let app: FastifyInstance;

beforeAll(async () => {
  container = await getSharedPostgres();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await bootstrapSharedRoles(superPool);
  await provisionPgPartman(superPool);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:super-pw@${host}:${port}/openwhispr`;

  const ownerPool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  pool = new Pool({ connectionString: ownerUri });

  const u = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2)
       ON CONFLICT (tenant_id, (lower(email))) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    [DEFAULT_TENANT_ID, EMAIL],
  );
  userId = u.rows[0]?.id as string;

  const db = drizzle(pool);
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    req.user = { id: userId, email: EMAIL };
    req.tenant = DEFAULT_TENANT_ID;
  });
  await app.register(
    buildTranscriptionsBatchCreateRoutes({ db } as unknown as Parameters<
      typeof buildTranscriptionsBatchCreateRoutes
    >[0]),
  );
  await app.register(
    buildNotesBatchCreateRoutes({ db } as unknown as Parameters<
      typeof buildNotesBatchCreateRoutes
    >[0]),
  );
  await app.register(
    buildFoldersBatchCreateRoutes({ db } as unknown as Parameters<
      typeof buildFoldersBatchCreateRoutes
    >[0]),
  );
  await app.register(
    buildConversationsCreateRoutes({ db } as unknown as Parameters<
      typeof buildConversationsCreateRoutes
    >[0]),
  );
  await app.ready();
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
}, 60_000);

beforeEach(async () => {
  await pool.query(
    `TRUNCATE TABLE transcriptions, notes, folders, conversations RESTART IDENTITY CASCADE`,
  );
});

describe("R35 integration — sync endpoints accept the SQLite-form client body", () => {
  it("transcriptions/batch-create: SQLite created_at + non-enum status -> 201, status normalized", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/transcriptions/batch-create",
      payload: {
        transcriptions: [
          {
            client_transcription_id: "client-tx-1",
            text: "hello world",
            created_at: "2026-05-22 16:05:11",
            status: "synced",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      created: {
        id: string;
        client_transcription_id: string;
        status: string;
        created_at: string;
      }[];
    };
    expect(body.created).toHaveLength(1);
    const row = body.created[0];
    expect(row?.client_transcription_id).toBe("client-tx-1");
    // status normalized to a canonical enum value (unknown "synced" -> "completed")
    expect(["pending", "processing", "completed", "failed"]).toContain(row?.status);
    expect(row?.status).toBe("completed");
    // created_at carries the Postgres column default (the client string is
    // parsed-then-discarded per the route — it is not echoed back). The
    // R35 fix is about the INPUT being ACCEPTED; the response datetime
    // format is the existing app behavior, asserted only as a valid date.
    expect(row?.created_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(row?.created_at ?? ""))).toBe(false);

    // the row is readable back from the DB
    const dbRow = await pool.query<{ status: string }>(
      `SELECT status FROM transcriptions WHERE id = $1`,
      [row?.id],
    );
    expect(dbRow.rows[0]?.status).toBe("completed");
  });

  it("notes/batch-create: SQLite created_at/updated_at -> 201 { created:[{client_note_id,id}] }", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/notes/batch-create",
      payload: {
        notes: [
          {
            client_note_id: "client-note-1",
            content: "a note",
            created_at: "2026-05-22 16:05:11",
            updated_at: "2026-05-22 16:05:11",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { created: { client_note_id: string; id: string }[] };
    expect(body.created).toHaveLength(1);
    expect(body.created[0]?.client_note_id).toBe("client-note-1");
    expect(body.created[0]?.id).toBeTruthy();
  });

  it("folders/batch-create: normal folder -> 201 { created:[CloudFolder] } (control case)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/folders/batch-create",
      payload: {
        folders: [{ client_folder_id: "client-folder-1", name: "Inbox" }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { created: { id: string; client_folder_id: string }[] };
    expect(body.created).toHaveLength(1);
    expect(body.created[0]?.client_folder_id).toBe("client-folder-1");
    expect(body.created[0]?.id).toBeTruthy();
  });

  it("conversations/create: SQLite created_at/updated_at -> 201 CloudConversation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/create",
      payload: {
        client_conversation_id: "client-conv-1",
        title: "A conversation",
        created_at: "2026-05-22 16:05:11",
        updated_at: "2026-05-22 16:05:11",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      client_conversation_id: string;
      created_at: string;
    };
    expect(body.client_conversation_id).toBe("client-conv-1");
    expect(body.id).toBeTruthy();
    expect(body.created_at).toBeTruthy();
    expect(Number.isNaN(Date.parse(body.created_at))).toBe(false);
  });
});
