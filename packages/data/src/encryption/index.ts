// SPDX-License-Identifier: Apache-2.0
// Barrel export for the encryption module. Phase 1 Plan 04 / D-11, D-12.
//
// Importers should pull from `@openwhispr/data` (the package barrel) or
// from `@openwhispr/data/encryption` for the narrow surface — both
// resolve to this file.

export { EnvKeyProvider } from "./env-key-provider.js";
export type { EncryptedRow } from "./envelope.js";
export { decryptValue, encryptValue } from "./envelope.js";
export type { KeyProvider } from "./key-provider.js";
export { selectProvider } from "./key-provider.js";
export { KmsKeyProvider } from "./kms-key-provider.js";
export { VaultKeyProvider } from "./vault-key-provider.js";
