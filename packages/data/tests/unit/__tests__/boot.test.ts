// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 02 — boot-time MASTER_KEK + KEY_PROVIDER validator.
//
// What we're proving:
//   - `validateMasterKek()` exits with code 78 (BSD EX_CONFIG) when
//     `MASTER_KEK` is unset, malformed base64, or decodes to ≠ 32 bytes.
//   - `validateKeyProviderSelection()` exits with code 78 when
//     `OPENWHISPR_KEY_PROVIDER` is `vault` or `kms` — v1 stubs throw
//     NOT_IMPLEMENTED at first use; refusing at boot prevents silent
//     misconfig in production.
//   - On the happy path (valid 32-byte MASTER_KEK + provider=env or
//     unset) both validators return without throwing or exiting.
//
// Spies `process.exit` so the test runner doesn't actually die. The
// spy replaces exit with a thrown sentinel; tests assert the spy was
// called with code 78.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateEncryptionBoot,
  validateKeyProviderSelection,
  validateMasterKek,
} from "../../../src/encryption/boot.js";

function makeKek(): string {
  return randomBytes(32).toString("base64url");
}

class ProcessExitCalled extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

function spyExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitCalled(code);
  }) as never);
}

describe("validateMasterKek — Phase 33 Plan 02", () => {
  let exitSpy: ReturnType<typeof vi.spyOn> | undefined;
  let stderrSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    exitSpy = spyExit();
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy?.mockRestore();
    stderrSpy?.mockRestore();
    vi.unstubAllEnvs();
  });

  it("exits 78 when MASTER_KEK is unset", () => {
    vi.stubEnv("MASTER_KEK", "");
    expect(() => validateMasterKek(process.env)).toThrowError(ProcessExitCalled);
    expect(exitSpy).toHaveBeenCalledWith(78);
    const stderrCalls = (stderrSpy!.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(stderrCalls.some((s) => /MASTER_KEK env var not set/.test(s))).toBe(true);
  });

  it("exits 78 when MASTER_KEK decodes to less than 32 bytes", () => {
    // 31 raw bytes -> base64url: 41 chars.
    vi.stubEnv("MASTER_KEK", randomBytes(31).toString("base64url"));
    expect(() => validateMasterKek(process.env)).toThrowError(ProcessExitCalled);
    expect(exitSpy).toHaveBeenCalledWith(78);
    const stderrCalls = (stderrSpy!.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(stderrCalls.some((s) => /must decode to 32 bytes/.test(s))).toBe(true);
  });

  it("exits 78 when MASTER_KEK decodes to more than 32 bytes", () => {
    vi.stubEnv("MASTER_KEK", randomBytes(48).toString("base64url"));
    expect(() => validateMasterKek(process.env)).toThrowError(ProcessExitCalled);
    expect(exitSpy).toHaveBeenCalledWith(78);
  });

  it("returns silently on a valid 32-byte MASTER_KEK", () => {
    vi.stubEnv("MASTER_KEK", makeKek());
    expect(() => validateMasterKek(process.env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("attaches EXIT_CODE = 78 on the underlying error classes", async () => {
    const mod = await import("../../../src/encryption/boot.js");
    expect(mod.MasterKekMissingError.EXIT_CODE).toBe(78);
    expect(mod.MasterKekInvalidLengthError.EXIT_CODE).toBe(78);
  });
});

describe("validateKeyProviderSelection — Phase 33 Plan 02", () => {
  let exitSpy: ReturnType<typeof vi.spyOn> | undefined;
  let stderrSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    exitSpy = spyExit();
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy?.mockRestore();
    stderrSpy?.mockRestore();
    vi.unstubAllEnvs();
  });

  it("exits 78 when OPENWHISPR_KEY_PROVIDER=vault", () => {
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "vault");
    expect(() => validateKeyProviderSelection(process.env)).toThrowError(ProcessExitCalled);
    expect(exitSpy).toHaveBeenCalledWith(78);
    const stderrCalls = (stderrSpy!.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(stderrCalls.some((s) => /VaultKeyProvider.*deferred|not implemented/i.test(s))).toBe(
      true,
    );
  });

  it("exits 78 when OPENWHISPR_KEY_PROVIDER=kms", () => {
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "kms");
    expect(() => validateKeyProviderSelection(process.env)).toThrowError(ProcessExitCalled);
    expect(exitSpy).toHaveBeenCalledWith(78);
    const stderrCalls = (stderrSpy!.mock.calls as unknown[][]).map((c) => String(c[0]));
    expect(stderrCalls.some((s) => /KmsKeyProvider.*deferred|not implemented/i.test(s))).toBe(true);
  });

  it("returns silently when OPENWHISPR_KEY_PROVIDER=env", () => {
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "env");
    expect(() => validateKeyProviderSelection(process.env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("returns silently when OPENWHISPR_KEY_PROVIDER is unset (default to env)", () => {
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "");
    expect(() => validateKeyProviderSelection(process.env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe("validateEncryptionBoot — orchestrator", () => {
  let exitSpy: ReturnType<typeof vi.spyOn> | undefined;
  let stderrSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    exitSpy = spyExit();
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy?.mockRestore();
    stderrSpy?.mockRestore();
    vi.unstubAllEnvs();
  });

  it("runs both validators when MASTER_KEK + provider are both valid", () => {
    vi.stubEnv("MASTER_KEK", makeKek());
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "env");
    expect(() => validateEncryptionBoot(process.env)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits via the MASTER_KEK validator when KEK is missing (KEK runs first)", () => {
    vi.stubEnv("MASTER_KEK", "");
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "env");
    expect(() => validateEncryptionBoot(process.env)).toThrowError(ProcessExitCalled);
    expect(exitSpy).toHaveBeenCalledWith(78);
  });

  it("exits via the provider validator when KEK is OK but provider is vault", () => {
    vi.stubEnv("MASTER_KEK", makeKek());
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "vault");
    expect(() => validateEncryptionBoot(process.env)).toThrowError(ProcessExitCalled);
    expect(exitSpy).toHaveBeenCalledWith(78);
  });
});
