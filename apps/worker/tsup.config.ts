// Phase 03 Plan 08 — apps/worker bundle.
//
// Single CJS bundle for the long-running worker container. CJS chosen for
// the same reason as packages/data/migrate.cjs — the runtime container
// invokes `node /app/apps/worker/dist/index.cjs` without flags; CJS is
// the friendliest target for `node` direct invocation and avoids ESM
// URL-resolution surprises when the file ships standalone.
//
// Native modules (pg) stay external so the runtime image's flat
// node_modules supplies them — same pattern as the api bundle (Phase 02.2).
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs"],
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  splitting: false,
  bundle: true,
  // Phase 6 / Plan 06-12c — OTel SDK + pino kept external so the
  // PinoInstrumentation patches the same pino module instance the
  // worker imports (same pattern the api side has been running with
  // since Plan 06-03). The OTel exporter-metrics-otlp-grpc package
  // dynamically requires platform-specific grpc native bindings; the
  // runtime image's flat node_modules supplies them via the prod-deps
  // stage of apps/worker/Dockerfile.
  external: [
    "pg",
    "pg-native",
    "pino",
    "@opentelemetry/api",
    "@opentelemetry/exporter-metrics-otlp-grpc",
    "@opentelemetry/instrumentation-pino",
    "@opentelemetry/sdk-metrics",
    "@opentelemetry/sdk-node",
  ],
  // Workspace packages (@openwhispr/observability) must be INLINED so
  // they don't become `require('@openwhispr/observability')` at runtime
  // (the prod-deps node_modules layout doesn't include the workspace
  // package as a top-level entry). Same pattern as the api bundle's
  // noExternal config.
  noExternal: [/^@openwhispr\//],
});
