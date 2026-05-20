// SPDX-License-Identifier: FSL-1.1-ALv2
// BUG-53-36 closure — branch coverage tests for oauth-state-codec.
// data:CR-05 — positive lock: the codec NEVER trusts a caller-supplied
// plaintext `code_verifier`. Migration 0020 dropped the plaintext
// column; there is no plaintext fallback. A row missing sidecars must
// throw, even when it carries a `code_verifier` string field.
//
// Covers:
//   - encryptCodeVerifier produces 6 bytea sidecars (happy path).
//   - decryptCodeVerifierFromRow round-trip (single provider).
//   - decryptCodeVerifierFromRow throws when sidecars absent — even if
//     a plaintext `code_verifier` string is present (data:CR-05 lock).
//   - decryptCodeVerifierFromRow throws when sidecars are absent.
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

  it("data:CR-05 — NEVER trusts a caller-supplied plaintext code_verifier", async () => {
    // Migration 0020 dropped the plaintext oauth_state.code_verifier
    // column. The codec must NOT have a plaintext-fallback branch: a row
    // carrying a `code_verifier` string but no sidecars is corruption /
    // a hostile caller-supplied secret and MUST throw, not be trusted.
    await expect(
      decryptCodeVerifierFromRow([provider], {
        code_verifier: "attacker-supplied-plaintext",
      } as Parameters<typeof decryptCodeVerifierFromRow>[1]),
    ).rejects.toThrow(/missing bytea sidecars/);
  });

  it("throws when sidecars are absent", async () => {
    await expect(decryptCodeVerifierFromRow([provider], {})).rejects.toThrow(
      /missing bytea sidecars/,
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
        // No plaintext fallback → throw with the missing-sidecars message.
        await expect(decryptCodeVerifierFromRow([provider], incomplete)).rejects.toThrow(
          /missing bytea sidecars/,
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
