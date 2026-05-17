// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-16 — RED→GREEN regressions for REVIEW-INDEX.md
// byok-guard HIGH cluster.
//
// Pre-fix every row used a bare `if (!env.X)` check + case-sensitive
// literal comparisons, which let the following silently pass:
//   * Whitespace-only env values (" ", "\n", "\t") satisfied "present".
//   * `OTEL_EXPORTER_OTLP_ENDPOINT=Disabled` (capital D) fell through
//     to "missing".
//   * `NODE_ENV=Production` (capital P) skipped the SMTP gate.
// The fix introduces `normEnv` + `isSentinelDisabled` + `normNodeEnv`.
// The `INGRESS_BASE_URL` cascade (TLS cert path when https://) is
// also added here.

import { describe, expect, it } from "vitest";
import { assertBYOKConfig, BYOKGuardError } from "../../../src/index.js";

// Mirror byok-guard.test.ts happyEnv shape so the matrix walks past
// storage / observability and lands on the row under test.
const BASE: NodeJS.ProcessEnv = {
  S3_ENDPOINT: "https://s3.corp.example.com",
  S3_ACCESS_KEY: "AKIAEXAMPLE",
  S3_SECRET_KEY: "secret-token",
  S3_BUCKET: "openwhispr-prod",
  OTEL_EXPORTER_OTLP_ENDPOINT: "disabled",
  INGRESS_BASE_URL: "http://api.localhost",
  DATABASE_URL: "postgres://u:p@h:5432/d",
  NODE_ENV: "development",
};

describe("Plan 51-16 — byok-guard env-edge cases", () => {
  it("whitespace-only DATABASE_URL is rejected (not treated as present)", () => {
    expect(() => assertBYOKConfig({ ...BASE, DATABASE_URL: "   " })).toThrow(BYOKGuardError);
  });

  it("`=Disabled` (capital D) accepted as the disabled sentinel", () => {
    expect(() =>
      assertBYOKConfig({ ...BASE, OTEL_EXPORTER_OTLP_ENDPOINT: "Disabled" }),
    ).not.toThrow();
  });

  it("`=DISABLED ` (uppercase + trailing whitespace) accepted as the disabled sentinel", () => {
    expect(() =>
      assertBYOKConfig({ ...BASE, OTEL_EXPORTER_OTLP_ENDPOINT: "DISABLED " }),
    ).not.toThrow();
  });

  it("`NODE_ENV=Production` (capital P) triggers the SMTP gate", () => {
    // Need SMTP_HOST unset (it isn't in BASE) to trip the dev-tools row.
    expect(() =>
      assertBYOKConfig({ ...BASE, NODE_ENV: "Production", SMTP_HOST: undefined }),
    ).toThrow(/SMTP_HOST/);
  });

  it("`INGRESS_BASE_URL=https://…` without INGRESS_TLS_CERT_PATH rejects", () => {
    expect(() =>
      assertBYOKConfig({ ...BASE, INGRESS_BASE_URL: "https://api.example.com" }),
    ).toThrow(/INGRESS_TLS_CERT_PATH/);
  });

  it("`INGRESS_BASE_URL=https://…` WITH INGRESS_TLS_CERT_PATH passes", () => {
    expect(() =>
      assertBYOKConfig({
        ...BASE,
        INGRESS_BASE_URL: "https://api.example.com",
        INGRESS_TLS_CERT_PATH: "/etc/ssl/certs/api.example.com.pem",
      }),
    ).not.toThrow();
  });

  it("whitespace-only S3_ACCESS_KEY (cascade) is rejected", () => {
    expect(() =>
      assertBYOKConfig({
        ...BASE,
        S3_ENDPOINT: "https://s3.example.com",
        S3_ACCESS_KEY: " ",
        S3_SECRET_KEY: "x",
        S3_BUCKET: "b",
      }),
    ).toThrow(/S3_ACCESS_KEY/);
  });
});
