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
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

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

const autoInstrumentations = getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-fs": { enabled: false },
  "@opentelemetry/instrumentation-dns": { enabled: false },
});

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
  instrumentations: [autoInstrumentations, pinoInstrumentation],
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
