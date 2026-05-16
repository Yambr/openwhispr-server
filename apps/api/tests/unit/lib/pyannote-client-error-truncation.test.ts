// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 37 / Task 1 — RED tests for CR-9 siblings in pyannote-client.
//
// PyannoteBadRequestError + PyannoteUpstreamError both expose
// `public readonly bodyText: string` and currently store the FULL upstream
// body. pino's default `err` serializer enumerates own enumerable
// properties and ships them to Loki → STRIDE Info-Disclosure (V7).
//
// Post-fix invariants asserted here:
//   1. Construction-time truncation: JSON.stringify length bounded.
//   2. err.toJSON() returns only { name, message, status }.

import { describe, expect, it } from "vitest";
import {
  PyannoteBadRequestError,
  PyannoteUpstreamError,
} from "../../../src/lib/pyannote-client.js";

const HUGE = "x".repeat(10000);

describe("PyannoteBadRequestError — bodyText truncation (CR-9 sibling)", () => {
  it("JSON.stringify(err) is bounded below 500 bytes", () => {
    const err = new PyannoteBadRequestError(400, HUGE);
    expect(JSON.stringify(err).length).toBeLessThan(500);
  });

  it("JSON.stringify(err) does not echo the full body", () => {
    const err = new PyannoteBadRequestError(400, HUGE);
    expect(JSON.stringify(err)).not.toContain("x".repeat(201));
  });

  it("err.toJSON() returns only { name, message, status }", () => {
    const err = new PyannoteBadRequestError(422, HUGE);
    expect(err.toJSON()).toEqual({
      name: "PyannoteBadRequestError",
      message: expect.any(String),
      status: 422,
    });
    expect(JSON.stringify(err.toJSON())).not.toContain("x".repeat(10000));
  });

  it("preserves status field", () => {
    const err = new PyannoteBadRequestError(400, "");
    expect(err.status).toBe(400);
  });
});

describe("PyannoteUpstreamError — bodyText truncation (CR-9 sibling)", () => {
  it("JSON.stringify(err) is bounded below 500 bytes", () => {
    const err = new PyannoteUpstreamError(502, HUGE);
    expect(JSON.stringify(err).length).toBeLessThan(500);
  });

  it("JSON.stringify(err) does not echo the full body", () => {
    const err = new PyannoteUpstreamError(502, HUGE);
    expect(JSON.stringify(err)).not.toContain("x".repeat(201));
  });

  it("err.toJSON() returns only { name, message, status }", () => {
    const err = new PyannoteUpstreamError(502, HUGE);
    expect(err.toJSON()).toEqual({
      name: "PyannoteUpstreamError",
      message: expect.any(String),
      status: 502,
    });
    expect(JSON.stringify(err.toJSON())).not.toContain("x".repeat(10000));
  });

  it("preserves status field", () => {
    const err = new PyannoteUpstreamError(503, "");
    expect(err.status).toBe(503);
  });
});
