// SPDX-License-Identifier: Apache-2.0
// KmsKeyProvider — v1 stub. Phase 1 Plan 04 / D-12, PROVIDER-02.
//
// Every method throws a descriptive "deferred to v1+" error so wiring
// `OPENWHISPR_KEY_PROVIDER=kms` ahead of the real adapter shipping fails
// loudly instead of silently. Phase 6 replaces this with a real
// AWS KMS adapter (with provider-equivalent paths for GCP KMS / Azure
// Key Vault planned as separate adapters under the same interface).
import type { KeyProvider } from "./key-provider.js";

const NOT_IMPLEMENTED = "KmsKeyProvider not implemented in v1; AWS KMS adapter deferred";

export class KmsKeyProvider implements KeyProvider {
  readonly id = "kms";

  async getKek(): Promise<Buffer> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async wrapDek(): Promise<{ wrapped: Buffer; iv: Buffer; authTag: Buffer }> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async unwrapDek(): Promise<Buffer> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
