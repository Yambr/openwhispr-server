// SPDX-License-Identifier: FSL-1.1-ALv2
// BUG-53-36 closure — branch coverage tests for oauth-state-codec.
//
// Covers:
//   - encryptCodeVerifier produces 6 bytea sidecars (happy path).
//   - decryptCodeVerifierFromRow round-trip (single provider).
//   - decryptCodeVerifierFromRow fallback to plaintext column when
//     sidecars absent (mid-backfill window).
//   - decryptCodeVerifierFromRow throws when both plaintext and
//     sidecars are absent.
//   - hasAllSidecars branch coverage: each of the 6 buffer checks
//     fails independently when any one sidecar is missing.
//   - decryptCodeVerifierFromRow tries providers in order; first
//     successful decrypt wins, all-failed rethrows last error.
//
// Per CLAUDE.md "no mocks": real crypto via real EnvKeyProvider.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvKeyProvider } from "../../../src/encryption/env-key-provider.js";
import {
  decryptCodeVerifierFromRow,
  encryptCodeVerifier,
} from "../../../src/encryption/oauth-state-codec.js";

function makeKek(): string {
  return randomBytes(32).toString("base64url");
}

describe("oauth-state-codec — BUG-53-36 branch coverage", () => {
  let provider: EnvKeyProvider;
  let prevKek: string | undefined;

  beforeEach(() => {
    prevKek = process.env.MASTER_KEK;
    process.env.MASTER_KEK = makeKek();
    provider = new EnvKeyProvider();
  });

  afterEach(() => {
    if (prevKek === undefined) delete process.env.MASTER_KEK;
    else process.env.MASTER_KEK = prevKek;
  });

  it("encryptCodeVerifier produces 6 buffer sidecars", async () => {
    const sidecars = await encryptCodeVerifier(provider, "test-verifier");
    expect(Buffer.isBuffer(sidecars.code_verifier_dek_wrapped)).toBe(true);
    expect(Buffer.isBuffer(sidecars.code_verifier_dek_iv)).toBe(true);
    expect(Buffer.isBuffer(sidecars.code_verifier_dek_auth_tag)).toBe(true);
    expect(Buffer.isBuffer(sidecars.code_verifier_value_iv)).toBe(true);
    expect(Buffer.isBuffer(sidecars.code_verifier_value_auth_tag)).toBe(true);
    expect(Buffer.isBuffer(sidecars.code_verifier_value_ciphertext)).toBe(true);
  });

  it("decryptCodeVerifierFromRow round-trips a ciphertext row", async () => {
    const plaintext = "verifier-".concat("x".repeat(43));
    const sidecars = await encryptCodeVerifier(provider, plaintext);
    const recovered = await decryptCodeVerifierFromRow([provider], sidecars);
    expect(recovered).toBe(plaintext);
  });

  it("falls back to plaintext code_verifier when sidecars are absent", async () => {
    const recovered = await decryptCodeVerifierFromRow([provider], {
      code_verifier: "legacy-plaintext-value",
    });
    expect(recovered).toBe("legacy-plaintext-value");
  });

  it("throws when both plaintext and sidecars are absent", async () => {
    await expect(decryptCodeVerifierFromRow([provider], {})).rejects.toThrow(
      /missing both plaintext code_verifier and bytea sidecars/,
    );
  });

  describe("hasAllSidecars branch — each missing sidecar fails the gate", () => {
    let sidecars: Awaited<ReturnType<typeof encryptCodeVerifier>>;

    beforeEach(async () => {
      sidecars = await encryptCodeVerifier(provider, "anything");
    });

    const fields = [
      "code_verifier_dek_wrapped",
      "code_verifier_dek_iv",
      "code_verifier_dek_auth_tag",
      "code_verifier_value_iv",
      "code_verifier_value_auth_tag",
      "code_verifier_value_ciphertext",
    ] as const;

    for (const field of fields) {
      it(`drops sidecar ${field} → falls through hasAllSidecars`, async () => {
        const incomplete: Record<string, Buffer | null> = { ...sidecars };
        incomplete[field] = null;
        // No plaintext fallback → throw with the missing-both message.
        await expect(decryptCodeVerifierFromRow([provider], incomplete)).rejects.toThrow(
          /missing both plaintext/,
        );
      });
    }
  });

  it("tries providers in order — second provider decrypts when first throws", async () => {
    const ciphertext = await encryptCodeVerifier(provider, "second-wins");
    // First provider has a different KEK → its unwrapDek will throw.
    const wrongKek = makeKek();
    process.env.MASTER_KEK = wrongKek;
    const wrongProvider = new EnvKeyProvider();
    // Restore the correct provider state at the END so the chain ordering
    // (wrong then right) actually matters.
    const recovered = await decryptCodeVerifierFromRow([wrongProvider, provider], ciphertext);
    expect(recovered).toBe("second-wins");
  });

  it("rethrows lastErr when every provider fails", async () => {
    const ciphertext = await encryptCodeVerifier(provider, "anything");
    const wrongA = new EnvKeyProvider();
    process.env.MASTER_KEK = makeKek();
    const wrongB = new EnvKeyProvider();
    await expect(decryptCodeVerifierFromRow([wrongA, wrongB], ciphertext)).rejects.toThrow();
  });
});
