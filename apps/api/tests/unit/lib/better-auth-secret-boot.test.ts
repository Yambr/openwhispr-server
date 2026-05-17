// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-03 — RED→GREEN for REVIEW-INDEX.md CR-1.
//
// Better Auth 1.x does NOT validate `secret` at construction time. A
// missing or short BETTER_AUTH_SECRET silently signs session tokens with
// `undefined`, producing forgeable cookies. The pre-publication review
// found no boot-gate sibling to `validateEncryptionBoot()` for this
// env, so we introduce one here.
//
// Contract:
//  * `validateBetterAuthSecretBoot(env?)` MUST throw with EX_CONFIG (78)
//    when BETTER_AUTH_SECRET is missing.
//  * MUST throw with EX_CONFIG when the secret is shorter than 32
//    raw bytes (after best-effort base64url decode OR raw-bytes
//    measurement, whichever yields the larger byte count — operators
//    paste secrets in many encodings).
//  * MUST return void on a satisfied env.
//
// The function calls `process.exit(78)` indirectly via stderr-write
// failure-handler, just like `validateMasterKek`. Tests therefore stub
// `process.exit` to assert instead of crashing the test runner.

import { describe, expect, it, vi } from "vitest";
import { validateBetterAuthSecretBoot } from "../../../src/lib/better-auth-secret-boot.js";

describe("Plan 51-03 — validateBetterAuthSecretBoot", () => {
  function captureExit(): {
    code: number | undefined;
    stderr: string;
    restore: () => void;
  } {
    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string) => {
      exitCode = typeof code === "number" ? code : undefined;
      throw new Error(`__exit:${exitCode}`);
    }) as never);
    let stderr = "";
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as never);
    return {
      get code() {
        return exitCode;
      },
      get stderr() {
        return stderr;
      },
      restore: () => {
        exitSpy.mockRestore();
        writeSpy.mockRestore();
      },
    };
  }

  it("exits 78 when BETTER_AUTH_SECRET is missing", () => {
    const cap = captureExit();
    try {
      expect(() => validateBetterAuthSecretBoot({})).toThrow(/__exit:78/);
      expect(cap.code).toBe(78);
      expect(cap.stderr).toMatch(/BETTER_AUTH_SECRET/);
    } finally {
      cap.restore();
    }
  });

  it("exits 78 when BETTER_AUTH_SECRET is shorter than 32 bytes", () => {
    const cap = captureExit();
    try {
      expect(() => validateBetterAuthSecretBoot({ BETTER_AUTH_SECRET: "too-short" })).toThrow(
        /__exit:78/,
      );
      expect(cap.code).toBe(78);
      expect(cap.stderr).toMatch(/32 bytes|short/i);
    } finally {
      cap.restore();
    }
  });

  it("accepts a 32-byte raw secret", () => {
    // 32 ASCII bytes — passes the raw-length floor.
    const secret = "a".repeat(32);
    expect(() => validateBetterAuthSecretBoot({ BETTER_AUTH_SECRET: secret })).not.toThrow();
  });

  it("accepts a base64url-encoded 32-byte key", () => {
    // 32 bytes -> 43-char base64url
    const secret = "o8LhAB8-XXybutn4FzZVdJOy0fAPLk1si6rJ6AcmRWQ";
    expect(() => validateBetterAuthSecretBoot({ BETTER_AUTH_SECRET: secret })).not.toThrow();
  });
});
