// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-11 per 06-VALIDATION.md.
//
// Production module (not yet created): apps/api/src/plugins/served-by.ts
//
// Behavior locked by D-P3 (horizontal-scale verification):
//   - Tiny Fastify onSend hook attaches `x-served-by: <os.hostname()>` to every response
//   - Used by tests/e2e/horizontal-scale.test.ts to assert Traefik round-robin
//     actually distributes across replicas of the API service.
import { describe, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-11 implements apps/api/src/plugins/served-by.ts (D-P3)";

describe("served-by plugin (D-P3)", () => {
  it("attaches x-served-by response header on every reply", () => {
    throw new Error(NOT_YET);
  });

  it("uses os.hostname() as the header value", () => {
    throw new Error(NOT_YET);
  });

  it("attaches on the onSend hook (visible to clients downstream of Traefik)", () => {
    throw new Error(NOT_YET);
  });

  it("does not overwrite an existing x-served-by header if upstream already set it", () => {
    throw new Error(NOT_YET);
  });
});
