// SPDX-License-Identifier: Apache-2.0
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertBYOKConfig, type BYOKFatalRecord } from "../index.js";

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
    DATABASE_URL: "postgres://app:hunter2@db:5432/openwhispr",
    SMTP_HOST: "smtp.corp.example.com",
    NODE_ENV: "production",
  } as NodeJS.ProcessEnv;
}

describe("assertBYOKConfig (Phase 14 / Plan 04 / Task 1)", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // process.exit is mocked to throw a marker so the function under
    // test halts the same way it would in production (subsequent
    // statements never run) without killing the test runner.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__byok_exit_${code}__`);
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /**
   * Capture the fatal record emitted by `assertBYOKConfig(env)`. Returns
   * `null` when no fatal was emitted (happy path). Throws if the function
   * exits without emitting any line OR if the captured line is not JSON.
   */
  function runWithCapture(env: NodeJS.ProcessEnv): {
    record: BYOKFatalRecord | null;
    exitCode: number | null;
    rawStderr: string;
  } {
    const { stream, lines, raw } = makeLineCollector();
    const logger = pino({ name: "boot", level: "fatal" }, stream);
    let exitCode: number | null = null;
    try {
      assertBYOKConfig(env, { logger });
    } catch (err) {
      const msg = (err as Error).message;
      const match = msg.match(/^__byok_exit_(\d+)__$/);
      if (!match || !match[1]) throw err; // not our marker — re-throw real errors
      exitCode = Number.parseInt(match[1], 10);
    }
    const record = lines.length > 0 ? (JSON.parse(lines[0] as string) as BYOKFatalRecord) : null;
    return { record, exitCode, rawStderr: raw.join("") };
  }

  it("happy path — all BYOK envs set → returns void, no fatal, no exit", () => {
    const { record, exitCode } = runWithCapture(happyEnv());
    expect(record).toBeNull();
    expect(exitCode).toBeNull();
  });

  it("storage — S3_ENDPOINT unset → fatal BYOK_STORAGE_REQUIRED + exit 1", () => {
    const env = happyEnv();
    delete env.S3_ENDPOINT;
    delete env.S3_ACCESS_KEY;
    delete env.S3_SECRET_KEY;
    delete env.S3_BUCKET;
    const { record, exitCode } = runWithCapture(env);
    expect(exitCode).toBe(1);
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
    const { record, exitCode } = runWithCapture(env);
    expect(exitCode).toBe(1);
    expect(record?.code).toBe("BYOK_STORAGE_REQUIRED");
    expect(record?.missing).toEqual(["S3_ACCESS_KEY", "S3_SECRET_KEY"]);
  });

  it("observability — OTEL_EXPORTER_OTLP_ENDPOINT unset → fatal BYOK_OBSERVABILITY_REQUIRED", () => {
    const env = happyEnv();
    delete env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { record, exitCode } = runWithCapture(env);
    expect(exitCode).toBe(1);
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
    const { record, exitCode } = runWithCapture(env);
    expect(record).toBeNull();
    expect(exitCode).toBeNull();
  });

  it("observability — URL value → returns void", () => {
    const env = happyEnv();
    env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.corp.example.com:4317";
    const { record, exitCode } = runWithCapture(env);
    expect(record).toBeNull();
    expect(exitCode).toBeNull();
  });

  it("ingress — INGRESS_BASE_URL unset → fatal BYOK_INGRESS_REQUIRED", () => {
    const env = happyEnv();
    delete env.INGRESS_BASE_URL;
    const { record, exitCode } = runWithCapture(env);
    expect(exitCode).toBe(1);
    expect(record?.code).toBe("BYOK_INGRESS_REQUIRED");
    expect(record?.overlay).toBe("ingress");
    expect(record?.missing).toEqual(["INGRESS_BASE_URL"]);
  });

  it("pgbouncer — DATABASE_URL unset → fatal BYOK_DATABASE_REQUIRED", () => {
    const env = happyEnv();
    delete env.DATABASE_URL;
    const { record, exitCode } = runWithCapture(env);
    expect(exitCode).toBe(1);
    expect(record?.code).toBe("BYOK_DATABASE_REQUIRED");
    expect(record?.overlay).toBe("pgbouncer");
    expect(record?.missing).toEqual(["DATABASE_URL"]);
  });

  it("dev-tools (SMTP) — NODE_ENV=production AND SMTP_HOST unset → fatal BYOK_SMTP_REQUIRED", () => {
    const env = happyEnv();
    delete env.SMTP_HOST;
    const { record, exitCode } = runWithCapture(env);
    expect(exitCode).toBe(1);
    expect(record?.code).toBe("BYOK_SMTP_REQUIRED");
    expect(record?.overlay).toBe("dev-tools");
    expect(record?.missing).toContain("SMTP_HOST");
  });

  it("dev-tools (SMTP) — NODE_ENV=test AND SMTP_HOST unset → returns void (NODE_ENV gate honored)", () => {
    const env = happyEnv();
    env.NODE_ENV = "test";
    delete env.SMTP_HOST;
    const { record, exitCode } = runWithCapture(env);
    expect(record).toBeNull();
    expect(exitCode).toBeNull();
  });

  it("dev-tools (SMTP) — NODE_ENV unset AND SMTP_HOST unset → returns void (NODE_ENV gate honored)", () => {
    const env = happyEnv();
    delete env.NODE_ENV;
    delete env.SMTP_HOST;
    const { record, exitCode } = runWithCapture(env);
    expect(record).toBeNull();
    expect(exitCode).toBeNull();
  });

  it("first-violation-only — five overlays misconfigured → ONE fatal record with code BYOK_STORAGE_REQUIRED", () => {
    // Wipe every BYOK key.
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    const { stream, lines } = makeLineCollector();
    const logger = pino({ name: "boot", level: "fatal" }, stream);
    let exitCode: number | null = null;
    try {
      assertBYOKConfig(env, { logger });
    } catch (err) {
      const m = (err as Error).message.match(/^__byok_exit_(\d+)__$/);
      if (m?.[1]) exitCode = Number.parseInt(m[1], 10);
    }
    expect(exitCode).toBe(1);
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

  it("pino.final wrap — the fatal path uses pino.final() (not direct logger.fatal)", async () => {
    const finalSpy = vi.spyOn(pino, "final");
    const env = happyEnv();
    delete env.INGRESS_BASE_URL;
    const { stream } = makeLineCollector();
    const logger = pino({ name: "boot", level: "fatal" }, stream);
    try {
      assertBYOKConfig(env, { logger });
    } catch {
      /* swallow exit marker */
    }
    expect(finalSpy).toHaveBeenCalledTimes(1);
    expect(finalSpy).toHaveBeenCalledWith(logger);
  });

  it("default logger — assertBYOKConfig(env) works without opts.logger (constructs its own pino instance)", () => {
    const env = happyEnv();
    delete env.INGRESS_BASE_URL;
    // We cannot directly capture stderr from the default logger here,
    // but we CAN assert it does not throw a non-exit error and that
    // process.exit(1) is still called.
    let exitCode: number | null = null;
    try {
      assertBYOKConfig(env);
    } catch (err) {
      const m = (err as Error).message.match(/^__byok_exit_(\d+)__$/);
      if (m?.[1]) exitCode = Number.parseInt(m[1], 10);
    }
    expect(exitCode).toBe(1);
  });

  it("default env — assertBYOKConfig() (zero args) falls back to process.env", () => {
    // Save & nuke selected keys so the call exits.
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
    let exitCode: number | null = null;
    try {
      assertBYOKConfig();
    } catch (err) {
      const m = (err as Error).message.match(/^__byok_exit_(\d+)__$/);
      if (m?.[1]) exitCode = Number.parseInt(m[1], 10);
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
    expect(exitCode).toBe(1);
  });
});
