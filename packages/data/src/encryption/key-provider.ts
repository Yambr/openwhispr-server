// SPDX-License-Identifier: FSL-1.1-ALv2
// KeyProvider interface + selectProvider() dispatcher.
//
// Phase 1 Plan 04 / D-12, PROVIDER-02.
//
// The provider abstraction exists so the envelope layer doesn't bake in
// a hard dependency on any specific KEK source. v1 ships exactly one
// production-grade implementation (`EnvKeyProvider`) that reads the KEK
// from `MASTER_KEK` env. Vault and KMS adapters are stubs (they satisfy
// the interface but throw "not implemented in v1" on every method) —
// that lets ops scripts wire `OPENWHISPR_KEY_PROVIDER=vault` early and
// get a synchronous, descriptive failure rather than a silent miswire.
//
// Phase 6 fills in the real Vault + KMS adapters. The interface stays
// stable so callers don't need to change.
import { EnvKeyProvider } from "./env-key-provider.js";
import { KmsKeyProvider } from "./kms-key-provider.js";
import { VaultKeyProvider } from "./vault-key-provider.js";

export interface KeyProvider {
  /** Stable identifier surfaced in logs and tests; matches the env id. */
  readonly id: string;

  /**
   * Returns the master key-encrypting key (KEK) as a 32-byte Buffer.
   * Implementations cache after the first call where appropriate.
   */
  getKek(): Promise<Buffer>;

  /**
   * Wrap a per-row DEK (32 bytes) under the KEK using AES-256-GCM with
   * a fresh random 12-byte IV. Returns the wrapped ciphertext, IV, and
   * GCM auth tag — these three values are stored on the encrypted row
   * alongside the value-level ciphertext.
   */
  wrapDek(dek: Buffer): Promise<{ wrapped: Buffer; iv: Buffer; authTag: Buffer }>;

  /**
   * Reverse of `wrapDek`. Must throw on any GCM auth-tag mismatch.
   */
  unwrapDek(wrapped: Buffer, iv: Buffer, authTag: Buffer): Promise<Buffer>;
}

/**
 * Resolve a provider implementation from the `OPENWHISPR_KEY_PROVIDER`
 * env var. Defaults to `env` (the production-grade v1 path). Vault and
 * KMS routes return their stubs — instantiation succeeds, calls throw.
 */
export function selectProvider(): KeyProvider {
  const id = process.env.OPENWHISPR_KEY_PROVIDER || "env";
  switch (id) {
    case "env":
      return new EnvKeyProvider();
    case "vault":
      return new VaultKeyProvider();
    case "kms":
      return new KmsKeyProvider();
    default:
      throw new Error(`Unknown key provider: ${id}`);
  }
}
