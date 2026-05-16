// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.e / HI-01 — `SKIP_LITELLM_DB_AUTOCREATE` operator escape hatch.
//
// Review .planning/review/data.md HI-01 §Fix mandates an opt-out env flag
// so operators with a pre-existing `litellm` database (or operators who
// run LiteLLM on a separate cluster) can run `pnpm --filter
// @openwhispr/data run migrate` WITHOUT setting POSTGRES_ADMIN_URL /
// DATABASE_URL_OWNER for the admin-side auto-create.
//
// Tests target the pure helper `shouldSkipLitellmDbAutocreate(env)`
// extracted from migrate.ts main(). The integration into main() is
// covered by the existing migrate-litellm-db.test.ts idempotency suite
// (the skip branch simply omits the ensureLitellmDatabase call).
import { describe, expect, it } from "vitest";
import { shouldSkipLitellmDbAutocreate } from "../../../src/migrate.js";

describe("shouldSkipLitellmDbAutocreate — HI-01 escape hatch", () => {
  it("returns true when SKIP_LITELLM_DB_AUTOCREATE=1", () => {
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "1" })).toBe(true);
  });

  it("returns true when SKIP_LITELLM_DB_AUTOCREATE=true (case-insensitive)", () => {
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "true" })).toBe(true);
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "TRUE" })).toBe(true);
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "True" })).toBe(true);
  });

  it("returns false when SKIP_LITELLM_DB_AUTOCREATE is unset", () => {
    expect(shouldSkipLitellmDbAutocreate({})).toBe(false);
  });

  it("returns false when SKIP_LITELLM_DB_AUTOCREATE=0", () => {
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "0" })).toBe(false);
  });

  it("returns false when SKIP_LITELLM_DB_AUTOCREATE=false", () => {
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "false" })).toBe(false);
  });

  it("returns false on arbitrary non-truthy strings", () => {
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "yes" })).toBe(false);
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "" })).toBe(false);
    expect(shouldSkipLitellmDbAutocreate({ SKIP_LITELLM_DB_AUTOCREATE: "on" })).toBe(false);
  });
});
