// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 03 Task 2 — @fastify/multipart registered at buildApp
// level (HIGH-4 fix). Plan 04 (/api/transcribe) needs multipart
// streaming; registering ONCE here in Wave 1 prevents the Wave-2
// cross-plan edit collision on apps/api/src/index.ts.
//
// Behaviors asserted:
//   1. registered: app exposes the 'multipart/form-data' content-type
//      parser after buildApp() resolves.
//   2. limits canonical: MULTIPART_OPTIONS exports the 100 MB hard cap
//      so future Wave-2 plans read a single source of truth.
//   3. attachFieldsToBody=false: routes forward the raw multipart
//      stream onward (Pitfall #5: no buffering).
//   4. limits enforced at runtime: a >100 MB upload via the same
//      MULTIPART_OPTIONS triggers FST_REQ_FILE_TOO_LARGE.
//   5. single registration: multiple buildApp() calls succeed (each
//      returns its own Fastify instance; the plugin is registered per
//      instance, not globally).

import fastifyMultipart from "@fastify/multipart";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp, MULTIPART_OPTIONS } from "../../../src/index.js";

describe("apps/api buildApp — @fastify/multipart wiring (HIGH-4)", () => {
  it("registers a multipart/form-data content-type parser on buildApp", async () => {
    const app = await buildApp();
    try {
      expect(app.hasContentTypeParser("multipart/form-data")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("MULTIPART_OPTIONS exports the canonical 100 MB cap and attachFieldsToBody=false", () => {
    // HIGH-4: future Wave-2 plans (transcribe) MUST read
    // these values from MULTIPART_OPTIONS, not redefine them locally.
    expect(MULTIPART_OPTIONS.attachFieldsToBody).toBe(false);
    expect(MULTIPART_OPTIONS.limits.fileSize).toBe(100 * 1024 * 1024);
  });

  it("does NOT auto-populate req.body for multipart requests (attachFieldsToBody=false)", async () => {
    // Probe a fresh Fastify instance with the SAME options buildApp uses.
    // We can't add a route to the real buildApp() (it has already called
    // app.ready()), so we mirror the registration here. This is exactly
    // what Plan 04/06 will rely on — the options object, not buildApp.
    const app = Fastify({ logger: false });
    await app.register(fastifyMultipart, MULTIPART_OPTIONS);

    let capturedBody: unknown = "not-set";
    app.post("/__multipart_probe", async (req, reply) => {
      capturedBody = req.body;
      return reply.status(204).send();
    });
    await app.ready();
    try {
      const boundary = "----testboundary";
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="field1"',
        "",
        "value1",
        `--${boundary}--`,
        "",
      ].join("\r\n");

      const res = await app.inject({
        method: "POST",
        url: "/__multipart_probe",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(res.statusCode).toBe(204);
      // attachFieldsToBody=false contract: req.body MUST NOT be a
      // parsed-fields object. Plans 04/06 will consume req.parts()
      // (or req.raw) directly without paying the parse cost.
      expect(capturedBody).not.toEqual({ field1: "value1" });
    } finally {
      await app.close();
    }
  });

  it("enforces the 100 MB fileSize cap (FST_REQ_FILE_TOO_LARGE on >100 MB)", async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyMultipart, MULTIPART_OPTIONS);

    app.post("/__multipart_size_probe", async (req, reply) => {
      try {
        for await (const part of req.parts()) {
          if (part.type === "file") {
            for await (const _chunk of part.file) {
              // drain — limit triggers during read
            }
          }
        }
        return reply.status(204).send();
      } catch (err) {
        const e = err as { code?: string; statusCode?: number; message?: string };
        return reply.status(e.statusCode ?? 413).send({ code: e.code, message: e.message });
      }
    });
    await app.ready();

    try {
      const boundary = "----sizeboundary";
      const oversized = Buffer.alloc(101 * 1024 * 1024, 0x61); // 101 MB of 'a'
      const head = Buffer.from(
        [
          `--${boundary}`,
          'Content-Disposition: form-data; name="audio"; filename="big.bin"',
          "Content-Type: application/octet-stream",
          "",
          "",
        ].join("\r\n"),
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const payload = Buffer.concat([head, oversized, tail]);

      const res = await app.inject({
        method: "POST",
        url: "/__multipart_size_probe",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
      expect(res.statusCode).toBe(413);
      const body = res.json() as { code?: string };
      expect(body.code).toBe("FST_REQ_FILE_TOO_LARGE");
    } finally {
      await app.close();
    }
  }, 30_000);

  it("supports calling buildApp() twice without 'plugin already registered' (per-instance plugin tree)", async () => {
    const a = await buildApp();
    const b = await buildApp();
    try {
      expect(a.hasContentTypeParser("multipart/form-data")).toBe(true);
      expect(b.hasContentTypeParser("multipart/form-data")).toBe(true);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
