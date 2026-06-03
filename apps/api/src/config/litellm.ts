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
// #5 (peer gr0flvsr) — the corporate-override path provisions a
// `LITELLM_VIRTUAL_KEY` and never sets `LITELLM_MASTER_KEY` (HI-2).
// `loadLitellmConfigFromEnv()` already prefers VIRTUAL over MASTER, so the
// runtime client boots fine — but this guard read MASTER directly and
// refused, blocking the operator who configured it correctly. The guard now
// resolves the EFFECTIVE key the same way (VIRTUAL wins) and accepts either.
// The dev-default footgun check then applies to the EFFECTIVE key: when a
// real virtual key is in play the master is unused, so a stale dev-default
// master must not block boot.
//
// LOCKER-01 compliance: this module lives under `config/` which is in
// the allowlist for `process.env.*` reads. Only `NODE_ENV`,
// `LITELLM_VIRTUAL_KEY` and `LITELLM_MASTER_KEY` are inspected.

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

  // Resolve the EFFECTIVE credential with the same precedence as
  // loadLitellmConfigFromEnv (HI-2): a non-empty LITELLM_VIRTUAL_KEY wins,
  // else LITELLM_MASTER_KEY. Either being present means a credential is
  // configured and the 4 LiteLLM routes will register.
  const virtualKey = env.LITELLM_VIRTUAL_KEY ?? "";
  const masterKey = env.LITELLM_MASTER_KEY ?? "";
  const effectiveKey = virtualKey.length > 0 ? virtualKey : masterKey;

  if (effectiveKey.length === 0) {
    onFail(
      `litellm-boot: NODE_ENV=production with no LiteLLM credential. ` +
        `Set LITELLM_VIRTUAL_KEY (corporate-override path) or ` +
        `LITELLM_MASTER_KEY. Refusing to boot — without one, the api ` +
        `silently drops 4 routes (transcribe, reason, diarization, ` +
        `realtime) while /api/health still reports ok.`,
    );
  }

  if (effectiveKey === DEV_OVERLAY_DEFAULT_MASTER_KEY) {
    onFail(
      `litellm-boot: NODE_ENV=production with the LiteLLM key set to ` +
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
