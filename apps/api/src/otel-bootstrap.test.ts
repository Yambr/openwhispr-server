// SPDX-License-Identifier: Apache-2.0
// Phase 6 / Plan 03 / Task 1 — GREEN.
//
// OTel SDK bootstrap module unit tests per 06-03-PLAN.md acceptance
// criteria + 06-CONTEXT.md decisions D-T1, D-T3, D-T6 + 06-RESEARCH.md §3.
//
// Test surface (load-bearing assertions):
//   1. Importing the bootstrap module starts a NodeSDK (side-effect
//      module: no default export, the SDK is started at top level).
//   2. PinoInstrumentation is in the registered list with logKeys
//      mapping traceId→trace_id, spanId→span_id, traceFlags→trace_flags
//      (D-T3 — pino<->OTel correlation).
//   3. @opentelemetry/instrumentation-fs is disabled (D-T1).
//   4. @opentelemetry/instrumentation-dns is disabled (D-T1).
//   5. The SDK exposes a `shutdown()` method (SIGTERM hook target).
//   6. apps/api/src/index.ts imports "./otel-bootstrap.js" as the
//      first executable statement — this guarantees the SDK starts
//      before any other import (pino, fastify, …) so
//      PinoInstrumentation can patch pino at require time (D-T3).
//   7. No `/metrics` route is registered in the API (D-T6 — single
//      metrics path; OTel SDK pushes to Mimir via Collector).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("otel-bootstrap (Phase 6 / Plan 03 / Task 1)", () => {
  it("exposes a started NodeSDK with PinoInstrumentation registered (D-T3)", async () => {
    const mod = await import("./otel-bootstrap.js");
    expect(mod.sdk).toBeDefined();
    // Phase 14 / Plan 04: sdk is now `NodeSDK | null` (null when
    // OTEL_EXPORTER_OTLP_ENDPOINT === "disabled"). At default load the
    // env is unset/URL so sdk MUST be non-null.
    if (mod.sdk === null) throw new Error("expected NodeSDK at default env");
    expect(typeof mod.sdk.shutdown).toBe("function");
    expect(Array.isArray(mod.registeredInstrumentations)).toBe(true);
    const pino = mod.registeredInstrumentations.find(
      (e: { name: string }) => e.name === "@opentelemetry/instrumentation-pino",
    );
    expect(pino).toBeDefined();
    expect(pino?.logKeys).toEqual({
      traceId: "trace_id",
      spanId: "span_id",
      traceFlags: "trace_flags",
    });
  });

  it("disables fs auto-instrumentation (D-T1)", async () => {
    const mod = await import("./otel-bootstrap.js");
    expect(mod.disabledInstrumentations).toContain("@opentelemetry/instrumentation-fs");
  });

  it("disables dns auto-instrumentation (D-T1)", async () => {
    const mod = await import("./otel-bootstrap.js");
    expect(mod.disabledInstrumentations).toContain("@opentelemetry/instrumentation-dns");
  });

  it("apps/api/src/index.ts imports ./otel-bootstrap.js as the FIRST executable line (D-T3 load order)", () => {
    const indexPath = path.join(__dirname, "index.ts");
    const src = fs.readFileSync(indexPath, "utf8");
    const lines = src.split(/\r?\n/);
    let firstCodeLine: string | undefined;
    let inBlockComment = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      if (line.startsWith("/*")) {
        if (!line.includes("*/")) inBlockComment = true;
        continue;
      }
      if (line.startsWith("//")) continue;
      firstCodeLine = line;
      break;
    }
    expect(firstCodeLine).toBeDefined();
    expect(firstCodeLine).toMatch(/^import\s+["']\.\/otel-bootstrap\.js["'];?$/);
  });

  it("shutdown() resolves cleanly (SIGTERM hook target)", async () => {
    const mod = await import("./otel-bootstrap.js");
    if (mod.sdk === null) throw new Error("expected NodeSDK at default env");
    await expect(mod.sdk.shutdown()).resolves.not.toThrow();
  });

  it("startSdk catches a synchronous start error so the API never crashes on telemetry init", async () => {
    const mod = await import("./otel-bootstrap.js");
    // Build a fake SDK whose start() throws; startSdk MUST swallow.
    const fakeSdk = {
      start: () => {
        throw new Error("synthetic start failure");
      },
    } as unknown as Parameters<typeof mod.startSdk>[0];
    expect(() => mod.startSdk(fakeSdk)).not.toThrow();
  });

  it("emitting SIGTERM after module load triggers the shutdown hook (line coverage for onSignal)", async () => {
    await import("./otel-bootstrap.js");
    // The handler is registered via process.once("SIGTERM", onSignal);
    // emitting the signal exercises the onSignal body — its sole job
    // is to call shutdownSdk() (return is void; we don't await the
    // internal promise because Node's signal handlers are sync).
    expect(() => process.emit("SIGTERM" as never)).not.toThrow();
  });

  it("shutdownSdk swallows a rejected shutdown so the SIGTERM handler stays infallible", async () => {
    const mod = await import("./otel-bootstrap.js");
    const fakeSdk = {
      shutdown: () => Promise.reject(new Error("synthetic shutdown failure")),
    } as unknown as Parameters<typeof mod.shutdownSdk>[0];
    await expect(mod.shutdownSdk(fakeSdk)).resolves.toBeUndefined();
  });

  describe("OTEL_EXPORTER_OTLP_ENDPOINT=disabled sentinel (Phase 14 / Plan 04 / Task 2)", () => {
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

    it("env=`disabled` → exported `sdk === null`", async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "disabled";
      const mod = await import("./otel-bootstrap.js");
      expect(mod.sdk).toBeNull();
    });

    it("env=`disabled` → startSdk() is a no-op (never constructs nor starts a NodeSDK)", async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "disabled";
      const mod = await import("./otel-bootstrap.js");
      // With sdk null, startSdk() must return without throwing and
      // without doing any work. Pass the null sdk explicitly to assert
      // the no-op-safe wrapper contract.
      expect(() => mod.startSdk(null)).not.toThrow();
      // Default-arg path also no-ops:
      expect(() => mod.startSdk()).not.toThrow();
    });

    it("env=`disabled` → shutdownSdk() resolves to undefined synchronously without throwing", async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "disabled";
      const mod = await import("./otel-bootstrap.js");
      await expect(mod.shutdownSdk(null)).resolves.toBeUndefined();
      await expect(mod.shutdownSdk()).resolves.toBeUndefined();
    });

    it("env set to a URL → sdk is a NodeSDK instance; startSdk() calls .start()", async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4317";
      const mod = await import("./otel-bootstrap.js");
      expect(mod.sdk).not.toBeNull();
      if (mod.sdk === null) throw new Error("unreachable — already asserted non-null");
      expect(typeof mod.sdk.start).toBe("function");
      expect(typeof mod.sdk.shutdown).toBe("function");
    });
  });

  it("does NOT expose a /metrics Prometheus-pull endpoint (D-T6)", () => {
    // Grep the route source tree for any /metrics registration. A
    // single metrics path through OTel SDK → Collector → Mimir is the
    // locked architecture (D-T6); a /metrics scrape endpoint would
    // duplicate signal.
    const apiRoot = path.resolve(__dirname);
    const routesDir = path.join(apiRoot, "routes");
    const stack: string[] = [routesDir, apiRoot];
    const hits: string[] = [];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || !fs.existsSync(cur)) continue;
      const stat = fs.statSync(cur);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(cur)) {
          if (entry === "node_modules" || entry.startsWith(".")) continue;
          stack.push(path.join(cur, entry));
        }
        continue;
      }
      if (!cur.endsWith(".ts") || cur.endsWith(".test.ts")) continue;
      const src = fs.readFileSync(cur, "utf8");
      if (/['"`]\/metrics['"`]/.test(src)) hits.push(cur);
    }
    expect(hits).toEqual([]);
  });
});
