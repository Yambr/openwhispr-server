// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track F — api-core:CR-01 production safety-knob boot guard.
//
// Four env knobs disable anti-abuse / verification controls or swap in a
// mock backend:
//
//   - OPENWHISPR_DISABLE_RATE_LIMIT          — turns off the rate limiter
//   - OPENWHISPR_DISABLE_EMAIL_VERIFICATION  — skips email-verification gate
//   - OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE — disables the cookie cache
//   - MOCK_DIARIZATION                       — replaces diarization with a fixture
//
// Each is a legitimate dev / test / load-test affordance, but a single
// leaked `.env` line in a public-facing production deploy silently disables
// core security controls. Pre-fix the knobs only WARN-logged and continued.
//
// `validateSafetyKnobsBoot()` joins the loud-fail family
// (`validateEncryptionBoot` / `validateAuthBoot` / `validateIngressBoot` /
// `validateBetterAuthSecretBoot`): it REFUSES to start the process
// (exit 78 EX_CONFIG) when ANY knob is truthy while NODE_ENV=production.
// In any non-production env the knobs stay fully functional.
//
// LOCKER-01 compliance: this module lives under `config/`, the allowlist
// for `process.env.*` reads — the NODE_ENV branch here is permitted. The
// knob-READ sites in plugins/routes read only `OPENWHISPR_DISABLE_*` /
// `MOCK_DIARIZATION` (not NODE_ENV) and are unchanged; this gate adds a
// boot-time veto in front of them.

/** Process exit code for configuration errors (sysexits.h EX_CONFIG). */
export const EX_CONFIG = 78;

/** The four production-dangerous env knobs vetoed under NODE_ENV=production. */
export const SAFETY_KNOBS = [
  "OPENWHISPR_DISABLE_RATE_LIMIT",
  "OPENWHISPR_DISABLE_EMAIL_VERIFICATION",
  "OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE",
  "MOCK_DIARIZATION",
] as const;

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

/**
 * Validate the production safety knobs or refuse to start.
 *
 * @param env Environment snapshot. Defaults to `process.env`; injected in
 *   unit tests to avoid mutating the global.
 * @param onFail Side-effect invoked instead of `process.exit(78)` — the
 *   default both writes a stderr line and exits. Production callers omit
 *   this parameter.
 * @returns `{ ok: true }` when NODE_ENV is not production, or when no knob
 *   is set to a truthy value.
 */
export function validateSafetyKnobsBoot(
  env: NodeJS.ProcessEnv = process.env,
  onFail: (message: string) => never = defaultFail,
): { ok: true } {
  if (env.NODE_ENV !== "production") return { ok: true };

  const offenders = SAFETY_KNOBS.filter((knob) => isTruthy(env[knob]));
  if (offenders.length === 0) return { ok: true };

  onFail(
    `safety-knobs-boot [EX_CONFIG]: ${offenders.join(", ")} set with ` +
      `NODE_ENV=production. These knobs disable anti-abuse / email-verification / ` +
      `session-cookie-cache controls (or swap in a mock diarization backend) and ` +
      `are dev/test/load-test only — refusing to boot. Unset the knob, or run ` +
      `with NODE_ENV=development for local profiles. See docs/security.md ` +
      `§safety-knobs. Closes api-core:CR-01 (Phase 57).`,
  );

  return { ok: true };
}

/**
 * Default failure behaviour: throw a loud Error. The boot entrypoint
 * (`index.ts`) catches it and converts the throw into `process.exit(78)`
 * so the process refuses to start. Throwing (rather than calling
 * `process.exit` here) keeps the function unit-testable without killing
 * the test runner — the message carries `EX_CONFIG` so the contract is
 * still asserted.
 */
function defaultFail(message: string): never {
  throw new Error(message);
}
