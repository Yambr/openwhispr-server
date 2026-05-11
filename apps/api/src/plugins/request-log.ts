// Phase 2 / Plan 03 / Task 3 — `x-openwhispr-source` request-log tag
// (D-16 / WIRE-19).
//
// Phase 6 / Plan 03 / Task 1 — pino logger factory + D-T4 redact paths.
//
// The desktop client sends `x-openwhispr-source: desktop` on every
// request so server logs can be filtered to client-traffic-only when
// triaging. We mirror it onto every `req.log` child so structured log
// lines carry it automatically.
//
// `null` is the explicit value when the header is absent, which is
// preferable to leaving the field undefined (Loki / Grafana queries
// can match on the canonical absent-value sentinel rather than special-
// casing the missing-field branch).
//
// `redactPaths` + `buildLogger()` (Phase 6 D-T4) configure pino to
// scrub bearer tokens / cookies / OAuth callback params / generic
// `*.token` `*.secret` `*.password` `*.apiKey` keys at SOURCE. The
// scrubbing happens before the log record reaches stdout, closing the
// brief stdout-leak window that a Collector-side scrubber would leave
// open (CloudWatch/EKS node-log capture would otherwise grab the raw
// secret).
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import pino, { type DestinationStream, type Logger } from "pino";

/**
 * Pino redact paths — Phase 6 D-T4 verbatim.
 *
 * Every entry below maps to a documented leak vector. The unit test
 * in `request-log.test.ts` asserts each is present.
 */
export const redactPaths: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  'res.headers["set-auth-token"]',
  'res.headers["set-cookie"]',
  "*.token",
  "*.secret",
  "*.password",
  "*.apiKey",
  "*.api_key",
  "*.virtualKey",
  "*.client_secret",
  "*.access_token",
  "*.refresh_token",
  // Top-level redactions — pino wildcard `*.foo` matches one-level-
  // deep keys only. The explicit top-level entries below close the
  // gap so a stray `log.info({ token })` cannot leak the bearer.
  "token",
  "secret",
  "password",
  "apiKey",
  "api_key",
  "virtualKey",
  "client_secret",
  "access_token",
  "refresh_token",
  "req.body.password",
  "req.body.token",
  "req.query.code",
  "req.query.state",
];

/**
 * Build a pino logger with the Phase 6 D-T4 redact policy applied.
 *
 * The optional `destination` parameter lets tests capture serialized
 * output without writing to stdout. In production the default stdout
 * stream is used so the OTel Collector's filelog receiver (configured
 * in `compose/otel-collector/config.yaml`, 06.1 D-04) can ingest log
 * records and forward them to Loki via `otlphttp`.
 */
export const buildLogger = (opts?: { destination?: DestinationStream }): Logger => {
  const pinoOptions: pino.LoggerOptions = {
    redact: {
      paths: [...redactPaths],
      censor: "[REDACTED]",
    },
  };
  if (opts?.destination) {
    return pino(pinoOptions, opts.destination);
  }
  return pino(pinoOptions);
};

async function requestLogInner(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req) => {
    const raw = req.headers["x-openwhispr-source"];
    const source = typeof raw === "string" ? raw : null;
    req.log = req.log.child({ openwhisprSource: source });
  });
}

export const requestLog = fp(requestLogInner, {
  name: "request-log",
  fastify: "5.x",
});
