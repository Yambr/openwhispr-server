// Phase 2 / Plan 03 / Task 3 — `x-openwhispr-source` request-log tag
// (D-16 / WIRE-19).
//
// Phase 6 / Plan 03 / Task 1 — pino logger factory + D-T4 redact paths.
// Phase 6 / Plan 10 — extracted to the shared @openwhispr/observability
// package so the Worker tier reuses the SAME redact policy without
// inverting the apps->packages dependency direction.
//
// Backwards-compatible re-exports:
//   - `redactPaths` (legacy name) -> REDACT_PATHS from @openwhispr/observability.
//   - `buildLogger({ destination })` -> thin wrapper around makePino.
//
// The Fastify `requestLog` plugin keeps its Phase 2 behavior unchanged
// (mirrors the `x-openwhispr-source` header onto every `req.log` child).

import { makePino, REDACT_PATHS } from "@openwhispr/observability";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { DestinationStream, Logger } from "pino";

/** Legacy alias preserved for the existing Phase 6 / Plan 03 callers + tests. */
export const redactPaths: readonly string[] = REDACT_PATHS;

/** Re-export the canonical path list under its new name for new callers. */
export { REDACT_PATHS } from "@openwhispr/observability";

/**
 * Build a pino logger with the Phase 6 D-T4 redact policy applied.
 *
 * Backwards-compatible alias for `makePino` — the existing API-tier tests
 * pass `{ destination }` to capture serialized output without writing to
 * stdout. The factory now delegates to `@openwhispr/observability` so the
 * API and Worker tiers share one redact policy.
 */
export const buildLogger = (opts?: { destination?: DestinationStream }): Logger => {
  if (opts?.destination) return makePino({ destination: opts.destination });
  return makePino();
};

async function requestLogInner(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req) => {
    const raw = req.headers["x-openwhispr-source"];
    const source = typeof raw === "string" ? raw : null;
    req.log = req.log.child({ openwhisprSource: source });
  });
}

export const requestLog = fp(requestLogInner, {
  name: "request-log",
  fastify: "5.x",
});
