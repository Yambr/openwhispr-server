// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 / Task 2 — `@fastify/rate-limit` plugin (D-28).
// Phase 6 / Plan 06-09 — layered IP + user keying (D-RL1), per-route
// matrix (D-RL2), standard headers + audit-on-429 (D-RL3).
//
// Source of truth:
//   * .planning/phases/02-auth-wire-api-skeleton-conformance-harness
//     /02-RESEARCH-CONTAINER.md § Pattern 5 + Pitfalls 1-2 (Phase 2)
//   * .planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md
//     § Rate-Limit Policy Matrix (Phase 6 D-RL1..3)
//
// Behavior (Phase 6 extensions in [BRACKETS]):
//   * Global default user-tier counter: 60/min keyed on
//     `user:<req.user.id ?? req.ip>` (auto-degrades to IP when
//     unauthenticated). Phase 2 was IP-only; Phase 6 swaps in the
//     auto-degrading user keyGenerator. [D-RL1]
//   * The 429 body remains EXACTLY `{error:"Too many requests"}`.
//   * Per-route overrides come from each route's `config.rateLimit`
//     (Plan 03 + Phase 6 routes via `routeRateLimitConfig()`). `false`
//     opts a route out (e.g. `/api/health`).
//   * NameSpace `owrl:` so Valkey keys don't collide with future BullMQ
//     queues or other tenants on the same instance.
//   * `skipOnError: true` — a Valkey blip should NOT 500 the API.
//   * `addHeaders: true` — emit X-RateLimit-{Limit,Remaining,Reset}
//     and Retry-After (Phase 6 D-RL3 / OWASP API4:2023 / IETF
//     ratelimit-headers draft).
//   * [Phase 6] Separate IP-tier global ceiling enforced via a preHandler
//     hook with a dedicated ioredis INCR+EXPIRE counter — fires 429 when
//     EITHER counter is exhausted. Skipped on routes whose
//     `config.rateLimit === false`. [D-RL1]
//   * [Phase 6] On 429, emit an `audit_log` row with
//     `action='security.rate_limit_exceeded'` via `recordAudit()` if a
//     tenant context is available. Best-effort: a missing tenant (pre-
//     auth abuse) is logged but does NOT crash the response path. [D-RL3]
//
// Backend selection:
//   * If `redis` is provided in opts (test/integration), use it.
//   * Otherwise build one from VALKEY_URL.
//   * If VALKEY_URL is absent, fall back to in-process counters (also
//     applies to the IP-tier preHandler — a Map<ip, {count, reset}>
//     under that branch).

import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { GLOBAL_IP_CEILING } from "../config/rate-limits.js";

export interface RateLimitPluginOptions {
  /**
   * Pre-constructed redis client (e.g. testcontainers / mocks). When
   * omitted we construct one from `process.env.VALKEY_URL` if set.
   */
  // biome-ignore lint/suspicious/noExplicitAny: opaque redis client surface
  redis?: any;
  /** Maximum requests per `timeWindow` for the global default. */
  max?: number;
  /** Default timeWindow string (e.g. "1 minute") or millis. */
  timeWindow?: string | number;
  /**
   * Override for the per-IP global ceiling. Defaults to
   * `GLOBAL_IP_CEILING` from `config/rate-limits.ts`. Tests inject a
   * tiny number to exercise the IP-tier path within a single suite.
   */
  globalIpCeiling?: number;
  /**
   * Hook invoked when EITHER tier emits a 429. Best-effort audit-log
   * fanout; the default (an inline recordAudit emission) is wired by
   * the buildApp seam — kept injectable so the unit test can capture
   * calls without standing up Postgres.
   */
  onRateLimitExceeded?:
    | ((req: FastifyRequest, rule: "ip" | "user", route: string) => void | Promise<void>)
    | undefined;
}

interface IpCounterStore {
  incr(key: string, ttlMs: number): Promise<number>;
}

function inProcessIpStore(): IpCounterStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async incr(key: string, ttlMs: number) {
      const now = Date.now();
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + ttlMs });
        return 1;
      }
      existing.count += 1;
      return existing.count;
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: opaque redis client surface
function redisIpStore(redis: any): IpCounterStore {
  return {
    async incr(key: string, ttlMs: number) {
      // Atomic counter + lazy expiry. INCR returns the new value; on
      // the first hit (n === 1) we set the TTL. Subsequent hits leave
      // the original TTL intact so the window doesn't slide.
      const n = (await redis.incr(key)) as number;
      if (n === 1) {
        // PEXPIRE in milliseconds — same precision as the
        // @fastify/rate-limit RedisStore TTL.
        await redis.pexpire(key, ttlMs);
      }
      return n;
    },
  };
}

const IP_TIER_WINDOW_MS = 60_000; // 1 minute

function getRouteName(req: FastifyRequest): string {
  // FastifyRequest exposes `routeOptions.url` (v5) for the matched route
  // template, falling back to the concrete URL when the request is
  // unmatched (404 path). The route name is the only stable identifier
  // we can ship into the audit payload's `route` key.
  const ro = (req as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions;
  return ro?.url ?? req.url;
}

// ── Phase 8 / Plan 01 ───────────────────────────────────────────────────
// `OPENWHISPR_DISABLE_RATE_LIMIT` LOAD-TEST-ONLY env switch. When set to
// "1" or "true", the plugin skips BOTH the IP-tier preHandler AND the
// `@fastify/rate-limit` registration so synthetic load traffic (1000 VUs
// from one Mac IP under docker-compose `load-test-*` profiles) bypasses
// the anti-abuse limiter that would otherwise throttle them within the
// first second. Default is OFF (unset OR "0"). The Better Auth limiter
// honours the same switch in `apps/api/src/auth.ts`. A WARN banner fires
// at plugin registration so an operator who fat-fingers this in
// production sees the failure mode in their logs (D-RL safety, anti-leak).
function rateLimitDisabled(): boolean {
  const raw = process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
  return raw === "1" || raw === "true";
}

async function rateLimitPluginInner(
  fastify: FastifyInstance,
  opts: RateLimitPluginOptions,
): Promise<void> {
  if (rateLimitDisabled()) {
    fastify.log.warn(
      { env: "OPENWHISPR_DISABLE_RATE_LIMIT" },
      "[security] Rate limit DISABLED via OPENWHISPR_DISABLE_RATE_LIMIT — load-test only, MUST NOT be set in production",
    );
    return;
  }
  // biome-ignore lint/suspicious/noExplicitAny: opaque redis client surface
  let redis: any | undefined = opts.redis;

  if (!redis && process.env.VALKEY_URL) {
    // Phase 03 e2e fix — see header comment for the ioredis-vs-@redis/client
    // story. We keep the same defineCommand-capable ioredis instance for
    // both the @fastify/rate-limit RedisStore and our IP-tier preHandler.
    const { Redis } = await import("ioredis");
    const url = process.env.VALKEY_URL;
    redis = new Redis(url, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
    fastify.addHook("onClose", async () => {
      try {
        await redis.quit();
      } catch {
        /* best-effort */
      }
    });
  }

  const ipStore: IpCounterStore = redis ? redisIpStore(redis) : inProcessIpStore();
  const ipCeiling = opts.globalIpCeiling ?? GLOBAL_IP_CEILING;

  // ── Phase 6 D-RL1 ──────────────────────────────────────────────────
  // Global IP-tier ceiling preHandler. Fires BEFORE the per-route
  // user-tier counter (@fastify/rate-limit), so the IP-tier outcome
  // takes precedence. Skipped on routes whose config.rateLimit === false
  // (probes), aligned with the user-tier opt-out semantics.
  fastify.addHook("onRequest", async (req, reply) => {
    const routeConfig = (
      req as FastifyRequest & { routeOptions?: { config?: { rateLimit?: unknown } } }
    ).routeOptions?.config;
    if (routeConfig?.rateLimit === false) return;

    const ipKey = `owrl:ip:${req.ip}`;
    let count = 0;
    try {
      count = await ipStore.incr(ipKey, IP_TIER_WINDOW_MS);
    } catch {
      // skipOnError parity — never 500 the request when the limiter
      // substrate is degraded.
      return;
    }
    if (count > ipCeiling) {
      // Best-effort audit. Pre-auth abuse traffic typically has no
      // tenant context, so the hook silently drops emission failures.
      if (opts.onRateLimitExceeded) {
        try {
          await opts.onRateLimitExceeded(req, "ip", getRouteName(req));
        } catch {
          /* best-effort */
        }
      }
      // Mirror the @fastify/rate-limit envelope contract.
      reply.header("Retry-After", "60");
      reply.header("RateLimit-Limit", String(ipCeiling));
      reply.header("RateLimit-Remaining", "0");
      reply.header("RateLimit-Reset", "60");
      reply.code(429);
      throw Object.assign(new Error("Too many requests"), {
        statusCode: 429,
        __rateLimited: true,
      });
    }
  });

  // Phase 07.1 / Plan 13.3 — `RATE_LIMIT_GLOBAL_USER_MAX` overrides the
  // default global user-tier ceiling (60/min). Used by the e2e test stack
  // where a single Playwright worker drives every signed-in request from
  // one fixture user, blowing past 60/min on shared routes (notes/list,
  // conversations/list, …) within the suite's ~1-min runtime. Production
  // deployments leave this UNSET to retain the documented anti-abuse
  // posture; the matrix in `config/rate-limits.ts` still applies the
  // per-route stricter values.
  const globalUserMax = (() => {
    const raw = process.env.RATE_LIMIT_GLOBAL_USER_MAX;
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();
  await fastify.register(rateLimit, {
    global: true,
    max: opts.max ?? globalUserMax ?? 60,
    timeWindow: opts.timeWindow ?? "1 minute",
    redis,
    skipOnError: true,
    nameSpace: "owrl:",
    // ── Phase 6 D-RL1 ────────────────────────────────────────────────
    // Run at `preHandler` time so the user-tier keyGenerator can read
    // `req.user.id` populated by the dualAuthHook (registered as
    // `onRequest` in apps/api/src/index.ts AFTER this plugin). Without
    // this override the keyGenerator would always see an unauthenticated
    // request and incorrectly degrade to IP keying even for signed-in
    // users. The IP-tier ceiling above stays on `onRequest` so it runs
    // first and short-circuits abuse before any handler work.
    hook: "preHandler",
    // ── Phase 6 D-RL1 ────────────────────────────────────────────────
    // User-tier keyGenerator. `req.user` is populated by the dual-auth
    // hook on authenticated routes; when absent (pre-auth or
    // unauthenticated polling) the key auto-degrades to req.ip so the
    // counter still works for IP-only rules like /api/auth/signin.
    keyGenerator: (req) => {
      const userId = (req as FastifyRequest & { user?: { id?: string } }).user?.id;
      return userId ? `user:${userId}` : `ip:${req.ip}`;
    },
    // ── Phase 6 D-RL3 ────────────────────────────────────────────────
    // X-RateLimit-{Limit,Remaining,Reset} + Retry-After per IETF draft
    // and OWASP API4:2023. @fastify/rate-limit v10 emits these natively
    // (no `X-` prefix in the IETF draft — v10 still uses the legacy
    // `X-RateLimit-*` prefixes for back-compat; clients reading either
    // shape will work).
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    // CRITICAL (Phase 2 Pitfall #1): single-key envelope. Phase 6
    // preserves the contract byte-for-byte. We attach a sentinel so the
    // centralized error handler can short-circuit the envelope mapping
    // even when other branches would otherwise add error-class context.
    errorResponseBuilder: (req, ctx) => {
      // Best-effort audit emission on the user-tier 429 path. Mirrors
      // the IP-tier path above. Fire-and-forget — never await inside the
      // builder so the response stays low-latency.
      if (opts.onRateLimitExceeded) {
        Promise.resolve(opts.onRateLimitExceeded(req, "user", getRouteName(req))).catch(() => {
          /* best-effort */
        });
      }
      const err = new Error("Too many requests") as Error & {
        statusCode: number;
        __rateLimited: true;
      };
      // @fastify/rate-limit v10 always passes ctx.statusCode (= 429) when
      // it invokes the builder. The Error.statusCode mirror is what the
      // centralized error-handler reads for envelope mapping.
      err.statusCode = ctx.statusCode;
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
