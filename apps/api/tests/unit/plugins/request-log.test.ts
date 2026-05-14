// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 03 / Task 1 — GREEN (D-T4 + English-only constitutional).
//
// Verifies the pino redact configuration exported from request-log.ts:
//   - redactPaths covers every D-T4 entry verbatim.
//   - buildLogger() returns a pino logger that scrubs a sentinel
//     bearer/password to literal "[REDACTED]" on every D-T4 path.
//   - Serialized output is 7-bit-ASCII only (English-only rule).
import { describe, expect, it } from "vitest";
import { buildLogger, redactPaths } from "../../../src/plugins/request-log.js";

const REQUIRED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.token",
  "*.secret",
  "*.password",
  "*.apiKey",
  'res.headers["set-auth-token"]',
  "req.query.code",
  "req.query.state",
];

describe("request-log pino redact paths (D-T4)", () => {
  for (const p of REQUIRED_PATHS) {
    it(`declares D-T4 path: ${p}`, () => {
      expect(redactPaths).toContain(p);
    });
  }

  it("scrubs a sentinel bearer token from every documented path (D-T4)", () => {
    const SENTINEL = `sentinel-XYZ-${Date.now()}`;
    const chunks: string[] = [];
    const log = buildLogger({
      destination: {
        write(chunk: string): void {
          chunks.push(chunk);
        },
      },
    });
    log.info(
      {
        req: {
          headers: {
            authorization: `Bearer ${SENTINEL}`,
            cookie: `session=${SENTINEL}`,
          },
          query: { code: SENTINEL, state: SENTINEL },
        },
        res: {
          headers: {
            "set-auth-token": SENTINEL,
          },
        },
        token: SENTINEL,
        secret: SENTINEL,
        password: SENTINEL,
        apiKey: SENTINEL,
      },
      "auth attempt",
    );
    const joined = chunks.join("");
    expect(joined).not.toContain(SENTINEL);
    expect(joined).toContain("[REDACTED]");
  });

  it("uses the literal censor token '[REDACTED]' (D-T4)", () => {
    const chunks: string[] = [];
    const log = buildLogger({
      destination: {
        write(chunk: string): void {
          chunks.push(chunk);
        },
      },
    });
    log.info({ password: "p" }, "x");
    expect(chunks.join("")).toContain("[REDACTED]");
  });

  it("buildLogger() without a destination returns a default-stdout pino logger (production path)", () => {
    const log = buildLogger();
    expect(typeof log.info).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("emits English-ASCII-only output (English-only constitutional)", () => {
    const chunks: string[] = [];
    const log = buildLogger({
      destination: {
        write(chunk: string): void {
          chunks.push(chunk);
        },
      },
    });
    log.info({ event: "ready", reqId: "abc-123" }, "english only");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 7-bit ASCII range scan
    expect(chunks.join("")).toMatch(/^[\x00-\x7F]+$/);
  });

  // Plan 06-10 — sentinel sweep across the 6 leak vectors enumerated in
  // tests/integration/log-scrub-sentinel.test.ts. Mirrors them at the
  // unit level so the API tier's redact contract is checked on every
  // `pnpm -F @openwhispr/api test` run (cheap, no testcontainer).
  it("Plan 06-10 sweep #1: Authorization: Bearer SENTINEL never reaches stdout", () => {
    const SENTINEL = `SENTINEL-AUTH-${Date.now()}-1`;
    const chunks: string[] = [];
    const log = buildLogger({ destination: { write: (c) => chunks.push(c) } });
    log.info({ req: { headers: { authorization: `Bearer ${SENTINEL}` } } }, "auth");
    expect(chunks.join("")).not.toContain(SENTINEL);
    expect(chunks.join("")).toContain("[REDACTED]");
  });

  it("Plan 06-10 sweep #2: Cookie: session=SENTINEL never reaches stdout", () => {
    const SENTINEL = `SENTINEL-COOKIE-${Date.now()}-2`;
    const chunks: string[] = [];
    const log = buildLogger({ destination: { write: (c) => chunks.push(c) } });
    log.info({ req: { headers: { cookie: `session=${SENTINEL}` } } }, "session");
    expect(chunks.join("")).not.toContain(SENTINEL);
  });

  it("Plan 06-10 sweep #3: req.body.password SENTINEL never reaches stdout", () => {
    const SENTINEL = `SENTINEL-PWD-${Date.now()}-3`;
    const chunks: string[] = [];
    const log = buildLogger({ destination: { write: (c) => chunks.push(c) } });
    log.info({ req: { body: { password: SENTINEL } } }, "signup");
    expect(chunks.join("")).not.toContain(SENTINEL);
  });

  it("Plan 06-10 sweep #4: URL ?code=SENTINEL&state=SENTINEL never reaches stdout", () => {
    const SENTINEL_CODE = `SENTINEL-CODE-${Date.now()}-4a`;
    const SENTINEL_STATE = `SENTINEL-STATE-${Date.now()}-4b`;
    const chunks: string[] = [];
    const log = buildLogger({ destination: { write: (c) => chunks.push(c) } });
    log.info({ req: { query: { code: SENTINEL_CODE, state: SENTINEL_STATE } } }, "oauth cb");
    const joined = chunks.join("");
    expect(joined).not.toContain(SENTINEL_CODE);
    expect(joined).not.toContain(SENTINEL_STATE);
  });

  it("Plan 06-10 sweep #5: api-key creation flow (apiKey field) never reaches stdout", () => {
    const SENTINEL = `SENTINEL-APIKEY-${Date.now()}-5`;
    const chunks: string[] = [];
    const log = buildLogger({ destination: { write: (c) => chunks.push(c) } });
    log.info({ event: "api_key.issued", apiKey: SENTINEL, key_id: "k_123" }, "issued");
    expect(chunks.join("")).not.toContain(SENTINEL);
    expect(chunks.join("")).toContain("k_123");
  });

  it("Plan 06-10 sweep #6: worker job payload virtual_key SENTINEL never reaches stdout", () => {
    const SENTINEL = `SENTINEL-VK-${Date.now()}-6`;
    const chunks: string[] = [];
    const log = buildLogger({ destination: { write: (c) => chunks.push(c) } });
    log.error({ job: { virtual_key: SENTINEL }, err: { message: "boom" } }, "worker fail");
    expect(chunks.join("")).not.toContain(SENTINEL);
  });

  it("Plan 06-10: REDACT_PATHS legacy alias mirrors redactPaths exactly", async () => {
    const mod = await import("../../../src/plugins/request-log");
    expect(mod.REDACT_PATHS).toBe(mod.redactPaths);
  });
});
