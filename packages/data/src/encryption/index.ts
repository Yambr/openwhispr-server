// SPDX-License-Identifier: FSL-1.1-ALv2
// Barrel export for the encryption module. Phase 1 Plan 04 / D-11, D-12.
//
// Importers should pull from `@openwhispr/data` (the package barrel) or
// from `@openwhispr/data/encryption` for the narrow surface — both
// resolve to this file.

export type { SidecarAdditionalFields } from "./additional-fields.js";
export { deriveSidecarAdditionalFields } from "./additional-fields.js";
export type {
  BackfillColumnConfig,
  BackfillColumnMap,
  BackfillColumnResult,
  BackfillReport,
  RunBackfillOpts,
} from "./backfill.js";
export { runBackfill } from "./backfill.js";
export {
  EX_CONFIG,
  KeyProviderStubError,
  MasterKekInvalidLengthError,
  MasterKekMissingError,
  validateEncryptionBoot,
  validateKeyProviderSelection,
  validateMasterKek,
} from "./boot.js";
export { EnvKeyProvider } from "./env-key-provider.js";
export type { EncryptedRow } from "./envelope.js";
export { decryptValue, encryptValue } from "./envelope.js";
export type { KeyProvider } from "./key-provider.js";
export { selectProvider } from "./key-provider.js";
// Phase 67 / HI-06 — `KmsKeyProvider` and `VaultKeyProvider` are deliberately
// NOT re-exported here. They are v1 stubs (every method throws
// `NOT_IMPLEMENTED`) and `validateKeyProviderSelection()` refuses
// `OPENWHISPR_KEY_PROVIDER=vault|kms` at boot. They remain reachable
// internally via `selectProvider()` (which imports them directly from their
// own files); exporting them from the public barrel falsely advertised them
// as production-grade `KeyProvider` implementations. v1 supports
// `OPENWHISPR_KEY_PROVIDER=env` only — KMS/Vault providers are a v2 roadmap
// item (see `docs/security.md §12`).
export type {
  EncryptedColumnConfig,
  EncryptedColumnMap,
  FingerprintColumn,
} from "./lens.js";
export { AccountTokenExpiredError, wrapAdapter } from "./lens.js";
export type { EncryptedCodeVerifierSidecars } from "./oauth-state-codec.js";
export { decryptCodeVerifierFromRow, encryptCodeVerifier } from "./oauth-state-codec.js";
