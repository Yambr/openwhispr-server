// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 06-04 / Task 1 — three kubelet-canonical health probes (D-P1).
//
// Routes:
//   - GET /livez    : process-alive only, ZERO dep checks, 200 always.
//                     A Postgres/Valkey/LiteLLM blip MUST NOT cascade-restart
//                     pods — kubelet uses /livez for restart decisions.
//   - GET /readyz   : checks Postgres + Valkey + LiteLLM in parallel via the
//                     5s-cached dep-check library. 200 if ALL ok, else 503.
//                     Traefik / EKS use /readyz for "stop routing to this
//                     replica" decisions (drops the calling pod from the LB
//                     pool without restarting it).
//   - GET /startupz : 503 until `markStartupComplete()` is called by the
//                     entrypoint after `app.ready()` + first successful PG
//                     SELECT 1. Allows slow-init pods to escape the
//                     liveness-probe failure window during cold boot.
//   - GET /api/health: back-compat alias for /livez. Plan 02 wired the
//                     original `/api/health` route; this plan replaces it
//                     in-place (Plan 02's health.ts is dropped from
//                     registration) so old contract tests still pass.
//                     Carries `Deprecation: true` + `Link: </livez>;
//                     rel="successor-version"` per RFC 8594.
//
// All four routes are `config.auth=false` (no dual-auth hook) and
// `config.rateLimit=false` (kubelet probes at periodSeconds=10 across 1000
// pods would otherwise saturate the limiter).
import type { FastifyInstance } from "fastify";
import type { DepCheck } from "../lib/dep-check.js";

let startupComplete = false;

/**
 * Flip the /startupz response from 503 to 200. Called by the entrypoint
 * after `app.ready()` + first successful PG `SELECT 1` (cold-boot pool
 * warm-up).
 *
 * Idempotent. Tests may call `resetStartupComplete()` to restore the
 * initial 503-pending state between cases.
 */
export const markStartupComplete = (): void => {
  startupComplete = true;
};

/**
 * Reset the startup flag — test-only. Production callers MUST NOT use
 * this; once a pod is up it stays up.
 */
export const resetStartupComplete = (): void => {
  startupComplete = false;
};

export const isStartupComplete = (): boolean => startupComplete;

export interface ProbesDeps {
  /**
   * Optional dep-check function. When omitted, /readyz and /startupz
   * return 503 immediately (no deps wired → not ready by definition).
   * Production constructs via `makeDepCheck({pg, valkey, litellmUrl})`;
   * tests inject deterministic fakes.
   */
  readonly depCheck?: DepCheck;
  /**
   * Plan 13-01 / Task 13-01-05 — optional migrations probe consulted by
   * `/api/health` to populate the `migrations_completed: boolean` field.
   * Production wires `() => count(_meta.__drizzle_migrations) > 0` against
   * the existing app pool (no fresh pg.Client). Tests inject deterministic
   * fakes. When omitted, the field reports `false` (operator-actionable
   * signal that no DB-backed probe was attached at boot, distinct from a
   * runtime DB outage). Errors thrown by `migrationsCheck` are swallowed
   * and surfaced as `false` so `/api/health` (an alias of `/livez`) never
   * cascades a kubelet restart on a migrations-probe hiccup.
   */
  readonly migrationsCheck?: () => Promise<boolean>;
}

export const registerProbes = async (
  app: FastifyInstance,
  deps: ProbesDeps = {},
): Promise<void> => {
  const { depCheck, migrationsCheck } = deps;

  app.route({
    method: "GET",
    url: "/livez",
    config: { auth: false, rateLimit: false },
    handler: async () => ({ status: "ok" as const }),
  });

  app.route({
    method: "GET",
    url: "/readyz",
    config: { auth: false, rateLimit: false },
    handler: async (_req, reply) => {
      if (!depCheck) {
        return reply.code(503).send({
          postgres: { ok: false, latency_ms: 0, error: "depCheck not wired" },
          valkey: { ok: false, latency_ms: 0, error: "depCheck not wired" },
          litellm: { ok: false, latency_ms: 0, error: "depCheck not wired" },
        });
      }
      const [postgres, valkey, litellm] = await Promise.all([
        depCheck("postgres"),
        depCheck("valkey"),
        depCheck("litellm"),
      ]);
      const allOk = postgres.ok && valkey.ok && litellm.ok;
      return reply.code(allOk ? 200 : 503).send({ postgres, valkey, litellm });
    },
  });

  app.route({
    method: "GET",
    url: "/startupz",
    config: { auth: false, rateLimit: false },
    handler: async (_req, reply) => {
      return reply.code(startupComplete ? 200 : 503).send({ ready: startupComplete });
    },
  });

  app.route({
    method: "GET",
    url: "/api/health",
    config: { auth: false, rateLimit: false },
    handler: async (_req, reply) => {
      reply.header("Deprecation", "true");
      reply.header("Link", '</livez>; rel="successor-version"');
      // Plan 13-01 / Task 13-01-05 — surface the migrations_completed
      // signal. When migrationsCheck is unwired OR throws, default to
      // `false`: /api/health is /livez-aliased and MUST stay 200, but the
      // field truthfully reports that no positive migration confirmation
      // was obtained (operator/harness reads this to gate a readiness
      // decision; kubelet does not consult /api/health for restart).
      let migrations_completed = false;
      if (migrationsCheck) {
        try {
          migrations_completed = await migrationsCheck();
        } catch {
          migrations_completed = false;
        }
      }
      return reply.send({ status: "ok" as const, migrations_completed });
    },
  });
};

export default registerProbes;
