// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick-task 260527-im6 — unit tests for apps/api/src/config/setup-claim.ts
//
// Covers PLAN.md §5.U-A (parser) + §5.U-B (timing-safe comparator) +
// §5.U-C (boot validator, A1 single-parse property) + A2 boot-validation
// of ADDITIONAL_ALLOWED_ORIGINS via getAllowedOrigins.
//
// DB-touching paths use the real testcontainer harness in
// apps/api/src/routes/__tests__/setup.ts -- CLAUDE.md constitutional
// rule "no mocks of internal logic" is honored.

import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAllowedOrigins,
  OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT,
  parseSetupClaimToken,
  SetupClaimConfigError,
  safeTokenCompare,
  validateSetupClaimBoot,
} from "../../../../src/config/setup-claim.js";
import {
  type BootedPostgres,
  bootMigratedPostgres,
  resetSetupState,
} from "../../../../src/routes/__tests__/setup.js";

const VALID_HEX64 = "0123456789abcdef0123456789abcdee0123456789abcdef0123456789abcd00";
const VALID_HEX64_TWO = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543211";

describe("OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT", () => {
  it("accepts lowercase hex of exactly 64 chars", () => {
    expect(OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT.test(VALID_HEX64)).toBe(true);
  });
  it("rejects uppercase hex (lowercase-only by spec)", () => {
    expect(OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT.test(VALID_HEX64.toUpperCase())).toBe(false);
  });
  it("rejects 63 chars", () => {
    expect(OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT.test("0".repeat(63))).toBe(false);
  });
  it("rejects 65 chars", () => {
    expect(OPENWHISPR_SETUP_CLAIM_TOKEN_FORMAT.test("0".repeat(65))).toBe(false);
  });
});

describe("parseSetupClaimToken (U-A matrix)", () => {
  it("U-A-1: returns undefined when env var is unset", () => {
    expect(parseSetupClaimToken({})).toBeUndefined();
  });
  it("U-A-1b: returns undefined when env var is blank-after-trim", () => {
    expect(parseSetupClaimToken({ OPENWHISPR_SETUP_CLAIM_TOKEN: "   " })).toBeUndefined();
  });
  it("U-A-2: returns Buffer length 32 for valid hex64", () => {
    const buf = parseSetupClaimToken({ OPENWHISPR_SETUP_CLAIM_TOKEN: VALID_HEX64 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf?.length).toBe(32);
  });
  it("U-A-3: trims surrounding whitespace", () => {
    const buf = parseSetupClaimToken({
      OPENWHISPR_SETUP_CLAIM_TOKEN: `  ${VALID_HEX64}  `,
    });
    expect(buf?.length).toBe(32);
  });
  it("U-A-4: throws on 63 hex chars", () => {
    expect(() => parseSetupClaimToken({ OPENWHISPR_SETUP_CLAIM_TOKEN: "a".repeat(63) })).toThrow(
      SetupClaimConfigError,
    );
  });
  it("U-A-5: throws on 65 hex chars", () => {
    expect(() =>
      parseSetupClaimToken({ OPENWHISPR_SETUP_CLAIM_TOKEN: "a".repeat(64) + "0" }),
    ).toThrow(SetupClaimConfigError);
  });
  it("U-A-6: throws on uppercase hex (lowercase-only shape gate)", () => {
    expect(() =>
      parseSetupClaimToken({ OPENWHISPR_SETUP_CLAIM_TOKEN: VALID_HEX64.toUpperCase() }),
    ).toThrow(SetupClaimConfigError);
  });
  it("U-A-7: throws on lowercase 'deadbeef' x8 (BAD_TOKEN_PATTERNS)", () => {
    expect(() =>
      parseSetupClaimToken({ OPENWHISPR_SETUP_CLAIM_TOKEN: "deadbeef".repeat(8) }),
    ).toThrow(/low-entropy/);
  });
  it("U-A-8: throws on '0'.repeat(64) (single-char repeat)", () => {
    expect(() => parseSetupClaimToken({ OPENWHISPR_SETUP_CLAIM_TOKEN: "0".repeat(64) })).toThrow(
      /low-entropy/,
    );
  });
  it("U-A-9: throws on 'a'.repeat(64) (single-char repeat)", () => {
    expect(() => parseSetupClaimToken({ OPENWHISPR_SETUP_CLAIM_TOKEN: "a".repeat(64) })).toThrow(
      /low-entropy/,
    );
  });
  it("U-A-10: throws on ascending-hex repeat", () => {
    expect(() =>
      parseSetupClaimToken({
        OPENWHISPR_SETUP_CLAIM_TOKEN: "0123456789abcdef".repeat(4),
      }),
    ).toThrow(/low-entropy/);
  });
  it("U-A-12: throws on non-hex character", () => {
    expect(() =>
      parseSetupClaimToken({
        OPENWHISPR_SETUP_CLAIM_TOKEN: "g".repeat(64),
      }),
    ).toThrow(/canonical hex64 shape/);
  });
});

describe("safeTokenCompare (U-B matrix)", () => {
  const a = Buffer.from(VALID_HEX64, "hex");
  const aClone = Buffer.from(VALID_HEX64, "hex");
  const b = Buffer.from(VALID_HEX64_TWO, "hex");
  const short = Buffer.alloc(16);

  it("U-B-1: returns true on identical 32-byte Buffers", () => {
    expect(safeTokenCompare(a, aClone)).toBe(true);
  });
  it("U-B-2: returns false on different 32-byte Buffers", () => {
    expect(safeTokenCompare(a, b)).toBe(false);
  });
  it("U-B-3: returns false on length mismatch -- does NOT throw", () => {
    expect(() => safeTokenCompare(short, a)).not.toThrow();
    expect(safeTokenCompare(short, a)).toBe(false);
  });
  it("U-B-4: returns false when presented is undefined", () => {
    expect(safeTokenCompare(undefined, a)).toBe(false);
  });
  it("U-B-5: returns false when expected is undefined", () => {
    expect(safeTokenCompare(a, undefined)).toBe(false);
  });
  it("U-B-6: returns false when both are undefined", () => {
    expect(safeTokenCompare(undefined, undefined)).toBe(false);
  });
});

describe("getAllowedOrigins (A2 matrix)", () => {
  it("returns canonical-only when ADDITIONAL_ALLOWED_ORIGINS is unset", () => {
    const r = getAllowedOrigins({ ingressBaseUrl: "https://api.example.com", env: {} });
    expect(r.canonical).toBe("https://api.example.com");
    expect(r.additional).toEqual([]);
    expect(r.all).toEqual(["https://api.example.com"]);
  });
  it("strips trailing path on canonical via URL.origin", () => {
    const r = getAllowedOrigins({ ingressBaseUrl: "https://api.example.com/", env: {} });
    expect(r.canonical).toBe("https://api.example.com");
  });
  it("parses comma-separated additional origins", () => {
    const r = getAllowedOrigins({
      ingressBaseUrl: "http://localhost:4000",
      env: { ADDITIONAL_ALLOWED_ORIGINS: "http://localhost:5173,https://app.example.com" },
    });
    expect(r.additional).toEqual(["http://localhost:5173", "https://app.example.com"]);
    expect(r.all).toEqual([
      "http://localhost:4000",
      "http://localhost:5173",
      "https://app.example.com",
    ]);
  });
  it("skips empty entries silently", () => {
    const r = getAllowedOrigins({
      ingressBaseUrl: "http://localhost:4000",
      env: { ADDITIONAL_ALLOWED_ORIGINS: "http://localhost:5173, ,,https://app.example.com" },
    });
    expect(r.additional).toEqual(["http://localhost:5173", "https://app.example.com"]);
  });
  it("throws on path-bearing entry", () => {
    expect(() =>
      getAllowedOrigins({
        ingressBaseUrl: "http://localhost:4000",
        env: { ADDITIONAL_ALLOWED_ORIGINS: "http://localhost:5173/with/path" },
      }),
    ).toThrow(/contains a path/);
  });
  it("throws on query-bearing entry", () => {
    expect(() =>
      getAllowedOrigins({
        ingressBaseUrl: "http://localhost:4000",
        env: { ADDITIONAL_ALLOWED_ORIGINS: "http://localhost:5173/?foo=bar" },
      }),
    ).toThrow(/contains a path|contains query/);
  });
  it("throws on hash-bearing entry", () => {
    expect(() =>
      getAllowedOrigins({
        ingressBaseUrl: "http://localhost:4000",
        env: { ADDITIONAL_ALLOWED_ORIGINS: "http://localhost:5173#fragment" },
      }),
    ).toThrow(/contains query or hash/);
  });
  it("throws on data: scheme entry (URL.origin returns 'null')", () => {
    expect(() =>
      getAllowedOrigins({
        ingressBaseUrl: "http://localhost:4000",
        env: { ADDITIONAL_ALLOWED_ORIGINS: "data:text/plain,foo" },
      }),
    ).toThrow();
  });
  it("throws on malformed URL", () => {
    expect(() =>
      getAllowedOrigins({
        ingressBaseUrl: "http://localhost:4000",
        env: { ADDITIONAL_ALLOWED_ORIGINS: "not-a-url" },
      }),
    ).toThrow(/is not a valid URL/);
  });
  it("throws on malformed canonical (defence-in-depth)", () => {
    expect(() => getAllowedOrigins({ ingressBaseUrl: "::::not a url", env: {} })).toThrow(
      /is not a valid URL/,
    );
  });
});

// =====================================================================
// validateSetupClaimBoot (U-C matrix) -- uses real testcontainer DB.
// =====================================================================
describe("validateSetupClaimBoot (U-C matrix)", () => {
  let booted: BootedPostgres;
  let db: TransactionalDb<ExecutableTx>;

  beforeAll(async () => {
    booted = await bootMigratedPostgres();
    db = booted.db as unknown as TransactionalDb<ExecutableTx>;
  }, 180_000);
  afterAll(async () => {
    await booted?.shutdown();
  });
  beforeEach(async () => {
    await resetSetupState(booted.ownerPool, "pending");
  });

  /** Spy-onFail harness mirroring auth.test.ts:19-34. */
  async function callValidate(env: NodeJS.ProcessEnv): Promise<{
    result?: Awaited<ReturnType<typeof validateSetupClaimBoot>>;
    failure?: string;
  }> {
    let failure: string | undefined;
    const onFail = vi.fn((message: string): never => {
      failure = message;
      throw new Error("__refuse__");
    }) as unknown as (message: string) => never;
    try {
      const result = await validateSetupClaimBoot({ db, env, onFail });
      return { result };
    } catch {
      return { failure };
    }
  }

  it("U-C-1: status='completed' + no env-token + no SMTP -> no-op", async () => {
    await resetSetupState(booted.ownerPool, "completed");
    const { result, failure } = await callValidate({ NODE_ENV: "production" });
    expect(failure).toBeUndefined();
    expect(result?.setupStateStatus).toBe("completed");
    expect(result?.hasEnvToken).toBe(false);
    expect(result?.hasSmtp).toBe(false);
    expect(result?.envTokenBuffer).toBeUndefined();
  });

  it("U-C-2: status='pending' + valid hex64 -> envTokenBuffer populated (A1)", async () => {
    const { result, failure } = await callValidate({
      NODE_ENV: "production",
      OPENWHISPR_SETUP_CLAIM_TOKEN: VALID_HEX64,
    });
    expect(failure).toBeUndefined();
    expect(result?.hasEnvToken).toBe(true);
    expect(result?.hasSmtp).toBe(false);
    expect(result?.envTokenBuffer).toBeInstanceOf(Buffer);
    expect(result?.envTokenBuffer?.length).toBe(32);
  });

  it("U-C-3: status='pending' + SMTP set -> no-op, hasSmtp=true", async () => {
    const { result, failure } = await callValidate({
      NODE_ENV: "production",
      SMTP_HOST: "mail.example.com",
    });
    expect(failure).toBeUndefined();
    expect(result?.hasEnvToken).toBe(false);
    expect(result?.hasSmtp).toBe(true);
    expect(result?.envTokenBuffer).toBeUndefined();
  });

  it("U-C-4: status='pending' + neither path configured -> refuse boot", async () => {
    const { result, failure } = await callValidate({ NODE_ENV: "production" });
    expect(result).toBeUndefined();
    expect(failure).toMatch(/no admin claim path is configured/);
    expect(failure).toMatch(/OPENWHISPR_SETUP_CLAIM_TOKEN/);
    expect(failure).toMatch(/SMTP_HOST/);
  });

  it("U-C-5: bad token pattern -> refuse boot, message names the cause", async () => {
    const { result, failure } = await callValidate({
      NODE_ENV: "production",
      OPENWHISPR_SETUP_CLAIM_TOKEN: "0".repeat(64),
    });
    expect(result).toBeUndefined();
    expect(failure).toMatch(/setup-claim-boot:/);
    expect(failure).toMatch(/low-entropy|well-known pattern/);
  });

  it("U-C-5b: bad shape (uppercase) -> refuse boot, message names the cause", async () => {
    const { result, failure } = await callValidate({
      NODE_ENV: "production",
      OPENWHISPR_SETUP_CLAIM_TOKEN: VALID_HEX64.toUpperCase(),
    });
    expect(result).toBeUndefined();
    expect(failure).toMatch(/canonical hex64 shape/);
  });

  it("U-C-7: status='skipped_legacy' + no claim path -> no-op", async () => {
    await resetSetupState(booted.ownerPool, "skipped_legacy");
    const { result, failure } = await callValidate({ NODE_ENV: "production" });
    expect(failure).toBeUndefined();
    expect(result?.setupStateStatus).toBe("skipped_legacy");
  });

  it("U-C-8: status='pending' + both env-token + SMTP -> both flags true, envTokenBuffer populated", async () => {
    const { result } = await callValidate({
      NODE_ENV: "production",
      OPENWHISPR_SETUP_CLAIM_TOKEN: VALID_HEX64,
      SMTP_HOST: "mail.example.com",
    });
    expect(result?.hasEnvToken).toBe(true);
    expect(result?.hasSmtp).toBe(true);
    expect(result?.envTokenBuffer?.length).toBe(32);
  });

  it("U-C-9 (A1 single-parse): boot validator returns the parsed Buffer; route consumes via deps without re-parsing", async () => {
    const { result } = await callValidate({
      NODE_ENV: "production",
      OPENWHISPR_SETUP_CLAIM_TOKEN: VALID_HEX64,
    });
    // The buffer the boot validator returns IS the canonical reference
    // the route layer consumes via deps. A1 -- route MUST NOT re-parse;
    // the property below proves the validator yields a usable Buffer the
    // safeTokenCompare seam reads directly.
    expect(result?.envTokenBuffer).toBeInstanceOf(Buffer);
    const presented = Buffer.from(VALID_HEX64, "hex");
    expect(safeTokenCompare(presented, result?.envTokenBuffer)).toBe(true);
    const wrongPresented = Buffer.from(VALID_HEX64_TWO, "hex");
    expect(safeTokenCompare(wrongPresented, result?.envTokenBuffer)).toBe(false);
  });

  it("U-C-test-permissive: NODE_ENV=test + status=pending + no claim path -> returns without onFail", async () => {
    // The permissive default returns instead of refusing. Production
    // path uses the strict onFail invocation.
    const { result, failure } = await callValidate({ NODE_ENV: "test" });
    expect(failure).toBeUndefined();
    expect(result?.hasEnvToken).toBe(false);
    expect(result?.hasSmtp).toBe(false);
    expect(result?.setupStateStatus).toBe("pending");
  });

  it("default onFail writes FATAL to stderr and calls process.exit(78)", async () => {
    // Cover the `defaultFail` branch — the production path when no
    // onFail spy is injected. Spy on stderr + process.exit so we can
    // assert the contract without killing the test runner.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__exit_called__");
    }) as never);
    try {
      await validateSetupClaimBoot({
        db,
        env: { NODE_ENV: "production" }, // pending + no path → refuse boot
        // NO onFail -- exercises the defaultFail default.
      });
    } catch (err) {
      expect((err as Error).message).toBe("__exit_called__");
    }
    expect(errSpy).toHaveBeenCalled();
    const stderrCall = errSpy.mock.calls[0]?.[0] as string;
    expect(stderrCall).toMatch(/^FATAL setup-claim-boot:/);
    expect(exitSpy).toHaveBeenCalledWith(78);
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("DB error: failed setup_state read propagates (does NOT swallow)", async () => {
    // Inject a fake db whose transaction throws -- mirrors a transient
    // connection failure at boot. The validator MUST propagate the
    // error (same posture as validateBetterAuthSecretBoot) instead of
    // silently defaulting status to 'pending'.
    const fakeDb = {
      async transaction() {
        throw new Error("simulated DB outage at boot");
      },
    } as unknown as TransactionalDb<ExecutableTx>;
    let captured: unknown;
    try {
      await validateSetupClaimBoot({
        db: fakeDb,
        env: { NODE_ENV: "production", OPENWHISPR_SETUP_CLAIM_TOKEN: VALID_HEX64 },
        onFail: ((msg: string) => {
          throw new Error(`__refuse__:${msg}`);
        }) as (m: string) => never,
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toMatch(/simulated DB outage/);
  });

  it("DB-defensive: missing setup_state row defaults to 'pending'", async () => {
    await resetSetupState(booted.ownerPool, "missing");
    const { result, failure } = await callValidate({
      NODE_ENV: "production",
      OPENWHISPR_SETUP_CLAIM_TOKEN: VALID_HEX64,
    });
    // Should succeed (env-token mode covers pending).
    expect(failure).toBeUndefined();
    expect(result?.setupStateStatus).toBe("pending");
  });
});
