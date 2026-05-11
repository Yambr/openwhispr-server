// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-11 per 06-VALIDATION.md.
//
// Behavior locked by D-P3 (SCALE-01 horizontal scale e2e):
//   - DockerComposeEnvironment.withScale("api", 2) via testcontainers
//   - Signin via Traefik -> capture bearer + cookie
//   - Hit a session-protected endpoint (/api/me or /api/usage) 20x via Traefik
//   - Assert >= 1 hit lands on EACH replica's hostname (x-served-by header)
//   - All 20 return 200 with the same session.id (proves cross-replica continuity)
//
// Gated on E2E=1. Real services per constitutional "no mocks of internal logic".
import { beforeAll, describe, expect, it } from "vitest";

const NOT_YET = "not yet implemented — Plan 06-11 implements horizontal-scale e2e (SCALE-01, D-P3)";

describe.skipIf(process.env.E2E !== "1")("horizontal scale e2e (SCALE-01, D-P3)", () => {
  beforeAll(async () => {
    // TODO Plan 06-11: boot via testcontainers
    //   new DockerComposeEnvironment("compose", "compose.yml")
    //     .withScale("api", 2)
    //     .up();
    // Add `testcontainers` to tests/e2e/package.json deps when this
    // stub flips GREEN.
    throw new Error(NOT_YET);
  }, 180_000);

  it("boots docker compose with withScale('api', 2) via testcontainers DockerComposeEnvironment per D-P3", () => {
    expect.fail(NOT_YET);
  });

  it("signs in once via Traefik and obtains a bearer token + session cookie per D-P3", () => {
    expect.fail(NOT_YET);
  });

  it("hits /api/me 20x through Traefik round-robin — at least 1 hit per replica via x-served-by header per D-P3", () => {
    expect.fail(NOT_YET);
  });

  it("all 20 responses return 200 with the same session.id (cross-replica continuity) per D-P3", () => {
    expect.fail(NOT_YET);
  });
});
