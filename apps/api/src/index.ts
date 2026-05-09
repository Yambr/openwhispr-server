// Phase 2 / Plan 04 / Task 2 — `buildApp()`: the sole authoritative
// wiring point for the OpenWhispr API.
//
// Plan 03 supplied:
//   * route plugin factories + `allRoutes` barrel (routes/index.ts)
//   * dual-auth + cookie-only middleware (middleware/*)
//   * zod-type-provider + request-log plugins (plugins/*)
//   * centralized setErrorHandler (error-handler.ts) + typed errors
//
// Plan 04 owns the assembly. Order is load-bearing — see the comments
// at each step.
//
// CRITICAL ordering (per 02-04-PLAN.md Task 2):
//   1. Construct Fastify with `trustProxy:true` so req.ip resolves the
//      X-Forwarded-For client behind Traefik (Pitfall #2 — without this
//      every rate-limit bucket collapses onto Traefik's single IP).
//   2. registerErrorHandler FIRST so any plugin error during register
//      is enveloped.
//   3. @fastify/cookie — required by delete-account's clearCookie and
//      by Better Auth's session cookies.
//   4. zod-type-provider — must be in place before any route declares
//      a zod schema in `schema.body` / `schema.response`.
//   5. request-log — preserves x-openwhispr-source on every req.log
//      child (AUTH-06 / D-16).
//   6. rate-limit — BEFORE route registration so per-route
//      `config.rateLimit` overrides are honored at registration time.
//   7. Mount Better Auth: `app.all('/api/auth/*', ...)` — Better Auth
//      handles its own routes; everything not auth-prefixed is ours.
//   8. Register `dualAuthHook` as `onRequest` (routes opt out via
//      config.auth=false). This MUST come AFTER rate-limit but BEFORE
//      route registration so it sees route configs at preHandler time.
//      (Fastify resolves route-level config at registration; the hook
//      reads it via req.routeOptions at request time.)
//   9. Register Plan 03's routes via `allRoutes` from routes/index.ts.
//
// Dependencies for the routes (`db`, `auth`) are constructed inside
// `buildApp` from app-level singletons. For tests, callers can pass
// overrides via `BuildAppOptions` to avoid env-time side effects.
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { registerErrorHandler } from "./error-handler.js";
import { zodTypeProvider } from "./plugins/zod-type-provider.js";
import { requestLog } from "./plugins/request-log.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { buildDualAuthHook, type AuthLike } from "./middleware/dual-auth.js";
import { buildAllRoutes } from "./routes/index.js";
import { tenantPlugin } from "./middleware/tenant.js";
import type { TransactionalDb, ExecutableTx } from "@openwhispr/data";

export interface BuildAppOptions {
  /**
   * Phase 1 transactional database (PgBouncer-backed app role). Required
   * for the cookie-only routes (verification-status, delete-account)
   * and check-user. Tests inject fakes; production constructs from
   * `makeAppDb`.
   */
  db?: TransactionalDb<ExecutableTx>;
  /**
   * Better Auth instance. Tests inject fakes; production constructs
   * via `buildAuth({db, log})`.
   */
  auth?: AuthLike;
  /**
   * Disable per-process side effects when running under tests (e.g.
   * skip Valkey connection, skip Better Auth mount). Defaults to
   * `false`.
   */
  testMode?: boolean;
}

export const buildApp = async (
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> => {
  // 1. trustProxy:true — Pitfall #2.
  const app = Fastify({ logger: false, trustProxy: true });

  // 2. Centralized error handler FIRST so plugin errors during
  //    register get the envelope.
  registerErrorHandler(app);

  // 3. Cookie support (delete-account.clearCookie + Better Auth cookies).
  await app.register(fastifyCookie);

  // 4. zod schemas at validation + serialization compilers.
  await app.register(zodTypeProvider);

  // 5. x-openwhispr-source mirrored onto every req.log child (AUTH-06).
  await app.register(requestLog);

  // 6. Rate-limit BEFORE routes so per-route configs apply.
  await app.register(rateLimitPlugin);

  // 7. Phase 1 tenant middleware (D-19) — populates req.tenantId from
  //    the placeholder header until Plan 03's dual-auth hook supersedes
  //    it. Kept here for backward-compat with Phase 1 tests; Plan 03's
  //    middleware sets req.tenant (different field, same intent).
  await app.register(tenantPlugin);

  // If we have all the pieces (auth + db), wire the full route surface.
  // Otherwise (Phase 1-style smoke / first-launch dev), expose only the
  // health route which has no auth/db needs.
  if (opts.auth) {
    // 8. Dual-auth hook BEFORE routes.
    const dualAuthHook = buildDualAuthHook({ auth: opts.auth });
    app.addHook("onRequest", dualAuthHook);
  }

  // 9. Routes.
  if (opts.auth && opts.db) {
    const routes = buildAllRoutes({ auth: opts.auth, db: opts.db });
    for (const plugin of routes) {
      await app.register(plugin);
    }
  } else {
    // Minimal mode: only health route (no DB / auth dependency).
    const { default: healthRoutes } = await import("./routes/health.js");
    await app.register(healthRoutes);
  }

  await app.ready();
  return app;
};

/* v8 ignore start -- entry-point bootstrap; exercised in dev/prod, not in unit tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    // biome-ignore lint/suspicious/noConsole: server bootstrap fatal-error logger; structured logging arrives in Phase 6 (OBS-03)
    console.error(err);
    process.exit(1);
  });
}
/* v8 ignore stop */
