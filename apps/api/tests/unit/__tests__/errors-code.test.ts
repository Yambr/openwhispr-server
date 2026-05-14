// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 10 / Plan 10-01a / Step 4 — typed error classes carry a stable
// `code` literal for i18n key lookup (`errors.<CODE>`).
//
// Pin every class to its canonical code so the i18n-completeness scanner
// (apps/api/src/i18n/__tests__/i18n-completeness.test.ts) can rely on
// the same literals as compile-time constants without fragile string
// matching of class names.

import { describe, expect, it } from "vitest";
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ServiceUnavailable,
  ValidationError,
} from "../../../src/errors.js";

describe("typed errors — readonly i18n codes (Phase 10-01a)", () => {
  it("ValidationError.code === VALIDATION_ERROR", () => {
    expect(new ValidationError("x").code).toBe("VALIDATION_ERROR");
  });
  it("AuthError.code === AUTH_ERROR", () => {
    expect(new AuthError("x").code).toBe("AUTH_ERROR");
  });
  it("NotFoundError.code === NOT_FOUND", () => {
    expect(new NotFoundError("x").code).toBe("NOT_FOUND");
  });
  it("RateLimitError.code === RATE_LIMITED", () => {
    expect(new RateLimitError("x").code).toBe("RATE_LIMITED");
  });
  it("ServiceUnavailable.code === SERVICE_UNAVAILABLE", () => {
    expect(new ServiceUnavailable("x").code).toBe("SERVICE_UNAVAILABLE");
  });
  it("ServerError.code === SERVER_ERROR", () => {
    expect(new ServerError("x").code).toBe("SERVER_ERROR");
  });
});
