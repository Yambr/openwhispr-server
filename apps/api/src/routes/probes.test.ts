// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-06 per 06-VALIDATION.md.
//
// Production modules (not yet created):
//   apps/api/src/routes/probes.ts
//   apps/api/src/lib/dep-check.ts
//
// Behaviors locked by D-P1 (three kubelet-canonical probes):
//   - /livez   : process-alive only, NO dep checks, MUST stay 200 even with PG down
//   - /readyz  : checks Postgres + Valkey + LiteLLM, 503 if any unhealthy
//   - /startupz: migrations applied + pg pool warm + Valkey reachable
//   - /api/health: alias for /livez (back-compat with existing tests)
import { describe, it } from "vitest";

const NOT_YET = "not yet implemented — Plan 06-06 implements three probe routes (D-P1)";

describe("/livez (D-P1 — NO dep checks)", () => {
  it("returns 200 when Fastify event loop is responsive", () => {
    throw new Error(NOT_YET);
  });

  it("returns 200 even when Postgres is DOWN (process-alive only — no cascade restart)", () => {
    throw new Error(NOT_YET);
  });

  it("returns 200 even when Valkey is DOWN", () => {
    throw new Error(NOT_YET);
  });

  it("returns 200 even when LiteLLM is DOWN", () => {
    throw new Error(NOT_YET);
  });
});

describe("/readyz (D-P1 — checks Postgres + Valkey + LiteLLM)", () => {
  it("returns 200 when all three deps healthy", () => {
    throw new Error(NOT_YET);
  });

  it("returns 503 when Postgres unhealthy", () => {
    throw new Error(NOT_YET);
  });

  it("returns 503 when Valkey unhealthy", () => {
    throw new Error(NOT_YET);
  });

  it("returns 503 when LiteLLM unhealthy", () => {
    throw new Error(NOT_YET);
  });

  it("uses 2-5s cached result to prevent kubelet thundering herd", () => {
    throw new Error(NOT_YET);
  });
});

describe("/startupz (D-P1 — boot completion)", () => {
  it("returns 503 until migrations applied", () => {
    throw new Error(NOT_YET);
  });

  it("returns 503 until pg pool warm", () => {
    throw new Error(NOT_YET);
  });

  it("returns 200 once full boot complete", () => {
    throw new Error(NOT_YET);
  });
});

describe("/api/health alias (back-compat with apps/api/src/health.test.ts)", () => {
  it("delegates to /livez behavior", () => {
    throw new Error(NOT_YET);
  });
});
