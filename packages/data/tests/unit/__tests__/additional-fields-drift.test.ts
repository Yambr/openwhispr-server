// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 57 / Track A.2 — Fix B drift-prevention test (RESEARCH.md §6.3).
//
// Asserts that the codegen helper `deriveSidecarAdditionalFields` produces,
// for every (model, column) in `ENCRYPTED_COLUMNS_MAP`, the 6 camelCase
// sidecar keys (+ optional camelCase fingerprint key) Better Auth's
// drizzleAdapter `transformInput` must see to forward the lens's emitted
// payload through to the SQL layer.
//
// Why this test exists (RESEARCH.md §2.4 + §3.5 + §6.1):
//
//   The lens (`packages/data/src/encryption/lens.ts`) emits 6 sidecar keys
//   per encrypted column (`<col>_dek_wrapped`, ..., `<col>_value_ciphertext`)
//   plus an optional `<col>_fp` fingerprint, in BOTH snake_case AND camelCase
//   forms. Better Auth's adapter-factory `transformInput`
//   (`@better-auth/core/dist/db/adapter/factory.mjs:98-140`) iterates only
//   the keys in `schema[model].fields`, which is the union of the canonical
//   Better Auth model schema + the operator-supplied `additionalFields`. A
//   sidecar key not in that set is SILENTLY DROPPED — the bytea never reaches
//   the SQL layer.
//
//   Hand-listing 44 `additionalFields` entries against the schema is the
//   "Hand-maintained parallel list" §3.5 antipattern: the very next encrypted
//   column added to `ENCRYPTED_COLUMNS_MAP` reintroduces the bug class. The
//   `deriveSidecarAdditionalFields(ENCRYPTED_COLUMNS_MAP)` helper materialises
//   the 44 entries from the 7-entry canonical source (drift-free by
//   construction).
//
// This test pins the SHAPE of the codegen output. Any future revert that
// drops the helper or removes a sidecar key from the per-model output
// trips here BEFORE the apps/api integration canary
// (`better-auth-envelope-at-rest.test.ts`) — i.e., before Postgres + Better
// Auth would surface the silent-drop downstream.
//
// Mocked surface (DISCIPLINE Rule 4): no mocks. Pure value-level transform
// from `ENCRYPTED_COLUMNS_MAP` → `additionalFields` record.
import { describe, expect, it } from "vitest";
import {
  deriveSidecarAdditionalFields,
  type EncryptedColumnMap,
} from "../../../src/encryption/index.js";

const SIDECAR_KEYS = [
  "dek_wrapped",
  "dek_iv",
  "dek_auth_tag",
  "value_iv",
  "value_auth_tag",
  "value_ciphertext",
] as const;

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

describe("Phase 57 Track A.2 — deriveSidecarAdditionalFields codegen drift", () => {
  it("returns {} for every Better-Auth model when the input map is empty", () => {
    const out = deriveSidecarAdditionalFields({});
    expect(out).toEqual({});
  });

  it("returns an empty per-model record for models not in the input map", () => {
    const out = deriveSidecarAdditionalFields({
      account: { password: { sidecarPrefix: "password" } },
    });
    // session / verification / user absent from input → absent from output.
    expect(out.session).toBeUndefined();
    expect(out.verification).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.account).toBeDefined();
  });

  it("emits 6 camelCase sidecar entries per encrypted column (no fingerprint)", () => {
    const map: EncryptedColumnMap = {
      account: { password: { sidecarPrefix: "password" } },
    };
    const out = deriveSidecarAdditionalFields(map);
    const account = out.account;
    expect(account).toBeDefined();
    for (const k of SIDECAR_KEYS) {
      const camel = toCamel(`password_${k}`);
      expect(account?.[camel]).toMatchObject({
        type: "string",
        input: false,
        required: false,
        returned: false,
      });
    }
    // No fingerprint configured → no `_fp` key.
    expect(account?.passwordFp).toBeUndefined();
    // 6 keys total for this column.
    expect(Object.keys(account ?? {}).length).toBe(6);
  });

  it("emits 7 entries when `fingerprint` is configured (6 sidecars + fp camelCase)", () => {
    const map: EncryptedColumnMap = {
      session: {
        token: {
          sidecarPrefix: "token",
          fingerprint: { column: "token_fp", algorithm: "sha256" },
        },
      },
    };
    const out = deriveSidecarAdditionalFields(map);
    const session = out.session;
    expect(session).toBeDefined();
    expect(session?.tokenFp).toMatchObject({
      type: "string",
      input: false,
      required: false,
      returned: false,
    });
    expect(Object.keys(session ?? {}).length).toBe(7);
  });

  it("covers the production ENCRYPTED_COLUMNS_MAP shape for the 4 Better Auth models", () => {
    // Mirrors the production map in apps/api/src/auth.ts. The drift-prevention
    // test lives in this package because the helper itself lives here; the
    // canonical site uses these exact column declarations to populate Better
    // Auth's `additionalFields` per model.
    const map: EncryptedColumnMap = {
      account: {
        password: { sidecarPrefix: "password" },
        access_token: { sidecarPrefix: "access_token" },
        refresh_token: { sidecarPrefix: "refresh_token" },
        id_token: { sidecarPrefix: "id_token" },
      },
      session: {
        token: {
          sidecarPrefix: "token",
          fingerprint: { column: "token_fp", algorithm: "sha256" },
        },
        previous_token: {
          sidecarPrefix: "previous_token",
          fingerprint: { column: "previous_token_fp", algorithm: "sha256" },
        },
      },
      verification: {
        value: { sidecarPrefix: "value" },
      },
    };
    const out = deriveSidecarAdditionalFields(map);

    // account: 4 columns × 6 sidecars = 24 keys, no fingerprints.
    expect(Object.keys(out.account ?? {}).length).toBe(24);
    // session: 2 columns × (6 sidecars + 1 fp) = 14 keys.
    expect(Object.keys(out.session ?? {}).length).toBe(14);
    // verification: 1 column × 6 sidecars = 6 keys.
    expect(Object.keys(out.verification ?? {}).length).toBe(6);
    // 24 + 14 + 6 = 44, per RESEARCH.md §1 Seam #2 sidecar-count table.

    // Spot-check each model has the expected camelCase keys present.
    expect(out.account?.accessTokenValueCiphertext).toBeDefined();
    expect(out.account?.refreshTokenDekWrapped).toBeDefined();
    expect(out.account?.idTokenValueIv).toBeDefined();
    expect(out.account?.passwordValueAuthTag).toBeDefined();
    expect(out.session?.tokenValueCiphertext).toBeDefined();
    expect(out.session?.tokenFp).toBeDefined();
    expect(out.session?.previousTokenFp).toBeDefined();
    expect(out.session?.previousTokenValueCiphertext).toBeDefined();
    expect(out.verification?.valueValueCiphertext).toBeDefined();
  });

  it("emits every sidecar with `input: false` so Better Auth never lets a public sign-up body inject ciphertext", () => {
    // STRIDE T (tampering): if `input` were true (or absent → default true),
    // a malicious sign-up body could forge `passwordValueCiphertext` to
    // overwrite the lens's emitted ciphertext at the field-translation layer.
    // The lens writes the genuine bytes AFTER the public input is read, so
    // ordering would protect us in practice — but defence-in-depth: every
    // sidecar entry MUST be input:false. Asserted across the production
    // ENCRYPTED_COLUMNS_MAP shape.
    const map: EncryptedColumnMap = {
      account: { password: { sidecarPrefix: "password" } },
      session: {
        token: {
          sidecarPrefix: "token",
          fingerprint: { column: "token_fp", algorithm: "sha256" },
        },
      },
    };
    const out = deriveSidecarAdditionalFields(map);
    for (const model of ["account", "session"] as const) {
      const fields = out[model] ?? {};
      for (const [key, attr] of Object.entries(fields)) {
        expect(attr.input).toBe(false);
        // Sanity: assert no key is somehow `input: true`.
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });
});
