// Phase 2 / Plan 03 / Task 3 — single ordered registry of route plugin
// FACTORIES.
//
// Plan 04 (the buildApp owner) imports `buildAllRoutes(deps)`, calls it
// after the rate-limit plugin is wired, and registers each returned
// plugin onto the app. Per Pattern 2 of 02-RESEARCH-WIRE.md the order
// is fixed: health first (lightest), then check-user (pre-auth), then
// the cookie-only auth pair.
//
// Plan 03's responsibility ENDS at exporting these factories; wiring
// (the actual `app.register(plugin)` calls inside `buildApp`) is Plan
// 04's territory. This avoids the index.ts authorship race the plan
// explicitly calls out.
import type { FastifyInstance } from "fastify";
import type { AuthLike } from "../middleware/dual-auth.js";
import type { TransactionalDb, ExecutableTx } from "@openwhispr/data";
import {
  buildCheckUserRoutes,
  type CheckUserDeps,
} from "./check-user.js";
import {
  buildVerificationStatusRoutes,
  type VerificationStatusDeps,
} from "./verification-status.js";
import {
  buildDeleteAccountRoutes,
  type DeleteAccountDeps,
} from "./delete-account.js";
import healthRoutes from "./health.js";

export type RoutePlugin = (app: FastifyInstance) => Promise<void>;

export interface AllRoutesDeps {
  db: TransactionalDb<ExecutableTx>;
  auth: AuthLike;
}

/**
 * Build the ordered array of route plugin functions for `buildApp` to
 * register. Plan 04 calls this after the rate-limit plugin is in place
 * so per-route `config.rateLimit` is honored.
 */
export function buildAllRoutes(deps: AllRoutesDeps): readonly RoutePlugin[] {
  const checkUserDeps: CheckUserDeps = { db: deps.db };
  const verificationDeps: VerificationStatusDeps = {
    db: deps.db,
    auth: deps.auth,
  };
  const deleteAccountDeps: DeleteAccountDeps = {
    db: deps.db,
    auth: deps.auth,
  };
  return [
    healthRoutes,
    buildCheckUserRoutes(checkUserDeps),
    buildVerificationStatusRoutes(verificationDeps),
    buildDeleteAccountRoutes(deleteAccountDeps),
  ];
}

export { healthRoutes };
export { buildCheckUserRoutes };
export { buildVerificationStatusRoutes };
export { buildDeleteAccountRoutes };
