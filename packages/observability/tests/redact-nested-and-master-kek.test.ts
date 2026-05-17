// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-09 + small-pkgs MEDIUM — pino REDACT_PATHS gaps
// identified in REVIEW-INDEX.md:
//
//   * `err.response.config.headers.Authorization` — every upstream-401
//     job failure logs `childLog.error({ err }, "tenant job failed")`
//     where `err` is an axios-shaped Error and the bearer is nested 4
//     levels deep. The pre-fix REDACT_PATHS wildcard `*.foo` matches
//     ONE level only, so the bearer leaks.
//   * `MASTER_KEK` env-var name — if `process.env` is ever logged
//     flat, the at-rest envelope-encryption KEK leaks. The pre-fix
//     list covered every `*_API_KEY` but missed `MASTER_KEK` and
//     `BETTER_AUTH_SECRET`.
//   * `x-api-key` / `x-auth-token` / `x-amz-*` headers — Pino wildcard
//     `*.foo` does not match two-level-deep `req.headers["x-api-key"]`.

import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { makePino } from "../src/redact.js";

function captureLog(opts: Parameters<typeof makePino>[0] = {}): {
  log: ReturnType<typeof makePino>;
  output(): string;
} {
  let buf = "";
  const sink = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return {
    log: makePino({ ...opts, destination: sink }),
    output: () => buf,
  };
}

describe("Plan 51-09 — REDACT_PATHS covers nested and env-name surfaces", () => {
  it("masks `err.response.config.headers.Authorization` (axios-shaped upstream-401)", () => {
    const { log, output } = captureLog();
    const err = {
      response: { config: { headers: { Authorization: "Bearer sk-leaked-12345" } } },
    };
    log.error({ err }, "tenant job failed");
    expect(output()).not.toContain("sk-leaked-12345");
  });

  it("masks `err.response.headers.Authorization` (one-level shallower variant)", () => {
    const { log, output } = captureLog();
    const err = {
      response: { headers: { Authorization: "Bearer sk-shallow-67890" } },
    };
    log.error({ err }, "tenant job failed");
    expect(output()).not.toContain("sk-shallow-67890");
  });

  it("masks `MASTER_KEK` at the root", () => {
    const { log, output } = captureLog();
    log.info({ env: { MASTER_KEK: "verysecretkek-do-not-log-abcdef" } }, "boot diagnostics");
    expect(output()).not.toContain("verysecretkek-do-not-log-abcdef");
  });

  it("masks `BETTER_AUTH_SECRET` at the root", () => {
    const { log, output } = captureLog();
    log.info(
      { env: { BETTER_AUTH_SECRET: "ba-secret-must-not-appear-xyzpdq" } },
      "boot diagnostics",
    );
    expect(output()).not.toContain("ba-secret-must-not-appear-xyzpdq");
  });

  it("masks `req.headers['x-api-key']`", () => {
    const { log, output } = captureLog();
    log.info({ req: { headers: { "x-api-key": "secret-x-api-value-12345" } } }, "request received");
    expect(output()).not.toContain("secret-x-api-value-12345");
  });

  it("masks `req.headers['x-amz-signature']` (S3 SigV4)", () => {
    const { log, output } = captureLog();
    log.info(
      { req: { headers: { "x-amz-signature": "secret-sigv4-signature-AABBCC" } } },
      "request received",
    );
    expect(output()).not.toContain("secret-sigv4-signature-AABBCC");
  });
});
