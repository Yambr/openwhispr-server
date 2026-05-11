// Phase 6 / Plan 06-04 — GREEN (D-P3).
//
// Verifies the `x-served-by` Fastify plugin:
//   - attaches the header on every reply via `onSend`
//   - value equals `os.hostname()`
//   - does NOT overwrite an existing upstream-provided `x-served-by`
//
// Pure unit test against the Fastify inject() surface — no network, no
// testcontainers. The horizontal-scale e2e
// (tests/e2e/horizontal-scale.test.ts, Plan 06-12) verifies the
// cross-replica wire behavior on a real `--scale api=2` stack.

import os from "node:os";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { servedByPlugin } from "./served-by.js";

describe("served-by plugin (D-P3)", () => {
  it("attaches x-served-by response header on every reply", async () => {
    const app = Fastify();
    await app.register(servedByPlugin);
    app.get("/a", async () => ({ ok: true }));
    app.get("/b", async () => ({ ok: true }));

    const ra = await app.inject({ method: "GET", url: "/a" });
    const rb = await app.inject({ method: "GET", url: "/b" });

    expect(ra.headers["x-served-by"]).toBeDefined();
    expect(rb.headers["x-served-by"]).toBeDefined();
    await app.close();
  });

  it("uses os.hostname() as the header value", async () => {
    const app = Fastify();
    await app.register(servedByPlugin);
    app.get("/x", async () => ({}));

    const res = await app.inject({ method: "GET", url: "/x" });

    expect(res.headers["x-served-by"]).toBe(os.hostname());
    await app.close();
  });

  it("attaches on the onSend hook (visible to clients downstream of Traefik)", async () => {
    // We assert the hook fires by registering a sentinel onSend AFTER
    // the plugin and observing that reply.getHeader('x-served-by') is
    // populated at that point — i.e. our plugin's onSend ran earlier in
    // the chain.
    const app = Fastify();
    await app.register(servedByPlugin);
    let observed: string | undefined;
    app.addHook("onSend", async (_req, reply) => {
      const v = reply.getHeader("x-served-by");
      observed = typeof v === "string" ? v : Array.isArray(v) ? String(v[0]) : undefined;
    });
    app.get("/y", async () => ({}));

    await app.inject({ method: "GET", url: "/y" });

    expect(observed).toBe(os.hostname());
    await app.close();
  });

  it("does not overwrite an existing x-served-by header if upstream already set it", async () => {
    const app = Fastify();
    await app.register(servedByPlugin);
    app.get("/z", async (_req, reply) => {
      reply.header("x-served-by", "upstream-sidecar-xyz");
      return { ok: true };
    });

    const res = await app.inject({ method: "GET", url: "/z" });

    expect(res.headers["x-served-by"]).toBe("upstream-sidecar-xyz");
    await app.close();
  });

  it("preserves header even when route emits empty string (treats empty as unset)", async () => {
    // Defensive: an empty string is not a meaningful tag — fall back to
    // hostname rather than emit `x-served-by:`.
    const app = Fastify();
    await app.register(servedByPlugin);
    app.get("/empty", async (_req, reply) => {
      reply.header("x-served-by", "");
      return { ok: true };
    });

    const res = await app.inject({ method: "GET", url: "/empty" });

    expect(res.headers["x-served-by"]).toBe(os.hostname());
    await app.close();
  });
});
