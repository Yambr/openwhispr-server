// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 04 / Task 1 — settings-resolver helper tests.
// AUDIT-LIB-02 (LIB-9) — the resolver no longer reads `process.env`; the
// env-default tier is a validated `SttSettingsConfig` threaded in as a
// dependency. These tests build that config via `loadSttSettingsConfigFromEnv`
// against an injected env snapshot (the same `config/` loader production
// uses) so the chain semantics still exercise real env resolution.
//
// Pure unit coverage with a recording fake tx — no Postgres needed for
// the chain semantics. The companion route integration tests
// (apps/api/src/routes/__tests__/{stt-config,note-recording-config}.test.ts)
// exercise the same helpers against a real testcontainer to prove the
// SQL parameterization round-trips.
//
// Coverage matrix:
//   * resolveSttConfig — empty rows -> config defaults
//   * resolveSttConfig — tenant override wins over config
//   * resolveSttConfig — user override wins over tenant + config
//   * resolveSttConfig — empty JSONB object falls through cleanly
//   * resolveSttConfig — NULL row falls through cleanly
//   * computeAvailableProviders — returns the config's provider list
//   * computeAvailableProviders — order is stable
//   * availableProviders is NEVER sourced from settings tables
//   * resolveNoteRecordingConfig — empty rows -> config defaults
//   * resolveNoteRecordingConfig — tenant / user overrides win
//   * resolveNoteRecordingConfig — config-driven formats / diarization /
//     numeric defaults
//   * SQL fragments reference tenant_settings AND user_settings

import { describe, expect, it } from "vitest";
import {
  loadSttSettingsConfigFromEnv,
  type SttSettingsConfig,
} from "../../../../src/config/stt-settings.js";
import {
  computeAvailableProviders,
  resolveNoteRecordingConfig,
  resolveSttConfig,
} from "../../../../src/lib/settings-resolver.js";

const TENANT = "00000000-0000-0000-0000-000000000000";
const USER = "11111111-1111-1111-1111-111111111111";

/** Build a validated SttSettingsConfig from an injected env snapshot. */
function cfg(env: Record<string, string> = {}): SttSettingsConfig {
  return loadSttSettingsConfigFromEnv(env as NodeJS.ProcessEnv);
}

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

describe("resolveSttConfig", () => {
  it("returns config defaults when both tenant and user rows are empty", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveSttConfig(tx, TENANT, USER, cfg());
    expect(out.defaultModel).toBe("whisper-1");
    expect(out.defaultLanguage).toBe("auto");
    expect(out.availableProviders).toEqual([]);
  });

  it("returns config-tier env override when set (no tenant/user values)", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveSttConfig(
      tx,
      TENANT,
      USER,
      cfg({ STT_DEFAULT_MODEL: "whisper-large-v3", STT_DEFAULT_LANGUAGE: "en" }),
    );
    expect(out.defaultModel).toBe("whisper-large-v3");
    expect(out.defaultLanguage).toBe("en");
  });

  it("tenant override wins over config default", async () => {
    const { tx } = makeFakeTx({ tenantSttConfig: { defaultModel: "large-v3" } });
    const out = await resolveSttConfig(tx, TENANT, USER, cfg({ STT_DEFAULT_MODEL: "whisper-1" }));
    expect(out.defaultModel).toBe("large-v3");
  });

  it("user override wins over tenant override + config", async () => {
    const { tx } = makeFakeTx({
      tenantSttConfig: { defaultModel: "large-v3" },
      userSttOverrides: { defaultModel: "tiny" },
    });
    const out = await resolveSttConfig(tx, TENANT, USER, cfg({ STT_DEFAULT_MODEL: "whisper-1" }));
    expect(out.defaultModel).toBe("tiny");
  });

  it("falls through cleanly when JSONB rows are empty objects", async () => {
    const { tx } = makeFakeTx({ tenantSttConfig: {}, userSttOverrides: {} });
    const out = await resolveSttConfig(tx, TENANT, USER, cfg());
    expect(out.defaultModel).toBe("whisper-1");
    expect(out.defaultLanguage).toBe("auto");
  });

  it("falls through cleanly when the rows are missing entirely", async () => {
    const { tx } = makeFakeTx({ tenantRowMissing: true, userRowMissing: true });
    const out = await resolveSttConfig(tx, TENANT, USER, cfg());
    expect(out.defaultModel).toBe("whisper-1");
  });

  it("queries both tenant_settings and user_settings (RLS contract)", async () => {
    const { tx, recorded } = makeFakeTx();
    await resolveSttConfig(tx, TENANT, USER, cfg());
    const sqls = recorded.map((r) => r.sql).join("\n");
    expect(sqls).toMatch(/FROM tenant_settings/);
    expect(sqls).toMatch(/FROM user_settings/);
    const params = recorded.flatMap((r) => r.params);
    expect(params).toContain(TENANT);
    expect(params).toContain(USER);
  });
});

describe("computeAvailableProviders (D-19 — config-resolved provider list)", () => {
  it("returns empty when no provider keys are set", () => {
    expect(computeAvailableProviders(cfg())).toEqual([]);
  });

  it("returns each provider exactly when its key is present", () => {
    expect(computeAvailableProviders(cfg({ OPENAI_API_KEY: "sk-xxx" }))).toEqual(["openai"]);
  });

  it("returns providers in stable order: openai, groq, assemblyai, deepgram", () => {
    const config = cfg({
      DEEPGRAM_API_KEY: "x",
      OPENAI_API_KEY: "x",
      ASSEMBLYAI_API_KEY: "x",
      GROQ_API_KEY: "x",
    });
    expect(computeAvailableProviders(config)).toEqual(["openai", "groq", "assemblyai", "deepgram"]);
  });

  it("returns a defensive copy (mutating the result does not mutate config)", () => {
    const config = cfg({ OPENAI_API_KEY: "x" });
    const first = computeAvailableProviders(config);
    first.push("tampered");
    expect(computeAvailableProviders(config)).toEqual(["openai"]);
  });
});

describe("availableProviders never sourced from settings tables (D-19)", () => {
  it("ignores availableProviders set in tenant or user JSONB", async () => {
    const { tx } = makeFakeTx({
      tenantSttConfig: { availableProviders: ["fake-tenant-provider"] },
      userSttOverrides: { availableProviders: ["fake-user-provider"] },
    });
    const out = await resolveSttConfig(tx, TENANT, USER, cfg());
    expect(out.availableProviders).toEqual([]);
    expect(out.availableProviders).not.toContain("fake-tenant-provider");
    expect(out.availableProviders).not.toContain("fake-user-provider");
  });

  it("reflects a provider key present in the resolved config", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveSttConfig(tx, TENANT, USER, cfg({ OPENAI_API_KEY: "sk-x" }));
    expect(out.availableProviders).toEqual(["openai"]);
  });
});

describe("resolveNoteRecordingConfig", () => {
  it("returns config defaults when both tenant and user rows are empty", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER, cfg());
    expect(out.maxDurationSeconds).toBe(7200);
    expect(out.sampleRateHz).toBe(16000);
    expect(out.allowedFormats).toEqual(["webm", "ogg", "wav", "m4a"]);
    expect(out.diarizationEnabled).toBe(true);
  });

  it("tenant override wins over config defaults", async () => {
    const { tx } = makeFakeTx({
      tenantNoteRecordingConfig: {
        maxDurationSeconds: 3600,
        sampleRateHz: 48000,
        allowedFormats: ["wav"],
        diarizationEnabled: false,
      },
    });
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER, cfg());
    expect(out.maxDurationSeconds).toBe(3600);
    expect(out.sampleRateHz).toBe(48000);
    expect(out.allowedFormats).toEqual(["wav"]);
    expect(out.diarizationEnabled).toBe(false);
  });

  it("user override wins over tenant override", async () => {
    const { tx } = makeFakeTx({
      tenantNoteRecordingConfig: { maxDurationSeconds: 3600, diarizationEnabled: false },
      userNoteRecordingOverrides: { maxDurationSeconds: 600, diarizationEnabled: true },
    });
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER, cfg());
    expect(out.maxDurationSeconds).toBe(600);
    expect(out.diarizationEnabled).toBe(true);
  });

  it("config NOTE_RECORDING_DIARIZATION_ENABLED='false' disables diarization", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveNoteRecordingConfig(
      tx,
      TENANT,
      USER,
      cfg({ NOTE_RECORDING_DIARIZATION_ENABLED: "false" }),
    );
    expect(out.diarizationEnabled).toBe(false);
  });

  it("config NOTE_RECORDING_ALLOWED_FORMATS comma-splits, trims, drops blanks", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveNoteRecordingConfig(
      tx,
      TENANT,
      USER,
      cfg({ NOTE_RECORDING_ALLOWED_FORMATS: "wav, mp3 ,, flac" }),
    );
    expect(out.allowedFormats).toEqual(["wav", "mp3", "flac"]);
  });

  it("config max/sample-rate numeric overrides apply", async () => {
    const { tx } = makeFakeTx();
    const out = await resolveNoteRecordingConfig(
      tx,
      TENANT,
      USER,
      cfg({
        NOTE_RECORDING_MAX_DURATION_SECONDS: "120",
        NOTE_RECORDING_SAMPLE_RATE_HZ: "44100",
      }),
    );
    expect(out.maxDurationSeconds).toBe(120);
    expect(out.sampleRateHz).toBe(44100);
  });

  it("falls through cleanly when JSONB row is missing", async () => {
    const { tx } = makeFakeTx({ tenantRowMissing: true, userRowMissing: true });
    const out = await resolveNoteRecordingConfig(tx, TENANT, USER, cfg());
    expect(out.maxDurationSeconds).toBe(7200);
    expect(out.sampleRateHz).toBe(16000);
  });

  it("queries both tenant_settings and user_settings (RLS contract)", async () => {
    const { tx, recorded } = makeFakeTx();
    await resolveNoteRecordingConfig(tx, TENANT, USER, cfg());
    const sqls = recorded.map((r) => r.sql).join("\n");
    expect(sqls).toMatch(/FROM tenant_settings/);
    expect(sqls).toMatch(/FROM user_settings/);
    const params = recorded.flatMap((r) => r.params);
    expect(params).toContain(TENANT);
    expect(params).toContain(USER);
  });
});
