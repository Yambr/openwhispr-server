// Phase 6 / Plan 03 / Task 1 — GREEN (D-T4 + English-only constitutional).
//
// Verifies the pino redact configuration exported from request-log.ts:
//   - redactPaths covers every D-T4 entry verbatim.
//   - buildLogger() returns a pino logger that scrubs a sentinel
//     bearer/password to literal "[REDACTED]" on every D-T4 path.
//   - Serialized output is 7-bit-ASCII only (English-only rule).
import { describe, expect, it } from "vitest";
import { buildLogger, redactPaths } from "./request-log.js";

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
});
