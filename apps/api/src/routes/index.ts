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

import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import type { LitellmClient } from "@openwhispr/litellm-client";
import type { FastifyInstance } from "fastify";
import type { RedisLike } from "../lib/idempotency-cache.js";
import type { AuthLike } from "../middleware/dual-auth.js";
import {
  type AgentStreamDeps,
  buildAgentStreamRoutes,
} from "./agent/stream.js";
import { buildWebSearchRoutes, type WebSearchDeps } from "./agent/web-search.js";
import {
  type AuthCallbackDeps,
  buildAuthCallbackRoutes,
  type MintBearer,
} from "./auth-callback.js";
import { type BetterAuthHandlerDeps, buildBetterAuthHandlerRoutes } from "./better-auth-handler.js";
import { buildCheckUserRoutes, type CheckUserDeps } from "./check-user.js";
import { buildDeleteAccountRoutes, type DeleteAccountDeps } from "./delete-account.js";
import { buildDesktopSigninRoutes, type DesktopSigninDeps } from "./desktop-signin.js";
import { buildDiarizationRoutes, type DiarizationDeps } from "./diarization.js";
import healthRoutes from "./health.js";
import { buildReasonRoutes, type ReasonDeps } from "./reason.js";
import { buildRealtimeRoutes, type RealtimeDeps } from "./realtime.js";
import {
  buildNoteRecordingConfigRoutes,
  type NoteRecordingConfigDeps,
} from "./note-recording-config.js";
import { buildSttConfigRoutes, type SttConfigDeps } from "./stt-config.js";
import {
  buildStreamingUsageRoutes,
  type StreamingUsageDeps,
} from "./streaming-usage.js";
import { buildUsageRoutes, type UsageDeps } from "./usage.js";
import { buildTestOnlyRoutes } from "./test-only.js";
import { buildAssemblyAITokenRoutes } from "./tokens/assemblyai.js";
import { buildDeepgramTokenRoutes } from "./tokens/deepgram.js";
import { buildOpenAIRealtimeTokenRoutes } from "./tokens/openai-realtime.js";
import { buildTranscribeRoutes, type TranscribeDeps } from "./transcribe.js";
import {
  buildVerificationStatusRoutes,
  type VerificationStatusDeps,
} from "./verification-status.js";

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
  /**
   * Phase 03 / Plan 04+: present when LITELLM_MASTER_KEY is configured at
   * buildApp() time. Routes that require LiteLLM (transcribe, reason,
   * diarization, realtime token) are conditionally registered. When
   * absent, those routes are NOT registered — operators get a 404 on
   * unconfigured surfaces, which the centralized notFoundHandler maps to
   * the canonical envelope. The 404 (not 503) is intentional — it tells
   * the operator the route was never wired, distinct from a runtime
   * config error (missing GROQ_API_KEY for whisper-large-v3 etc, which
   * surfaces as 503 from inside the route).
   */
  litellm?: LitellmClient;
  /**
   * Phase 03 / Plan 07 (LITELLM-03, D-04): the LITELLM_MASTER_KEY string
   * that the WSS /v1/realtime reverse-proxy injects on upstream-bound
   * upgrade headers (replacing the desktop's opaque bearer). Production
   * loads this from `loadLitellmConfigFromEnv().masterKey` alongside the
   * client itself; tests inject a synthetic key without env mutation.
   * The realtime route is registered only when BOTH `litellm` AND
   * `litellmMasterKey` are supplied — missing key at boot leaves the
   * /v1/realtime surface unwired (centralized notFoundHandler emits the
   * canonical 404 envelope, distinct from a registered-but-dead 503).
   */
  litellmMasterKey?: string;
  /**
   * Phase 03 / Plan 06 (D-07 REVISED): Valkey client for the diarization
   * route's Stripe-style idempotency cache. When supplied (production
   * wires the same client used by the rate-limit plugin), the
   * /v1/audio/diarization route is registered. When omitted, the route
   * is NOT registered and the centralized notFoundHandler emits the
   * canonical 404 envelope (operator must wire VALKEY_URL to enable
   * diarization in bundled mode).
   */
  redis?: RedisLike;
  /**
   * Phase 03 / Plan 06 (D-07 REVISED): MOCK_DIARIZATION=true short-
   * circuits the diarization route to a fixture response. Set in the
   * contract-test profile so `make contract-test` runs hermetically
   * (no pyannote.ai dependency in CI). Production .env MUST NOT set
   * this — bootstrap.sh deny-list refuses placeholder values.
   */
  mockDiarization?: boolean;
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
    // Phase 04 / Plan 06 — three streaming-token mint routes (D-13: each
    // calls its provider HTTP API directly via undici, NOT via LiteLLM, so
    // they register UNCONDITIONALLY regardless of whether deps.litellm is
    // present). Missing per-provider keys are gated inside the route's
    // preHandler (D-18 missing-key 503 envelope); operators get a clear
    // "<Provider> not configured (set <ENV_VAR_NAME> in .env)" signal at
    // request time.
    buildAssemblyAITokenRoutes(),
    buildDeepgramTokenRoutes(),
    buildOpenAIRealtimeTokenRoutes(),
    // Phase 05 / Plan 02 — WIRE-09 + WIRE-10. Both routes are registered
    // UNCONDITIONALLY (do not gate on litellm presence) because their
    // contract is database-only: idempotent ledger insert + SUM aggregator.
    // The desktop client calls them on every streaming-STT session and
    // periodically polls /api/usage; conditional registration would break
    // wire shape for operators who deploy without LITELLM_MASTER_KEY.
    buildStreamingUsageRoutes({ db: deps.db } satisfies StreamingUsageDeps),
    buildUsageRoutes({ db: deps.db } satisfies UsageDeps),
    // Phase 05 / Plan 04 — WIRE-11 GET /api/stt-config + WIRE-12 GET
    // /api/note-recording-config. Both register UNCONDITIONALLY (Pitfall
    // #6) because they are DB-only: read tenant_settings + user_settings
    // (FORCE-RLS), fall through to env defaults per D-18. Resolution
    // chain is user_settings -> tenant_settings -> process.env.
    // availableProviders on /api/stt-config is computed at request time
    // from per-provider env keys (D-19), NEVER read from JSONB.
    buildSttConfigRoutes({ db: deps.db } satisfies SttConfigDeps),
    buildNoteRecordingConfigRoutes({
      db: deps.db,
    } satisfies NoteRecordingConfigDeps),
    // Phase 05 / Plan 03 — WIRE-08 POST /api/agent/web-search. Registers
    // UNCONDITIONALLY (Pitfall #6): even when no provider key is wired,
    // the route exists and surfaces a 503 missing-key envelope so the
    // CONTRACT-01 negative matrix can enumerate it. Provider selection
    // honors WEB_SEARCH_PROVIDER at boot via resolveWebSearchProvider()
    // (D-02 boot-fatal on unknown value).
    buildWebSearchRoutes({ db: deps.db } satisfies WebSearchDeps),
  ];
  // Phase 03 / Plan 04: conditionally register the transcribe route only
  // when a LiteLLM client was constructed (LITELLM_MASTER_KEY present).
  // Plans 05/06/07 follow the same pattern as they land.
  if (deps.litellm) {
    const transcribeDeps: TranscribeDeps = { db: deps.db, litellm: deps.litellm };
    plugins.push(buildTranscribeRoutes(transcribeDeps));
    // Phase 04 / Plan 06 — POST /api/agent/stream forwards to LiteLLM
    // /v1/chat/completions, so it shares the same litellm-presence gate as
    // transcribe/reason. Without litellm the route is NOT registered and
    // /api/agent/stream surfaces the canonical 404 envelope (operator-
    // actionable: "you forgot to wire LITELLM_MASTER_KEY").
    const agentStreamDeps: AgentStreamDeps = {
      db: deps.db,
      litellm: deps.litellm,
    };
    plugins.push(buildAgentStreamRoutes(agentStreamDeps));
    // Phase 03 / Plan 05 — POST /api/reason mirrors the transcribe wiring
    // template (Plan 04 Pattern 1). Same conditional gate: skipped when
    // LITELLM_MASTER_KEY is unset at boot, registered when the shared
    // client is constructed.
    const reasonDeps: ReasonDeps = { db: deps.db, litellm: deps.litellm };
    plugins.push(buildReasonRoutes(reasonDeps));
    // Phase 03 / Plan 07 (LITELLM-03, D-04): WSS /v1/realtime reverse-
    // proxy. Registered only when LITELLM_MASTER_KEY was loadable at
    // boot (its absence is the canonical "operator hasn't wired
    // realtime yet" signal — the centralized notFoundHandler emits a
    // 404 envelope on /v1/realtime which is the right operator UX,
    // distinct from a transient-looking 503 on a registered-but-dead
    // route). The same master-key string is injected on upstream-bound
    // upgrade headers (`authorization: Bearer ${masterKey}`) so the
    // desktop's opaque bearer never reaches LiteLLM.
    if (deps.litellmMasterKey) {
      const realtimeDeps: RealtimeDeps = {
        litellm: deps.litellm,
        masterKey: deps.litellmMasterKey,
      };
      plugins.push(buildRealtimeRoutes(realtimeDeps));
    }
  }
  // Phase 03 / Plan 06 (D-07 REVISED): conditionally register the
  // diarization route. Bundled-mode requires a Valkey client (idempotency
  // cache backing) — when omitted, the route is NOT registered and the
  // notFoundHandler emits the canonical 404 envelope. PYANNOTE_API_KEY is
  // consumed inside the route at request time (NOT at registration), so a
  // missing key surfaces as 503 (Pitfall #8 — never 401 to the desktop)
  // only when the route is actually invoked.
  if (deps.redis) {
    const diarizationDeps: DiarizationDeps = {
      redis: deps.redis,
      mockMode:
        deps.mockDiarization === true ||
        process.env.MOCK_DIARIZATION === "true",
    };
    plugins.push(buildDiarizationRoutes(diarizationDeps));
  }
  // Plan 08: register the /api/_test/* surface when explicitly enabled
  // OR when running under NODE_ENV='test'. The plugin itself enforces
  // the gate as well — defense in depth.
  //
  // Phase 02.21 / Residual C — also accept the `OPENWHISPR_TEST_ROUTES`
  // env opt-in so the compose contract-test stack (running with
  // NODE_ENV=production for deploy-posture parity) can still expose
  // /api/_test/force-rotate + /api/_test/health-authed for the AUTH-04
  // token-rotation contract test. PRODUCTION OPERATORS MUST NOT set
  // this var to "true" — it exposes a session-rotation shortcut.
  if (
    deps.testOnly === true ||
    process.env.NODE_ENV === "test" ||
    process.env.OPENWHISPR_TEST_ROUTES === "true"
  ) {
    plugins.push(
      buildTestOnlyRoutes({
        db: deps.db,
        auth: deps.auth,
        // Phase 03 / Plan 10 — when litellm is wired, expose the
        // /api/_test/litellm-baseurl introspection seam so the contract
        // suite can prove PROVIDER-01 (env override → all routes follow).
        ...(deps.litellm ? { litellm: deps.litellm } : {}),
      }),
    );
  }
  return plugins;
}

export {
  buildAgentStreamRoutes,
  buildAssemblyAITokenRoutes,
  buildAuthCallbackRoutes,
  buildBetterAuthHandlerRoutes,
  buildCheckUserRoutes,
  buildDeepgramTokenRoutes,
  buildDeleteAccountRoutes,
  buildDesktopSigninRoutes,
  buildDiarizationRoutes,
  buildNoteRecordingConfigRoutes,
  buildOpenAIRealtimeTokenRoutes,
  buildReasonRoutes,
  buildRealtimeRoutes,
  buildSttConfigRoutes,
  buildStreamingUsageRoutes,
  buildTestOnlyRoutes,
  buildTranscribeRoutes,
  buildUsageRoutes,
  buildVerificationStatusRoutes,
  buildWebSearchRoutes,
  healthRoutes,
};
