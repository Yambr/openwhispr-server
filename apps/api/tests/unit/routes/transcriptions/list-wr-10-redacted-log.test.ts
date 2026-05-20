// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-10 regression test.
//
// WR-10 — transcriptions/list.ts logs `req.log.warn({ err }, ...)` on an
// invalid-query catch. The shared redact policy is a fixed path allowlist —
// `err.message` is not covered, so a parseListQuery message embedding raw
// user cursor text would land in Loki. The fix logs a redacted shape
// (`{ name }`) instead of the raw Error object.
//
// Strategy: register the real list route on a bare Fastify instance, decorate
// `req.log` with a capturing spy via an onRequest hook, drive an
// invalid-`before` query (passes the zod schema but fails parseListQuery's
// Date.parse), and assert the captured `req.log.warn` bound object.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildTranscriptionsListRoutes } from "../../../../src/routes/transcriptions/list.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

interface WarnCall {
  obj: Record<string, unknown>;
  msg: string;
}

async function buildApp(warnCalls: WarnCall[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: TEST_USER,
      email: "fixture@conformance.test",
    };
    (req as unknown as { tenant: string }).tenant = TEST_TENANT;
    // Capturing spy logger — records the bound object of every warn() call.
    const spy = {
      warn(obj: Record<string, unknown>, msg: string) {
        warnCalls.push({ obj, msg });
      },
      info() {},
      error() {},
      debug() {},
      trace() {},
      fatal() {},
      child() {
        return spy;
      },
    };
    (req as unknown as { log: typeof spy }).log = spy;
  });
  // DB is never reached — the invalid-query throw fires before withTenant.
  await app.register(buildTranscriptionsListRoutes({ db: {} as never }));
  await app.ready();
  return app;
}

describe("transcriptions/list — WR-10 redacted error log", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("WR-10: an invalid query logs a redacted shape, not the raw Error object", async () => {
    const warnCalls: WarnCall[] = [];
    app = await buildApp(warnCalls);
    const res = await app.inject({
      method: "GET",
      url: "/api/transcriptions/list?before=not-a-real-timestamp",
    });
    expect(res.statusCode).toBe(400);

    const call = warnCalls.find((c) => c.msg.includes("invalid query"));
    expect(call).toBeDefined();
    // The bound object must NOT carry the raw `err` Error object.
    expect(call?.obj).not.toHaveProperty("err");
    // It carries only a redacted shape — the Error's `name`.
    expect(call?.obj).toHaveProperty("name");
    expect(typeof call?.obj.name).toBe("string");
    // The raw parseListQuery message ("Invalid 'before' timestamp") must
    // not appear in the logged object.
    expect(JSON.stringify(call?.obj)).not.toContain("Invalid 'before' timestamp");
  });
});
