// SPDX-License-Identifier: FSL-1.1-ALv2
// Keep-alive alignment with the reverse proxy in front of the api.
//
// THE FAILURE THIS PREVENTS — intermittent 502s that no application log
// explains. When a proxy keeps an idle upstream connection in its pool LONGER
// than the backend is willing to hold it, this race is always available:
//
//   t+0s    nginx puts the idle connection in its keepalive pool
//   t+72s   Node hits keepAliveTimeout and starts closing the socket
//   t+72s   nginx, not yet knowing, writes the next request into that socket
//           → the request dies on a half-closed connection → 502 to the client
//
// The window is small per connection but it is hit constantly under real
// traffic, and it looks like a flaky backend rather than a config mismatch.
// The only robust fix is ordering: the BACKEND must outlive the PROXY's idle
// timeout, so the proxy is always the side that closes first.
//
// Deployment contract (see the ingress annotations in the open-whisper-server
// deploy repo, .helm/templates/090-ingress.yaml):
//
//   nginx.ingress.kubernetes.io/upstream-keepalive-timeout: "300"
//
// so this server must sit strictly above 300s. Fastify's own default is 72s
// (fastify/lib/config-validator.js defaultInitOptions.keepAliveTimeout), which
// is BELOW that — i.e. the misconfiguration is what you get by not deciding.
//
// If the ingress annotation ever changes, this test is the thing that has to be
// updated with it, deliberately.
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/index.js";

/** Must match `upstream-keepalive-timeout` on the ingress, in milliseconds. */
const INGRESS_UPSTREAM_KEEPALIVE_MS = 300_000;

describe("keep-alive alignment with the reverse proxy", () => {
  it("outlives the ingress upstream keep-alive so the proxy always closes first", async () => {
    const app = await buildApp({});
    try {
      expect(app.server.keepAliveTimeout).toBeGreaterThan(INGRESS_UPSTREAM_KEEPALIVE_MS);
    } finally {
      await app.close();
    }
  });

  it("keeps headersTimeout above keepAliveTimeout, as Node requires", async () => {
    // Node closes an idle keep-alive socket via keepAliveTimeout, but a socket
    // that has begun a request is governed by headersTimeout. If headersTimeout
    // were the smaller of the two, Node would tear down connections mid-request
    // once keepAliveTimeout was raised — trading one source of 502s for another.
    const app = await buildApp({});
    try {
      expect(app.server.headersTimeout).toBeGreaterThan(app.server.keepAliveTimeout);
    } finally {
      await app.close();
    }
  });
});
