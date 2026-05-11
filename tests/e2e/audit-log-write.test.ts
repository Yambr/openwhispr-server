// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-05 / 06-12 per 06-VALIDATION.md.
//
// Behavior locked by D-A1 + D-A6 #1 + D-A7 (OBS-03 audit log e2e):
//   - /api/auth/signin via real Better Auth writes audit_log row in the
//     same transaction (sync, no fanout queue).
//   - action='auth.signin' (D-A6 #1).
//   - payload.request_id (correlates with trace_id), payload.ip,
//     payload.user_agent (truncated to 512 chars), payload.method='password'
//     (D-A7 per-action key).
//
// Gated on E2E=1.
import { beforeAll, describe, expect, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-05 implements audit_log sync writer; Plan 06-12 wires this e2e (OBS-03, D-A1, D-A6, D-A7)";

describe.skipIf(process.env.E2E !== "1")(
  "audit log sync write e2e (OBS-03, DATA-04, D-A1, D-A6 #1)",
  () => {
    beforeAll(async () => {
      throw new Error(NOT_YET);
    }, 180_000);
    it("performs auth.signin via real Better Auth and writes audit_log row in the same txn per D-A1", () => {
      expect.fail(NOT_YET);
    });

    it("row.action='auth.signin' with payload.request_id + payload.ip + payload.user_agent (truncated 512) per D-A6 #1", () => {
      expect.fail(NOT_YET);
    });

    it("row.payload.method='password' for password-grant signin per D-A7", () => {
      expect.fail(NOT_YET);
    });
  },
);
