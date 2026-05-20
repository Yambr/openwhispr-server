// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 67 / Plan 67-01 — HI-06: KMS/Vault stubs must not be on the public barrel.
//
// HI-06: `encryption/index.ts` (the public barrel re-exported by both
// `@openwhispr/data` and `@openwhispr/data/encryption`) used to re-export
// `VaultKeyProvider` and `KmsKeyProvider`. Both are stubs that throw
// `NOT_IMPLEMENTED` on every method — yet a downstream importer pulling them
// from the barrel gets a constructible-but-broken object presented as
// production-grade. `validateKeyProviderSelection()` already refuses
// `OPENWHISPR_KEY_PROVIDER=vault|kms` at boot; the misleading public surface
// is the actual drift. Approach (a): remove the two barrel re-exports — the
// stubs stay reachable internally via `selectProvider()` (which imports them
// directly from their own files), and `docs/security.md §12` is corrected to
// state v1 supports `env` only.
//
// Pure module-surface assertion — no DB.

import { describe, expect, it } from "vitest";
import * as barrel from "../../../src/encryption/index.js";

describe("encryption barrel public surface (HI-06)", () => {
  it("HI-06: VaultKeyProvider is NOT exported from the public barrel", () => {
    expect((barrel as Record<string, unknown>).VaultKeyProvider).toBeUndefined();
  });

  it("HI-06: KmsKeyProvider is NOT exported from the public barrel", () => {
    expect((barrel as Record<string, unknown>).KmsKeyProvider).toBeUndefined();
  });

  it("HI-06: selectProvider() remains exported (internal stub reachability intact)", () => {
    expect(typeof barrel.selectProvider).toBe("function");
  });

  it("HI-06: the env-path public surface is unchanged", () => {
    expect(typeof barrel.EnvKeyProvider).toBe("function");
    expect(typeof barrel.validateKeyProviderSelection).toBe("function");
  });
});
