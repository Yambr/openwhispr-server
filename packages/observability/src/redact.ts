// Phase 6 / Plan 06-10 — shared pino redact configuration.
//
// Canonical sensitive-key list + `makePino()` factory used by BOTH the API
// tier (`apps/api/src/plugins/request-log.ts`) and the Worker tier
// (`apps/worker/src/lib/with-tenant-context.ts`, `with-system-context.ts`).
//
// Per CLAUDE.md monorepo invariants, apps depend on packages — never the
// reverse, and apps do not import from sibling apps. Plan 06-10's original
// proposal had the worker import `makePino` from `@openwhispr/api`; that
// would invert the dependency direction and is forbidden. The shared
// observability package is the proper enterprise fix (deviation Rule 3).
//
// D-T4 anchors:
//   - Scrub bearer tokens / cookies / OAuth callback params / generic
//     `*.token` `*.secret` `*.password` `*.apiKey` keys at SOURCE so a
//     CloudWatch/EKS node-log capture cannot grab raw secrets in the brief
//     window before a Collector-side scrubber would otherwise read them.
//   - Censor literal: `[REDACTED]`.
//   - Pino wildcard `*.foo` matches one-level-deep keys (`obj.foo`) but
//     does NOT match root-level keys; explicit top-level entries below
//     close the gap so a stray `log.info({ token })` cannot leak.
import pino, { type DestinationStream, type Logger } from "pino";

/**
 * Canonical sensitive-key list — Phase 6 D-T4 + extensions for every
 * surface introduced by Phases 2/3/5/6 routes and worker jobs.
 *
 * The unit test in `redact.test.ts` asserts every D-T4 path is present and
 * exercises a sentinel sweep across every entry.
 */
export const REDACT_PATHS: readonly string[] = [
  // ── D-T4 verbatim ────────────────────────────────────────────────────
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  'res.headers["set-auth-token"]',
  'res.headers["set-cookie"]',
  // Wildcard one-level-deep matches (D-T4).
  "*.token",
  "*.secret",
  "*.password",
  "*.apiKey",
  "*.api_key",
  "*.virtualKey",
  "*.virtual_key",
  "*.client_secret",
  "*.access_token",
  "*.refresh_token",
  "*.bearer_token",
  "*.set-auth-token",
  // Request bodies for auth endpoints + OAuth callback URL params.
  "req.body.password",
  "req.body.token",
  "req.body.virtual_key",
  "req.query.code",
  "req.query.state",
  // ── Top-level entries (closes the *.foo gap for root-level keys) ────
  "token",
  "secret",
  "password",
  "apiKey",
  "api_key",
  "virtualKey",
  "virtual_key",
  "client_secret",
  "access_token",
  "refresh_token",
  "bearer_token",
  "authorization",
  "cookie",
  // ── Provider/env API keys surfaced by Phase 3 + Phase 5 ─────────────
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "PYANNOTE_API_KEY",
  "TAVILY_API_KEY",
  "YANDEX_API_KEY",
  "LITELLM_VIRTUAL_KEY",
  "LITELLM_MASTER_KEY",
  // ── Wildcards for the env-key family (covers *.OPENAI_API_KEY etc.) ─
  "*.OPENAI_API_KEY",
  "*.OPENROUTER_API_KEY",
  "*.GROQ_API_KEY",
  "*.PYANNOTE_API_KEY",
  "*.TAVILY_API_KEY",
  "*.YANDEX_API_KEY",
  "*.LITELLM_VIRTUAL_KEY",
  "*.LITELLM_MASTER_KEY",
];

/** Literal censor token emitted in place of any redacted value. */
export const REDACT_CENSOR = "[REDACTED]";

export interface MakePinoOptions {
  /** Static fields merged onto every record (e.g. `{ service: 'worker' }`). */
  base?: Record<string, unknown> | null;
  /** Test seam — destination stream to capture serialized output. */
  destination?: DestinationStream;
  /** Override the log level (default: env `LOG_LEVEL` or `'info'`). */
  level?: pino.LevelWithSilent;
}

/**
 * Build a pino logger with the canonical Phase 6 D-T4 redact policy.
 *
 * Production callers in BOTH tiers (API + Worker) MUST go through this
 * factory rather than constructing pino directly — that is how the
 * sentinel-sweep integration test (tests/integration/log-scrub-sentinel.test.ts)
 * proves the redact policy is universally applied.
 */
export function makePino(opts: MakePinoOptions = {}): Logger {
  const pinoOptions: pino.LoggerOptions = {
    level: opts.level ?? (process.env["LOG_LEVEL"] as pino.LevelWithSilent | undefined) ?? "info",
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACT_CENSOR,
    },
    // English-only key constraint enforced by convention + sentinel test
    // (CLAUDE.md DOCS-09 / English-only constitutional rule).
  };
  if (opts.base !== undefined && opts.base !== null) {
    pinoOptions.base = opts.base;
  }
  if (opts.destination) {
    return pino(pinoOptions, opts.destination);
  }
  return pino(pinoOptions);
}
