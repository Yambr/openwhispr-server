// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260602-eth — make LITELLM_DATABASE_URL optional.
//
// `loadWorkerConfig` is the worker's single env boundary (LOCKER-01). These
// tests pin the `spendReconciliationEnabled` resolution: reconciliation is
// gated on BOTH an explicit `SPEND_RECONCILIATION_ENABLED` opt-in AND a
// reachable LiteLLM DB URL, because the reconciliation jobs read
// `LiteLLM_SpendLogs` cross-DB and have nothing to connect to otherwise.
// `env` is injected so we exercise the parse without mutating process.env.

import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../../../src/config/worker-config.js";

describe("loadWorkerConfig — allowSmtpFallback (existing precedent)", () => {
  it("is false by default and true on '1'/'true'", () => {
    expect(loadWorkerConfig({}).allowSmtpFallback).toBe(false);
    expect(loadWorkerConfig({ EMAIL_FALLBACK_NONFATAL: "1" }).allowSmtpFallback).toBe(true);
    expect(loadWorkerConfig({ EMAIL_FALLBACK_NONFATAL: "true" }).allowSmtpFallback).toBe(true);
    expect(loadWorkerConfig({ EMAIL_FALLBACK_NONFATAL: "no" }).allowSmtpFallback).toBe(false);
  });
});

describe("loadWorkerConfig — spendReconciliationEnabled (quick 260602-eth)", () => {
  it("is false when neither the flag nor a LiteLLM DB URL is set", () => {
    expect(loadWorkerConfig({}).spendReconciliationEnabled).toBe(false);
  });

  it("is false when the flag is set but NO LiteLLM DB URL is present (can't reconcile w/o the DB)", () => {
    expect(loadWorkerConfig({ SPEND_RECONCILIATION_ENABLED: "1" }).spendReconciliationEnabled).toBe(
      false,
    );
  });

  it("is false when a LiteLLM DB URL is present but the flag is unset (opt-in required)", () => {
    expect(
      loadWorkerConfig({
        LITELLM_DATABASE_URL: "postgres://litellm-host:5432/litellm",
      }).spendReconciliationEnabled,
    ).toBe(false);
  });

  it("is true when the flag is set AND LITELLM_DATABASE_URL is present", () => {
    expect(
      loadWorkerConfig({
        SPEND_RECONCILIATION_ENABLED: "true",
        LITELLM_DATABASE_URL: "postgres://litellm-host:5432/litellm",
      }).spendReconciliationEnabled,
    ).toBe(true);
  });

  it("is true when the flag is set AND the LITELLM_READ_DATABASE_URL replica is present", () => {
    expect(
      loadWorkerConfig({
        SPEND_RECONCILIATION_ENABLED: "1",
        LITELLM_READ_DATABASE_URL: "postgres://litellm-replica:5432/litellm",
      }).spendReconciliationEnabled,
    ).toBe(true);
  });

  it("treats an empty-string DB URL as absent (auto-false)", () => {
    expect(
      loadWorkerConfig({
        SPEND_RECONCILIATION_ENABLED: "1",
        LITELLM_DATABASE_URL: "",
      }).spendReconciliationEnabled,
    ).toBe(false);
  });
});
