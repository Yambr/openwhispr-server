// SPDX-License-Identifier: FSL-1.1-ALv2
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

// Phase 14 / Plan 04 / Task 3 — BYOK boot guard. MUST run BEFORE the
// OTel SDK import side-effect below: a misconfigured OTLP endpoint
// would otherwise cause cascading dial noise on stderr before the
// fatal "byok.required" record reaches operators. Also runs BEFORE
// installGlobalSSRF() to avoid wasted setup on a process about to
// exit 1. The guard is a pure-function call that returns void on a
// satisfied env contract — happy path adds zero overhead.
//
// Phase 19 / Plan 02 (SR-19.3, D-09 + D-10): the library now THROWS
// `BYOKGuardError`; this entrypoint catches it, logs via a synchronous
// pino, and exits. The library's own pino.fatal record has already
// flushed to stderr by the time we re-enter the catch — the
// `process.boot` log here is supplementary context (cause-chain pino
// `{ err }`). Any non-BYOKGuardError is re-thrown.
import { assertBYOKConfig, BYOKGuardError } from "@openwhispr/byok-guard";
import { validateEncryptionBoot } from "@openwhispr/data";
import { makePino } from "@openwhispr/observability";
import pino from "pino";

try {
  assertBYOKConfig();
} catch (err) {
  if (err instanceof BYOKGuardError) {
    const bootLog = pino({ name: "api-boot" }, pino.destination({ sync: true, dest: 2 }));
    bootLog.fatal({ err }, "BYOK guard refused boot");
    process.exit(1);
  }
  throw err;
}

// Phase 33 / Plan 33-04 — encryption-config boot gate. Runs AFTER the
// BYOK guard (same loud-fail posture) and BEFORE the OTel SDK side-effect
// import so a missing/short MASTER_KEK or an unsupported
// OPENWHISPR_KEY_PROVIDER value exits with BSD EX_CONFIG (78) before any
// route registers. validateEncryptionBoot writes its own stderr line and
// calls process.exit(78) directly — no return on failure.
validateEncryptionBoot();

// Phase 51 / Plan 51-03 (REVIEW CR-1) — Better Auth secret boot gate.
// Better Auth 1.6.9 does NOT validate `secret` at construction; missing
// or short BETTER_AUTH_SECRET silently signs session tokens with
// `undefined`. Same EX_CONFIG (78) loud-fail posture as
// validateEncryptionBoot — operators get one consistent signal for any
// boot-time secret-config error.
import { validateBetterAuthSecretBoot } from "./lib/better-auth-secret-boot.js";

validateBetterAuthSecretBoot();

// Phase 57 / Track E (REVIEW api-routes-rest CRITICAL CR-01) — ingress
// origin boot gate. better-auth-handler.ts reconstructs the request URL
// Better Auth uses for CSRF / Origin / redirect-uri validation; without
// a configured INGRESS_BASE_URL / AUTH_URL the pre-fix code fell back to
// the attacker-controlled `req.headers.host` header. validateIngressBoot
// REFUSES to start (exit 78 EX_CONFIG) when both env vars are unset, so
// the route handler always has a trustworthy env-derived origin. Same
// loud-fail posture as validateEncryptionBoot / validateBetterAuthSecretBoot.
import { validateIngressBoot } from "./config/auth.js";

validateIngressBoot();

// Phase 57 / Track F (REVIEW api-core CRITICAL CR-01) — production
// safety-knob boot gate. OPENWHISPR_DISABLE_RATE_LIMIT /
// OPENWHISPR_DISABLE_EMAIL_VERIFICATION / OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE
// / MOCK_DIARIZATION disable anti-abuse / verification controls or swap in a
// mock backend. They are legitimate dev/test/load-test affordances but a
// single leaked env line in production silently disables core security
// controls. validateSafetyKnobsBoot REFUSES to start (exit 78 EX_CONFIG)
// when any knob is truthy under NODE_ENV=production — same loud-fail posture
// as validateEncryptionBoot / validateIngressBoot. The veto fires ONLY in
// production; non-production profiles keep the knobs functional.
import { validateSafetyKnobsBoot } from "./config/safety-knobs.js";

try {
  validateSafetyKnobsBoot();
} catch (err) {
  // biome-ignore lint/suspicious/noConsole: pre-logger boot path — stderr is the only sink.
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
  process.exit(78);
}

// Phase 6 / Plan 03 / Task 1 (D-T3 load order) — OTel SDK must start
// BEFORE any other import resolves so `@opentelemetry/instrumentation-pino`
// patches the `pino` module at require time. This import is intentionally
// a side-effect-only module (no symbols consumed here).
import "./otel-bootstrap.js";
// Phase 6 / Plan 06 (SCALE-04) — install the SSRF dispatcher as the
// global undici dispatcher BEFORE any outbound fetch can fire. Must run
// AFTER otel-bootstrap (so OTel undici-instrumentation sees the SSRF
// agent as the upstream) and BEFORE buildApp() and any route registers.
import { installGlobalSSRF } from "./bootstrap.js";

installGlobalSSRF();

import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
// Phase 51 / Plan 51-02 (REVIEW CR-10) — switched from the old
// `./lib/redact-url.js` (URL.password-only stub) to the canonical
// byok-guard implementation, which also masks JWTs, bearer-shape query
// values, and OAuth2 implicit-flow hash fragments. The legacy file was
// deleted in the same commit.
import { redactUrl } from "@openwhispr/byok-guard";
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import type { LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { registerErrorHandler } from "./error-handler.js";
import { i18nPlugin } from "./i18n/init.js";
import { type DepCheck, makeDepCheck } from "./lib/dep-check.js";
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
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { requestLog } from "./plugins/request-log.js";
import { servedByPlugin } from "./plugins/served-by.js";
import { zodTypeProvider } from "./plugins/zod-type-provider.js";
import { buildDebugFetchRoutes } from "./routes/__test/fetch.js";
import type { MintBearer } from "./routes/auth-callback.js";
import { buildAllRoutes } from "./routes/index.js";
import { markStartupComplete, registerProbes } from "./routes/probes.js";
import type { SetupAdminRenameTenant, SetupAdminSignUpEmail } from "./routes/setup-admin.js";

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
   * Phase 60 / Track A — optional pino logger fed into the Fastify
   * constructor. Production leaves this unset and `buildApp` defaults to
   * `makePino({ base: { service: "api" } })` so the canonical
   * REDACT_PATHS policy applies to every request/error record. The field
   * exists only as a test seam (mirrors the `destination` seam in
   * `request-log.ts:buildLogger`) so a unit test can inject
   * `makePino({ destination })` and capture serialized output. A bare
   * pino bypassing `makePino` is forbidden — the redact policy is not
   * optional.
   *
   * Typed as `FastifyBaseLogger` (which `makePino`'s `pino.Logger`
   * structurally satisfies) so the Fastify constructor keeps its default
   * logger generic — a narrower `pino.Logger` here makes Fastify infer a
   * non-default `FastifyInstance<..., Logger>` that breaks route-plugin
   * assignability under `exactOptionalPropertyTypes`.
   */
  logger?: FastifyBaseLogger;
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
  /**
   * Phase 6 / Plan 06-04 (OBS-05, D-P2): dep-check function for the
   * /readyz + /startupz probes. Production wires
   * `makeDepCheck({pg, valkey, litellmUrl})` from the same pg.Pool /
   * ioredis client / LiteLLM URL the rest of the app uses; tests inject
   * deterministic fakes (see routes/probes.test.ts).
   *
   * When omitted, /readyz returns 503 with `error:"depCheck not wired"`
   * — an operator-actionable signal distinct from a runtime dep outage.
   */
  depCheck?: DepCheck;
  /**
   * Plan 13-01 / Task 13-01-05 — optional migrations probe for the
   * /api/health `migrations_completed` field. Production wires
   * `count(*) FROM _meta.__drizzle_migrations > 0` against the existing
   * app pool returned by `makeAppDb()` (NO fresh pg.Client — the existing
   * pool is reused to avoid leaking PG connections under the kubelet
   * probe cadence). Tests inject fakes.
   */
  migrationsCheck?: () => Promise<boolean>;
  /**
   * Phase 55-05b / BUG-55-05-SETUP-ADMIN-ROUTE-UNWIRED — production
   * wiring for the first-run admin bootstrap route. When supplied,
   * `buildAllRoutes` registers POST /api/setup/admin (via the
   * `deps.setupAdmin` branch in routes/index.ts); when omitted, the
   * route is NOT registered and the wizard's submit step 404s. The
   * entrypoint constructs:
   *   - `ownerPool`: a `pg.Pool` bound to `DATABASE_URL_OWNER` (reuses
   *     the probe pool with `max≥2` so the singleton UPSERT + UPDATE
   *     do not starve the kubelet migrations probe).
   *   - `signUpEmail`: a thin adapter wrapping `auth.api.signUpEmail`
   *     that converts Better Auth's throw-on-error contract into the
   *     `{data, error}` envelope the route handler expects.
   *   - `renameTenant` (optional): defaults to the raw-SQL impl inside
   *     routes/setup-admin.ts; tests override to exercise the
   *     warnings-array branch.
   */
  setupAdmin?: {
    ownerPool: import("pg").Pool;
    signUpEmail: SetupAdminSignUpEmail;
    renameTenant?: SetupAdminRenameTenant;
  };
}

export const buildApp = async (opts: BuildAppOptions = {}): Promise<FastifyInstance> => {
  // 1. trustProxy:true — Pitfall #2.
  //    Phase 60 / Track A (Defect A): build Fastify with a real pino
  //    logger so every `req.log.{warn,info,error}` call site — incl.
  //    `error-handler.ts` "request error" on every 500 and the
  //    `request-log` plugin's `req.log.child({openwhisprSource})` — emits
  //    structured JSON. The logger goes through `makePino` so the
  //    canonical REDACT_PATHS policy scrubs secret-shaped fields; log
  //    level comes from `LOG_LEVEL` (read inside `makePino`), never
  //    `NODE_ENV`. `opts.logger` is a test-only injection seam.
  //    Fastify 5 accepts a pre-built logger instance under
  //    `loggerInstance` (the `logger` key is reserved for a pino *options*
  //    object); `makePino` returns an instance, so it goes here.
  const app = Fastify({
    loggerInstance: opts.logger ?? makePino({ base: { service: "api" } }),
    trustProxy: true,
  });

  // 2. Centralized error handler FIRST so plugin errors during
  //    register get the envelope.
  registerErrorHandler(app);

  // 2b. Phase 6 / Plan 06-04 (D-P3, SCALE-01) — `x-served-by` onSend hook.
  //     Registered EARLY so every response (including error envelopes
  //     emitted by registerErrorHandler) carries the replica tag. The
  //     horizontal-scale e2e (tests/e2e/horizontal-scale.test.ts, Plan
  //     06-12) asserts Traefik round-robin actually distributes across
  //     `--scale api=N` by reading this header.
  await app.register(servedByPlugin);

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

  // 5b. Phase 10 / Plan 10-01a — i18next middleware: attach `req.i18n`
  //     (and `req.language`) keyed off Accept-Language so the centralized
  //     error handler can emit localized envelopes. Registered AFTER
  //     requestLog (preserves the structured logger ordering) and BEFORE
  //     dual-auth / routes so error envelopes emitted from anywhere
  //     downstream (auth hook, route handlers, plugin errors) read a
  //     populated `req.i18n` at error-emission time.
  await app.register(i18nPlugin);

  // 6. Rate-limit BEFORE routes so per-route configs apply.
  // Phase 6 / Plan 06-09 / D-RL3 — when EITHER tier emits 429, fire a
  // best-effort `security.rate_limit_exceeded` audit row via the
  // injectable onRateLimitExceeded callback. Emission requires an
  // authenticated tenant context (req.tenant + req.user). Pre-auth
  // abuse traffic has neither — log warning + drop the audit fanout to
  // preserve forward progress. Wired here (not in the plugin) because
  // recordAudit needs the live DB tx + tenant resolution which only
  // buildApp owns.
  const rateLimitOpts: Parameters<typeof rateLimitPlugin>[1] = {};
  if (opts.db) {
    const dbForTx = opts.db as unknown as TransactionalDb<ExecutableTx>;
    rateLimitOpts.onRateLimitExceeded = async (req, rule, route) => {
      try {
        const tenantId = (req as { tenant?: string }).tenant;
        const user = (req as { user?: { id?: string } }).user;
        if (!tenantId) return;
        const { recordAudit, auditCtxFromRequest } = await import("./lib/audit.js");
        await dbForTx.transaction(async (tx: ExecutableTx) => {
          const ctx = auditCtxFromRequest(
            req as unknown as { id: string; ip: string; headers: Record<string, unknown> },
            tenantId,
            user?.id ?? null,
          );
          await recordAudit(tx, ctx, "security.rate_limit_exceeded", { rule, route });
        });
      } catch (err) {
        req.log.warn({ err, rule, route }, "rate-limit audit emission failed");
      }
    };
  }
  await app.register(rateLimitPlugin, rateLimitOpts);

  // 6b. Phase 6 / Plan 06-12b / SCALE-04 / T-ssrf — emit a
  //     `security.ssrf_blocked` audit row whenever the global SSRF
  //     dispatcher refuses an outbound connect.  The dispatcher's own
  //     `onBlock` callback runs at the undici-lookup layer (no request
  //     context, no DB handle, no tenant) and only writes a structured
  //     WARN line to stdout; the durable audit row must be written
  //     inside the request transaction so the row is tenant-scoped and
  //     correlated to `req.id`.
  //
  //     `onError` fires BEFORE `setErrorHandler` so the audit insert
  //     completes before the 502 envelope is emitted. Best-effort:
  //     unauthenticated pre-route abuse has no tenant context and is
  //     silently dropped (logged at warn). Mirrors the rate-limit audit
  //     emission posture above (D-RL3).
  if (opts.db) {
    const dbForSsrf = opts.db as unknown as TransactionalDb<ExecutableTx>;
    app.addHook("onError", async (req, _reply, err) => {
      // Plan 06-12e — same cause-chain walk as the error handler.
      // Node 24 `globalThis.fetch` wraps SSRFBlockedError as
      // `TypeError('fetch failed', { cause: <original> })`; without
      // unwrapping the hook silently drops the audit row.
      const { findSSRFBlockedError } = await import("./error-handler.js");
      const ssrfErr = findSSRFBlockedError(err);
      if (!ssrfErr) return;
      // Plan 06-12e — fall back to the default tenant when the request
      // has no authenticated tenant binding.  SSRF blocks are emitted
      // from BOTH authenticated routes (rare — most internal calls
      // target allow-listed hosts) AND unauthenticated/auth-bypass
      // paths (the /__test/fetch debug surface in NODE_ENV=test, plus
      // any pre-auth route that resolves a user-supplied URL).  We
      // refuse to silently drop the audit row when the dispatcher
      // refused egress; an unauthenticated SSRF attempt is exactly the
      // signal an operator needs to surface.  D-A1 still holds — the
      // row commits inside a real DB tx; only the tenant attribution
      // degrades to "default" when no session is present.
      const { resolveDefaultTenantId } = await import("./lib/default-tenant.js");
      let tenantId: string | undefined = (req as { tenant?: string }).tenant;
      if (!tenantId) {
        try {
          tenantId = await resolveDefaultTenantId();
        } catch {
          // No tenant context AND default tenant unresolvable — drop.
          return;
        }
      }
      const user = (req as { user?: { id?: string } }).user;
      try {
        const { recordAudit, auditCtxFromRequest } = await import("./lib/audit.js");
        await dbForSsrf.transaction(async (tx: ExecutableTx) => {
          const ctx = auditCtxFromRequest(
            req as unknown as { id: string; ip: string; headers: Record<string, unknown> },
            tenantId,
            user?.id ?? null,
          );
          await recordAudit(tx, ctx, "security.ssrf_blocked", {
            target_url_host: ssrfErr.host,
            rule: ssrfErr.rule,
          });
        });
      } catch (auditErr) {
        req.log.warn(
          { err: auditErr, ssrf_rule: ssrfErr.rule, ssrf_host: ssrfErr.host },
          "ssrf audit emission failed",
        );
      }
    });
  }

  // 7. (Phase 34 / CR-1 closure) The legacy `tenantPlugin` that read
  //    a client-controlled `x-tenant-id` header into `req.tenantId` was
  //    retired here. The authoritative tenant binding (`req.tenant`) is
  //    set by `dualAuthHook` from the resolved Better Auth session.
  //    See `.planning/phases/34-tenant-plugin-retirement/34-AUDIT.md`.

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
            // WR-05: tryPreviousTokenLib now resolves the user's email
            // via a follow-up SELECT. When the user row was deleted
            // mid-rotation (m.email === null), surface a sentinel that
            // is OBVIOUSLY synthetic ('<previous-token-no-email>') so
            // downstream consumers (audit logs, ledger metadata) fail
            // loud on accidental dependence — pre-fix this was a silent
            // empty string that silently propagated.
            return {
              user: {
                id: m.userId,
                email: m.email ?? "<previous-token-no-email>",
                tenantId: m.tenantId,
              },
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
        const oldBearer = extractBearer(req.headers.authorization);
        if (
          opts.db &&
          newBearer.length > 0 &&
          oldBearer &&
          newBearer !== oldBearer &&
          req.tenant &&
          req.user &&
          req.sessionId
        ) {
          try {
            // Phase 51 / Plan 51-13 (REVIEW api-core HIGH HI-01) —
            // header rewritten. recordPreviousToken now persists ONLY
            // a SHA-256 fingerprint of the old bearer (`previous_token_fp`
            // sidecar; the plaintext column was dropped in migration
            // 0020 / Phase 33 / Plan 33-05). The AUTH-04 5-minute
            // overlap CONTRACT is preserved across the three storage
            // shapes the project shipped (bytea-SHA256 → plaintext →
            // fingerprint-only).
            await recPrev(opts.db, req.tenant, req.sessionId, oldBearer);
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
      ...(opts.mockDiarization !== undefined ? { mockDiarization: opts.mockDiarization } : {}),
      // Phase 55-05b / BUG-55-05 — without this thread-through,
      // routes/index.ts gates POST /api/setup/admin on
      // `deps.setupAdmin` being truthy and silently drops the route.
      ...(opts.setupAdmin ? { setupAdmin: opts.setupAdmin } : {}),
    });
    for (const plugin of routes) {
      await app.register(plugin);
    }
  }

  // Phase 6 / Plan 06-04 (D-P1, OBS-05) — register the three kubelet-
  // canonical probe routes (/livez, /readyz, /startupz) + the back-compat
  // /api/health alias. Registered LAST so they exist in BOTH full-mode
  // (auth+db wired) AND minimal-mode (no auth/db) — minimal mode used to
  // mount `./routes/health.js`; that registration has been folded into
  // `registerProbes` so there's a single source-of-truth for the health
  // surface across the app's lifecycle.
  await registerProbes(app, {
    ...(opts.depCheck ? { depCheck: opts.depCheck } : {}),
    ...(opts.migrationsCheck ? { migrationsCheck: opts.migrationsCheck } : {}),
  });

  // Phase 6 / Plan 06-12b — debug-only outbound-fetch helper. Registered
  // ONLY when NODE_ENV === 'test' OR the explicit OPENWHISPR_TEST_ROUTES
  // gate is set (the non-production compose contract-test stack uses the
  // env flag). The plugin itself enforces the gate again at registration
  // (defense in depth — same pattern as apps/api/src/routes/test-only.ts).
  // Plan 51-25.
  //
  // HI-02 (Phase 62): `NODE_ENV !== "production"` is an absolute veto —
  // a misset OPENWHISPR_TEST_ROUTES=true copied into a production .env can
  // no longer mount this unauthenticated arbitrary-URL fetcher. Same veto
  // Phase 57 Track C applied to the /api/_test/* plugin gate.
  if (
    process.env.NODE_ENV !== "production" &&
    (process.env.NODE_ENV === "test" || process.env.OPENWHISPR_TEST_ROUTES === "true")
  ) {
    await app.register(buildDebugFetchRoutes());
  }

  await app.ready();

  // Phase 6 / Plan 06-04 (D-P1) — flip the /startupz response from 503
  // to 200 once Fastify has registered every plugin/route and (in
  // production) the entrypoint has run its first PG SELECT 1. The flag
  // is module-scope in routes/probes.ts; resetStartupComplete() is
  // available for test isolation.
  markStartupComplete();

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
  // Phase 51 / Plan 51-13b (REVIEW api-core HIGH HI-02) — boot pino.
  // Phase 6 has shipped `makePino()` with the canonical REDACT_PATHS
  // policy; replaces the historical `console.warn` calls (which carried
  // credential-bearing strings through unscrubbed stdout to Loki).
  const bootLog = makePino({ base: { name: "api-boot" } });
  // Phase 02.6 / D-01 — destructure the {db, pool} wrapper. Passing the
  // wrapper instead of the bare Drizzle instance was the root cause of
  // the Phase 02.5-04 contract-test failure (`TypeError: db.select is
  // not a function` inside @better-auth/drizzle-adapter findOne). The
  // prior `as never` casts hid the type mismatch from tsc; they are
  // removed here so a future wrapper-leak fails typecheck immediately.
  const { db, pool: appPool } = makeAppDb();
  // Phase 10 / Plan 10-01c — wire the BullMQ email-delivery queue so
  // Better Auth's sendVerificationEmail hook dispatches via the worker
  // (locale-aware templates from Plan 10-01b). Gated on VALKEY_URL: if
  // the operator has not configured Valkey/Redis, we leave
  // `enqueueEmail` undefined and `buildAuth` falls back to the inline
  // `email.send` path (backward compat for OSS quickstart). Connection
  // shape mirrors the diarization ioredis client below.
  let enqueueEmail: ((p: import("./auth.js").EmailDeliveryPayload) => Promise<void>) | undefined;
  if (process.env.VALKEY_URL) {
    try {
      const { Queue } = await import("bullmq");
      const url = new URL(process.env.VALKEY_URL);
      const queue = new Queue("email-delivery", {
        connection: {
          host: url.hostname,
          port: Number(url.port || 6379),
          ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
        },
      });
      enqueueEmail = async (payload) => {
        await queue.add("email-delivery", payload, {
          jobId: payload.request_id,
          attempts: 5,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: { age: 24 * 3600, count: 1_000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        });
      };
    } catch (err) {
      // Phase 13 review HI-02 / Plan 51-13b: NEVER log `err.message` —
      // both `new URL(...)` and ioredis/BullMQ embed the credential-
      // bearing URL into thrown error messages. We log the redacted URL
      // + error class name via pino (REDACT_PATHS scrubs any residual
      // secret-shape field). Phase 51 retired the console.warn path.
      bootLog.warn(
        {
          event: "bullmq.email_queue.unavailable",
          valkey_url: redactUrl(process.env.VALKEY_URL ?? ""),
          err_name: (err as Error).name,
        },
        "BullMQ email-delivery queue not constructed; verification emails fall back to inline SMTP",
      );
    }
  }
  // Phase 55-05b — capture the raw Better Auth instance separately so
  // the setup-admin signUpEmail adapter below can call
  // `auth.api.signUpEmail` without re-widening the AuthLike type (which
  // would either force a fresh `as unknown as` cast — LOCKER-02 cap —
  // or pollute the AuthLike interface with a signUpEmail field every
  // existing fake would need to stub).
  const authRaw = buildAuth(enqueueEmail ? { db, enqueueEmail } : { db });
  const auth = authRaw as unknown as AuthLike;
  // Phase 03 / Plan 04: construct the shared LiteLLM client when
  // LITELLM_MASTER_KEY is configured. Missing key -> log a one-line
  // warning and skip; transcribe/reason/diarization/realtime routes are
  // simply not registered (404 on unconfigured surfaces, not 503 — the
  // operator gets a clear "you forgot to set LITELLM_MASTER_KEY" signal
  // distinct from a per-provider 503 emitted from inside the route).
  // BUG-53-41-remaining (a) — production guard: refuse to boot when
  // NODE_ENV=production and LITELLM_MASTER_KEY is missing or set to
  // the well-known dev-tools overlay default. Without this guard the
  // catch arm below silently drops 4 routes (transcribe, reason,
  // diarization, realtime) while /api/health still returns ok. Mirror
  // of validateAuthBoot's EX_CONFIG exit-78 pattern.
  const { validateLitellmBoot } = await import("./config/litellm.js");
  validateLitellmBoot();
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
    // Phase 13 review HI-02 / Plan 51-13b: do NOT log `err.message` —
    // `loadLitellmConfigFromEnv` can embed LITELLM_BASE_URL (potentially
    // with embedded credentials). Pino + REDACT_PATHS scrubs residual
    // secret-shape fields.
    bootLog.warn(
      {
        event: "litellm.client.unavailable",
        litellm_base_url: redactUrl(process.env.LITELLM_BASE_URL ?? ""),
        err_name: (err as Error).name,
      },
      "LiteLLM client not constructed; LITELLM-backed routes (transcribe, reason, diarization, realtime) will not be registered",
    );
  }
  // Phase 03 / Plan 06 (CR-01) + e2e fix: construct the Valkey/Redis
  // client for the diarization idempotency cache. We use ioredis (same
  // library as apps/worker and required by @fastify/rate-limit's
  // RedisStore which calls `redis.defineCommand('rateLimit', ...)` for
  // an atomic Lua-script counter+TTL op — `@redis/client` does NOT
  // expose defineCommand, which crashed the api at boot when VALKEY_URL
  // was set). Single ioredis client serves both rate-limit and
  // diarization since both consume the same RedisLike subset (get/set
  // with EX/NX/PX flags). When VALKEY_URL is unset, leave `redis`
  // undefined — buildAllRoutes will skip /v1/audio/diarization
  // registration and operators get an operator-actionable 404 from
  // notFoundHandler (one-line warning below tells them exactly what to
  // set).
  let redis: RedisLike | undefined;
  if (process.env.VALKEY_URL) {
    try {
      const { Redis } = await import("ioredis");
      const url = process.env.VALKEY_URL;
      const client = new Redis(url, {
        maxRetriesPerRequest: null,
        lazyConnect: false,
      });
      redis = client as unknown as RedisLike;
    } catch (err) {
      // Phase 13 review HI-02 / Plan 51-13b: ioredis throws errors whose
      // `.message` embeds the offending URL verbatim. Pino path scrubs
      // any residual secret-shape via REDACT_PATHS.
      bootLog.warn(
        {
          event: "valkey.client.unavailable",
          valkey_url: redactUrl(process.env.VALKEY_URL ?? ""),
          err_name: (err as Error).name,
        },
        "Valkey client not constructed; /v1/audio/diarization will NOT be registered. Set VALKEY_URL to enable diarization",
      );
    }
  } else {
    bootLog.warn(
      { event: "valkey.url.unset" },
      "VALKEY_URL is unset; /v1/audio/diarization will NOT be registered (operator-actionable: set VALKEY_URL to enable bundled-mode diarization)",
    );
  }
  const mockDiarization = process.env.MOCK_DIARIZATION === "true";
  const buildOpts: BuildAppOptions = { db, auth };
  if (litellm) buildOpts.litellm = litellm;
  if (litellmMasterKey) buildOpts.litellmMasterKey = litellmMasterKey;
  if (redis) buildOpts.redis = redis;
  if (mockDiarization) buildOpts.mockDiarization = true;
  // Phase 6 / Plan 06-04 (OBS-05, D-P2) — wire the /readyz dep-check.
  // Reuses the same pg.Pool returned by makeAppDb and the ioredis client
  // already constructed for rate-limit/diarization. When either is
  // absent, /readyz returns 503 with `error:"depCheck not wired"` so
  // operators get an actionable signal.
  const litellmBaseUrl = process.env.LITELLM_BASE_URL ?? "http://litellm:4000";
  if (redis) {
    buildOpts.depCheck = makeDepCheck({
      pg: appPool,
      // The ioredis instance constructed above satisfies the dep-check
      // surface (ping()) — narrow the cast to the structural minimum.
      valkey: redis as unknown as import("ioredis").Redis,
      litellmUrl: litellmBaseUrl,
    });
  }
  // Plan 13-01 / Task 13-01-05 — wire the /api/health migrations_completed
  // probe. Queries the canonical drizzle table `_meta.__drizzle_migrations`
  // and reports count > 0.
  //
  // Phase 13 / Session 5 fix: the appPool runs as `openwhispr_app` which
  // does NOT have USAGE on the `_meta` schema (RLS isolation; the schema
  // is owner-only). Reusing the appPool here would silently return `false`
  // for ever. We construct a tiny dedicated owner pool (max=1, lazy) bound
  // to DATABASE_URL_OWNER and POOL it for the probe's lifetime. The pool
  // is closed at process exit via the existing shutdown hook below.
  //
  // Connection acquisition errors and missing-table errors both surface
  // as `false` (the migrations runner has not yet completed its first
  // apply); transient outages also surface as `false` so the harness never
  // falsely reports "ready" during a DB hiccup.
  const { Pool: PgPool } = await import("pg");
  const ownerUrl = process.env.DATABASE_URL_OWNER;
  // Phase 55-05b / BUG-55-05 — bumped max from 1 → 4 so the singleton
  // POST /api/setup/admin UPSERT + UPDATE path (one connection each)
  // does not starve the kubelet `migrations_completed` probe running
  // on the same pool. Setup-admin fires once per instance lifetime;
  // the upper bound is set defensively for the worst-case interleave
  // (probe + retry + admin UPSERT + tenant UPDATE).
  const probeOwnerPool = ownerUrl ? new PgPool({ connectionString: ownerUrl, max: 4 }) : undefined;
  buildOpts.migrationsCheck = async (): Promise<boolean> => {
    if (!probeOwnerPool) return false;
    try {
      const result = await probeOwnerPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM _meta.__drizzle_migrations",
      );
      const row = result.rows[0];
      if (!row) return false;
      const n = Number.parseInt(row.count, 10);
      return Number.isFinite(n) && n > 0;
    } catch {
      return false;
    }
  };
  // Phase 55-05b / BUG-55-05-SETUP-ADMIN-ROUTE-UNWIRED — wire the
  // first-run admin bootstrap route. Without this block, the wizard's
  // submit step POSTs to /api/setup/admin and gets a 404 envelope
  // because routes/index.ts only registers the handler when
  // `deps.setupAdmin` is supplied.
  //
  // Adapter: Better Auth's `auth.api.signUpEmail` throws an APIError
  // on failure and returns the user/session directly on success. The
  // route handler expects the `{data, error}` envelope shape
  // (SetupAdminSignUpResult); we convert the throw-on-error contract
  // into that envelope here so the handler's compensating-rollback
  // branch (UPDATE setup_state SET status='pending') fires correctly.
  //
  // Pool reuse: probeOwnerPool already runs as DATABASE_URL_OWNER (the
  // RLS-bypass role required for the raw-SQL writes against
  // users.role and tenants.name); see the inline rationale on the
  // probeOwnerPool definition above for the max:4 sizing.
  if (probeOwnerPool && auth) {
    const setupAdminSignUpEmail: SetupAdminSignUpEmail = async (call) => {
      try {
        // Better Auth's `signUpEmail` endpoint accepts `{body}` and
        // returns `{user, token, ...}` on success / throws APIError on
        // failure. We pin only the fields the route handler reads
        // (`user.id`, `user.email`) via a narrow return-shape type;
        // the `as` cast on the call result is single-step (NOT `as
        // unknown as`) because authRaw retains its full inferred type.
        const result = await authRaw.api.signUpEmail({ body: call.body });
        const user = (result as { user?: { id?: string; email?: string } }).user;
        if (!user?.id || !user.email) {
          return {
            data: null,
            error: { code: "SIGN_UP_NO_USER", message: "sign-up returned no user" },
          };
        }
        return {
          data: { user: { id: user.id, email: user.email } },
          error: null,
        };
      } catch (err) {
        const e = err as { body?: { code?: string; message?: string }; message?: string };
        const code = e.body?.code;
        return {
          data: null,
          error: {
            ...(code ? { code } : {}),
            message: e.body?.message ?? e.message ?? "admin sign-up failed",
          },
        };
      }
    };
    buildOpts.setupAdmin = {
      ownerPool: probeOwnerPool,
      signUpEmail: setupAdminSignUpEmail,
    };
  } else {
    bootLog.warn(
      {
        event: "setup_admin.wiring.skipped",
        has_owner_pool: Boolean(probeOwnerPool),
        has_auth: Boolean(auth),
      },
      "POST /api/setup/admin will NOT be registered (DATABASE_URL_OWNER unset or auth not constructed)",
    );
  }
  const app = await buildApp(buildOpts);
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    bootLog.fatal({ err }, "fastify listen failed; exiting");
    process.exit(1);
  });
}
/* v8 ignore stop */
