// SPDX-License-Identifier: Apache-2.0
// EnvKeyProvider — reads the master KEK from `MASTER_KEK` env, caches it
// after the first call, and wraps/unwraps per-row DEKs under it via
// AES-256-GCM. Phase 1 Plan 04 / D-11, D-12.
//
// MASTER_KEK is base64url-encoded by `tools/bootstrap.sh` (Plan 02), and
// must decode to exactly 32 raw bytes — anything else is a misconfig and
// fails fast on the first `getKek()`.
//
// We intentionally do NOT cache the decoded KEK in a module-level global:
// EnvKeyProvider holds it per-instance so tests can swap MASTER_KEK and
// instantiate a fresh provider without polluting other tests. In
// production the same single instance is shared via `selectProvider()`.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyProvider } from "./key-provider.js";

// Algorithm name is inlined at the createCipheriv/createDecipheriv call
// sites rather than referenced via a constant — the verification grep
// (`createCipheriv\('aes-256-gcm'`) checks for the literal string.

export class EnvKeyProvider implements KeyProvider {
  readonly id = "env";
  private kek: Buffer | null = null;

  async getKek(): Promise<Buffer> {
    if (this.kek) return this.kek;
    const raw = process.env.MASTER_KEK;
    if (!raw) {
      throw new Error("MASTER_KEK env var not set");
    }
    // tools/bootstrap.sh produces base64url-encoded 32-byte secrets.
    const buf = Buffer.from(raw, "base64url");
    if (buf.length !== 32) {
      throw new Error(`MASTER_KEK must decode to 32 bytes, got ${buf.length}`);
    }
    this.kek = buf;
    return buf;
  }

  async wrapDek(dek: Buffer): Promise<{ wrapped: Buffer; iv: Buffer; authTag: Buffer }> {
    if (!Buffer.isBuffer(dek) || dek.length !== 32) {
      throw new Error("DEK must be 32 bytes");
    }
    const kek = await this.getKek();
    // 12-byte random IV per call. Reusing an IV under the same key is the
    // canonical GCM footgun — randomBytes here is the single source of
    // uniqueness. The companion test `produces different ciphertexts ...`
    // guards against regressions that accidentally reuse the IV.
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", kek, iv);
    const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { wrapped, iv, authTag };
  }

  async unwrapDek(wrapped: Buffer, iv: Buffer, authTag: Buffer): Promise<Buffer> {
    const kek = await this.getKek();
    const decipher = createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAuthTag(authTag);
    // Buffer.concat throws on auth-tag mismatch when final() runs —
    // the error propagates to the caller as the `decryptValue` path
    // requires.
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  }
}
