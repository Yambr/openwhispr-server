// Phase 05 / Plan 04 / Task 2 — GET /api/note-recording-config plugin tests.
//
// Symmetric to stt-config.test.ts. The full chain semantics live in
// the settings-resolver unit suite; this file pins the route's
// 200/401/RLS contract.

import { NoteRecordingConfigResponseSchema } from "@openwhispr/wire-schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../error-handler.js";
import { zodTypeProvider } from "../../plugins/zod-type-provider.js";
import { buildNoteRecordingConfigRoutes } from "../note-recording-config.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "33333333-3333-3333-3333-333333333333";

interface Recorded {
  sql: string;
  params: unknown[];
}

interface FakeDbOpts {
  tenantNote?: unknown;
  userNote?: unknown;
}

function makeFakeDb(opts: FakeDbOpts = {}): {
  db: Parameters<typeof buildNoteRecordingConfigRoutes>[0]["db"];
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        } else {
          parts.push("?");
          params.push(c);
        }
      }
      const sqlText = parts.join("");
      recorded.push({ sql: sqlText, params });
      if (/FROM tenant_settings/i.test(sqlText)) {
        return { rows: [{ note_recording_config: opts.tenantNote ?? {} }] };
      }
      if (/FROM user_settings/i.test(sqlText)) {
        return { rows: [{ note_recording_overrides: opts.userNote ?? {} }] };
      }
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return { db, recorded };
}

function buildApp(
  deps: Parameters<typeof buildNoteRecordingConfigRoutes>[0],
  opts?: { authed?: boolean },
): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  if (opts?.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "note-rec-config@test" };
      req.tenant = TEST_TENANT;
    });
  }
  app.register(buildNoteRecordingConfigRoutes(deps));
  return app;
}

const ENV_KEYS = [
  "NOTE_RECORDING_MAX_DURATION_SECONDS",
  "NOTE_RECORDING_SAMPLE_RATE_HZ",
  "NOTE_RECORDING_ALLOWED_FORMATS",
  "NOTE_RECORDING_DIARIZATION_ENABLED",
] as const;
const SNAPSHOT: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    SNAPSHOT[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SNAPSHOT[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = SNAPSHOT[k];
    }
    delete SNAPSHOT[k];
  }
});

describe("GET /api/note-recording-config", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 200 + canonical defaults on the happy path", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({
      method: "GET",
      url: "/api/note-recording-config",
    });
    expect(res.statusCode).toBe(200);
    const parsed = NoteRecordingConfigResponseSchema.parse(res.json());
    expect(parsed.maxDurationSeconds).toBe(7200);
    expect(parsed.sampleRateHz).toBe(16000);
    expect(parsed.allowedFormats).toEqual(["webm", "ogg", "wav", "m4a"]);
    expect(parsed.diarizationEnabled).toBe(true);
  });

  it("returns 401 envelope when req.user is absent (defensive guard)", async () => {
    const { db } = makeFakeDb();
    app = buildApp({ db }, { authed: false });
    const res = await app.inject({
      method: "GET",
      url: "/api/note-recording-config",
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBeTruthy();
  });

  it("queries BOTH tenant_settings + user_settings under withTenant (RLS)", async () => {
    const { db, recorded } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({
      method: "GET",
      url: "/api/note-recording-config",
    });
    expect(res.statusCode).toBe(200);
    const sqls = recorded.map((r) => r.sql).join("\n");
    expect(sqls).toMatch(/set_config\('app\.tenant_id'/);
    expect(sqls).toMatch(/FROM tenant_settings/);
    expect(sqls).toMatch(/FROM user_settings/);
    const params = recorded.flatMap((r) => r.params);
    expect(params).toContain(TEST_TENANT);
    expect(params).toContain(TEST_USER);
  });

  it("user override wins over tenant + env in the rendered response", async () => {
    process.env.NOTE_RECORDING_MAX_DURATION_SECONDS = "7200";
    const { db } = makeFakeDb({
      tenantNote: { maxDurationSeconds: 3600, diarizationEnabled: false },
      userNote: { maxDurationSeconds: 600 },
    });
    app = buildApp({ db });
    const res = await app.inject({
      method: "GET",
      url: "/api/note-recording-config",
    });
    expect(res.statusCode).toBe(200);
    const parsed = NoteRecordingConfigResponseSchema.parse(res.json());
    // user > tenant
    expect(parsed.maxDurationSeconds).toBe(600);
    // tenant still wins where user didn't override
    expect(parsed.diarizationEnabled).toBe(false);
  });

  it("env NOTE_RECORDING_DIARIZATION_ENABLED='false' disables diarization", async () => {
    process.env.NOTE_RECORDING_DIARIZATION_ENABLED = "false";
    const { db } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({
      method: "GET",
      url: "/api/note-recording-config",
    });
    const parsed = NoteRecordingConfigResponseSchema.parse(res.json());
    expect(parsed.diarizationEnabled).toBe(false);
  });

  it("env NOTE_RECORDING_ALLOWED_FORMATS comma-splits / trims", async () => {
    process.env.NOTE_RECORDING_ALLOWED_FORMATS = "wav,mp3, flac";
    const { db } = makeFakeDb();
    app = buildApp({ db });
    const res = await app.inject({
      method: "GET",
      url: "/api/note-recording-config",
    });
    const parsed = NoteRecordingConfigResponseSchema.parse(res.json());
    expect(parsed.allowedFormats).toEqual(["wav", "mp3", "flac"]);
  });
});
