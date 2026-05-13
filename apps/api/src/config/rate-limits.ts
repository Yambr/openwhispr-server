// SPDX-License-Identifier: Apache-2.0
// Phase 6 / Plan 06-09 / D-RL2 — per-route rate-limit matrix (locked numbers).
//
// Source of truth: .planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md
// table under § Rate-Limit Policy Matrix.
//
// Design:
//   - Every entry exposes `rpmUser` and/or `rpmIp` plus a `keying` tag.
//   - All numeric limits are env-overridable so Phase 8 k6 tuning is a
//     config change, not a code change. Defaults match D-RL2 byte-for-byte.
//   - `keying` taxonomy:
//       * 'skip'                — probes (/livez, /readyz, /startupz, /api/health)
//       * 'ip-only'             — pre-auth abuse target (signin / signup / forgot)
//       * 'composite-ip-email'  — Phase 2 D-* polling carve-out
//                                 (verification-status); the actual
//                                 keyGenerator lives on the route to keep
//                                 the (IP,email) shape byte-for-byte
//       * 'user-and-ip'         — layered (D-RL1): user-tier here,
//                                 IP-tier enforced globally via the
//                                 plugin's IP preHandler
//   - GLOBAL_IP_CEILING is the always-on /min/IP ceiling enforced by the
//     plugin's preHandler hook regardless of route — the DoS shield.
//
// Phase 8 tuners: override RATE_LIMIT_* env vars; restart the API.

import { z } from "zod";

function num(env: string, fallback: number): number {
  const raw = process.env[env];
  if (raw === undefined || raw === "") return fallback;
  return z.coerce.number().int().positive().parse(raw);
}

export type RouteKeying = "skip" | "ip-only" | "composite-ip-email" | "user-and-ip";

export interface RouteRateLimit {
  rpmUser?: number;
  rpmIp?: number;
  /** Only set for 'composite-ip-email' (verification-status carve-out). */
  rpm?: number;
  keying: RouteKeying;
}

/**
 * Per-route rpm matrix — D-RL2 verbatim. Read at boot; routes consume
 * the value via the helper `routeConfig()` below or by importing the
 * relevant entry directly.
 */
export const rateLimits = {
  // Probes — unlimited (D-RL2 row 1).
  probes: { keying: "skip" } as const satisfies RouteRateLimit,

  // Pre-auth abuse target — IP-only tight ceiling (D-RL2 row 2).
  authSignin: {
    rpmIp: num("RATE_LIMIT_AUTH_SIGNIN_IP", 10),
    keying: "ip-only",
  } as RouteRateLimit,
  authSignup: {
    rpmIp: num("RATE_LIMIT_AUTH_SIGNUP_IP", 10),
    keying: "ip-only",
  } as RouteRateLimit,
  authForgotPassword: {
    rpmIp: num("RATE_LIMIT_AUTH_FORGOT_IP", 10),
    keying: "ip-only",
  } as RouteRateLimit,

  // Polling carve-out — preserved from Phase 2 (D-RL2 row 3).
  // 30/min/(IP,email); the route owns the keyGenerator that
  // composes IP + email — kept verbatim from Phase 2.
  verificationStatus: {
    rpm: num("RATE_LIMIT_VERIFICATION_STATUS", 30),
    keying: "composite-ip-email",
  } as RouteRateLimit,

  // Poll-tolerant lightweight reads (D-RL2 row 4).
  lightweightReads: {
    rpmUser: num("RATE_LIMIT_LIGHTWEIGHT_USER", 120),
    rpmIp: num("RATE_LIMIT_LIGHTWEIGHT_IP", 600),
    keying: "user-and-ip",
  } as RouteRateLimit,

  // Expensive
  transcribe: {
    rpmUser: num("RATE_LIMIT_TRANSCRIBE_USER", 20),
    rpmIp: num("RATE_LIMIT_TRANSCRIBE_IP", 60),
    keying: "user-and-ip",
  } as RouteRateLimit,
  reason: {
    rpmUser: num("RATE_LIMIT_REASON_USER", 30),
    rpmIp: num("RATE_LIMIT_REASON_IP", 90),
    keying: "user-and-ip",
  } as RouteRateLimit,
  agentStream: {
    rpmUser: num("RATE_LIMIT_AGENT_STREAM_USER", 10),
    rpmIp: num("RATE_LIMIT_AGENT_STREAM_IP", 30),
    keying: "user-and-ip",
  } as RouteRateLimit,
  agentWebSearch: {
    rpmUser: num("RATE_LIMIT_WEB_SEARCH_USER", 30),
    rpmIp: num("RATE_LIMIT_WEB_SEARCH_IP", 90),
    keying: "user-and-ip",
  } as RouteRateLimit,

  // CRUD
  crudWrite: {
    rpmUser: num("RATE_LIMIT_CRUD_WRITE_USER", 60),
    rpmIp: num("RATE_LIMIT_CRUD_WRITE_IP", 300),
    keying: "user-and-ip",
  } as RouteRateLimit,
  crudRead: {
    rpmUser: num("RATE_LIMIT_CRUD_READ_USER", 120),
    rpmIp: num("RATE_LIMIT_CRUD_READ_IP", 600),
    keying: "user-and-ip",
  } as RouteRateLimit,
  crudBatch: {
    rpmUser: num("RATE_LIMIT_CRUD_BATCH_USER", 20),
    rpmIp: num("RATE_LIMIT_CRUD_BATCH_IP", 60),
    keying: "user-and-ip",
  } as RouteRateLimit,

  // Sensitive — key minting
  keysCreate: {
    rpmUser: num("RATE_LIMIT_KEYS_CREATE_USER", 5),
    rpmIp: num("RATE_LIMIT_KEYS_CREATE_IP", 20),
    keying: "user-and-ip",
  } as RouteRateLimit,
  keysOther: {
    rpmUser: num("RATE_LIMIT_KEYS_OTHER_USER", 30),
    rpmIp: num("RATE_LIMIT_KEYS_OTHER_IP", 90),
    keying: "user-and-ip",
  } as RouteRateLimit,

  // Admin
  admin: {
    rpmUser: num("RATE_LIMIT_ADMIN_USER", 60),
    rpmIp: num("RATE_LIMIT_ADMIN_IP", 300),
    keying: "user-and-ip",
  } as RouteRateLimit,
} as const;

/**
 * Global IP-tier ceiling enforced by the rate-limit plugin's preHandler
 * hook on every non-skip route, regardless of per-route config.
 * D-RL1 — DoS shield. ~600/min/IP.
 */
export const GLOBAL_IP_CEILING = num("RATE_LIMIT_GLOBAL_IP_CEILING", 600);

/**
 * Convenience builder — translates a rateLimits[key] entry into the
 * Fastify route `config.rateLimit` shape. The route author writes:
 *
 *   config: { rateLimit: routeRateLimitConfig('transcribe') }
 *
 * For 'composite-ip-email' the caller must still attach the
 * (IP,email) keyGenerator manually — the shape is route-specific.
 * For 'skip' this returns `false` (opts the route out of the limiter).
 */
export function routeRateLimitConfig(key: keyof typeof rateLimits):
  | false
  | {
      max: number;
      timeWindow: string;
    } {
  const entry = rateLimits[key];
  switch (entry.keying) {
    case "skip":
      return false;
    // For 'ip-only' (pre-auth) we surface rpmIp as max; the plugin's
    // default user-tier keyGenerator falls back to req.ip when the
    // request is unauthenticated anyway, so the user-tier counter
    // naturally degrades to IP and applies the tighter ip-only ceiling.
    case "ip-only":
      return { max: entry.rpmIp as number, timeWindow: "1 minute" };
    case "composite-ip-email":
      return { max: entry.rpm as number, timeWindow: "1 minute" };
    case "user-and-ip":
      // user-tier max via the plugin; IP-tier handled globally.
      return { max: entry.rpmUser as number, timeWindow: "1 minute" };
  }
}
