// SPDX-License-Identifier: FSL-1.1-ALv2
// Barrel export for the encryption module. Phase 1 Plan 04 / D-11, D-12.
//
// Importers should pull from `@openwhispr/data` (the package barrel) or
// from `@openwhispr/data/encryption` for the narrow surface — both
// resolve to this file.

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
export { KmsKeyProvider } from "./kms-key-provider.js";
export type {
  EncryptedColumnConfig,
  EncryptedColumnMap,
  FingerprintColumn,
} from "./lens.js";
export { wrapAdapter } from "./lens.js";
export type { EncryptedCodeVerifierSidecars } from "./oauth-state-codec.js";
export { decryptCodeVerifierFromRow, encryptCodeVerifier } from "./oauth-state-codec.js";
export { VaultKeyProvider } from "./vault-key-provider.js";
