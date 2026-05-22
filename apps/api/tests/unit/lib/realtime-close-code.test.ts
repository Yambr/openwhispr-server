// SPDX-License-Identifier: FSL-1.1-ALv2
// T-03-07 close-behavior refinement — unit tests for the pure
// upstream-status → WS-close-code mapper.

import { describe, expect, it } from "vitest";
import { mapUpstreamStatusToCloseCode } from "../../../src/lib/realtime-close-code.js";

describe("mapUpstreamStatusToCloseCode — upstream handshake status → WS close code", () => {
  it("maps 401 to 1008 (policy violation) with a fixed unauthorized reason", () => {
    expect(mapUpstreamStatusToCloseCode(401)).toEqual({
      code: 1008,
      reason: "realtime upstream unauthorized",
    });
  });

  it("maps 403 to 1008 (policy violation) with a fixed unauthorized reason", () => {
    expect(mapUpstreamStatusToCloseCode(403)).toEqual({
      code: 1008,
      reason: "realtime upstream unauthorized",
    });
  });

  it("maps 429 to 1013 (try again later) with a fixed rate-limited reason", () => {
    expect(mapUpstreamStatusToCloseCode(429)).toEqual({
      code: 1013,
      reason: "realtime upstream rate limited",
    });
  });

  it("maps 500 to 1011 (internal error) with a fixed unavailable reason", () => {
    expect(mapUpstreamStatusToCloseCode(500)).toEqual({
      code: 1011,
      reason: "realtime upstream unavailable",
    });
  });

  it("maps 503 to 1011 (internal error) with a fixed unavailable reason", () => {
    expect(mapUpstreamStatusToCloseCode(503)).toEqual({
      code: 1011,
      reason: "realtime upstream unavailable",
    });
  });

  it("maps any other status (e.g. 418) to the 1011 unavailable fallback", () => {
    expect(mapUpstreamStatusToCloseCode(418)).toEqual({
      code: 1011,
      reason: "realtime upstream unavailable",
    });
  });

  it("never emits a reason longer than the 120-char WS close-reason bound", () => {
    for (const status of [401, 403, 429, 500, 503, 418]) {
      expect(mapUpstreamStatusToCloseCode(status).reason.length).toBeLessThanOrEqual(120);
    }
  });
});
