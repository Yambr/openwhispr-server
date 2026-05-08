// KeyProvider dispatcher + EnvKeyProvider tests — Phase 1 Plan 04 /
// D-12, PROVIDER-02.
//
// Vault and KMS adapters are stubs in v1; their job is to satisfy the
// interface contract AND throw a clear "deferred to v1+" error every
// time any method is called. selectProvider() routes via env.
//
// We use vitest's `vi.stubEnv` / `vi.unstubAllEnvs` so each test has a
// clean process.env without leaking state between cases.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvKeyProvider } from "../encryption/env-key-provider.js";
import { selectProvider } from "../encryption/key-provider.js";
import { KmsKeyProvider } from "../encryption/kms-key-provider.js";
import { VaultKeyProvider } from "../encryption/vault-key-provider.js";

function makeKek(): string {
  return randomBytes(32).toString("base64url");
}

describe("KeyProvider — Phase 1 Plan 04", () => {
  beforeEach(() => {
    // Each test sets exactly the env it needs.
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selectProvider() defaults to EnvKeyProvider when OPENWHISPR_KEY_PROVIDER is unset", () => {
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "");
    const p = selectProvider();
    expect(p).toBeInstanceOf(EnvKeyProvider);
    expect(p.id).toBe("env");
  });

  it("selectProvider() returns VaultKeyProvider for OPENWHISPR_KEY_PROVIDER=vault and getKek() throws the deferred error", async () => {
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "vault");
    const p = selectProvider();
    expect(p).toBeInstanceOf(VaultKeyProvider);
    expect(p.id).toBe("vault");
    await expect(p.getKek()).rejects.toThrow(
      /VaultKeyProvider not implemented in v1; HashiCorp Vault adapter deferred/,
    );
  });

  it("selectProvider() returns KmsKeyProvider for OPENWHISPR_KEY_PROVIDER=kms and getKek() throws the deferred error", async () => {
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "kms");
    const p = selectProvider();
    expect(p).toBeInstanceOf(KmsKeyProvider);
    expect(p.id).toBe("kms");
    await expect(p.getKek()).rejects.toThrow(
      /KmsKeyProvider not implemented in v1; AWS KMS adapter deferred/,
    );
  });

  it("selectProvider() throws on an unknown provider id", () => {
    vi.stubEnv("OPENWHISPR_KEY_PROVIDER", "unknown");
    expect(() => selectProvider()).toThrowError(/Unknown key provider: unknown/);
  });

  it("EnvKeyProvider.getKek() throws when MASTER_KEK is unset", async () => {
    vi.stubEnv("MASTER_KEK", "");
    const p = new EnvKeyProvider();
    await expect(p.getKek()).rejects.toThrow(/MASTER_KEK env var not set/);
  });

  it("EnvKeyProvider.getKek() throws when MASTER_KEK decodes to the wrong byte length", async () => {
    // 'short' base64url-decodes to 4 raw bytes — well below the 32-byte
    // requirement. We assert on the byte-length error message.
    vi.stubEnv("MASTER_KEK", "short");
    const p = new EnvKeyProvider();
    await expect(p.getKek()).rejects.toThrow(/MASTER_KEK must decode to 32 bytes/);
  });

  it("EnvKeyProvider.wrapDek + unwrapDek round-trips a 32-byte DEK byte-for-byte", async () => {
    vi.stubEnv("MASTER_KEK", makeKek());
    const p = new EnvKeyProvider();
    const dek = randomBytes(32);
    const { wrapped, iv, authTag } = await p.wrapDek(dek);
    const back = await p.unwrapDek(wrapped, iv, authTag);
    expect(back.equals(dek)).toBe(true);
  });

  it("EnvKeyProvider.wrapDek rejects DEKs that aren't exactly 32 bytes", async () => {
    vi.stubEnv("MASTER_KEK", makeKek());
    const p = new EnvKeyProvider();
    await expect(p.wrapDek(randomBytes(16))).rejects.toThrow(/DEK must be 32 bytes/);
    await expect(p.wrapDek(randomBytes(64))).rejects.toThrow(/DEK must be 32 bytes/);
  });
});
