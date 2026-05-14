// SPDX-License-Identifier: Apache-2.0
// KEK/DEK envelope-encryption tests — Phase 1 Plan 04 / D-11, D-12.
//
// What we're proving:
//   - encryptValue + decryptValue round-trip plaintext byte-for-byte.
//   - Each call generates a fresh DEK + IV, so encrypting the same input
//     twice yields different ciphertexts (regression net for IV reuse).
//   - GCM auth-tag verification rejects tampered ciphertext, tampered
//     auth tags, AND tampered DEK wrapping. A single bit flipped at any
//     point causes decryptValue to throw.
//   - encryptValue runtime-guards against non-Buffer plaintext (TS catches
//     most cases, the runtime guard is defense in depth).
//
// Per CLAUDE.md "no mocks": real Node `crypto` (createCipheriv etc.).
// We boot a real EnvKeyProvider with a deterministic test KEK.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvKeyProvider } from "../../../src/encryption/env-key-provider.js";
import { decryptValue, encryptValue } from "../../../src/encryption/envelope.js";

/** 32 raw bytes -> base64url so EnvKeyProvider accepts it as MASTER_KEK. */
function makeKek(): string {
  return randomBytes(32).toString("base64url");
}

describe("envelope encryption — Phase 1 Plan 04", () => {
  let provider: EnvKeyProvider;
  let prevKek: string | undefined;

  beforeEach(() => {
    prevKek = process.env.MASTER_KEK;
    process.env.MASTER_KEK = makeKek();
    provider = new EnvKeyProvider();
  });

  afterEach(() => {
    if (prevKek === undefined) {
      delete process.env.MASTER_KEK;
    } else {
      process.env.MASTER_KEK = prevKek;
    }
  });

  it("round-trips plaintext byte-for-byte across multiple sample sizes", async () => {
    const samples: Buffer[] = [
      Buffer.alloc(0), // empty
      Buffer.from([0x42]), // 1 byte
      Buffer.from("hello world", "utf8"),
      randomBytes(1024), // 1 KiB random
      randomBytes(64 * 1024), // 64 KiB random
    ];
    for (const pt of samples) {
      const row = await encryptValue(provider, pt);
      const back = await decryptValue(provider, row);
      expect(back.equals(pt)).toBe(true);
    }
  });

  it("produces different ciphertexts for the same plaintext (random IV/DEK per call)", async () => {
    const pt = Buffer.from("repeat-me");
    const a = await encryptValue(provider, pt);
    const b = await encryptValue(provider, pt);
    // All four randomized fields must differ between the two calls.
    expect(a.value_ciphertext.equals(b.value_ciphertext)).toBe(false);
    expect(a.value_iv.equals(b.value_iv)).toBe(false);
    expect(a.dek_wrapped.equals(b.dek_wrapped)).toBe(false);
    expect(a.dek_iv.equals(b.dek_iv)).toBe(false);
  });

  it("rejects tampered value_ciphertext (one bit flipped) via GCM auth tag", async () => {
    const row = await encryptValue(provider, Buffer.from("secret"));
    const tampered = Buffer.from(row.value_ciphertext);
    // Make sure ciphertext is non-empty for the bit flip.
    expect(tampered.length).toBeGreaterThan(0);
    const first = tampered[0] ?? 0;
    tampered[0] = first ^ 0x01;
    await expect(decryptValue(provider, { ...row, value_ciphertext: tampered })).rejects.toThrow();
  });

  it("rejects tampered value_auth_tag", async () => {
    const row = await encryptValue(provider, Buffer.from("secret"));
    const tampered = Buffer.from(row.value_auth_tag);
    const first = tampered[0] ?? 0;
    tampered[0] = first ^ 0xff;
    await expect(decryptValue(provider, { ...row, value_auth_tag: tampered })).rejects.toThrow();
  });

  it("rejects tampered dek_wrapped (caught at the unwrap step)", async () => {
    const row = await encryptValue(provider, Buffer.from("secret"));
    const tampered = Buffer.from(row.dek_wrapped);
    const first = tampered[0] ?? 0;
    tampered[0] = first ^ 0xaa;
    await expect(decryptValue(provider, { ...row, dek_wrapped: tampered })).rejects.toThrow();
  });

  it("encryptValue runtime-guards against non-Buffer plaintext", async () => {
    await expect(
      encryptValue(provider, "raw-string" as any),
    ).rejects.toThrow(/plaintext must be a Buffer/);
  });
});
