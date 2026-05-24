// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 14 / Plan 04 / Task 1 — RED then GREEN.
//
// Unit tests for `assertBYOKConfig()`: the boot-time guard that refuses
// to start when a compose overlay is OFF and the corresponding BYOK env
// contract is unset (CONTEXT.md decision 2 — verbatim per-overlay matrix
// of envs, codes, and NODE_ENV gates).
//
// Test mechanics:
//   - `process.exit` is spied so that the function throws a marker error
//     instead of terminating the test runner. The marker carries the
//     exit code so we assert exit(1) per CONTEXT.md decision 2 ("must
//     NOT regress to exit 78").
//   - Pino is configured to write to an in-memory `Writable` stream (a
//     small NDJSON-collector) so we can parse the emitted fatal record
//     without spawning a child process. The custom destination is
//     injected via the optional `opts.logger` parameter; the assertion
//     code's `pino.final()` wrap is exercised by the same test path —
//     no internal logic is mocked, only the destination stream (a
//     process-boundary primitive, allowed per CLAUDE.md).
//   - Each test calls `assertBYOKConfig({...synthetic env...})` — the
//     function is PURE over env (default arg is process.env in prod,
//     but tests pass an explicit object to avoid global mutation).
import { Writable } from "node:stream";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as guard from "../../../src/index.js";
import { assertBYOKConfig, type BYOKFatalRecord, BYOKGuardError } from "../../../src/index.js";

/**
 * NDJSON line collector — pino writes one JSON record per line to a
 * `Writable` stream. We capture each `write()` chunk as a string in
 * `lines` for later parsing.
 */
function makeLineCollector(): { stream: Writable; lines: string[]; raw: string[] } {
  const lines: string[] = [];
  const raw: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      const s = chunk.toString("utf8");
      raw.push(s);
      // pino-stream chunks already end in "\n"; split safely to ignore
      // empty trailing element after the final newline.
      for (const part of s.split("\n")) {
        if (part) lines.push(part);
      }
      cb();
    },
  });
  return { stream, lines, raw };
}

/**
 * Build the synthetic happy-path env that satisfies all five BYOK rows.
 * Tests then delete or override individual keys to assert per-row
 * loud-fail behavior.
 */
function happyEnv(): NodeJS.ProcessEnv {
  return {
    S3_ENDPOINT: "https://s3.corp.example.com",
    S3_ACCESS_KEY: "AKIAEXAMPLE",
    S3_SECRET_KEY: "secret-token",
    S3_BUCKET: "openwhispr-prod",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.corp.example.com:4317",
    INGRESS_BASE_URL: "https://api.corp.example.com",
    // Phase 51 / Plan 51-16 — INGRESS_BASE_URL=https://… now requires
    // the TLS cert path cascade (was a silent gap pre-fix).
    INGRESS_TLS_CERT_PATH: "/etc/ssl/certs/openwhispr.pem",
    DATABASE_URL: "postgres://app:hunter2@db:5432/openwhispr",
    SMTP_HOST: "smtp.corp.example.com",
    NODE_ENV: "production",
  } as NodeJS.ProcessEnv;
}

describe("assertBYOKConfig (Phase 14 / Plan 04 / Task 1; Phase 19 / Plan 02 throw-not-exit contract)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Phase 19 / Plan 02 — `assertBYOKConfig` now THROWS `BYOKGuardError`
   * instead of `process.exit(1)` (SR-19.3, D-09). The library logs the
   * fatal record then throws; entrypoints catch + log + exit.
   *
   * Capture the fatal record emitted by `assertBYOKConfig(env)`. Returns
   * `null` when no fatal was emitted (happy path). `threwGuardError` is
   * `true` iff the call threw a `BYOKGuardError` (the new contract).
   */
  function runWithCapture(env: NodeJS.ProcessEnv): {
    record: BYOKFatalRecord | null;
    threwGuardError: boolean;
    thrown: unknown;
    rawStderr: string;
  } {
    const { stream, lines, raw } = makeLineCollector();
    const logger = pino({ name: "boot", level: "fatal" }, stream);
    let threwGuardError = false;
    let thrown: unknown;
    try {
      assertBYOKConfig(env, { logger });
    } catch (err) {
      thrown = err;
      if (err instanceof BYOKGuardError) {
        threwGuardError = true;
      } else {
        throw err; // surface unexpected errors
      }
    }
    const record = lines.length > 0 ? (JSON.parse(lines[0] as string) as BYOKFatalRecord) : null;
    return { record, threwGuardError, thrown, rawStderr: raw.join("") };
  }

  it("happy path — all BYOK envs set → returns void, no fatal, no throw", () => {
    const { record, threwGuardError } = runWithCapture(happyEnv());
    expect(record).toBeNull();
    expect(threwGuardError).toBe(false);
  });

  it("storage — S3_ENDPOINT unset → fatal BYOK_STORAGE_REQUIRED + throws BYOKGuardError", () => {
    const env = happyEnv();
    delete env.S3_ENDPOINT;
    delete env.S3_ACCESS_KEY;
    delete env.S3_SECRET_KEY;
    delete env.S3_BUCKET;
    const { record, threwGuardError } = runWithCapture(env);
    expect(threwGuardError).toBe(true);
    expect(record).toMatchObject({
      event: "byok.required",
      code: "BYOK_STORAGE_REQUIRED",
      overlay: "storage",
      missing: ["S3_ENDPOINT"],
    });
    expect(record?.hint).toContain("compose/docker-compose.storage.yml");
  });

  it("storage partial — S3_ENDPOINT set but partner keys unset → fatal lists the partner keys", () => {
    const env = happyEnv();
    delete env.S3_ACCESS_KEY;
    delete env.S3_SECRET_KEY;
    // S3_BUCKET stays set — assert subset behavior.
    const { record, threwGuardError } = runWithCapture(env);
    expect(threwGuardError).toBe(true);
    expect(record?.code).toBe("BYOK_STORAGE_REQUIRED");
    expect(record?.missing).toEqual(["S3_ACCESS_KEY", "S3_SECRET_KEY"]);
  });

  it("observability — OTEL_EXPORTER_OTLP_ENDPOINT unset → fatal BYOK_OBSERVABILITY_REQUIRED", () => {
    const env = happyEnv();
    delete env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { record, threwGuardError } = runWithCapture(env);
    expect(threwGuardError).toBe(true);
    expect(record).toMatchObject({
      event: "byok.required",
      code: "BYOK_OBSERVABILITY_REQUIRED",
      overlay: "observability",
      missing: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
    });
  });

  it("observability — `=disabled` sentinel → returns void (guard yields to otel-bootstrap)", () => {
    const env = happyEnv();
    env.OTEL_EXPORTER_OTLP_ENDPOINT = "disabled";
    const { record, threwGuardError } = runWithCapture(env);
    expect(record).toBeNull();
    expect(threwGuardError).toBe(false);
  });

  it("observability — URL value → returns void", () => {
    const env = happyEnv();
    env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.corp.example.com:4317";
    const { record, threwGuardError } = runWithCapture(env);
    expect(record).toBeNull();
    expect(threwGuardError).toBe(false);
  });

  it("ingress — INGRESS_BASE_URL unset → fatal BYOK_INGRESS_REQUIRED", () => {
    const env = happyEnv();
    delete env.INGRESS_BASE_URL;
    const { record, threwGuardError } = runWithCapture(env);
    expect(threwGuardError).toBe(true);
    expect(record?.code).toBe("BYOK_INGRESS_REQUIRED");
    expect(record?.overlay).toBe("ingress");
    expect(record?.missing).toEqual(["INGRESS_BASE_URL"]);
  });

  it("pgbouncer — DATABASE_URL unset → fatal BYOK_DATABASE_REQUIRED", () => {
    const env = happyEnv();
    delete env.DATABASE_URL;
    const { record, threwGuardError } = runWithCapture(env);
    expect(threwGuardError).toBe(true);
    expect(record?.code).toBe("BYOK_DATABASE_REQUIRED");
    expect(record?.overlay).toBe("pgbouncer");
    expect(record?.missing).toEqual(["DATABASE_URL"]);
  });

  it("dev-tools (SMTP) — NODE_ENV=production AND SMTP_HOST unset → fatal BYOK_SMTP_REQUIRED", () => {
    const env = happyEnv();
    delete env.SMTP_HOST;
    const { record, threwGuardError } = runWithCapture(env);
    expect(threwGuardError).toBe(true);
    expect(record?.code).toBe("BYOK_SMTP_REQUIRED");
    expect(record?.overlay).toBe("dev-tools");
    expect(record?.missing).toContain("SMTP_HOST");
  });

  it("dev-tools (SMTP) — NODE_ENV=test AND SMTP_HOST unset → returns void (NODE_ENV gate honored)", () => {
    const env = happyEnv();
    env.NODE_ENV = "test";
    delete env.SMTP_HOST;
    const { record, threwGuardError } = runWithCapture(env);
    expect(record).toBeNull();
    expect(threwGuardError).toBe(false);
  });

  it("dev-tools (SMTP) — NODE_ENV unset AND SMTP_HOST unset → returns void (NODE_ENV gate honored)", () => {
    const env = happyEnv();
    delete env.NODE_ENV;
    delete env.SMTP_HOST;
    const { record, threwGuardError } = runWithCapture(env);
    expect(record).toBeNull();
    expect(threwGuardError).toBe(false);
  });

  it("first-violation-only — five overlays misconfigured → ONE fatal record with code BYOK_STORAGE_REQUIRED", () => {
    // Wipe every BYOK key.
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    const { stream, lines } = makeLineCollector();
    const logger = pino({ name: "boot", level: "fatal" }, stream);
    let threwGuardError = false;
    try {
      assertBYOKConfig(env, { logger });
    } catch (err) {
      if (err instanceof BYOKGuardError) threwGuardError = true;
      else throw err;
    }
    expect(threwGuardError).toBe(true);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string) as BYOKFatalRecord;
    expect(record.code).toBe("BYOK_STORAGE_REQUIRED");
  });

  it("redaction — credential-bearing S3_ENDPOINT redacted in hint; raw secret never appears on stderr", () => {
    const env = happyEnv();
    env.S3_ENDPOINT = "https://user:secret-token-xyz@s3.corp.example.com/";
    delete env.S3_ACCESS_KEY;
    const { record, rawStderr } = runWithCapture(env);
    expect(record?.code).toBe("BYOK_STORAGE_REQUIRED");
    // Either the hint contains the redacted URL OR the hint does not
    // echo the raw URL at all — both are acceptable. What is NOT
    // acceptable is leaking the raw password substring.
    expect(rawStderr).not.toContain("secret-token-xyz");
    // The hint should mention the overlay file regardless.
    expect(record?.hint).toContain("compose/docker-compose.storage.yml");
  });

  it("createBootLogger — exposed module-level constructor returns a Pino logger backed by a synchronous stderr destination (Pino-9 replacement for pino.final flush-discipline)", () => {
    // The createBootLogger() helper is the named module-level seam that
    // CONTEXT.md decision 2's legacy `pino.final()` call ultimately
    // collapsed into under Pino 9 (pino.final was removed). Asserting it
    // exists, returns a Pino logger with the documented `.fatal` shape,
    // and (most importantly) constructs a SYNCHRONOUS destination so the
    // line is flushed to fd 2 before process.exit(1) runs is the
    // operational invariant we are pinning here.
    const logger = guard.createBootLogger();
    expect(typeof logger.fatal).toBe("function");
    // The constructor wraps pino.destination({sync:true, dest: 2});
    // we cannot probe the destination's `sync` flag directly without
    // poking pino internals, but we CAN verify the public method shape
    // and assert that constructing the logger does not throw (the
    // pino.destination call would throw on an invalid descriptor).
    expect(() => guard.createBootLogger()).not.toThrow();
  });

  it("default logger — assertBYOKConfig(env) works without opts.logger (constructs its own pino instance) and throws BYOKGuardError", () => {
    const env = happyEnv();
    delete env.INGRESS_BASE_URL;
    expect(() => assertBYOKConfig(env)).toThrow(BYOKGuardError);
  });

  it("default env — assertBYOKConfig() (zero args) falls back to process.env and throws BYOKGuardError", () => {
    // Save & nuke selected keys so the call throws.
    const saved = process.env.INGRESS_BASE_URL;
    const savedNodeEnv = process.env.NODE_ENV;
    const savedS3 = process.env.S3_ENDPOINT;
    const savedOtel = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const savedDb = process.env.DATABASE_URL;
    const savedSmtp = process.env.SMTP_HOST;
    process.env.S3_ENDPOINT = "https://s3.corp";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "disabled";
    delete process.env.INGRESS_BASE_URL;
    process.env.DATABASE_URL = "postgres://x";
    process.env.NODE_ENV = "test";
    delete process.env.SMTP_HOST;
    let thrown: unknown;
    try {
      assertBYOKConfig();
    } catch (err) {
      thrown = err;
    }
    // Restore.
    if (saved === undefined) delete process.env.INGRESS_BASE_URL;
    else process.env.INGRESS_BASE_URL = saved;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedS3 === undefined) delete process.env.S3_ENDPOINT;
    else process.env.S3_ENDPOINT = savedS3;
    if (savedOtel === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = savedOtel;
    if (savedDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDb;
    if (savedSmtp === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = savedSmtp;
    expect(thrown).toBeInstanceOf(BYOKGuardError);
  });

  describe("BYOKGuardError thrown contract (Phase 19 / Plan 02; SR-19.3, D-09, D-11)", () => {
    // D-11 mandates the lib throws BYOKGuardError; entrypoints catch + exit.
    // These tests are the canonical witnesses for the new contract.
    it("Test 1 — assertBYOKConfig({}) throws BYOKGuardError", () => {
      expect(() =>
        assertBYOKConfig({} as NodeJS.ProcessEnv, { logger: makeSilentLogger() }),
      ).toThrow(BYOKGuardError);
    });

    it("Test 2 — thrown error carries the fatal record's `msg` string + overlay/missing detail", () => {
      let thrown: unknown;
      try {
        assertBYOKConfig({} as NodeJS.ProcessEnv, { logger: makeSilentLogger() });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(BYOKGuardError);
      // Phase 51 / Plan 51-16 — error message now appends
      // `(overlay=..., missing=...)` so log readers can disambiguate
      // WHICH env failed without parsing the structured pino record.
      // We still require the original fixed prefix so any catch
      // handler that pattern-matches on it keeps working.
      const msg = (thrown as BYOKGuardError).message;
      expect(msg.startsWith("BYOK env missing for disabled overlay; refusing to start")).toBe(true);
      expect(/overlay=/.test(msg)).toBe(true);
      expect(/missing=/.test(msg)).toBe(true);
    });

    it("Test 3 — valid env does not throw", () => {
      expect(() => assertBYOKConfig(happyEnv(), { logger: makeSilentLogger() })).not.toThrow();
    });

    it("Test 4 — BYOKGuardError is a named Error subclass", () => {
      expect(BYOKGuardError.prototype).toBeInstanceOf(Error);
      expect(new BYOKGuardError("x").name).toBe("BYOKGuardError");
      expect(new BYOKGuardError("x")).toBeInstanceOf(Error);
      expect(new BYOKGuardError("x")).toBeInstanceOf(BYOKGuardError);
    });
  });

  // OPENWHISPR_DEPLOYMENT_MODE=k8s kill-switch (downstream Yambr fix).
  // K8s operators bring observability / storage / ingress via Kubernetes-
  // native primitives (ServiceMonitor / envFromSecret / HTTPRoute), not
  // docker compose overlays. The compose-era loud-fail rows are not
  // applicable in k8s mode; the kill-switch short-circuits them while
  // leaving compose-mode behavior untouched (backward compatible default).
  describe("OPENWHISPR_DEPLOYMENT_MODE=k8s bypass", () => {
    it("k8s mode — empty env (no S3/OTEL/INGRESS) does not throw", () => {
      const env = { OPENWHISPR_DEPLOYMENT_MODE: "k8s" } as NodeJS.ProcessEnv;
      const { record, threwGuardError } = runWithCapture(env);
      expect(threwGuardError).toBe(false);
      expect(record).toBeNull();
    });

    it("k8s mode — case-insensitive (K8S)", () => {
      const env = { OPENWHISPR_DEPLOYMENT_MODE: "K8S" } as NodeJS.ProcessEnv;
      const { threwGuardError } = runWithCapture(env);
      expect(threwGuardError).toBe(false);
    });

    it("k8s mode — whitespace-tolerant ( k8s )", () => {
      const env = { OPENWHISPR_DEPLOYMENT_MODE: "  k8s  " } as NodeJS.ProcessEnv;
      const { threwGuardError } = runWithCapture(env);
      expect(threwGuardError).toBe(false);
    });

    it("compose mode (default, unset) — still enforces storage/observability/ingress", () => {
      const env = {} as NodeJS.ProcessEnv;
      const { threwGuardError, record } = runWithCapture(env);
      expect(threwGuardError).toBe(true);
      // First-violation-only: storage row fires first in declaration order.
      expect(record?.code).toBe("BYOK_STORAGE_REQUIRED");
    });

    it("compose mode (explicit) — still enforces", () => {
      const env = { OPENWHISPR_DEPLOYMENT_MODE: "compose" } as NodeJS.ProcessEnv;
      const { threwGuardError } = runWithCapture(env);
      expect(threwGuardError).toBe(true);
    });

    it("unrelated value — not 'k8s', still enforces", () => {
      const env = { OPENWHISPR_DEPLOYMENT_MODE: "something-else" } as NodeJS.ProcessEnv;
      const { threwGuardError } = runWithCapture(env);
      expect(threwGuardError).toBe(true);
    });

    it("k8s mode — emits structured info log on bypass (operator visibility)", () => {
      const { stream, lines } = makeLineCollector();
      const logger = pino({ name: "boot", level: "info" }, stream);
      const env = { OPENWHISPR_DEPLOYMENT_MODE: "k8s" } as NodeJS.ProcessEnv;
      expect(() => assertBYOKConfig(env, { logger })).not.toThrow();
      // At least one record emitted, mentioning the bypass + mode.
      expect(lines.length).toBeGreaterThan(0);
      const record = JSON.parse(lines[0] as string) as {
        msg?: string;
        event?: string;
        mode?: string;
      };
      expect(record.event).toBe("byok.bypassed");
      expect(record.mode).toBe("k8s");
    });
  });
});

/** Silent logger that swallows fatal records (used by BYOKGuardError contract tests). */
function makeSilentLogger() {
  const sink = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  return pino({ name: "boot", level: "fatal" }, sink);
}
