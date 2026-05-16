// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-04 — manual envelope-encryption codec for
// `oauth_state.code_verifier`.
//
// Why this lives outside the Better-Auth Adapter lens (`lens.ts`):
//   The 3 write/read sites in apps/api/src/routes/{auth-callback,
//   desktop-signin}.ts use drizzle's raw `sql` template tag (not the
//   typed Adapter `db.insert(oauth_state)...` path), so `wrapAdapter`'s
//   CRUD interceptor never sees them. Plan 33-04 task 3 hooks the codec
//   directly at each sql-fragment site.
//
// Shape compatibility: the codec produces the SAME 6-bytea-sidecar
// shape (`<col>_dek_wrapped`, `<col>_dek_iv`, `<col>_dek_auth_tag`,
// `<col>_value_iv`, `<col>_value_auth_tag`, `<col>_value_ciphertext`)
// that lens.ts produces for Better-Auth-Adapter-routed columns, so the
// backfill migrator (33-03) and the Phase 33-05 plaintext-column-drop
// migration treat oauth_state.code_verifier identically to the 8
// Better-Auth credentials.
//
// `decryptCodeVerifierFromRow` is the inverse: given a row object with
// the 6 sidecars present, recover the UTF-8 plaintext via the provider
// chain (matches lens.ts read semantics — try each provider until one
// decrypts, otherwise rethrow). Rows missing all sidecars (legacy
// plaintext during the 33-03 backfill mid-window) fall through to the
// plaintext `code_verifier` column, mirroring the lens' silent-pass-
// through posture.

import { decryptValue, type EncryptedRow, encryptValue } from "./envelope.js";
import type { KeyProvider } from "./key-provider.js";

export interface EncryptedCodeVerifierSidecars {
  code_verifier_dek_wrapped: Buffer;
  code_verifier_dek_iv: Buffer;
  code_verifier_dek_auth_tag: Buffer;
  code_verifier_value_iv: Buffer;
  code_verifier_value_auth_tag: Buffer;
  code_verifier_value_ciphertext: Buffer;
}

/**
 * Encrypt a plaintext PKCE verifier into the 6 bytea sidecars matching
 * the `oauth_state.code_verifier_*` columns added by migration 0019.
 *
 * Caller binds the returned object's fields into a parameterized INSERT
 * (or UPDATE) at the desktop-signin/auth-callback sql-fragment sites.
 */
export async function encryptCodeVerifier(
  provider: KeyProvider,
  plaintext: string,
): Promise<EncryptedCodeVerifierSidecars> {
  const row = await encryptValue(provider, Buffer.from(plaintext, "utf8"));
  return {
    code_verifier_dek_wrapped: row.dek_wrapped,
    code_verifier_dek_iv: row.dek_iv,
    code_verifier_dek_auth_tag: row.dek_auth_tag,
    code_verifier_value_iv: row.value_iv,
    code_verifier_value_auth_tag: row.value_auth_tag,
    code_verifier_value_ciphertext: row.value_ciphertext,
  };
}

interface RowWithSidecars {
  code_verifier?: string | null;
  code_verifier_dek_wrapped?: Buffer | null;
  code_verifier_dek_iv?: Buffer | null;
  code_verifier_dek_auth_tag?: Buffer | null;
  code_verifier_value_iv?: Buffer | null;
  code_verifier_value_auth_tag?: Buffer | null;
  code_verifier_value_ciphertext?: Buffer | null;
}

function hasAllSidecars(row: RowWithSidecars): boolean {
  return (
    Buffer.isBuffer(row.code_verifier_dek_wrapped) &&
    Buffer.isBuffer(row.code_verifier_dek_iv) &&
    Buffer.isBuffer(row.code_verifier_dek_auth_tag) &&
    Buffer.isBuffer(row.code_verifier_value_iv) &&
    Buffer.isBuffer(row.code_verifier_value_auth_tag) &&
    Buffer.isBuffer(row.code_verifier_value_ciphertext)
  );
}

/**
 * Recover plaintext from a row's sidecar columns. Tries each provider in
 * order; the FIRST successful decrypt wins. If sidecars are absent,
 * falls back to the plaintext `code_verifier` column (mid-backfill
 * window). Throws if neither plaintext nor sidecars are present.
 */
export async function decryptCodeVerifierFromRow(
  providers: readonly KeyProvider[],
  row: RowWithSidecars,
): Promise<string> {
  if (!hasAllSidecars(row)) {
    if (typeof row.code_verifier === "string") return row.code_verifier;
    throw new Error("oauth_state row missing both plaintext code_verifier and bytea sidecars");
  }
  const encrypted: EncryptedRow = {
    dek_wrapped: row.code_verifier_dek_wrapped as Buffer,
    dek_iv: row.code_verifier_dek_iv as Buffer,
    dek_auth_tag: row.code_verifier_dek_auth_tag as Buffer,
    value_iv: row.code_verifier_value_iv as Buffer,
    value_auth_tag: row.code_verifier_value_auth_tag as Buffer,
    value_ciphertext: row.code_verifier_value_ciphertext as Buffer,
  };
  let lastErr: unknown;
  for (const p of providers) {
    try {
      const pt = await decryptValue(p, encrypted);
      return pt.toString("utf8");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("oauth_state codec: no provider could decrypt code_verifier");
}
