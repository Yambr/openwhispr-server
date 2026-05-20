// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 60 / Track A — Defect A: the api process emits no structured
// request logs.
//
// `apps/api/src/index.ts` built the Fastify instance with
// `Fastify({ logger: false })`, making `req.log` a no-op stub. Every
// production `req.log.{warn,info,error}` call site — including
// `error-handler.ts:233` (`req.log.warn({err,status}, "request error")`,
// the ONLY server-side record of every 500) — silently discarded its
// output. A live 500 produced zero container log lines.
//
// This test proves the api request logger is a REAL pino instance built
// through `makePino` (so the REDACT_PATHS policy applies), and that the
// error-handler path emits a structured `"request error"` record on a
// 500. It uses the `BuildAppOptions.logger` test seam: an injected
// `makePino({ destination })` whose serialized output is captured.
//
// The 500 is driven through an EXISTING route — `/readyz` awaits the
// injected `depCheck` with no try/catch, so a `depCheck` that throws
// escapes to the centralized error handler. No new production seam
// beyond `BuildAppOptions.logger` is introduced.
//
// RED (pre-fix): `Fastify({ logger: false })` ignores the injected
// logger — the error-handler warn is a no-op and the capture stream is
// empty. GREEN (post-fix): the makePino-built logger is fed into Fastify
// and the captured output carries the structured record with a redacted
// `err`.
import { makePino } from "@openwhispr/observability";
import type { DestinationStream } from "pino";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/index.js";

/** Minimal in-memory pino destination — accumulates serialized lines. */
function captureStream(): { stream: DestinationStream; lines: () => string[] } {
  const chunks: string[] = [];
  return {
    stream: {
      write(chunk: string): void {
        chunks.push(chunk);
      },
    },
    lines: () => chunks.join("").split("\n").filter(Boolean),
  };
}

describe("Phase 60 Track A — api logger wiring (Defect A)", () => {
  it("buildApp builds Fastify with a real makePino logger (not the no-op stub)", async () => {
    const app = await buildApp({});
    // With `logger: false` Fastify exposes an Abstract no-op logger whose
    // `level` getter is absent (`undefined`). A real pino logger has a
    // settable string `level` and `child` returns a DISTINCT instance.
    expect(typeof app.log.child).toBe("function");
    expect(typeof app.log.level).toBe("string");
    const child = app.log.child({ probe: true });
    expect(child).not.toBe(app.log);
    await app.close();
  });

  it("emits a structured 'request error' record on a 500 with the err redacted", async () => {
    const { stream, lines } = captureStream();
    const logger = makePino({ base: { service: "api" }, destination: stream });

    // `/readyz` awaits `depCheck` directly; a throwing depCheck escapes
    // to the centralized error handler → 500. The thrown error carries a
    // token-shaped field that REDACT_PATHS must censor.
    const depCheck = vi.fn(async () => {
      const err = new Error("synthetic depCheck 500 for logger wiring test") as Error & {
        token?: string;
      };
      err.token = "sk-super-secret-should-not-leak";
      throw err;
    });
    const app = await buildApp({ logger, depCheck: depCheck as never });

    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(500);

    const all = lines().join("\n");
    // The error-handler warn must have emitted a structured record.
    expect(all).toContain("request error");
    // REDACT_PATHS must have censored the token-shaped field — the raw
    // secret MUST NOT appear, the censor literal MUST.
    expect(all).not.toContain("sk-super-secret-should-not-leak");
    expect(all).toContain("[REDACTED]");

    await app.close();
  });
});
