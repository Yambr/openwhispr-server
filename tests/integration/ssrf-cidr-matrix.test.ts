// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 6 / Plan 06 / SCALE-04 — SSRF CIDR matrix integration test.
 *
 * Boots a local fixture HTTP server bound to 127.0.0.1, then exercises
 * the SSRF dispatcher against it through `globalThis.fetch` (undici).
 *
 * Coverage:
 *   1. With OUTBOUND_ALLOW_LOOPBACK=1 + NODE_ENV='test' + host in allow-list,
 *      the outbound request reaches the loopback fixture and returns 200.
 *   2. With OUTBOUND_ALLOW_LOOPBACK=0, the SAME fixture call is blocked
 *      with an SSRFBlockedError surfacing at fetch().
 *   3. AWS IMDS target (169.254.169.254) is rejected with rule='link_local_v4'.
 *   4. OUTBOUND_SSRF_MODE='warn' lets the request proceed but still
 *      fires the onBlock audit callback (D-S5 warn-mode contract).
 *
 * Constitutional: no mocks of internal logic — the SSRF dispatcher is
 * the production module; the fixture server is a real HTTP listener;
 * DNS resolution is pinned at the dispatcher boundary via the `resolve`
 * option so we deterministically target 127.0.0.1 / 169.254.169.254
 * without depending on the OS resolver or /etc/hosts.
 */

import { createServer, type Server } from "node:http";
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSSRFDispatcher, SSRFBlockedError } from "../../apps/api/src/lib/ssrf-dispatcher.js";

describe("SSRF dispatcher CIDR matrix (integration — loopback fixture)", () => {
  let server: Server;
  let port: number;
  let prevDispatcher: ReturnType<typeof getGlobalDispatcher>;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    port = addr.port;
    prevDispatcher = getGlobalDispatcher();
  });

  afterAll(async () => {
    setGlobalDispatcher(prevDispatcher ?? new Agent());
    await new Promise<void>((res) => server.close(() => res()));
  });

  it("OUTBOUND_ALLOW_LOOPBACK=1 + NODE_ENV='test': fetch to local fixture succeeds", async () => {
    const dispatcher = makeSSRFDispatcher({
      allowedHosts: ["local.fixture"],
      privateHostAllowlist: [],
      allowLoopback: true,
      mode: "enforce",
      nodeEnv: "test",
      onBlock: () => {},
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    setGlobalDispatcher(dispatcher);
    const res = await fetch(`http://local.fixture:${port}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("OUTBOUND_ALLOW_LOOPBACK=0: fetch to loopback is BLOCKED with SSRFBlockedError", async () => {
    const dispatcher = makeSSRFDispatcher({
      allowedHosts: ["local.fixture"],
      privateHostAllowlist: [],
      allowLoopback: false,
      mode: "enforce",
      nodeEnv: "test",
      onBlock: () => {},
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    setGlobalDispatcher(dispatcher);
    let caught: Error | null = null;
    try {
      await fetch(`http://local.fixture:${port}/`);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    // The cause chain MUST surface SSRFBlockedError somewhere.
    let cursor: unknown = caught;
    let ssrfErr: SSRFBlockedError | null = null;
    for (let i = 0; i < 6 && cursor; i++) {
      if (cursor instanceof SSRFBlockedError) {
        ssrfErr = cursor;
        break;
      }
      cursor = (cursor as { cause?: unknown }).cause;
    }
    expect(
      ssrfErr,
      `expected SSRFBlockedError in cause chain, got: ${caught?.message}`,
    ).not.toBeNull();
    expect(ssrfErr?.rule).toBe("loopback_v4");
  });

  it("AWS IMDS target (169.254.169.254) is rejected with rule='link_local_v4'", async () => {
    const dispatcher = makeSSRFDispatcher({
      allowedHosts: ["metadata.aws"],
      privateHostAllowlist: [],
      allowLoopback: false,
      mode: "enforce",
      nodeEnv: "test",
      onBlock: () => {},
      // Pin the resolve so we don't actually hit the metadata IP from CI.
      resolve: async () => [{ address: "169.254.169.254", family: 4 }],
    });
    setGlobalDispatcher(dispatcher);
    let caught: Error | null = null;
    try {
      await fetch("http://metadata.aws/latest/meta-data/iam/security-credentials/");
    } catch (e) {
      caught = e as Error;
    }
    let cursor: unknown = caught;
    let ssrfErr: SSRFBlockedError | null = null;
    for (let i = 0; i < 6 && cursor; i++) {
      if (cursor instanceof SSRFBlockedError) {
        ssrfErr = cursor;
        break;
      }
      cursor = (cursor as { cause?: unknown }).cause;
    }
    expect(ssrfErr).not.toBeNull();
    expect(ssrfErr?.rule).toBe("link_local_v4");
    expect(ssrfErr?.ip).toBe("169.254.169.254");
  });

  it("OUTBOUND_SSRF_MODE='warn' + loopback: request PROCEEDS but onBlock fires (D-S5)", async () => {
    const blocks: Array<{ host: string; ip: string | null; rule: string; mode: string }> = [];
    const dispatcher = makeSSRFDispatcher({
      allowedHosts: ["local.fixture"],
      privateHostAllowlist: [],
      allowLoopback: false, // would normally block
      mode: "warn", // but warn-mode lets it through
      nodeEnv: "test",
      onBlock: (ctx) => blocks.push(ctx),
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    setGlobalDispatcher(dispatcher);
    const res = await fetch(`http://local.fixture:${port}/`);
    expect(res.status).toBe(200);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.rule).toBe("loopback_v4");
    expect(blocks[0]?.mode).toBe("warn");
  });
});
