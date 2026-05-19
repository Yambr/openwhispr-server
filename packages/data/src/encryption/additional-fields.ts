// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track A.2 — Fix B codegen helper (RESEARCH.md §6.1 Option B1).
//
// Derive Better Auth `additionalFields` entries from `EncryptedColumnMap`.
//
// Why this helper exists (RESEARCH.md §1 Seam #2 + §2.4 + §3.5):
//
//   The encryption lens (`./lens.ts`) emits 6 sidecar keys per encrypted
//   column (`<col>_dek_wrapped`, `<col>_dek_iv`, `<col>_dek_auth_tag`,
//   `<col>_value_iv`, `<col>_value_auth_tag`, `<col>_value_ciphertext`) plus
//   an optional `<col>_fp` SHA-256 fingerprint, in BOTH snake_case AND
//   camelCase forms. Better Auth's adapter-factory `transformInput`
//   (`@better-auth/core/dist/db/adapter/factory.mjs:98-140`) only forwards
//   keys it finds in `schema[model].fields`, which is the union of the
//   canonical Better Auth model schema and the operator-supplied
//   `additionalFields` on `betterAuth({...})`. Any sidecar key not present
//   in that union is SILENTLY DROPPED before the inner adapter sees it —
//   the bytea sidecars never land at the SQL layer and the lens's
//   encryption work is invisible at rest.
//
// Hand-maintaining a 44-entry parallel list against ENCRYPTED_COLUMNS_MAP
// is the §3.5 "Hand-maintained parallel list" antipattern (drift-by-
// default on the next added encrypted column). This helper closes the
// gap by construction: ONE source of truth (`ENCRYPTED_COLUMNS_MAP`) →
// derived registration computed at module load.
//
// Each sidecar entry is `{ type: 'string', input: false, returned: false,
// required: false }`:
//   - `type: 'string'` — DBFieldType has no `bytea`; Better Auth's drizzle
//     adapter accepts the Buffer payload transparently for bytea columns
//     regardless of the BA-side type declaration. Issue #6779 cautions
//     against non-trivial types (`json` / `string[]`) on the drizzle path;
//     `string` is the safe choice with full upstream-tested code paths.
//   - `input: false` — sidecars are NEVER read from a public request body
//     (defence-in-depth STRIDE Tampering: prevents a forged sign-up payload
//     from injecting ciphertext that overwrites the lens's emitted bytes).
//   - `returned: false` — never serialised into the API-response shape
//     Better Auth emits. The 6 ciphertext bytes are useless to clients
//     and would inflate every session-bound response.
//   - `required: false` — pre-encryption rows (the 33-03 backfill window)
//     legitimately have NULL sidecars before the lens fires.
import type { DBFieldAttribute } from "@better-auth/core/db";
import type { EncryptedColumnMap } from "./lens.js";

const SIDECAR_KEYS = [
  "dek_wrapped",
  "dek_iv",
  "dek_auth_tag",
  "value_iv",
  "value_auth_tag",
  "value_ciphertext",
] as const;

/**
 * Canonical sidecar-field attribute shape. `as const` (and the spread at
 * each call site) keeps each derived entry structurally independent of
 * the others so a future per-column override (e.g. one column needing
 * `returned: true` for an admin-introspection route) is a localised edit.
 */
const SIDECAR_FIELD_SPEC = {
  type: "string",
  input: false,
  returned: false,
  required: false,
} as const satisfies DBFieldAttribute;

/**
 * Snake-case → camelCase, matching the canonical drizzle TS-field shape
 * Better Auth's `transformInput` keys against. Mirrors the helper at
 * `./lens.ts:136` (`toCamel`). Replicated here (rather than imported)
 * because the lens's helper is module-private; duplicating one 1-line
 * function is cheaper than enlarging the lens's public surface.
 */
function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Per-model additionalFields output type. Each model key is OPTIONAL: the
 * helper only emits a model entry when the input map has at least one
 * column for that model. Down-stream call sites do `additionalFields: {
 * ...derived.account, ...handWrittenForAccount }` which is a no-op when
 * `derived.account` is `undefined` (spread-of-undefined is legal).
 */
export type SidecarAdditionalFields = Partial<Record<string, Record<string, DBFieldAttribute>>>;

/**
 * Materialise the 6 sidecar entries (+ optional fingerprint) per
 * (model, column) declared in `columnMap` as a Better-Auth-shaped
 * `additionalFields` record, keyed first by model name then by the
 * camelCase sidecar field name.
 *
 * Returns `{}` (empty) when `columnMap` is empty; returns a record with
 * only the models that have at least one encrypted column otherwise.
 *
 * Pure: no side effects, no I/O, no closure over module state. Safe to
 * call at module load to compute the static registration table.
 */
export function deriveSidecarAdditionalFields(
  columnMap: EncryptedColumnMap,
): SidecarAdditionalFields {
  const out: SidecarAdditionalFields = {};
  for (const [model, cols] of Object.entries(columnMap)) {
    const perModel: Record<string, DBFieldAttribute> = {};
    for (const [, cfg] of Object.entries(cols)) {
      for (const k of SIDECAR_KEYS) {
        const camel = toCamel(`${cfg.sidecarPrefix}_${k}`);
        perModel[camel] = { ...SIDECAR_FIELD_SPEC };
      }
      if (cfg.fingerprint) {
        const fpCamel = toCamel(cfg.fingerprint.column);
        perModel[fpCamel] = { ...SIDECAR_FIELD_SPEC };
      }
    }
    out[model] = perModel;
  }
  return out;
}
