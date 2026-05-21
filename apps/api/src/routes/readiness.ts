// SPDX-License-Identifier: FSL-1.1-ALv2
// R25 — GET /api/ready: real Cloud-plane readiness probe.
//
// Distinct from /api/health (liveness — process-alive only, used by the
// kubelet livenessProbe / compose restart decision) and /readyz (the
// kubelet-canonical Postgres/Valkey/LiteLLM dep aggregate). /api/ready is
// the COMPOSE healthcheck target: a container that cannot serve Cloud
// traffic (no SSRF dispatcher, no LiteLLM client, unreachable upstream)
// is marked `unhealthy` and pulled from rotation — instead of silently
// serving 500s on /api/transcribe, /api/reason, /api/agent/*.
//
// Checks (each a hard 200-or-503 contributor):
//   - ssrf_dispatcher: the process-global undici dispatcher carries the
//     `openwhispr.ssrf-wrapped` marker. This catches RUNTIME clobbering
//     (a stray post-boot `setGlobalDispatcher`), not just the boot state.
//   - litellm_client: a LiteLLM client was constructed at buildApp() time
//     (LITELLM_MASTER_KEY present). When absent, the Cloud-plane routes
//     are not even registered, so the container is not Cloud-ready.
//   - litellm_upstream: a cheap LiteLLM `/health` ping under a short
//     timeout (delegated to the shared dep-check library, ≤2s). A
//     `skipped` upstream (intentionally-absent AI plane) does NOT fail
//     the probe.
//
// The handler NEVER throws — every failure path resolves to a 503 with a
// structured `checks` body so operators can disambiguate.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type Dispatcher, getGlobalDispatcher } from "undici";
import type { DepCheck } from "../lib/dep-check.js";

// R24/R25 — the well-known SSRF-wrap marker. Recomputed via the global
// symbol registry (same value as ssrf-dispatcher.ts) so this route does
// not import the apps-internal dispatcher module.
const SSRF_WRAPPED_MARKER = Symbol.for("openwhispr.ssrf-wrapped");

interface ReadinessCheck {
  readonly ok: boolean;
  readonly error?: string;
}

interface ReadinessBody {
  readonly status: "ready" | "not_ready";
  readonly checks: {
    readonly ssrf_dispatcher: ReadinessCheck;
    readonly litellm_client: ReadinessCheck;
    readonly litellm_upstream: ReadinessCheck;
  };
}

export interface ReadinessDeps {
  /**
   * True when buildApp() received a constructed LiteLLM client
   * (LITELLM_MASTER_KEY present at boot). When false the Cloud-plane
   * routes were never registered and the container is not Cloud-ready.
   */
  readonly litellmClientConstructed: boolean;
  /**
   * Optional shared dep-check. Used only for the `litellm_upstream`
   * probe here. When omitted, the upstream check reports a wired-failure
   * (`error: "depCheck not wired"`).
   */
  readonly depCheck?: DepCheck;
}

/**
 * Runtime SSRF-marker check. Reads the CURRENT process-global undici
 * dispatcher (not a boot snapshot) so a post-boot clobber is caught.
 */
export function checkSsrfDispatcher(): ReadinessCheck {
  // Single `as` narrow (LOCKER-02 clean) — Dispatcher's symbol indexer is
  // `unknown | undefined`; mirrors `assertSsrfInstalled` in litellm-client.
  const dispatcher = getGlobalDispatcher() as Dispatcher & { [k: symbol]: unknown };
  if (dispatcher[SSRF_WRAPPED_MARKER]) {
    return { ok: true };
  }
  return {
    ok: false,
    error: "global undici dispatcher is not the SSRF-wrapped Agent",
  };
}

export const buildReadinessRoutes = (deps: ReadinessDeps) =>
  async function readinessRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/ready",
      // `/api/ready` is an allowlisted `rateLimit:false` URL (LOCKER-04):
      // the compose healthcheck polls it on a tight interval and a 1000-
      // pod fleet would otherwise saturate the limiter. Public — no auth.
      config: { auth: false, rateLimit: false },
      handler: async (_req: FastifyRequest, reply: FastifyReply) => {
        const ssrf_dispatcher = checkSsrfDispatcher();

        const litellm_client: ReadinessCheck = deps.litellmClientConstructed
          ? { ok: true }
          : {
              ok: false,
              error: "LiteLLM client not constructed (LITELLM_MASTER_KEY unset at boot)",
            };

        let litellm_upstream: ReadinessCheck;
        if (!deps.depCheck) {
          litellm_upstream = { ok: false, error: "depCheck not wired" };
        } else {
          // depCheck.probe() is total — it never rejects. A `skipped`
          // upstream (intentionally-absent AI plane) is reported ok:true.
          const result = await deps.depCheck("litellm");
          litellm_upstream = result.error
            ? { ok: result.ok, error: result.error }
            : { ok: result.ok };
        }

        const allOk = ssrf_dispatcher.ok && litellm_client.ok && litellm_upstream.ok;
        const body: ReadinessBody = {
          status: allOk ? "ready" : "not_ready",
          checks: { ssrf_dispatcher, litellm_client, litellm_upstream },
        };
        return reply
          .header("cache-control", "no-store")
          .code(allOk ? 200 : 503)
          .send(body);
      },
    });
  };

export default buildReadinessRoutes;
