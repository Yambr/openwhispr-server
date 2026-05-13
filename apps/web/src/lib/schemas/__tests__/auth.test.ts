// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 07 — RED tests for auth zod schemas.
//
// signInSchema:
//   - accepts valid { email, password >= 8 chars }
//   - rejects malformed email
//   - rejects empty password (must be >= 8 chars per Better Auth default)
//
// signUpSchema:
//   - accepts valid { name, email, password >= 8 chars }
//   - rejects empty name (min 1)
//   - rejects name > 100 chars (max 100)
//   - rejects malformed email
//   - rejects short password (< 8 chars)
import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "../auth";

describe("signInSchema", () => {
  it("accepts valid credentials", () => {
    const parsed = signInSchema.safeParse({
      email: "alice@test.local",
      password: "Pwa9!testStrong",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects malformed email", () => {
    const parsed = signInSchema.safeParse({
      email: "not-an-email",
      password: "Pwa9!testStrong",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects short password (< 8 chars)", () => {
    const parsed = signInSchema.safeParse({
      email: "alice@test.local",
      password: "short",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("accepts valid sign-up payload", () => {
    const parsed = signUpSchema.safeParse({
      name: "Alice",
      email: "alice@test.local",
      password: "Pwa9!testStrong",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty name", () => {
    const parsed = signUpSchema.safeParse({
      name: "",
      email: "alice@test.local",
      password: "Pwa9!testStrong",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects name longer than 100 chars", () => {
    const parsed = signUpSchema.safeParse({
      name: "A".repeat(101),
      email: "alice@test.local",
      password: "Pwa9!testStrong",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects malformed email", () => {
    const parsed = signUpSchema.safeParse({
      name: "Alice",
      email: "not-an-email",
      password: "Pwa9!testStrong",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects short password (< 8 chars)", () => {
    const parsed = signUpSchema.safeParse({
      name: "Alice",
      email: "alice@test.local",
      password: "Pwa9!",
    });
    expect(parsed.success).toBe(false);
  });
});
