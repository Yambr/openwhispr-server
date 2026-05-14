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
 * D-19 — derive `availableProviders` at every request from process.env.
 * Order is stable (openai, groq, assemblyai, deepgram) so the desktop
 * client can compare arrays via straight equality.
 */
export function computeAvailableProviders(): string[] {
  const out: string[] = [];
  if (process.env.OPENAI_API_KEY) out.push("openai");
  if (process.env.GROQ_API_KEY) out.push("groq");
  if (process.env.ASSEMBLYAI_API_KEY) out.push("assemblyai");
  if (process.env.DEEPGRAM_API_KEY) out.push("deepgram");
  return out;
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
    process.env.STT_DEFAULT_MODEL ??
    "whisper-1";
  const defaultLanguage =
    (typeof userCfg.defaultLanguage === "string" ? userCfg.defaultLanguage : undefined) ??
    (typeof tenantCfg.defaultLanguage === "string" ? tenantCfg.defaultLanguage : undefined) ??
    process.env.STT_DEFAULT_LANGUAGE ??
    "auto";
  return {
    defaultModel,
    defaultLanguage,
    availableProviders: computeAvailableProviders(),
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

  const envFormats = (process.env.NOTE_RECORDING_ALLOWED_FORMATS ?? "webm,ogg,wav,m4a")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const maxDurationSeconds =
    (typeof userCfg.maxDurationSeconds === "number" ? userCfg.maxDurationSeconds : undefined) ??
    (typeof tenantCfg.maxDurationSeconds === "number" ? tenantCfg.maxDurationSeconds : undefined) ??
    Number(process.env.NOTE_RECORDING_MAX_DURATION_SECONDS ?? 7200);
  const sampleRateHz =
    (typeof userCfg.sampleRateHz === "number" ? userCfg.sampleRateHz : undefined) ??
    (typeof tenantCfg.sampleRateHz === "number" ? tenantCfg.sampleRateHz : undefined) ??
    Number(process.env.NOTE_RECORDING_SAMPLE_RATE_HZ ?? 16000);
  const allowedFormats = (asStringArray(userCfg.allowedFormats) ??
    asStringArray(tenantCfg.allowedFormats) ??
    envFormats) as string[];
  const diarizationEnabled =
    (typeof userCfg.diarizationEnabled === "boolean" ? userCfg.diarizationEnabled : undefined) ??
    (typeof tenantCfg.diarizationEnabled === "boolean"
      ? tenantCfg.diarizationEnabled
      : undefined) ??
    process.env.NOTE_RECORDING_DIARIZATION_ENABLED !== "false";

  return {
    maxDurationSeconds,
    sampleRateHz,
    allowedFormats: [...allowedFormats],
    diarizationEnabled,
  };
}
