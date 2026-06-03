// SPDX-License-Identifier: FSL-1.1-ALv2
// BUG-53-41-remaining (a) — validateLitellmBoot tests.
//
// Mirrors the validateAuthBoot pattern in auth.test.ts. The guard MUST:
//   - production + valid masterKey      → accept
//   - production + missing masterKey    → REFUSE (EX_CONFIG semantics)
//   - production + empty masterKey      → REFUSE
//   - development + missing masterKey   → accept (warn only — handled in caller)
//   - test + missing masterKey          → accept (permissive)
//
// The production refuse path closes the silent-route-drop hole: when
// LITELLM_MASTER_KEY is unset, loadLitellmConfigFromEnv() throws,
// apps/api/src/index.ts catches and silently skips the 4 LiteLLM-backed
// routes (transcribe, reason, diarization, realtime). /api/health
// still returns ok=true — the breakage is invisible.

import { describe, expect, it, vi } from "vitest";
import { validateLitellmBoot } from "../../../src/config/litellm.js";

const STRONG_KEY = "sk-prod-".concat("x".repeat(40));

function callValidate(env: NodeJS.ProcessEnv): {
  ok?: boolean;
  failure?: string;
} {
  let failure: string | undefined;
  const onFail = vi.fn((message: string): never => {
    failure = message;
    throw new Error("__refuse__");
  }) as unknown as (message: string) => never;
  try {
    validateLitellmBoot(env, onFail);
    return { ok: true };
  } catch {
    return { failure };
  }
}

describe("validateLitellmBoot", () => {
  it("accepts production with strong masterKey", () => {
    const { ok } = callValidate({
      NODE_ENV: "production",
      LITELLM_MASTER_KEY: STRONG_KEY,
    });
    expect(ok).toBe(true);
  });

  it("REFUSES production with missing LITELLM_MASTER_KEY", () => {
    const { ok, failure } = callValidate({ NODE_ENV: "production" });
    expect(ok).toBeUndefined();
    expect(failure).toMatch(/LITELLM_MASTER_KEY/);
    expect(failure).toMatch(/Refusing to boot/);
  });

  it("REFUSES production with empty LITELLM_MASTER_KEY", () => {
    const { failure } = callValidate({
      NODE_ENV: "production",
      LITELLM_MASTER_KEY: "",
    });
    expect(failure).toMatch(/LITELLM_MASTER_KEY/);
  });

  it("accepts development with missing masterKey (caller handles fallback)", () => {
    const { ok } = callValidate({ NODE_ENV: "development" });
    expect(ok).toBe(true);
  });

  it("accepts NODE_ENV=test with missing masterKey", () => {
    const { ok } = callValidate({ NODE_ENV: "test" });
    expect(ok).toBe(true);
  });

  it("REFUSES production with the well-known dev default master key", () => {
    // BUG-53-41 dev-tools overlay seeds this value. If an operator
    // copies the dev overlay env into prod by mistake, the guard
    // must catch it.
    const { failure } = callValidate({
      NODE_ENV: "production",
      LITELLM_MASTER_KEY: "sk-dev-master-key-do-not-use-in-prod",
    });
    expect(failure).toMatch(/dev-master-key|do-not-use-in-prod/);
  });

  // -------------------------------------------------------------------------
  // #5 (peer gr0flvsr) — LITELLM_VIRTUAL_KEY is the corporate-override path
  // (HI-2): operators pointing at an internal LiteLLM provision a virtual key
  // and never set the master key. `loadLitellmConfigFromEnv()` already prefers
  // VIRTUAL over MASTER, so the runtime client boots — but this boot-guard
  // read MASTER directly and refused, blocking the "did it right" operator.
  // The guard must accept EITHER key as proof a credential is configured.
  // -------------------------------------------------------------------------
  describe("#5 — LITELLM_VIRTUAL_KEY satisfies the boot-guard", () => {
    it("accepts production with only LITELLM_VIRTUAL_KEY (master unset)", () => {
      const { ok } = callValidate({
        NODE_ENV: "production",
        LITELLM_VIRTUAL_KEY: STRONG_KEY,
      });
      expect(ok).toBe(true);
    });

    it("accepts production with only LITELLM_VIRTUAL_KEY (master empty string)", () => {
      const { ok } = callValidate({
        NODE_ENV: "production",
        LITELLM_VIRTUAL_KEY: STRONG_KEY,
        LITELLM_MASTER_KEY: "",
      });
      expect(ok).toBe(true);
    });

    it("REFUSES production when BOTH virtual and master are unset", () => {
      const { ok, failure } = callValidate({ NODE_ENV: "production" });
      expect(ok).toBeUndefined();
      expect(failure).toMatch(/Refusing to boot/);
    });

    it("REFUSES production when BOTH virtual and master are empty strings", () => {
      const { failure } = callValidate({
        NODE_ENV: "production",
        LITELLM_VIRTUAL_KEY: "",
        LITELLM_MASTER_KEY: "",
      });
      expect(failure).toMatch(/Refusing to boot/);
    });

    it("still REFUSES the dev-default MASTER even if it would otherwise pass (virtual unset)", () => {
      const { failure } = callValidate({
        NODE_ENV: "production",
        LITELLM_MASTER_KEY: "sk-dev-master-key-do-not-use-in-prod",
      });
      expect(failure).toMatch(/dev-master-key|do-not-use-in-prod/);
    });

    it("a real LITELLM_VIRTUAL_KEY bypasses the dev-default MASTER footgun check", () => {
      // The dev-default check guards against copying a dev master into prod.
      // When a real virtual key is the effective credential, the master is
      // unused — a stale dev-default master must not block boot.
      const { ok } = callValidate({
        NODE_ENV: "production",
        LITELLM_VIRTUAL_KEY: STRONG_KEY,
        LITELLM_MASTER_KEY: "sk-dev-master-key-do-not-use-in-prod",
      });
      expect(ok).toBe(true);
    });
  });
});
