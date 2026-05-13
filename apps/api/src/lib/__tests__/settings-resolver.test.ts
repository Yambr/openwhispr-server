// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 04 / Task 1 — settings-resolver helper tests.
//
// Pure unit coverage with a recording fake tx — no Postgres needed for
// the chain semantics. The companion route integration tests
// (apps/api/src/routes/__tests__/{stt-config,note-recording-config}.test.ts)
// exercise the same helpers against a real testcontainer to prove the
// SQL parameterization round-trips.
//
// Coverage matrix:
//   * resolveSttConfig — empty rows -> env defaults
//   * resolveSttConfig — tenant override wins over env
//   * resolveSttConfig — user override wins over tenant + env
//   * resolveSttConfig — empty JSONB object falls through cleanly
//   * resolveSttConfig — NULL row falls through cleanly
//   * computeAvailableProviders — reads at request time per D-19
//   * computeAvailableProviders — order is stable (openai, groq,
//     assemblyai, deepgram)
//   * availableProviders is NEVER sourced from settings tables
//   * resolveNoteRecordingConfig — empty rows -> defaults
//   * resolveNoteRecordingConfig — tenant override wins
//   * resolveNoteRecordingConfig — user override wins
//   * resolveNoteRecordingConfig — env override of formats list parses
//     comma-separated
//   * resolveNoteRecordingConfig — env NOTE_RECORDING_DIARIZATION_ENABLED
//     ='false' disables diarization
//   * SQL fragments reference tenant_settings AND user_settings (RLS
//     contract — both tables are touched within the same withTenant tx)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeAvailableProviders,
  resolveNoteRecordingConfig,
  resolveSttConfig,
} from "../settings-resolver.js";

const TENANT = "00000000-0000-0000-0000-000000000000";
const USER = "11111111-1111-1111-1111-111111111111";

interface Recorded {
  sql: string;
  params: unknown[];
}

interface FakeTxOpts {
  tenantSttConfig?: unknown;
  userSttOverrides?: unknown;
  tenantNoteRecordingConfig?: unknown;
  userNoteRecordingOverrides?: unknown;
  /** When true, simulate "no row at all" (empty rows array). */
  tenantRowMissing?: boolean;
  userRowMissing?: boolean;
}

function makeFakeTx(opts: FakeTxOpts = {}): {
  tx: { execute(query: unknown): Promise<unknown> };
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
          // drizzle StringChunk — literal SQL text (array of strings)
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        } else {
          // Bare value (string/number/etc) — bound parameter, NOT literal SQL
          parts.push("?");
          params.push(c);
        }
      }
      const sqlText = parts.join("");
      recorded.push({ sql: sqlText, params });
      if (/FROM tenant_settings/i.test(sqlText)) {
        if (opts.tenantRowMissing) return { rows: [] };
        if (/stt_config/i.test(sqlText)) {
          return { rows: [{ stt_config: opts.tenantSttConfig ?? {} }] };
        }
        return {
          rows: [{ note_recording_config: opts.tenantNoteRecordingConfig ?? {} }],
        };
      }
      if (/FROM user_settings/i.test(sqlText)) {
        if (opts.userRowMissing) return { rows: [] };
        if (/stt_overrides/i.test(sqlText)) {
          return { rows: [{ stt_overrides: opts.userSttOverrides ?? {} }] };
        }
        return {
          rows: [{ note_recording_overrides: opts.userNoteRecordingOverrides ?? {} }],
        };
      }
      return { rows: [] };
    },
  };
  return { tx, recorded };
}

const STT_ENV_KEYS = [
  "STT_DEFAULT_MODEL",
  "STT_DEFAULT_LANGUAGE",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "ASSEMBLYAI_API_KEY",
  "DEEPGRAM_API_KEY",
] as const;
const NOTE_ENV_KEYS = [
  "NOTE_RECORDING_MAX_DURATION_SECONDS",
  "NOTE_RECORDING_SAMPLE_RATE_HZ",
  "NOTE_RECORDING_ALLOWED_FORMATS",
  "NOTE_RECORDING_DIARIZATION_ENABLED",
] as const;

const ENV_SNAPSHOT: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [...STT_ENV_KEYS, ...NOTE_ENV_KEYS]) {
    ENV_SNAPSHOT[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of [...STT_ENV_KEYS, ...NOTE_ENV_KEYS]) {
    if (ENV_SNAPSHOT[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = ENV_SNAPSHOT[k];
    }
    delete ENV_SNAPSHOT[k];
  }
  vi.unstubAllEnvs();
});

describe("resolveSttConfig", () => {
  it("returns env defaults when both tenant and user rows are empty", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveSttConfig(tx, TENANT, USER);
    expect(out.defaultModel).toBe("whisper-1");
    expect(out.defaultLanguage).toBe("auto");
    expect(out.availableProviders).toEqual([]);
  });

  it("returns env override when set (no tenant/user values)", async () => {
    process.env.STT_DEFAULT_MODEL = "whisper-large-v3";
    process.env.STT_DEFAULT_LANGUAGE = "en";
    const { tx } = makeFakeTx();
    const out = await resolveSttConfig(tx, TENANT, USER);
    expect(out.defaultModel).toBe("whisper-large-v3");
    expect(out.defaultLanguage).toBe("en");
  });

  it("tenant override wins over env", async () => {
    process.env.STT_DEFAULT_MODEL = "whisper-1";
    const { tx } = makeFakeTx({
      tenantSttConfig: { defaultModel: "large-v3" },
    });
    const out = await resolveSttConfig(tx, TENANT, USER);
    expect(out.defaultModel).toBe("large-v3");
  });

  it("user override wins over tenant override + env", async () => {
    process.env.STT_DEFAULT_MODEL = "whisper-1";
    const { tx } = makeFakeTx({
      tenantSttConfig: { defaultModel: "large-v3" },
      userSttOverrides: { defaultModel: "tiny" },
    });
    const out = await resolveSttConfig(tx, TENANT, USER);
    expect(out.defaultModel).toBe("tiny");
  });

  it("falls through cleanly when JSONB rows are empty objects", async () => {
    const { tx } = makeFakeTx({
      tenantSttConfig: {},
      userSttOverrides: {},
    });
    const out = await resolveSttConfig(tx, TENANT, USER);
    expect(out.defaultModel).toBe("whisper-1");
    expect(out.defaultLanguage).toBe("auto");
  });

  it("falls through cleanly when the rows are missing entirely", async () => {
    const { tx } = makeFakeTx({ tenantRowMissing: true, userRowMissing: true });
    const out = await resolveSttConfig(tx, TENANT, USER);
    expect(out.defaultModel).toBe("whisper-1");
  });

  it("queries both tenant_settings and user_settings (RLS contract)", async () => {
    const { tx, recorded } = makeFakeTx();
    await resolveSttConfig(tx, TENANT, USER);
    const sqls = recorded.map((r) => r.sql).join("\n");
    expect(sqls).toMatch(/FROM tenant_settings/);
    expect(sqls).toMatch(/FROM user_settings/);
    // tenantId + userId are bound parameters, NOT interpolated
    const params = recorded.flatMap((r) => r.params);
    expect(params).toContain(TENANT);
    expect(params).toContain(USER);
  });
});

describe("computeAvailableProviders (D-19 — request-time read of process.env)", () => {
  it("returns empty when no provider keys are set", () => {
    expect(computeAvailableProviders()).toEqual([]);
  });

  it("returns each provider exactly when its env var is set", () => {
    process.env.OPENAI_API_KEY = "sk-xxx";
    expect(computeAvailableProviders()).toEqual(["openai"]);
  });

  it("returns providers in stable order: openai, groq, assemblyai, deepgram", () => {
    process.env.DEEPGRAM_API_KEY = "x";
    process.env.OPENAI_API_KEY = "x";
    process.env.ASSEMBLYAI_API_KEY = "x";
    process.env.GROQ_API_KEY = "x";
    expect(computeAvailableProviders()).toEqual([
      "openai",
      "groq",
      "assemblyai",
      "deepgram",
    ]);
  });
});

describe("availableProviders never sourced from settings tables (D-19)", () => {
  it("ignores availableProviders set in tenant or user JSONB", async () => {
    // No env keys set
    const { tx } = makeFakeTx({
      tenantSttConfig: { availableProviders: ["fake-tenant-provider"] },
      userSttOverrides: { availableProviders: ["fake-user-provider"] },
    });
    const out = await resolveSttConfig(tx, TENANT, USER);
    // Comes from env (empty) — NOT from JSONB
    expect(out.availableProviders).toEqual([]);
    expect(out.availableProviders).not.toContain("fake-tenant-provider");
    expect(out.availableProviders).not.toContain("fake-user-provider");
  });

  it("reflects a freshly-set env key without re-querying settings tables", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    const { tx } = makeFakeTx();
    const out = await resolveSttConfig(tx, TENANT, USER);
    expect(out.availableProviders).toEqual(["openai"]);
  });
});

describe("resolveNoteRecordingConfig", () => {
  it("returns defaults when both tenant and user rows are empty", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER);
    expect(out.maxDurationSeconds).toBe(7200);
    expect(out.sampleRateHz).toBe(16000);
    expect(out.allowedFormats).toEqual(["webm", "ogg", "wav", "m4a"]);
    expect(out.diarizationEnabled).toBe(true);
  });

  it("tenant override wins over defaults", async () => {
    const { tx } = makeFakeTx({
      tenantNoteRecordingConfig: {
        maxDurationSeconds: 3600,
        sampleRateHz: 48000,
        allowedFormats: ["wav"],
        diarizationEnabled: false,
      },
    });
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER);
    expect(out.maxDurationSeconds).toBe(3600);
    expect(out.sampleRateHz).toBe(48000);
    expect(out.allowedFormats).toEqual(["wav"]);
    expect(out.diarizationEnabled).toBe(false);
  });

  it("user override wins over tenant override", async () => {
    const { tx } = makeFakeTx({
      tenantNoteRecordingConfig: {
        maxDurationSeconds: 3600,
        diarizationEnabled: false,
      },
      userNoteRecordingOverrides: {
        maxDurationSeconds: 600,
        diarizationEnabled: true,
      },
    });
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER);
    expect(out.maxDurationSeconds).toBe(600);
    expect(out.diarizationEnabled).toBe(true);
  });

  it("env NOTE_RECORDING_DIARIZATION_ENABLED='false' disables diarization", async () => {
    process.env.NOTE_RECORDING_DIARIZATION_ENABLED = "false";
    const { tx } = makeFakeTx();
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER);
    expect(out.diarizationEnabled).toBe(false);
  });

  it("env NOTE_RECORDING_ALLOWED_FORMATS comma-splits, trims, drops blanks", async () => {
    process.env.NOTE_RECORDING_ALLOWED_FORMATS = "wav, mp3 ,, flac";
    const { tx } = makeFakeTx();
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER);
    expect(out.allowedFormats).toEqual(["wav", "mp3", "flac"]);
  });

  it("env max/sample-rate numeric overrides apply", async () => {
    process.env.NOTE_RECORDING_MAX_DURATION_SECONDS = "120";
    process.env.NOTE_RECORDING_SAMPLE_RATE_HZ = "44100";
    const { tx } = makeFakeTx();
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER);
    expect(out.maxDurationSeconds).toBe(120);
    expect(out.sampleRateHz).toBe(44100);
  });

  it("falls through cleanly when JSONB row is missing", async () => {
    const { tx } = makeFakeTx({ tenantRowMissing: true, userRowMissing: true });
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER);
    expect(out.maxDurationSeconds).toBe(7200);
    expect(out.sampleRateHz).toBe(16000);
  });

  it("queries both tenant_settings and user_settings (RLS contract)", async () => {
    const { tx, recorded } = makeFakeTx();
    await resolveNoteRecordingConfig(tx, TENANT, USER);
    const sqls = recorded.map((r) => r.sql).join("\n");
    expect(sqls).toMatch(/FROM tenant_settings/);
    expect(sqls).toMatch(/FROM user_settings/);
    const params = recorded.flatMap((r) => r.params);
    expect(params).toContain(TENANT);
    expect(params).toContain(USER);
  });
});
