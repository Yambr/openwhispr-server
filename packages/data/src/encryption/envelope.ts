// KEK/DEK envelope encryption — Phase 1 Plan 04 / D-11.
//
// Why an envelope at all:
//
//   Encrypting every sensitive value directly under the master KEK would
//   force a full ciphertext re-encryption on every KEK rotation. The
//   envelope pattern (industry-standard for KMS-backed systems) sidesteps
//   that: every row gets its own per-row data-encryption key (DEK), the
//   value is encrypted under the DEK, and the DEK itself is wrapped under
//   the KEK. KEK rotation becomes "re-wrap the DEKs" — touching only the
//   3 small bytea columns per row, not the (potentially large) value
//   ciphertext column.
//
// Wire shape (6 bytea columns per encrypted value column):
//   - dek_wrapped:      AES-256-GCM(KEK, DEK), the wrapped key material.
//   - dek_iv:           12-byte random IV used to wrap the DEK.
//   - dek_auth_tag:     16-byte GCM tag covering dek_wrapped.
//   - value_iv:         12-byte random IV used to encrypt the plaintext.
//   - value_auth_tag:   16-byte GCM tag covering value_ciphertext.
//   - value_ciphertext: AES-256-GCM(DEK, plaintext).
//
// IV uniqueness is the load-bearing GCM safety property. We generate
// fresh randomBytes(12) for both wrap-IV and value-IV on every call;
// the unit test "produces different ciphertexts for the same plaintext"
// guards against regressions that accidentally reuse one.
//
// DEK zeroization (`dek.fill(0)` post-use) is best-effort under V8's
// generational GC — see RESEARCH-DB Assumption A2. We do it because it's
// cheap and removes a class of trivial memory-scrape leaks; we don't
// rely on it for any security claim.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyProvider } from "./key-provider.js";

const ALG = "aes-256-gcm";

export interface EncryptedRow {
  dek_wrapped: Buffer;
  dek_iv: Buffer;
  dek_auth_tag: Buffer;
  value_iv: Buffer;
  value_auth_tag: Buffer;
  value_ciphertext: Buffer;
}

export async function encryptValue(
  provider: KeyProvider,
  plaintext: Buffer,
): Promise<EncryptedRow> {
  if (!Buffer.isBuffer(plaintext)) {
    throw new TypeError("encryptValue: plaintext must be a Buffer");
  }
  const dek = randomBytes(32);
  try {
    const valueIv = randomBytes(12);
    const cipher = createCipheriv(ALG, dek, valueIv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const valueAuthTag = cipher.getAuthTag();

    const { wrapped, iv: dekIv, authTag: dekAuthTag } = await provider.wrapDek(dek);

    return {
      dek_wrapped: wrapped,
      dek_iv: dekIv,
      dek_auth_tag: dekAuthTag,
      value_iv: valueIv,
      value_auth_tag: valueAuthTag,
      value_ciphertext: ciphertext,
    };
  } finally {
    // Best-effort zeroization (V8 GC may have already retained copies).
    dek.fill(0);
  }
}

export async function decryptValue(provider: KeyProvider, row: EncryptedRow): Promise<Buffer> {
  const dek = await provider.unwrapDek(row.dek_wrapped, row.dek_iv, row.dek_auth_tag);
  try {
    const decipher = createDecipheriv(ALG, dek, row.value_iv);
    decipher.setAuthTag(row.value_auth_tag);
    // final() throws on auth-tag mismatch; the error propagates as
    // the test "rejects tampered value_ciphertext" requires.
    return Buffer.concat([decipher.update(row.value_ciphertext), decipher.final()]);
  } finally {
    dek.fill(0);
  }
}
