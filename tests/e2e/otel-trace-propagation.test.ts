// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-11 / 06-12 per 06-VALIDATION.md.
//
// Behavior locked by D-T3 (OBS-01 trace propagation e2e):
//   - Perform a request that emits a pino log inside an active span.
//   - Tempo receives the span with service.name='openwhispr-api' for the
//     captured trace_id.
//   - Loki returns the matching log line for the same trace_id (Grafana
//     derivedFields correlation per compose/grafana/.../loki.yaml).
//
// Gated on E2E=1.
import { beforeAll, describe, expect, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-11 lands dashboards; Plan 06-12 wires this e2e (OBS-01, D-T3)";

describe.skipIf(process.env.E2E !== "1")("OTel trace propagation e2e (OBS-01, D-T3)", () => {
  beforeAll(async () => {
    throw new Error(NOT_YET);
  }, 180_000);
  it("performs a request that emits a pino log inside an active span (trace_id injected) per D-T3", () => {
    expect.fail(NOT_YET);
  });

  it("Tempo receives the span with service.name='openwhispr-api' for the captured trace_id per D-T3", () => {
    expect.fail(NOT_YET);
  });

  it("Loki returns the matching log line for the same trace_id (Grafana derivedFields correlation) per D-T3", () => {
    expect.fail(NOT_YET);
  });
});
