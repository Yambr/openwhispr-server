// SPDX-License-Identifier: Apache-2.0
// Phase 6 / Plan 06-12c — Worker OTel SDK bootstrap (side-effect module).
//
// THIS FILE MUST BE IMPORTED AS THE FIRST STATEMENT OF apps/worker/src/index.ts
// (same load-order discipline as apps/api/src/otel-bootstrap.ts — pino must
// resolve AFTER the SDK starts so PinoInstrumentation can patch it).
//
// The worker MUST have its own SDK because the reconciliation-daily-check job
// (Plan 06-08) creates ObservableGauges via `metrics.getMeter(...)`. Without an
// SDK + MeterProvider + PeriodicExportingMetricReader the gauges register
// against the no-op global Meter, the callbacks NEVER fire, and the Plan 11
// reconciliation-drift dashboard + alert have nothing to chart — OBS-04 fails
// end-to-end. The Plan 06-12c reconciliation-drift e2e is the test that
// catches this gap (the dashboard self-test in Plan 11 only validates JSON
// structure, not live metric emission).
//
// Endpoint config follows OTel spec env conventions:
//   OTEL_EXPORTER_OTLP_ENDPOINT (defaults to http://otel-collector:4317 in
//   docker-compose; the upstream SDK default is http://localhost:4317 which
//   resolves to the container itself inside docker — useless for our
//   collector-sidecar topology).
//
// Service name: process.env.OTEL_SERVICE_NAME ?? "openwhispr-worker" so spans
// + metrics resource attributes are distinguishable from the api tier in
// Tempo / Mimir / Loki.

import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
// sdk-node bundles its own copy of @opentelemetry/sdk-metrics — we must
// import PeriodicExportingMetricReader through the same bundled copy or
// the aggregation classes won't match (`aggregation.createAggregator is
// not a function` runtime crash from a sdk-metrics dual-realm bug).
// `sdk-node` re-exports it under the `metrics` namespace.
import { NodeSDK, metrics as sdkMetrics } from "@opentelemetry/sdk-node";

const { PeriodicExportingMetricReader } = sdkMetrics;

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

const pinoInstrumentation = new PinoInstrumentation({ logKeys: pinoLogKeys });

// NOTE: We intentionally DO NOT use `getNodeAutoInstrumentations()` here
// (the api side does). The auto bundle loads ~50 instrumentations
// including `@opentelemetry/instrumentation-aws-sdk` which calls
// `meter.createHistogram(...)` at sdk.start() time — and that runs
// against a sdk-metrics build pinned to an older API (`createAggregator`
// shape) that has been removed in newer sdk-metrics. The worker has no
// AWS / express / koa / etc surface; we only need pino instrumentation
// for trace_id correlation in log records. Keeping the instrumentation
// set narrow also reduces span volume on the BullMQ tick loop.

// Periodic metric reader so observable gauges fire on a schedule (worker has
// no HTTP /metrics endpoint per D-T6; everything flows OTLP -> Collector ->
// prometheusremotewrite -> Mimir). 15s interval matches the OTel SDK default
// and is well under the Plan 11 dashboard 30s scrape cadence so each render
// has fresh data.
const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({}),
  exportIntervalMillis: 15_000,
});

export const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "openwhispr-worker",
  instrumentations: [pinoInstrumentation],
  metricReader,
});

export const startSdk = (target = sdk): void => {
  try {
    target.start();
  } catch (err) {
    diag.error("Worker OTel SDK failed to start", err as Error);
  }
};

export const shutdownSdk = (target = sdk): Promise<void> => {
  return target.shutdown().catch((err) => {
    diag.error("Worker OTel SDK shutdown failed", err as Error);
  });
};

startSdk();

const onSignal = (): void => {
  void shutdownSdk();
};
process.once("SIGTERM", onSignal);
process.once("SIGINT", onSignal);
