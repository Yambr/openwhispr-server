// SPDX-License-Identifier: FSL-1.1-ALv2
// BUG-53-41-remaining (a) — LiteLLM boot-time security guard.
//
// Closes the silent-route-drop hole: when `LITELLM_MASTER_KEY` is unset,
// `loadLitellmConfigFromEnv()` (packages/litellm-client/src/config.ts:36)
// throws, and `apps/api/src/index.ts:629` catches → silently skips
// registering the 4 LiteLLM-backed routes (transcribe, reason,
// diarization, realtime). `/api/health` still returns ok=true. The
// breakage is invisible until an operator hits a 404.
//
// `validateLitellmBoot()` is invoked from the boot pathway BEFORE
// the catch arm. It refuses to start the process (exit 78 EX_CONFIG,
// matching `validateAuthBoot()`) when:
//
//   1. NODE_ENV === "production" AND LITELLM_MASTER_KEY is unset / empty.
//   2. NODE_ENV === "production" AND LITELLM_MASTER_KEY matches the
//      dev-tools overlay default (anti-footgun: copying dev .env into
//      prod must not silently work).
//
// In development / test, the guard returns silently — the caller's
// existing catch-and-warn path stays in place.
//
// LOCKER-01 compliance: this module lives under `config/` which is in
// the allowlist for `process.env.*` reads. Only `NODE_ENV` and
// `LITELLM_MASTER_KEY` are inspected.

const EX_CONFIG = 78;

const DEV_OVERLAY_DEFAULT_MASTER_KEY = "sk-dev-master-key-do-not-use-in-prod";

/**
 * Validate LiteLLM boot config or refuse to start.
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected
 *   in unit tests to avoid mutating the global.
 * @param onFail Side-effect invoked instead of `process.exit(78)`.
 *   Production callers omit this parameter; the default invokes
 *   `process.exit(78)` after writing FATAL to stderr.
 */
export function validateLitellmBoot(
  env: NodeJS.ProcessEnv = process.env,
  onFail: (message: string) => never = defaultFail,
): void {
  const isProduction = env.NODE_ENV === "production";
  if (!isProduction) {
    return;
  }

  const masterKey = env.LITELLM_MASTER_KEY ?? "";

  if (masterKey.length === 0) {
    onFail(
      `litellm-boot: NODE_ENV=production with missing LITELLM_MASTER_KEY. ` +
        `Refusing to boot — without it, the api silently drops 4 routes ` +
        `(transcribe, reason, diarization, realtime) while /api/health ` +
        `still reports ok. Set LITELLM_MASTER_KEY in your .env.`,
    );
  }

  if (masterKey === DEV_OVERLAY_DEFAULT_MASTER_KEY) {
    onFail(
      `litellm-boot: NODE_ENV=production with LITELLM_MASTER_KEY=` +
        `"sk-dev-master-key-do-not-use-in-prod". Refusing to boot — this is ` +
        `the well-known dev-tools overlay default and must never reach ` +
        `production. Generate a real key for the deployment.`,
    );
  }
}

function defaultFail(message: string): never {
  // biome-ignore lint/suspicious/noConsole: pre-logger boot path — stderr is the only sink.
  console.error(`FATAL ${message}`);
  process.exit(EX_CONFIG);
}
