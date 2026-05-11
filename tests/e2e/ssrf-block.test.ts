// Phase 6 Wave 0 RED stub — TDD-01b. Implementation in Plan 06-06 / 06-12 per 06-VALIDATION.md.
//
// Behavior locked by D-S1..S5 (SCALE-04 SSRF defense):
//   - Real undici dispatcher set globally in the API process.
//   - Outbound HTTP call to 169.254.169.254 (AWS IMDS) returns HTTP 502.
//   - 502 envelope: {error: "Upstream blocked by SSRF policy", request_id}.
//   - audit_log row written with action=security.ssrf_blocked + payload
//     {target_url_host, rule}.
//
// Gated on E2E=1.
import { beforeAll, describe, expect, it } from "vitest";

const NOT_YET =
  "not yet implemented — Plan 06-06 implements SSRF dispatcher; Plan 06-12 wires this e2e (SCALE-04, D-S1..S5)";

describe.skipIf(process.env.E2E !== "1")("SSRF block e2e (SCALE-04, D-S5)", () => {
  beforeAll(async () => {
    // TODO Plan 06-06: boot compose with default profile + an extra nginx
    //   container serving a 302 redirect to http://169.254.169.254/ so the
    //   SSRF dispatcher's resolved-IP block-list check fires (D-S3).
    throw new Error(NOT_YET);
  }, 180_000);
  it("an outbound call to 169.254.169.254 (AWS IMDS) returns HTTP 502 per D-S3/D-S5", () => {
    expect.fail(NOT_YET);
  });

  it("502 body is {error: 'Upstream blocked by SSRF policy', request_id} per D-S5", () => {
    expect.fail(NOT_YET);
  });

  it("audit_log gains a row with action=security.ssrf_blocked + payload.target_url_host + payload.rule per D-A6 #18 / D-A7", () => {
    expect.fail(NOT_YET);
  });
});
