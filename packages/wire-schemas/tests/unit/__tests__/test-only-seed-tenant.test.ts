// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56 / Plan 56-01 / R1 — SeedTenantRequest + SeedTenantResponse
// wire-schema unit tests. RED → GREEN pair for the strict shapes the
// route at apps/api/src/routes/test-only.ts validates against.
import { describe, expect, it } from "vitest";
import { SeedTenantRequest, SeedTenantResponse } from "../../../src/test-only-seed-tenant.js";

describe("SeedTenantRequest", () => {
  it("accepts the canonical minimal payload", () => {
    expect(
      SeedTenantRequest.safeParse({
        email: "e2e+abc@test.local",
        password: "hunter22hunter22",
        name: "E2E Tenant",
        verified: true,
      }).success,
    ).toBe(true);
  });

  it("rejects missing email", () => {
    expect(
      SeedTenantRequest.safeParse({
        password: "pw",
        name: "n",
        verified: true,
      }).success,
    ).toBe(false);
  });

  it("rejects non-email email", () => {
    expect(
      SeedTenantRequest.safeParse({
        email: "not-an-email",
        password: "pw",
        name: "n",
        verified: true,
      }).success,
    ).toBe(false);
  });

  it("rejects email over RFC 5321 254-octet cap", () => {
    const local = "a".repeat(250);
    expect(
      SeedTenantRequest.safeParse({
        email: `${local}@test.local`,
        password: "pw",
        name: "n",
        verified: true,
      }).success,
    ).toBe(false);
  });

  it("rejects empty password", () => {
    expect(
      SeedTenantRequest.safeParse({
        email: "a@b.c",
        password: "",
        name: "n",
        verified: true,
      }).success,
    ).toBe(false);
  });

  it("rejects password longer than 256 chars", () => {
    expect(
      SeedTenantRequest.safeParse({
        email: "a@b.c",
        password: "p".repeat(257),
        name: "n",
        verified: true,
      }).success,
    ).toBe(false);
  });

  it("rejects empty name", () => {
    expect(
      SeedTenantRequest.safeParse({
        email: "a@b.c",
        password: "pw",
        name: "",
        verified: true,
      }).success,
    ).toBe(false);
  });

  it("rejects name longer than 256 chars", () => {
    expect(
      SeedTenantRequest.safeParse({
        email: "a@b.c",
        password: "pw",
        name: "n".repeat(257),
        verified: true,
      }).success,
    ).toBe(false);
  });

  it("rejects non-boolean verified", () => {
    expect(
      SeedTenantRequest.safeParse({
        email: "a@b.c",
        password: "pw",
        name: "n",
        verified: "yes",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown extra keys (strict)", () => {
    expect(
      SeedTenantRequest.safeParse({
        email: "a@b.c",
        password: "pw",
        name: "n",
        verified: true,
        role: "admin",
      }).success,
    ).toBe(false);
  });
});

describe("SeedTenantResponse", () => {
  const VALID = {
    token: "opaque-bearer-32-bytes-or-so",
    user: {
      id: "11111111-2222-4333-8444-555555555555",
      email: "e2e@test.local",
      emailVerified: true as const,
      createdAt: "2026-05-19T12:34:56.000Z",
    },
  };

  it("accepts the canonical success shape", () => {
    expect(SeedTenantResponse.safeParse(VALID).success).toBe(true);
  });

  it("rejects emailVerified=false (would defeat the route's purpose)", () => {
    const bad = { ...VALID, user: { ...VALID.user, emailVerified: false } };
    expect(SeedTenantResponse.safeParse(bad).success).toBe(false);
  });

  it("rejects non-uuid user.id", () => {
    const bad = { ...VALID, user: { ...VALID.user, id: "not-a-uuid" } };
    expect(SeedTenantResponse.safeParse(bad).success).toBe(false);
  });

  it("rejects empty token", () => {
    const bad = { ...VALID, token: "" };
    expect(SeedTenantResponse.safeParse(bad).success).toBe(false);
  });

  it("rejects non-ISO createdAt", () => {
    const bad = { ...VALID, user: { ...VALID.user, createdAt: "yesterday" } };
    expect(SeedTenantResponse.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown extra keys on top-level", () => {
    expect(SeedTenantResponse.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
  });

  it("rejects unknown extra keys on user object", () => {
    const bad = { ...VALID, user: { ...VALID.user, role: "admin" } };
    expect(SeedTenantResponse.safeParse(bad).success).toBe(false);
  });
});
