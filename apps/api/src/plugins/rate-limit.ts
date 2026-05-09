// Phase 2 / Plan 04 / Task 2 — `@fastify/rate-limit` plugin (D-28).
//
// Source of truth: 02-RESEARCH-CONTAINER.md § Pattern 5 + Pitfall #1
// (envelope mismatch) + Pitfall #2 (req.ip behind Traefik).
//
// Behavior:
//   * Global default: 60/min/req.ip with envelope-conformant 429 body.
//   * The 429 body is EXACTLY `{error:"Too many requests"}` — no
//     statusCode / code / message keys. Any extra key would break
//     CONTRACT-01 byte-for-byte assertions and the global error
//     envelope (D-13).
//   * Per-route overrides come from each route's `config.rateLimit`
//     (Plan 03 already supplied them). `false` opts a route out (e.g.
//     `/api/health`); object overrides max/timeWindow/keyGenerator.
//   * NameSpace `owrl:` so Valkey keys don't collide with future BullMQ
//     queues or other tenants on the same instance.
//   * `skipOnError: true` — a Valkey blip should NOT 500 the API.
//     Better to over-allow briefly than to deny service when the
//     limiter substrate is degraded.
//
// Backend selection:
//   * If `redis` is provided in opts (test/integration), use it.
//   * Otherwise build one from VALKEY_URL + VALKEY_PASSWORD.
//   * If VALKEY_URL is absent (unit tests / dev without Valkey), skip
//     the redis backend and use the in-process fallback. Tests that
//     need real distributed semantics inject their own client.
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";

export interface RateLimitPluginOptions {
  /**
   * Pre-constructed redis client (e.g. testcontainers / mocks). When
   * omitted we construct one from `process.env.VALKEY_URL` if set.
   */
  // biome-ignore lint/suspicious/noExplicitAny: opaque redis client surface
  redis?: any;
  /**
   * Maximum requests per `timeWindow` for the global default. Defaults
   * to 60. Tests can lower this to keep run-time short.
   */
  max?: number;
  /** Default timeWindow string (e.g. "1 minute") or millis. */
  timeWindow?: string | number;
}

async function rateLimitPluginInner(
  fastify: FastifyInstance,
  opts: RateLimitPluginOptions,
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: opaque redis client surface
  let redis: any | undefined = opts.redis;

  if (!redis && process.env.VALKEY_URL) {
    const { createClient } = await import("@redis/client");
    const clientOpts: { url: string; password?: string } = {
      url: process.env.VALKEY_URL,
    };
    if (process.env.VALKEY_PASSWORD) {
      clientOpts.password = process.env.VALKEY_PASSWORD;
    }
    redis = createClient(clientOpts);
    await redis.connect();
    fastify.addHook("onClose", async () => {
      try {
        await redis.quit();
      } catch {
        /* best-effort */
      }
    });
  }

  await fastify.register(rateLimit, {
    global: true,
    max: opts.max ?? 60,
    timeWindow: opts.timeWindow ?? "1 minute",
    redis,
    skipOnError: true,
    nameSpace: "owrl:",
    keyGenerator: (req) => req.ip,
    // CRITICAL (Pitfall #1): the body MUST be `{error:"Too many requests"}`
    // and nothing else. The default body includes `statusCode`, `error`,
    // and `message` keys — that breaks the global envelope (D-13) and
    // CONTRACT-01.
    //
    // @fastify/rate-limit v10 expects `errorResponseBuilder` to return
    // an Error-shaped object with `statusCode` set (the plugin throws
    // it; setErrorHandler then sees statusCode === 429 and emits the
    // envelope). We attach a sentinel `__rateLimited` so the centralized
    // setErrorHandler can map directly to the single-key envelope and
    // bypass the default Error.message branch.
    errorResponseBuilder: (_req, ctx) => {
      const err = new Error("Too many requests") as Error & {
        statusCode: number;
        __rateLimited: true;
      };
      err.statusCode = ctx.statusCode ?? 429;
      err.__rateLimited = true;
      return err;
    },
  });
}

export const rateLimitPlugin = fp(rateLimitPluginInner, {
  name: "rate-limit",
  fastify: "5.x",
});

export default rateLimitPlugin;
