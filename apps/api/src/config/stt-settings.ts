// SPDX-License-Identifier: FSL-1.1-ALv2
// AUDIT-LIB-02 (LIB-9) — env-driven STT / note-recording settings config.
//
// `lib/settings-resolver.ts` previously read `process.env` directly with
// raw `Number()` casts (`NOTE_RECORDING_SAMPLE_RATE_HZ=abc` → NaN silently
// flowed into the wire response) — a `process.env` read OUTSIDE the
// `config/` LOCKER-01 boundary AND unvalidated.
//
// `loadSttSettingsConfigFromEnv()` lifts those reads HERE — `config/` is
// the sanctioned `process.env.*` boundary — and validates them with Zod
// so a malformed knob yields the documented default instead of NaN. The
// resolver functions now take the resolved config object as a dependency;
// the `lib/` source no longer touches `process.env`.
//
// The three-tier resolution chain (user_settings → tenant_settings → env
// default) is unchanged; this config object is exactly the bottom "env
// default" tier, now validated. Defaults are byte-identical to the
// pre-existing literals so valid input sees no behavior change.

import { z } from "zod";

/**
 * Default STT model when `STT_DEFAULT_MODEL` is unset.
 *
 * LEAK 1 fix (2026-05-25, peer wd6g78xz openwhispr client v1.7.8). Was
 * `"whisper-1"` — the OpenAI upstream alias — which leaked through to the
 * desktop client via /api/stt-config:defaultModel and caused lockdown-branded
 * builds to show "OpenAI Whisper" instead of "OpenWhispr Cloud" in Settings.
 * The canonical `openwhispr-default` alias is the server-owned namespace
 * (see compose/litellm/litellm_config.yaml entries `openwhispr-default` /
 * `openwhispr-reason` / `openwhispr-realtime`). Operators that wire a
 * different upstream override via `STT_DEFAULT_MODEL`; the alias mapping
 * lives in their LiteLLM config and is invisible to the client.
 */
export const DEFAULT_STT_MODEL = "openwhispr-default";
/** Default STT language when `STT_DEFAULT_LANGUAGE` is unset. */
export const DEFAULT_STT_LANGUAGE = "auto";
/** Default note-recording max duration (seconds). */
export const DEFAULT_NOTE_RECORDING_MAX_DURATION_SECONDS = 7200;
/** Default note-recording sample rate (Hz). */
export const DEFAULT_NOTE_RECORDING_SAMPLE_RATE_HZ = 16000;
/** Default note-recording allowed upload formats. */
export const DEFAULT_NOTE_RECORDING_ALLOWED_FORMATS = ["webm", "ogg", "wav", "m4a"] as const;

/**
 * A positive-integer env field: an unset, empty, or malformed value
 * (`abc`, `0`, `-5`, `12.5`) coerces to the supplied default rather than
 * NaN. `z.coerce.number()` on an empty string yields 0, which the
 * `.int().positive()` refinement rejects → `.catch(default)` applies.
 */
const positiveIntField = (def: number) =>
  z.coerce.number().int().positive().catch(def).default(def);

/** A non-empty trimmed string field, else the supplied default. */
const stringField = (def: string) => z.string().trim().min(1).catch(def).default(def);

/**
 * `NOTE_RECORDING_ALLOWED_FORMATS` — comma-separated list. Empty / unset
 * yields the default four-format list.
 */
const allowedFormatsField = z
  .string()
  .optional()
  .transform((raw) => {
    if (raw === undefined) return [...DEFAULT_NOTE_RECORDING_ALLOWED_FORMATS];
    const parsed = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : [...DEFAULT_NOTE_RECORDING_ALLOWED_FORMATS];
  });

/**
 * `NOTE_RECORDING_DIARIZATION_ENABLED` — diarization is ON unless the var
 * is exactly the string `"false"` (preserves the pre-existing
 * `!== "false"` semantics: any other value, including `"0"` / `"no"`,
 * leaves diarization enabled).
 */
const diarizationEnabledField = z
  .string()
  .optional()
  .transform((raw) => raw !== "false");

export const sttSettingsEnvSchema = z.object({
  STT_DEFAULT_MODEL: stringField(DEFAULT_STT_MODEL),
  STT_DEFAULT_LANGUAGE: stringField(DEFAULT_STT_LANGUAGE),
  NOTE_RECORDING_MAX_DURATION_SECONDS: positiveIntField(
    DEFAULT_NOTE_RECORDING_MAX_DURATION_SECONDS,
  ),
  NOTE_RECORDING_SAMPLE_RATE_HZ: positiveIntField(DEFAULT_NOTE_RECORDING_SAMPLE_RATE_HZ),
  NOTE_RECORDING_ALLOWED_FORMATS: allowedFormatsField,
  NOTE_RECORDING_DIARIZATION_ENABLED: diarizationEnabledField,
  // D-19 — provider-key PRESENCE drives `availableProviders`. Only
  // presence matters (the key value never reaches the wire), so each is
  // coerced to a boolean.
  OPENAI_API_KEY: z
    .string()
    .optional()
    .transform((v) => Boolean(v)),
  GROQ_API_KEY: z
    .string()
    .optional()
    .transform((v) => Boolean(v)),
  ASSEMBLYAI_API_KEY: z
    .string()
    .optional()
    .transform((v) => Boolean(v)),
  DEEPGRAM_API_KEY: z
    .string()
    .optional()
    .transform((v) => Boolean(v)),
});

/** Resolved STT / note-recording env-default settings. */
export interface SttSettingsConfig {
  /** Bottom-tier default STT model. */
  sttDefaultModel: string;
  /** Bottom-tier default STT language. */
  sttDefaultLanguage: string;
  /** Bottom-tier default note-recording max duration (seconds). */
  noteRecordingMaxDurationSeconds: number;
  /** Bottom-tier default note-recording sample rate (Hz). */
  noteRecordingSampleRateHz: number;
  /** Bottom-tier default note-recording allowed formats. */
  noteRecordingAllowedFormats: string[];
  /** Bottom-tier default diarization-enabled flag. */
  noteRecordingDiarizationEnabled: boolean;
  /**
   * STT provider keys present in the environment, in the stable order
   * (openai, groq, assemblyai, deepgram) the desktop client compares
   * against via straight array equality (D-19).
   */
  availableProviders: string[];
}

/**
 * Resolve {@link SttSettingsConfig} from the environment. Called once at
 * the `index.ts` env boundary; the result is threaded into the
 * stt-config / note-recording-config route deps.
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected in
 *   unit tests to avoid mutating the global.
 */
export function loadSttSettingsConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SttSettingsConfig {
  const parsed = sttSettingsEnvSchema.parse(env);
  const availableProviders: string[] = [];
  if (parsed.OPENAI_API_KEY) availableProviders.push("openai");
  if (parsed.GROQ_API_KEY) availableProviders.push("groq");
  if (parsed.ASSEMBLYAI_API_KEY) availableProviders.push("assemblyai");
  if (parsed.DEEPGRAM_API_KEY) availableProviders.push("deepgram");
  return {
    sttDefaultModel: parsed.STT_DEFAULT_MODEL,
    sttDefaultLanguage: parsed.STT_DEFAULT_LANGUAGE,
    noteRecordingMaxDurationSeconds: parsed.NOTE_RECORDING_MAX_DURATION_SECONDS,
    noteRecordingSampleRateHz: parsed.NOTE_RECORDING_SAMPLE_RATE_HZ,
    noteRecordingAllowedFormats: parsed.NOTE_RECORDING_ALLOWED_FORMATS,
    noteRecordingDiarizationEnabled: parsed.NOTE_RECORDING_DIARIZATION_ENABLED,
    availableProviders,
  };
}
