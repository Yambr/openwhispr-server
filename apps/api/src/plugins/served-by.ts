// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 06-04 / Task 1 — `x-served-by` response header plugin (D-P3).
//
// Tiny Fastify `onSend` hook that attaches `x-served-by: ${os.hostname()}`
// to every outgoing response. Consumed by tests/e2e/horizontal-scale.test.ts
// to prove Traefik round-robin actually distributes across `--scale api=N`
// replicas.
//
// Behavior:
//   - hostname resolved ONCE at plugin-load time (os.hostname() is cheap
//     but allocating it per-response is wasteful at SCALE-01's 1000
//     concurrent budget).
//   - In Kubernetes the pod name is exposed via `HOSTNAME` env var
//     (kubelet default) which `os.hostname()` reads on Linux; this gives
//     us pod-granular tagging for free without a downward-API env mount.
//   - Does NOT overwrite an upstream-provided `x-served-by` header — if
//     a proxy/sidecar already tagged the response, preserve their value
//     so trace-back through layers stays intact (D-P3 unit test asserts
//     this).

import os from "node:os";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

async function servedByInner(app: FastifyInstance): Promise<void> {
  const hostname = os.hostname();
  app.addHook("onSend", async (_req, reply) => {
    const existing = reply.getHeader("x-served-by");
    if (existing === undefined || existing === null || existing === "") {
      reply.header("x-served-by", hostname);
    }
  });
}

export const servedByPlugin = fp(servedByInner, {
  name: "served-by",
  fastify: "5.x",
});

export default servedByPlugin;
