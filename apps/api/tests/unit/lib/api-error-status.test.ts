// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 02.7 / Plan 03 — D-02 helper unit tests.
//
// Covers all branches of resolveApiErrorStatus for the Assumption A1
// defensive shape (string-name OR numeric `.status`).

import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { resolveApiErrorStatus } from "../../../src/lib/api-error-status.js";

function fakeAPIError(status: unknown): APIError {
  // Construct a real APIError, then override `.status` with the shape we
  // want to probe. The cast mirrors the helper's own narrow cast (justified
  // because Better Auth's public type does not stably expose `.status`).
  const e = APIError.fromStatus("UNAUTHORIZED", { message: "x" });
  (e as unknown as { status: unknown }).status = status;
  return e;
}

describe("resolveApiErrorStatus", () => {
  it("string-name UNAUTHORIZED → 401", () => {
    expect(resolveApiErrorStatus(fakeAPIError("UNAUTHORIZED"))).toBe(401);
  });

  it("string-name FORBIDDEN → 403", () => {
    expect(resolveApiErrorStatus(fakeAPIError("FORBIDDEN"))).toBe(403);
  });

  it("string-name BAD_REQUEST → 400", () => {
    expect(resolveApiErrorStatus(fakeAPIError("BAD_REQUEST"))).toBe(400);
  });

  it("string-name INTERNAL_SERVER_ERROR → 500", () => {
    expect(resolveApiErrorStatus(fakeAPIError("INTERNAL_SERVER_ERROR"))).toBe(500);
  });

  it("string-name TOO_MANY_REQUESTS → 429", () => {
    expect(resolveApiErrorStatus(fakeAPIError("TOO_MANY_REQUESTS"))).toBe(429);
  });

  it("numeric 401 (future Better Auth shape) → 401", () => {
    expect(resolveApiErrorStatus(fakeAPIError(401))).toBe(401);
  });

  it("numeric 503 (future shape) → 503", () => {
    expect(resolveApiErrorStatus(fakeAPIError(503))).toBe(503);
  });

  it("numeric out-of-range (e.g. 99) → 500 fallback", () => {
    expect(resolveApiErrorStatus(fakeAPIError(99))).toBe(500);
  });

  it("numeric out-of-range (e.g. 600) → 500 fallback", () => {
    expect(resolveApiErrorStatus(fakeAPIError(600))).toBe(500);
  });

  it("non-integer numeric (e.g. 401.5) → 500 fallback", () => {
    expect(resolveApiErrorStatus(fakeAPIError(401.5))).toBe(500);
  });

  it("unknown string-name → 500 fallback (safe default; threat T-02.7-11)", () => {
    expect(resolveApiErrorStatus(fakeAPIError("MADE_UP_NAME"))).toBe(500);
  });

  it("undefined .status → 500 fallback", () => {
    expect(resolveApiErrorStatus(fakeAPIError(undefined))).toBe(500);
  });

  it("null .status → 500 fallback", () => {
    expect(resolveApiErrorStatus(fakeAPIError(null))).toBe(500);
  });

  it("object .status → 500 fallback", () => {
    expect(resolveApiErrorStatus(fakeAPIError({ wat: 1 }))).toBe(500);
  });
});
