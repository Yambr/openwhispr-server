// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 — env-driven diarization configuration.
//
// The /v1/audio/diarization route + pyannote.ai REST client previously
// baked their upstream base URL, poll cadence, poll ceiling, and the local
// Speaches diarization model alias as module-level literals. Operators
// pointing at a corporate pyannote mirror, retuning the poll cadence for a
// faster upstream, or preloading a different Speaches model had no env
// override.
//
// `loadDiarizationConfigFromEnv()` lifts those knobs into env vars resolved
// HERE — `config/` is the LOCKER-01 allowlist for `process.env.*` reads.
// The route-assembly seam (apps/api/src/index.ts) calls this once at boot
// and threads the result into the diarization route deps + the pyannote
// client factory; the route/lib source files never touch `process.env`.
//
// Defaults are byte-identical to the pre-existing literals so an operator
// who sets none of these vars sees no behavior change.

import { parsePositiveIntEnv } from "@openwhispr/litellm-client";

/** Pre-existing literal defaults — kept identical so unset env = no drift. */
export const DEFAULT_PYANNOTE_BASE_URL = "https://api.pyannote.ai";
export const DEFAULT_PYANNOTE_POLL_INTERVAL_MS = 1_500;
export const DEFAULT_PYANNOTE_POLL_CEILING_MS = 300_000;
export const DEFAULT_SPEACHES_DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1";

/** Resolved diarization configuration. */
export interface DiarizationConfig {
  /** pyannote.ai REST base URL. Default: https://api.pyannote.ai */
  pyannoteBaseUrl: string;
  /** Job-status poll cadence in ms. Default: 1500. */
  pollIntervalMs: number;
  /** Hard poll ceiling in ms before the route 504s. Default: 300000. */
  pollCeilingMs: number;
  /** Speaches local-diarization model alias. */
  speachesModel: string;
}

/** Read a non-empty trimmed string env var, else `fallback`. */
function readString(raw: string | undefined, fallback: string): string {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Resolve the diarization configuration from the environment.
 *
 * Env vars:
 *   - PYANNOTE_BASE_URL           (default https://api.pyannote.ai)
 *   - PYANNOTE_POLL_INTERVAL_MS   (default 1500)
 *   - PYANNOTE_POLL_CEILING_MS    (default 300000)
 *   - SPEACHES_DIARIZATION_MODEL  (default pyannote/speaker-diarization-community-1)
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected in
 *   unit tests to avoid mutating the global.
 */
export function loadDiarizationConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DiarizationConfig {
  return {
    pyannoteBaseUrl: readString(env.PYANNOTE_BASE_URL, DEFAULT_PYANNOTE_BASE_URL),
    pollIntervalMs: parsePositiveIntEnv(
      env.PYANNOTE_POLL_INTERVAL_MS,
      DEFAULT_PYANNOTE_POLL_INTERVAL_MS,
    ),
    pollCeilingMs: parsePositiveIntEnv(
      env.PYANNOTE_POLL_CEILING_MS,
      DEFAULT_PYANNOTE_POLL_CEILING_MS,
    ),
    speachesModel: readString(env.SPEACHES_DIARIZATION_MODEL, DEFAULT_SPEACHES_DIARIZATION_MODEL),
  };
}
