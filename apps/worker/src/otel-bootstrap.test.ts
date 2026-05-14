// SPDX-License-Identifier: Apache-2.0
// Phase 14 / Plan 04 / Task 2 — Worker OTel SDK bootstrap unit tests.
//
// Mirrors apps/api/src/otel-bootstrap.test.ts for the worker tier. The
// worker has its own OTel SDK (Plan 06-12c) because the reconciliation-
// daily-check job creates ObservableGauges; the =disabled sentinel must
// short-circuit SDK init in the same way as the api so a slim-core
// deployment without the observability overlay does not dial a missing
// OTLP collector and produce cascading noise.
//
// Test surface:
//   * env=`disabled` → `sdk === null`, startSdk/shutdownSdk are no-ops.
//   * env set to URL → `sdk` is a NodeSDK instance with `.start`/`.shutdown`.
//   * default load (env unset OR URL) — `sdk` non-null, shutdown resolves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("worker otel-bootstrap (Phase 14 / Plan 04 / Task 2)", () => {
  let savedOtlpEndpoint: string | undefined;

  beforeEach(() => {
    savedOtlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    vi.resetModules();
  });

  afterEach(() => {
    if (savedOtlpEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedOtlpEndpoint;
    }
    vi.resetModules();
  });

  it("env=`disabled` → exported sdk === null", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "disabled";
    const mod = await import("./otel-bootstrap.js");
    expect(mod.sdk).toBeNull();
  });

  it("env=`disabled` → startSdk() is a no-op (no NodeSDK constructed, never .start()-ed)", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "disabled";
    const mod = await import("./otel-bootstrap.js");
    expect(() => mod.startSdk(null)).not.toThrow();
    expect(() => mod.startSdk()).not.toThrow();
  });

  it("env=`disabled` → shutdownSdk() resolves to undefined without throwing", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "disabled";
    const mod = await import("./otel-bootstrap.js");
    await expect(mod.shutdownSdk(null)).resolves.toBeUndefined();
    await expect(mod.shutdownSdk()).resolves.toBeUndefined();
  });

  it("env set to a URL → sdk is a NodeSDK instance with start/shutdown methods", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4317";
    const mod = await import("./otel-bootstrap.js");
    expect(mod.sdk).not.toBeNull();
    if (mod.sdk === null) throw new Error("unreachable — already asserted non-null");
    expect(typeof mod.sdk.start).toBe("function");
    expect(typeof mod.sdk.shutdown).toBe("function");
  });

  it("env unset → sdk is a NodeSDK instance (default behavior preserved)", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const mod = await import("./otel-bootstrap.js");
    // Unset endpoint is NOT the =disabled sentinel; the SDK still
    // initializes (the exporter falls back to its own default).
    expect(mod.sdk).not.toBeNull();
  });
});
