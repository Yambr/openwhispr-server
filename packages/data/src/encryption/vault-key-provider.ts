// VaultKeyProvider — v1 stub. Phase 1 Plan 04 / D-12, PROVIDER-02.
//
// Every method throws a descriptive "deferred to v1+" error so an ops
// script that wires `OPENWHISPR_KEY_PROVIDER=vault` ahead of the real
// adapter rolling out gets a synchronous, named failure rather than a
// silent no-op or worse, an apparent success that returns garbage.
// Phase 6 replaces this file with a real HashiCorp Vault adapter.
import type { KeyProvider } from "./key-provider.js";

const NOT_IMPLEMENTED = "VaultKeyProvider not implemented in v1; HashiCorp Vault adapter deferred";

export class VaultKeyProvider implements KeyProvider {
  readonly id = "vault";

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
