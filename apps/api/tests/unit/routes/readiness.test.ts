// SPDX-License-Identifier: FSL-1.1-ALv2
// R25 — GET /api/ready readiness probe.
//
// Mounts the route on a bare Fastify instance (no buildApp wiring) and
// drives the three checks (ssrf_dispatcher / litellm_client /
// litellm_upstream) by controlling the process-global undici dispatcher
// and injecting a deterministic depCheck fake. ROUTING + STATUS-CODE +
// BODY-SHAPE only.

import Fastify from "fastify";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DepName, DepResult } from "../../../src/lib/dep-check.js";
import { buildReadinessRoutes, checkSsrfDispatcher } from "../../../src/routes/readiness.js";

const SSRF_WRAPPED_MARKER = Symbol.for("openwhispr.ssrf-wrapped");

function makeMarkedAgent(): Agent {
  const agent = new Agent();
  Object.defineProperty(agent, SSRF_WRAPPED_MARKER, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return agent;
}

async function makeApp(deps: {
  litellmClientConstructed: boolean;
  depCheck?: (n: DepName) => Promise<DepResult>;
}) {
  const app = Fastify({ logger: false });
  await app.register(
    buildReadinessRoutes(
      deps.depCheck
        ? { litellmClientConstructed: deps.litellmClientConstructed, depCheck: deps.depCheck }
        : { litellmClientConstructed: deps.litellmClientConstructed },
    ),
  );
  await app.ready();
  return app;
}

let savedDispatcher: ReturnType<typeof getGlobalDispatcher>;
let markedAgent: Agent;
let bareAgent: Agent;

beforeEach(() => {
  savedDispatcher = getGlobalDispatcher();
  markedAgent = makeMarkedAgent();
  bareAgent = new Agent();
});

afterEach(async () => {
  setGlobalDispatcher(savedDispatcher);
  await markedAgent.close();
  await bareAgent.close();
});

describe("checkSsrfDispatcher", () => {
  it("ok:true when the global dispatcher carries the SSRF marker", () => {
    setGlobalDispatcher(markedAgent);
    expect(checkSsrfDispatcher()).toEqual({ ok: true });
  });

  it("ok:false when the global dispatcher lacks the SSRF marker (post-boot clobber)", () => {
    setGlobalDispatcher(bareAgent);
    const result = checkSsrfDispatcher();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SSRF-wrapped/);
  });
});

describe("GET /api/ready", () => {
  it("200 ready when SSRF marked, LiteLLM client constructed, upstream ok", async () => {
    setGlobalDispatcher(markedAgent);
    const app = await makeApp({
      litellmClientConstructed: true,
      depCheck: async () => ({ ok: true, latency_ms: 1 }),
    });
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ready",
      checks: {
        ssrf_dispatcher: { ok: true },
        litellm_client: { ok: true },
        litellm_upstream: { ok: true },
      },
    });
    await app.close();
  });

  it("R29b — 200 ready when the global dispatcher lacks the SSRF marker (ssrf_dispatcher is informational, non-gating)", async () => {
    // Post-R24 the LiteLLM client holds its OWN bound SSRF-wrapped
    // dispatcher; a clobbered process-global does NOT break the Cloud
    // plane, so it must NOT depool the container via the compose
    // healthcheck. The marker state is still reported in `checks` for
    // operator visibility (Better Auth OIDC / web-search egress) but is
    // excluded from the gating conjunction.
    setGlobalDispatcher(bareAgent);
    const app = await makeApp({
      litellmClientConstructed: true,
      depCheck: async () => ({ ok: true, latency_ms: 1 }),
    });
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    // Reported, falsey — visible to operators, but did NOT flip status.
    expect(body.checks.ssrf_dispatcher.ok).toBe(false);
    expect(body.checks.ssrf_dispatcher.error).toMatch(/SSRF-wrapped/);
    await app.close();
  });

  it("503 not_ready when the LiteLLM client was not constructed", async () => {
    setGlobalDispatcher(markedAgent);
    const app = await makeApp({
      litellmClientConstructed: false,
      depCheck: async () => ({ ok: true, latency_ms: 1 }),
    });
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.checks.litellm_client.ok).toBe(false);
    expect(body.checks.litellm_client.error).toMatch(/LITELLM_MASTER_KEY/);
    await app.close();
  });

  it("503 not_ready when the LiteLLM upstream probe fails", async () => {
    setGlobalDispatcher(markedAgent);
    const app = await makeApp({
      litellmClientConstructed: true,
      depCheck: async () => ({ ok: false, latency_ms: 2000, error: "litellm 503" }),
    });
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.checks.litellm_upstream.ok).toBe(false);
    expect(body.checks.litellm_upstream.error).toBe("litellm 503");
    await app.close();
  });

  it("200 ready when the LiteLLM upstream is intentionally skipped (ok:true)", async () => {
    setGlobalDispatcher(markedAgent);
    const app = await makeApp({
      litellmClientConstructed: true,
      depCheck: async () => ({ ok: true, latency_ms: 0, skipped: true }),
    });
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("503 not_ready when depCheck is not wired", async () => {
    setGlobalDispatcher(markedAgent);
    const app = await makeApp({ litellmClientConstructed: true });
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.checks.litellm_upstream).toEqual({
      ok: false,
      error: "depCheck not wired",
    });
    await app.close();
  });

  it("sets cache-control: no-store", async () => {
    setGlobalDispatcher(markedAgent);
    const app = await makeApp({
      litellmClientConstructed: true,
      depCheck: async () => ({ ok: true, latency_ms: 1 }),
    });
    const res = await app.inject({ method: "GET", url: "/api/ready" });
    expect(res.headers["cache-control"]).toBe("no-store");
    await app.close();
  });
});
