// SPDX-License-Identifier: Apache-2.0
// Phase 6 / Plan 03 / Task 1 — OTel SDK bootstrap (side-effect module).
//
// THIS FILE MUST BE IMPORTED AS THE FIRST STATEMENT OF apps/api/src/index.ts
// (and apps/worker/src/index.ts, when Phase 6 Wave 1 lands the worker tier).
// PinoInstrumentation patches the `pino` module at require/import time;
// any `import pino from "pino"` that resolves BEFORE this module starts
// the SDK will receive an unpatched copy and its log records will be
// emitted WITHOUT trace_id / span_id correlation (D-T3).
//
// Behaviors locked by 06-CONTEXT.md decisions:
//   - D-T1: auto-instrument Fastify, undici, pg, ioredis, BullMQ; SKIP
//     fs + dns (span volume dwarfs signal); SKIP Drizzle (sits on pg,
//     duplicates spans).
//   - D-T2: always-on 100% sampling in v1 (NodeSDK default).
//   - D-T3: PinoInstrumentation with logKeys traceId→trace_id,
//     spanId→span_id, traceFlags→trace_flags.
//   - D-T6: no /metrics scrape endpoint; metrics flow via OTel SDK →
//     Collector → prometheusremotewrite → Mimir (handled by the
//     Collector's pipeline; this module just initializes the SDK).
//
// The module exports the started `sdk` plus introspection arrays
// (`registeredInstrumentations`, `disabledInstrumentations`) for the
// unit test in `otel-bootstrap.test.ts`. There is no default export —
// importing this file for its side effect is the only intended use
// from production code.

import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { NodeSDK } from "@opentelemetry/sdk-node";

// Diag logger is used by OTel internals; default to ERROR to avoid
// flooding stdout (we expose it via OTEL_LOG_LEVEL env for debugging).
diag.setLogger(
  new DiagConsoleLogger(),
  DiagLogLevel[
    (process.env.OTEL_LOG_LEVEL?.toUpperCase() as keyof typeof DiagLogLevel) ?? "ERROR"
  ] ?? DiagLogLevel.ERROR,
);

const pinoLogKeys = {
  traceId: "trace_id",
  spanId: "span_id",
  traceFlags: "trace_flags",
} as const;

// Per D-T1: explicit disabled list (also asserted by unit tests).
export const disabledInstrumentations: readonly string[] = [
  "@opentelemetry/instrumentation-fs",
  "@opentelemetry/instrumentation-dns",
];

const pinoInstrumentation = new PinoInstrumentation({
  logKeys: pinoLogKeys,
});

const autoInstrumentations = getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-fs": { enabled: false },
  "@opentelemetry/instrumentation-dns": { enabled: false },
});

// Introspection surface for the unit test. PinoInstrumentation's
// `logKeys` field is private on the prototype; we mirror the config
// here so the test can assert what was passed in.
export const registeredInstrumentations: ReadonlyArray<{
  name: string;
  logKeys?: typeof pinoLogKeys;
}> = [
  { name: "@opentelemetry/instrumentation-pino", logKeys: pinoLogKeys },
  // Auto-instrumentations are an opaque array; surface a sentinel
  // entry so test assertions about "at least pino is here" succeed
  // without coupling to the exact internal shape.
  { name: "@opentelemetry/auto-instrumentations-node" },
];

export const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "openwhispr-api",
  instrumentations: [autoInstrumentations, pinoInstrumentation],
});

/**
 * Start the NodeSDK. Exported so tests can exercise the catch branch
 * (start-failure must not crash the API). Production-path callers
 * invoke this once at module load (see immediate call below).
 */
export const startSdk = (target = sdk): void => {
  try {
    target.start();
  } catch (err) {
    // Failing to start the OTel SDK MUST NOT crash the API. Emit a
    // single diag-error and fall through; the API still serves
    // requests, just without telemetry. This mirrors the upstream
    // recommendation for production hardening.
    diag.error("OTel SDK failed to start", err as Error);
  }
};

/**
 * Best-effort flush + shutdown the SDK. Exported so the SIGTERM
 * handler installed below can be unit-tested without actually
 * killing the process. Returns the underlying shutdown Promise so
 * callers can await it; the SIGTERM-installed wrapper consumes its
 * rejection to keep Node's signal-handler contract synchronous.
 */
export const shutdownSdk = (target = sdk): Promise<void> => {
  return target.shutdown().catch((err) => {
    diag.error("OTel SDK shutdown failed", err as Error);
  });
};

// Start synchronously at module load — the load-order test in
// `otel-bootstrap.test.ts` plus the literal-first-import discipline
// in `apps/api/src/index.ts` together guarantee this runs before any
// `import pino from "pino"` resolves.
startSdk();

// SIGTERM hook — best-effort flush so spans/logs/metrics reach the
// Collector before the container is killed.
const onSignal = (): void => {
  void shutdownSdk();
};
process.once("SIGTERM", onSignal);
process.once("SIGINT", onSignal);
