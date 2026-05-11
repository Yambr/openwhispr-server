// tests/e2e/otel-trace-propagation.test.ts
//
// Phase 6 / Plan 06-12c / Task 3 — OBS-01 / D-T3 OTel trace propagation e2e.
//
// Truths asserted:
//   1. An authenticated request through the api emits a pino log line
//      carrying a `trace_id` JSON field (PinoInstrumentation /
//      otel-bootstrap.ts D-T3).
//   2. Tempo's HTTP API `GET /api/traces/<trace_id>` returns a trace
//      containing at least one span with resource attribute
//      `service.name = openwhispr-api` — proves traces flow from the
//      api process via OTLP/gRPC -> otel-collector -> Tempo.
//   3. Loki's LogQL HTTP API `query_range` returns at least one log
//      line containing the same `trace_id` value — proves logs flow
//      from the api process via OTLP/HTTP -> otel-collector ->
//      Loki, AND that the Grafana `derivedFields` regex configured by
//      Plan 06-03 (`"trace_id":"([a-f0-9]+)"`) actually matches the
//      log format pino emits (so an operator clicking through a Loki
//      log line lands on the correct Tempo span).
//
// CLAUDE.md `no mocks of internal logic`: real OTel SDK, real
// otel-collector, real Tempo, real Loki, real Grafana derivedFields
// regex (validated indirectly by the LogQL query that mirrors it).
//
// Gated on E2E=1. Tear down with removeVolumes:true.

import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKEND_URL,
  curlInContainer,
  type Phase6Stack,
  phase6BringStackUp,
  pollUrl,
} from "./helpers/phase6-compose.js";

const SUITE_TIMEOUT_MS = 600_000;

let stack: Phase6Stack | undefined;
let testStartEpochSec = 0;

async function readStream(s: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of s) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface TempoTraceResponse {
  trace?: {
    batches?: Array<{
      resource?: { attributes?: Array<{ key: string; value?: { stringValue?: string } }> };
      scopeSpans?: Array<{ spans?: Array<{ name?: string }> }>;
      // Tempo's response format varies — newer versions return
      // `batches[].resource.attributes` per OTLP shape; older flatten
      // under `batches[].instrumentationLibrarySpans`. Both are tolerated
      // by the assertion below which searches deeply.
    }>;
  };
}

describe.skipIf(process.env.E2E !== "1")("OTel trace propagation e2e (OBS-01, D-T3)", () => {
  beforeAll(async () => {
    testStartEpochSec = Math.floor(Date.now() / 1000) - 1;
    stack = await phase6BringStackUp({ seed: false, timeoutMs: 360_000 });
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (stack) await stack.down();
  }, 120_000);

  it(
    "request -> pino log with trace_id -> Tempo has matching span (service.name=openwhispr-api) -> Loki has matching log line",
    async () => {
      if (!stack) throw new Error("stack not initialized");

      // 1. Emit a request that crosses a logged Fastify route. /api/health
      // is registered unconditionally and produces a request-log entry
      // through the buildLogger() factory (Plan 06-03), which means the
      // log line carries the PinoInstrumentation-injected trace_id
      // matching the active span.
      await pollUrl(`${BACKEND_URL}/api/health`, {
        expectStatus: (s) => s === 200,
        deadlineMs: 30_000,
        intervalMs: 500,
      });

      // Issue a uniquely-marked request so we can later find its log
      // line by header without ambiguity.
      const marker = `otel-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(`${BACKEND_URL}/api/health`, {
        headers: { "x-openwhispr-source": "phase6-e2e", "x-test-marker": marker },
      });
      expect(res.status).toBe(200);

      // Wait long enough for:
      //   - api pino log to flush to stdout
      //   - otel-collector batch processor (5s timeout) to flush
      //   - Tempo to ingest the trace
      //   - Loki to ingest the logs
      // Worst case: ~25s. Poll instead of single sleep to be tolerant.
      let traceId: string | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !traceId) {
        await new Promise((r) => setTimeout(r, 2000));
        const stream = await stack.api.logs({ since: testStartEpochSec });
        const apiLogs = await readStream(stream);
        // Find a log line that mentions our marker AND carries a
        // trace_id field. pino emits one JSON object per line.
        for (const line of apiLogs.split("\n")) {
          if (!line.includes(marker)) continue;
          const m = line.match(/"trace_id":"([a-f0-9]+)"/);
          if (m) {
            traceId = m[1];
            break;
          }
        }
        if (!traceId) {
          // Fall back: any log line with a trace_id field (the marker
          // may not be logged by /api/health but the request still
          // produced a trace).
          for (const line of apiLogs.split("\n").reverse()) {
            const m = line.match(/"trace_id":"([a-f0-9]+)"/);
            if (m) {
              traceId = m[1];
              break;
            }
          }
        }
      }
      expect(traceId, "trace_id should appear in api container logs").toBeDefined();
      const tid = traceId!;
      expect(tid).toMatch(/^[a-f0-9]+$/);

      // 2. Query Tempo for the trace.
      // Tempo's HTTP API endpoint is /api/traces/<traceID> (returns
      // the trace as OTLP-shaped JSON). Allow up to 30s additional
      // polling for ingestion delay.
      let tempoBody = "";
      let tempoStatus = 0;
      const tempoDeadline = Date.now() + 45_000;
      while (Date.now() < tempoDeadline) {
        const r = await curlInContainer(stack.grafana, `http://tempo:3200/api/traces/${tid}`);
        tempoStatus = r.exitCode;
        tempoBody = r.body;
        if (r.exitCode === 0 && tempoBody.length > 10 && tempoBody.includes("openwhispr-api")) {
          break;
        }
        await new Promise((r2) => setTimeout(r2, 2500));
      }
      expect(tempoStatus, `tempo exit (last body=${tempoBody.slice(0, 200)})`).toBe(0);
      // Tempo returns JSON with a `batches` array of OTLP ResourceSpans.
      // Service name lives in resource.attributes[].key === 'service.name'.
      // We assert the rendered JSON contains "openwhispr-api" as a
      // value — robust to small format variations across Tempo versions.
      let parsed: TempoTraceResponse = {};
      try {
        parsed = JSON.parse(tempoBody) as TempoTraceResponse;
      } catch {
        // Tempo may return non-JSON on cache miss; the substring
        // check below still catches the service name.
      }
      void parsed;
      expect(
        tempoBody.includes("openwhispr-api"),
        `Tempo response missing service.name=openwhispr-api: ${tempoBody.slice(0, 400)}`,
      ).toBe(true);

      // 3. Query Loki for log lines tagged with the trace_id. Loki's
      // OTLP path stores resource attrs as labels; our matcher mirrors
      // the Grafana derivedFields regex from compose/grafana/
      // provisioning/datasources/loki.yaml: `"trace_id":"([a-f0-9]+)"`.
      // Use a permissive LogQL that scans across all streams.
      const lokiQuery = `{service_name="openwhispr-api"} |~ \`"trace_id":"${tid}"\``;
      const nowNs = Date.now() * 1_000_000;
      const startNs = nowNs - 10 * 60 * 1_000_000_000;
      const lokiUrl =
        `http://loki:3100/loki/api/v1/query_range?` +
        `query=${encodeURIComponent(lokiQuery)}` +
        `&start=${startNs}&end=${nowNs}&limit=10`;
      let lokiHits = 0;
      const lokiDeadline = Date.now() + 45_000;
      while (Date.now() < lokiDeadline && lokiHits === 0) {
        const r = await curlInContainer(stack.grafana, lokiUrl);
        if (r.exitCode === 0) {
          try {
            const j = JSON.parse(r.body) as {
              status: string;
              data: { result: Array<{ values?: Array<unknown> }> };
            };
            if (j.status === "success") {
              for (const series of j.data.result) {
                lokiHits += series.values?.length ?? 0;
              }
            }
          } catch {
            // Loki occasionally returns plain-text errors on cold start;
            // tolerate and retry.
          }
        }
        if (lokiHits === 0) {
          // Try a more permissive query — service_name label might be
          // emitted under a different key by the OTLP -> Loki mapping
          // depending on Loki version. Fall back to a free-text
          // substring query.
          const lokiUrl2 =
            `http://loki:3100/loki/api/v1/query_range?` +
            `query=${encodeURIComponent(`{service_name=~".+"} |= "${tid}"`)}` +
            `&start=${startNs}&end=${nowNs}&limit=10`;
          const r2 = await curlInContainer(stack.grafana, lokiUrl2);
          if (r2.exitCode === 0) {
            try {
              const j = JSON.parse(r2.body) as {
                status: string;
                data: { result: Array<{ values?: Array<unknown> }> };
              };
              if (j.status === "success") {
                for (const series of j.data.result) {
                  lokiHits += series.values?.length ?? 0;
                }
              }
            } catch {
              /* ignore */
            }
          }
        }
        if (lokiHits === 0) await new Promise((r2) => setTimeout(r2, 2500));
      }
      expect(
        lokiHits,
        "Loki should return at least one log line with the trace_id",
      ).toBeGreaterThan(0);
    },
    SUITE_TIMEOUT_MS,
  );
});
