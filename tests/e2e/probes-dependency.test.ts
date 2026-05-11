// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-04 / 06-12 per 06-VALIDATION.md.
//
// Behavior locked by D-P1, D-P2 (OBS-05 health probes e2e):
//   - Pause postgres container; /livez STILL returns 200 (no dep checks —
//     Postgres blip MUST NOT cascade-restart pods, D-P1).
//   - /readyz returns 503 within 6s (5s cache TTL + 1s slack) per D-P2.
//   - Resume postgres; /readyz returns 200 within 6s.
//
// Gated on E2E=1.
import { beforeAll, describe, expect, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-04 lands probe routes; Plan 06-12 wires this e2e (OBS-05, D-P1, D-P2)";

describe.skipIf(process.env.E2E !== "1")("probes dependency e2e (OBS-05, D-P1, D-P2)", () => {
  beforeAll(async () => {
    throw new Error(NOT_YET);
  }, 180_000);
  it("/livez stays 200 while postgres is paused (no dep checks) per D-P1", () => {
    expect.fail(NOT_YET);
  });

  it("/readyz returns 503 within 6s (5s cache + 1s slack) once postgres is paused per D-P2", () => {
    expect.fail(NOT_YET);
  });

  it("/readyz recovers to 200 within 6s after postgres is resumed per D-P2", () => {
    expect.fail(NOT_YET);
  });
});
