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
import {
  buildDesktopSigninRoutes,
  type DesktopSigninDeps,
} from "./desktop-signin.js";
import {
  buildAuthCallbackRoutes,
  type AuthCallbackDeps,
  type MintBearer,
} from "./auth-callback.js";
import { buildTestOnlyRoutes } from "./test-only.js";
import {
  buildBetterAuthHandlerRoutes,
  type BetterAuthHandlerDeps,
} from "./better-auth-handler.js";
import healthRoutes from "./health.js";

export type RoutePlugin = (app: FastifyInstance) => Promise<void>;

export interface AllRoutesDeps {
  db: TransactionalDb<ExecutableTx>;
  auth: AuthLike;
  /** Plan 08: production MintBearer adapter; tests inject fakes. */
  mintBearer?: MintBearer;
  /**
   * Plan 08: when true OR NODE_ENV='test', register the /api/_test/*
   * routes consumed by packages/contract-tests/src/token-rotation.test.ts.
   */
  testOnly?: boolean;
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
  const desktopSigninDeps: DesktopSigninDeps = { db: deps.db };
  const authCallbackDeps: AuthCallbackDeps = deps.mintBearer
    ? { db: deps.db, mintBearer: deps.mintBearer }
    : { db: deps.db };
  // Phase 02.3 — mount Better Auth's universal handler at /api/auth/*.
  // Phase 02 Plan 04 left this wiring undone; without it sign-up,
  // sign-in, /verify-email, /sign-out, etc. are all caught by
  // dualAuthHook (no session) and 401'd before Better Auth sees them.
  const betterAuthHandlerDeps: BetterAuthHandlerDeps = { auth: deps.auth };
  const plugins: RoutePlugin[] = [
    healthRoutes,
    buildBetterAuthHandlerRoutes(betterAuthHandlerDeps),
    buildCheckUserRoutes(checkUserDeps),
    buildVerificationStatusRoutes(verificationDeps),
    buildDeleteAccountRoutes(deleteAccountDeps),
    buildDesktopSigninRoutes(desktopSigninDeps),
    buildAuthCallbackRoutes(authCallbackDeps),
  ];
  // Plan 08: register the /api/_test/* surface when explicitly enabled
  // OR when running under NODE_ENV='test'. The plugin itself enforces
  // the gate as well — defense in depth.
  if (deps.testOnly === true || process.env.NODE_ENV === "test") {
    plugins.push(buildTestOnlyRoutes({ db: deps.db, auth: deps.auth }));
  }
  return plugins;
}

export { healthRoutes };
export { buildBetterAuthHandlerRoutes };
export { buildCheckUserRoutes };
export { buildVerificationStatusRoutes };
export { buildDeleteAccountRoutes };
export { buildDesktopSigninRoutes };
export { buildAuthCallbackRoutes };
export { buildTestOnlyRoutes };
