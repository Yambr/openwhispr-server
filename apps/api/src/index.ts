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
// Plan 08 closes the residual integration gaps from 02-VERIFICATION.md:
//   * mintBearer adapter plumbed to buildAllRoutes (Gap 1).
//   * tryPreviousToken passed to buildDualAuthHook (Gap 2a).
//   * recordPreviousToken hooked via Fastify `onSend` whenever a route
//     emits a `set-auth-token` response header (Gap 2b).
//   * Production entrypoint constructs `auth` + `db` so a real `node
//     dist/index.js` boot wires the full route surface (no minimal-mode
//     residue).
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
//   8b. Plan 08: register the recordPreviousToken onSend hook AFTER the
//      dual-auth hook so req.user / req.tenant / req.sessionId are
//      populated by the time it fires.
//   9. Register Plan 03's routes via `allRoutes` from routes/index.ts.

import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import type { LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { registerErrorHandler } from "./error-handler.js";
import type { RedisLike } from "./lib/idempotency-cache.js";
import { buildMintBearer } from "./lib/mint-bearer.js";
import {
  recordPreviousToken as recordPreviousTokenLib,
  tryPreviousToken as tryPreviousTokenLib,
} from "./lib/token-rotation.js";
import {
  type AuthLike,
  buildDualAuthHook,
  extractBearer,
  type TryPreviousToken,
} from "./middleware/dual-auth.js";
import { tenantPlugin } from "./middleware/tenant.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { requestLog } from "./plugins/request-log.js";
import { zodTypeProvider } from "./plugins/zod-type-provider.js";
import type { MintBearer } from "./routes/auth-callback.js";
import { buildAllRoutes } from "./routes/index.js";

/** Signature of the recordPreviousToken library function (for tests). */
type RecordPreviousToken = typeof recordPreviousTokenLib;

/**
 * @fastify/multipart options used at buildApp level (HIGH-4).
 *
 * Exported so multipart-registered.test.ts can assert against the exact
 * shape AND so future Wave-2 plans (transcribe / diarization) can read
 * the canonical values rather than re-deriving them. Mutating this
 * object MUST stay in sync with the wire-contract docs.
 */
export const MULTIPART_OPTIONS = {
  attachFieldsToBody: false as const,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB hard cap
} as const;

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
  /**
   * Plan 08: production wires `buildMintBearer({auth, db})`; tests can
   * inject a deterministic fake to avoid Better Auth round-trips.
   */
  mintBearer?: MintBearer;
  /**
   * Plan 08: production wires `(t) => tryPreviousTokenLib(db, t)`;
   * tests inject fakes that return a synthetic match without DB.
   */
  tryPreviousToken?: TryPreviousToken;
  /**
   * Plan 08: production wires the SECURITY-DEFINER-backed library
   * function; tests inject a spy to assert call shape.
   */
  recordPreviousToken?: RecordPreviousToken;
  /**
   * Phase 03 / Plan 04+: when supplied, the build registers the LiteLLM-
   * backed routes (transcribe today; reason/diarization/realtime as
   * Plans 05/06/07 land). Production constructs via
   * `buildLitellmClient(loadLitellmConfigFromEnv())` and passes it
   * through; tests inject fakes that satisfy the LitellmClient surface.
   */
  litellm?: LitellmClient;
  /**
   * Phase 03 / Plan 07 (LITELLM-03, D-04): the LITELLM_MASTER_KEY string
   * the WSS /v1/realtime reverse-proxy injects on upstream-bound upgrade
   * headers. Production passes the same key that fed
   * `buildLitellmClient(loadLitellmConfigFromEnv())`; tests inject a
   * synthetic value without env mutation. When omitted (e.g. an operator
   * who hasn't set LITELLM_MASTER_KEY) the realtime route is NOT
   * registered and /v1/realtime returns 404.
   */
  litellmMasterKey?: string;
  /**
   * Phase 03 / Plan 06 (CR-01): pre-connected Valkey/Redis client used by
   * the diarization route's Stripe-style idempotency cache (and potentially
   * other request-time caches in future plans). Production constructs a
   * @redis/client `createClient({url: VALKEY_URL})` in the entrypoint and
   * passes it through; tests inject a fake `RedisLike`. When omitted, the
   * /v1/audio/diarization route is NOT registered — operators get the
   * canonical 404 envelope from notFoundHandler (operator-actionable
   * "wire VALKEY_URL" signal, distinct from a runtime 503).
   */
  redis?: RedisLike;
  /**
   * Phase 03 / Plan 06: short-circuit the diarization route to a fixture
   * response (no pyannote.ai dependency). Used by the contract-test
   * profile so `make contract-test` runs hermetically. Production .env
   * MUST NOT enable this (bootstrap.sh deny-list refuses placeholder
   * values in real deploys).
   */
  mockDiarization?: boolean;
}

export const buildApp = async (opts: BuildAppOptions = {}): Promise<FastifyInstance> => {
  // 1. trustProxy:true — Pitfall #2.
  const app = Fastify({ logger: false, trustProxy: true });

  // 2. Centralized error handler FIRST so plugin errors during
  //    register get the envelope.
  registerErrorHandler(app);

  // 3. Cookie support (delete-account.clearCookie + Better Auth cookies).
  await app.register(fastifyCookie);

  // 3b. HIGH-4 (Plan 03 Task 2 / Wave 1): register @fastify/multipart ONCE
  //     at buildApp level. Both Plan 04 (/api/transcribe) and Plan 06
  //     (/api/diarization) consume multipart streaming — registering here
  //     in Wave 1 (single sibling owns the shared edit) avoids the
  //     Wave-2 cross-plan edit collision on this file.
  //
  //     attachFieldsToBody:false is REQUIRED — routes forward req.raw
  //     (or the AsyncIterable parts() iterator) directly to LiteLLM via
  //     undici without buffering (RESEARCH Pitfall #5: avoid buffering
  //     large audio uploads into Node memory at SCALE-01 1000 concurrent).
  //
  //     100MB hard cap mirrors the desktop client's largest expected
  //     transcription payload; LiteLLM upstream enforces its own cap.
  await app.register(fastifyMultipart, MULTIPART_OPTIONS);

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
    //    Plan 08: bind tryPreviousToken so the AUTH-04 5-minute overlap
    //    window is active in the deployed binary.
    const tryPrev: TryPreviousToken | undefined =
      opts.tryPreviousToken ??
      (opts.db
        ? async (bearer: string) => {
            const m = await tryPreviousTokenLib(
              opts.db as unknown as { execute(q: unknown): Promise<unknown> },
              bearer,
            );
            if (!m) return null;
            return {
              user: { id: m.userId, email: "", tenantId: m.tenantId },
              tenantId: m.tenantId,
            };
          }
        : undefined);
    const dualAuthHook = buildDualAuthHook(
      tryPrev ? { auth: opts.auth, tryPreviousToken: tryPrev } : { auth: opts.auth },
    );
    app.addHook("onRequest", dualAuthHook);

    // 8b. Plan 08: when a route emits `set-auth-token` (Better Auth
    //     rotation OR /api/_test/force-rotate), record the OLD token's
    //     hash on the matching session row so subsequent OLD-token
    //     requests are admitted via tryPreviousToken for 5 minutes.
    if (opts.db) {
      const recPrev: RecordPreviousToken = opts.recordPreviousToken ?? recordPreviousTokenLib;
      app.addHook("onSend", async (req, reply, _payload) => {
        const newBearerHeader = reply.getHeader("set-auth-token");
        const newBearer =
          typeof newBearerHeader === "string"
            ? newBearerHeader
            : Array.isArray(newBearerHeader)
              ? String(newBearerHeader[0] ?? "")
              : "";
        const oldBearer = extractBearer(req.headers["authorization"]);
        if (
          newBearer.length > 0 &&
          oldBearer &&
          newBearer !== oldBearer &&
          req.tenant &&
          req.user &&
          req.sessionId
        ) {
          try {
            // Phase 02.12 — store the old bearer plain-text (no hashing).
            // The AUTH-04 5-minute overlap CONTRACT is preserved; only
            // the storage representation flipped from bytea(SHA-256) to text.
            await recPrev(opts.db!, req.tenant, req.sessionId, oldBearer);
          } catch (err) {
            req.log?.warn?.({ err }, "recordPreviousToken failed (Plan 08 onSend hook)");
          }
        }
      });
    }
  }

  // 9. Routes.
  if (opts.auth && opts.db) {
    const mintBearer: MintBearer =
      opts.mintBearer ?? buildMintBearer({ auth: opts.auth as never, db: opts.db });
    const routes = buildAllRoutes({
      auth: opts.auth,
      db: opts.db,
      mintBearer,
      ...(opts.litellm ? { litellm: opts.litellm } : {}),
      ...(opts.litellmMasterKey ? { litellmMasterKey: opts.litellmMasterKey } : {}),
      // Phase 03 / Plan 06 (CR-01): forward the Valkey client + the
      // mockDiarization flag so /v1/audio/diarization is registered when
      // the operator wired VALKEY_URL at boot. Without this thread-through,
      // buildAllRoutes (which gates the route on `deps.redis`) silently
      // dropped the route in every prod boot.
      ...(opts.redis ? { redis: opts.redis } : {}),
      ...(opts.mockDiarization !== undefined
        ? { mockDiarization: opts.mockDiarization }
        : {}),
    });
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
  // Plan 08: production entrypoint constructs the real auth + db so the
  // deployed binary wires the full route surface (mintBearer,
  // tryPreviousToken, recordPreviousToken). Closes the residual
  // "minimal mode" gap from 02-VERIFICATION.md.
  const { makeAppDb } = await import("@openwhispr/data/client");
  const { buildAuth } = await import("./auth.js");
  // Phase 02.6 / D-01 — destructure the {db, pool} wrapper. Passing the
  // wrapper instead of the bare Drizzle instance was the root cause of
  // the Phase 02.5-04 contract-test failure (`TypeError: db.select is
  // not a function` inside @better-auth/drizzle-adapter findOne). The
  // prior `as never` casts hid the type mismatch from tsc; they are
  // removed here so a future wrapper-leak fails typecheck immediately.
  const { db } = makeAppDb();
  const auth = buildAuth({ db }) as unknown as AuthLike;
  // Phase 03 / Plan 04: construct the shared LiteLLM client when
  // LITELLM_MASTER_KEY is configured. Missing key -> log a one-line
  // warning and skip; transcribe/reason/diarization/realtime routes are
  // simply not registered (404 on unconfigured surfaces, not 503 — the
  // operator gets a clear "you forgot to set LITELLM_MASTER_KEY" signal
  // distinct from a per-provider 503 emitted from inside the route).
  let litellm: LitellmClient | undefined;
  let litellmMasterKey: string | undefined;
  try {
    const { buildLitellmClient, loadLitellmConfigFromEnv } = await import(
      "@openwhispr/litellm-client"
    );
    const litellmConfig = loadLitellmConfigFromEnv();
    litellm = buildLitellmClient(litellmConfig);
    // Plan 07 — surface masterKey separately so buildAllRoutes can pass
    // it into the WSS /v1/realtime reverse-proxy's wsClientOptions
    // header rewrite. Same source-of-truth as the client construction
    // above, so they can never drift out of sync at boot.
    litellmMasterKey = litellmConfig.masterKey;
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: server bootstrap warning; structured logging arrives in Phase 6
    console.warn(
      "[buildApp] LiteLLM client not constructed; LITELLM-backed routes (transcribe, reason, diarization, realtime) will not be registered:",
      (err as Error).message,
    );
  }
  // Phase 03 / Plan 06 (CR-01): construct the Valkey/Redis client for the
  // diarization idempotency cache. We use the same `@redis/client` family
  // already pulled in by apps/api/src/plugins/rate-limit.ts so the runtime
  // dependency surface stays single-vendor. When VALKEY_URL is unset, leave
  // `redis` undefined — buildAllRoutes will skip /v1/audio/diarization
  // registration and operators get an operator-actionable 404 from
  // notFoundHandler (one-line warning below tells them exactly what to set).
  let redis: RedisLike | undefined;
  if (process.env.VALKEY_URL) {
    try {
      const { createClient } = await import("@redis/client");
      const clientOpts: { url: string; password?: string } = {
        url: process.env.VALKEY_URL,
      };
      if (process.env.VALKEY_PASSWORD) {
        clientOpts.password = process.env.VALKEY_PASSWORD;
      }
      const client = createClient(clientOpts);
      await client.connect();
      redis = client as unknown as RedisLike;
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: server bootstrap warning; structured logging arrives in Phase 6
      console.warn(
        "[buildApp] Valkey client not constructed; /v1/audio/diarization will NOT be registered. Set VALKEY_URL to enable diarization:",
        (err as Error).message,
      );
    }
  } else {
    // biome-ignore lint/suspicious/noConsole: server bootstrap warning; structured logging arrives in Phase 6
    console.warn(
      "[buildApp] VALKEY_URL is unset; /v1/audio/diarization will NOT be registered (operator-actionable: set VALKEY_URL to enable bundled-mode diarization).",
    );
  }
  const mockDiarization = process.env.MOCK_DIARIZATION === "true";
  const buildOpts: BuildAppOptions = { db, auth };
  if (litellm) buildOpts.litellm = litellm;
  if (litellmMasterKey) buildOpts.litellmMasterKey = litellmMasterKey;
  if (redis) buildOpts.redis = redis;
  if (mockDiarization) buildOpts.mockDiarization = true;
  const app = await buildApp(buildOpts);
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    // biome-ignore lint/suspicious/noConsole: server bootstrap fatal-error logger; structured logging arrives in Phase 6 (OBS-03)
    console.error(err);
    process.exit(1);
  });
}
/* v8 ignore stop */
