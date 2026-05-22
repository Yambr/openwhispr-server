// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 04 / Task 1 — Settings resolution chain (D-18, D-19, D-20).
//
// Both `/api/stt-config` (WIRE-11) and `/api/note-recording-config`
// (WIRE-12) resolve their response shape from a three-tier chain:
//
//   user_settings.<field>      (highest precedence)
//        ↓ falls through when undefined
//   tenant_settings.<field>
//        ↓ falls through when undefined
//   process.env defaults       (lowest precedence)
//
// D-19 — `availableProviders` is COMPUTED FRESH at every request from
//        process.env (OPENAI_API_KEY, GROQ_API_KEY, ASSEMBLYAI_API_KEY,
//        DEEPGRAM_API_KEY). It is NEVER read from settings tables. This
//        keeps the operator's "I just rotated my GROQ_API_KEY in .env"
//        signal visible to the desktop client without a DB write.
//
// D-31 — These are READ-only in v1. The mutation paths land in Phase 7
//        with the UI; until then `tenant_settings` and `user_settings`
//        rows are seeded by the AFTER INSERT trigger on `tenants`
//        (Plan 01) and otherwise empty. Empty / NULL JSONB columns
//        cleanly fall through to env defaults.
//
// RLS — both queries run inside `withTenant(deps.db, tenantId, …)`. The
//       isolation policies on both tables reference current_setting
//       ('app.tenant_id', true) so cross-tenant settings are invisible
//       (T-05-05 mitigation).

import type { ExecutableTx } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { SttSettingsConfig } from "../config/stt-settings.js";

interface StringRow {
  stt_config?: Record<string, unknown> | null;
  stt_overrides?: Record<string, unknown> | null;
  note_recording_config?: Record<string, unknown> | null;
  note_recording_overrides?: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as readonly string[];
  }
  return undefined;
}

/**
 * D-19 — `availableProviders` is the provider-key presence list resolved
 * at the `config/` env boundary by `loadSttSettingsConfigFromEnv()`.
 *
 * AUDIT-LIB-02 (LIB-9): this function previously read `process.env`
 * directly (outside the LOCKER-01 `config/` boundary). It now returns a
 * defensive COPY of the pre-resolved list threaded through `SttSettingsConfig`,
 * so the resolver no longer touches `process.env`. Order is stable
 * (openai, groq, assemblyai, deepgram) so the desktop client can compare
 * arrays via straight equality.
 */
export function computeAvailableProviders(config: SttSettingsConfig): string[] {
  return [...config.availableProviders];
}

/**
 * Resolve the stt-config response shape for the calling user under the
 * current tenant. MUST be invoked inside a `withTenant` transaction so
 * RLS scopes the SELECTs to the calling tenant.
 *
 * Both SELECTs are parameterized via Drizzle's `sql` template tag (no
 * string interpolation; values bind at protocol level — defense in depth
 * against JSONB injection even though both `tenantId` and `userId` are
 * UUIDs validated upstream).
 */
export async function resolveSttConfig(
  tx: ExecutableTx,
  tenantId: string,
  userId: string,
  config: SttSettingsConfig,
): Promise<{
  defaultModel: string;
  defaultLanguage: string;
  availableProviders: string[];
}> {
  const [tenantRow, userRow] = await Promise.all([
    tx.execute(sql`
      SELECT stt_config FROM tenant_settings
      WHERE tenant_id = ${tenantId}::uuid
      LIMIT 1
    `) as Promise<{ rows?: StringRow[] }>,
    tx.execute(sql`
      SELECT stt_overrides FROM user_settings
      WHERE user_id = ${userId}::uuid
      LIMIT 1
    `) as Promise<{ rows?: StringRow[] }>,
  ]);
  const tenantCfg = asRecord(tenantRow.rows?.[0]?.stt_config);
  const userCfg = asRecord(userRow.rows?.[0]?.stt_overrides);

  const defaultModel =
    (typeof userCfg.defaultModel === "string" ? userCfg.defaultModel : undefined) ??
    (typeof tenantCfg.defaultModel === "string" ? tenantCfg.defaultModel : undefined) ??
    config.sttDefaultModel;
  const defaultLanguage =
    (typeof userCfg.defaultLanguage === "string" ? userCfg.defaultLanguage : undefined) ??
    (typeof tenantCfg.defaultLanguage === "string" ? tenantCfg.defaultLanguage : undefined) ??
    config.sttDefaultLanguage;
  return {
    defaultModel,
    defaultLanguage,
    availableProviders: computeAvailableProviders(config),
  };
}

/**
 * Resolve the note-recording-config response shape for the calling user
 * under the current tenant. Same RLS / chain semantics as
 * resolveSttConfig.
 *
 * Env defaults:
 *   NOTE_RECORDING_MAX_DURATION_SECONDS = 7200
 *   NOTE_RECORDING_SAMPLE_RATE_HZ       = 16000
 *   NOTE_RECORDING_ALLOWED_FORMATS      = "webm,ogg,wav,m4a"
 *   NOTE_RECORDING_DIARIZATION_ENABLED  = "true" (boolean — anything
 *                                                else, including
 *                                                "false" / "0" / "no",
 *                                                disables diarization)
 */
export async function resolveNoteRecordingConfig(
  tx: ExecutableTx,
  tenantId: string,
  userId: string,
  config: SttSettingsConfig,
): Promise<{
  maxDurationSeconds: number;
  sampleRateHz: number;
  allowedFormats: string[];
  diarizationEnabled: boolean;
}> {
  const [tenantRow, userRow] = await Promise.all([
    tx.execute(sql`
      SELECT note_recording_config FROM tenant_settings
      WHERE tenant_id = ${tenantId}::uuid
      LIMIT 1
    `) as Promise<{ rows?: StringRow[] }>,
    tx.execute(sql`
      SELECT note_recording_overrides FROM user_settings
      WHERE user_id = ${userId}::uuid
      LIMIT 1
    `) as Promise<{ rows?: StringRow[] }>,
  ]);
  const tenantCfg = asRecord(tenantRow.rows?.[0]?.note_recording_config);
  const userCfg = asRecord(userRow.rows?.[0]?.note_recording_overrides);

  const maxDurationSeconds =
    (typeof userCfg.maxDurationSeconds === "number" ? userCfg.maxDurationSeconds : undefined) ??
    (typeof tenantCfg.maxDurationSeconds === "number" ? tenantCfg.maxDurationSeconds : undefined) ??
    config.noteRecordingMaxDurationSeconds;
  const sampleRateHz =
    (typeof userCfg.sampleRateHz === "number" ? userCfg.sampleRateHz : undefined) ??
    (typeof tenantCfg.sampleRateHz === "number" ? tenantCfg.sampleRateHz : undefined) ??
    config.noteRecordingSampleRateHz;
  const allowedFormats = (asStringArray(userCfg.allowedFormats) ??
    asStringArray(tenantCfg.allowedFormats) ??
    config.noteRecordingAllowedFormats) as string[];
  const diarizationEnabled =
    (typeof userCfg.diarizationEnabled === "boolean" ? userCfg.diarizationEnabled : undefined) ??
    (typeof tenantCfg.diarizationEnabled === "boolean"
      ? tenantCfg.diarizationEnabled
      : undefined) ??
    config.noteRecordingDiarizationEnabled;

  return {
    maxDurationSeconds,
    sampleRateHz,
    allowedFormats: [...allowedFormats],
    diarizationEnabled,
  };
}
