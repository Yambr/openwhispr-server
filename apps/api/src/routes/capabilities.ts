// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-02 / Task 3 — Authed GET /api/capabilities.
//
// Tenant-scoped capability discovery endpoint consumed by the desktop
// client + future Phase-14 BYOK UI. Phase 12 minimal payload
// (RESEARCH §5):
//
//   {
//     auth: { providers, emailVerification, setup: { status } },
//     features: { transcribe, agent, realtime },
//   }
//
// `auth.providers` and `auth.emailVerification` mirror the public
// `/api/auth/providers` shape so a single capabilities fetch covers
// both screens. `auth.setup.status` comes from the singleton
// `setup_state` row landed by Plan 12-01; the route treats a missing
// row as `pending` for defensive robustness (boot race).
//
// Feature gates are env-derived at request time:
//   * transcribe — LITELLM_MASTER_KEY present
//   * agent      — LITELLM_MASTER_KEY present (the agent stream uses LiteLLM)
//   * realtime   — LITELLM_MASTER_KEY AND OPENAI_API_KEY (realtime needs both)
//
// Cache-Control: `private, max-age=30` + weak ETag keyed on
// `(tenantId, env-hash, setup_status)` so:
//   * a config flip changes the ETag,
//   * the same tenant doing repeat fetches gets 304 fast paths,
//   * two tenants hitting the same env see DIFFERENT ETags.
//
// Auth: session required. `req.user` + `req.tenant` are stamped by the
// global dualAuthHook; we re-check here per the same defensive 401
// pattern used by usage.ts (T-12.02-02 mitigation).

import { createHash } from "node:crypto";
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "../errors.js";
import { type ConfiguredProvider, listConfiguredOidcProviders } from "../lib/oidc-providers.js";

export interface CapabilitiesDeps {
  db: TransactionalDb<ExecutableTx>;
  /** Optional env override for tests. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

interface EmailVerificationPosture {
  readonly required: boolean;
  readonly configured: boolean;
}

interface SetupPosture {
  readonly status: "pending" | "completed" | "skipped_legacy";
}

interface AuthSection {
  readonly providers: readonly ConfiguredProvider[];
  readonly emailVerification: EmailVerificationPosture;
  readonly setup: SetupPosture;
}

interface FeaturesSection {
  readonly transcribe: boolean;
  readonly agent: boolean;
  readonly realtime: boolean;
  /**
   * U65 — POST /api/embeddings is available. Gated on the LiteLLM proxy
   * (LITELLM_MASTER_KEY) AND an operator-configured embeddings model alias
   * (LITELLM_EMBEDDING_MODEL). The desktop client reads this flag first and
   * does NOT fall back to its local onnx worker when false.
   */
  readonly embeddings: boolean;
  /**
   * U65 — POST /api/rerank is available. Gated on LITELLM_MASTER_KEY AND an
   * operator-configured rerank model alias (LITELLM_RERANK_MODEL).
   */
  readonly rerank: boolean;
}

export interface CapabilitiesResponse {
  readonly auth: AuthSection;
  readonly features: FeaturesSection;
}

function deriveEmailVerification(env: NodeJS.ProcessEnv): EmailVerificationPosture {
  const required = env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION !== "1";
  const configured = typeof env.SMTP_HOST === "string" && env.SMTP_HOST.length > 0;
  return { required, configured };
}

function deriveFeatures(env: NodeJS.ProcessEnv): FeaturesSection {
  const hasLitellm =
    typeof env.LITELLM_MASTER_KEY === "string" && env.LITELLM_MASTER_KEY.length > 0;
  const hasOpenAI = typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.length > 0;
  // U65 — embeddings/rerank require the LiteLLM proxy AND the respective
  // operator-configured model alias. No model env → feature false (and the
  // route returns a clean 503; the client honors its no-fallback contract).
  const hasEmbeddingModel =
    typeof env.LITELLM_EMBEDDING_MODEL === "string" && env.LITELLM_EMBEDDING_MODEL.length > 0;
  const hasRerankModel =
    typeof env.LITELLM_RERANK_MODEL === "string" && env.LITELLM_RERANK_MODEL.length > 0;
  return {
    transcribe: hasLitellm,
    agent: hasLitellm,
    // Realtime requires the LiteLLM proxy AND an OpenAI key on the
    // upstream side (the realtime route mints OpenAI Realtime session
    // tokens). Either missing → feature is unavailable.
    realtime: hasLitellm && hasOpenAI,
    embeddings: hasLitellm && hasEmbeddingModel,
    rerank: hasLitellm && hasRerankModel,
  };
}

/**
 * Compute a stable env hash from the env keys that influence the
 * capabilities payload. NOT a cryptographic boundary — just an ETag
 * input. Hash inputs are the same values used to derive
 * `providers`/`emailVerification`/`features` so a flip of any of them
 * rotates the ETag.
 */
function envHash(env: NodeJS.ProcessEnv): string {
  const keys = [
    "OIDC_ISSUER_URL",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "OPENWHISPR_DISABLE_EMAIL_VERIFICATION",
    "SMTP_HOST",
    "LITELLM_MASTER_KEY",
    "OPENAI_API_KEY",
    // U65 — rotate the ETag when the embeddings/rerank model envs flip so a
    // cached client re-fetches the new capability flag.
    "LITELLM_EMBEDDING_MODEL",
    "LITELLM_RERANK_MODEL",
  ];
  const composite = keys.map((k) => `${k}=${env[k] ?? ""}`).join("\n");
  return createHash("sha256").update(composite).digest("hex").slice(0, 16);
}

function computeEtag(tenantId: string, envH: string, setupStatus: string): string {
  const hash = createHash("sha256")
    .update(`${tenantId}\n${envH}\n${setupStatus}`)
    .digest("hex")
    .slice(0, 16);
  return `W/"${hash}"`;
}

interface SetupStateRow {
  status: "pending" | "completed" | "skipped_legacy" | null;
}

async function readSetupStatus(
  db: TransactionalDb<ExecutableTx>,
): Promise<"pending" | "completed" | "skipped_legacy"> {
  let status: "pending" | "completed" | "skipped_legacy" = "pending";
  await db.transaction(async (tx) => {
    const result = (await tx.execute(sql`SELECT status FROM setup_state WHERE id = 1`)) as {
      rows?: SetupStateRow[];
    };
    const row = result.rows?.[0];
    if (row && row.status) {
      status = row.status;
    }
  });
  return status;
}

export const buildCapabilitiesRoutes = (deps: CapabilitiesDeps) =>
  async function capabilitiesRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/capabilities",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        // T-12.02-02 mitigation — defensive 401 (dualAuthHook should
        // have already rejected anonymous traffic).
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        const env = deps.env ?? process.env;
        const setupStatus = await readSetupStatus(deps.db);
        const body: CapabilitiesResponse = {
          auth: {
            providers: listConfiguredOidcProviders(env),
            emailVerification: deriveEmailVerification(env),
            setup: { status: setupStatus },
          },
          features: deriveFeatures(env),
        };

        const tenantId = req.tenant;
        const envH = envHash(env);
        const etag = computeEtag(tenantId, envH, setupStatus);

        const inm = req.headers["if-none-match"];
        if (typeof inm === "string" && inm === etag) {
          return reply
            .header("etag", etag)
            .header("cache-control", "private, max-age=30")
            .code(304)
            .send();
        }

        return reply
          .header("etag", etag)
          .header("cache-control", "private, max-age=30")
          .code(200)
          .send(body);
      },
    });
  };

export default buildCapabilitiesRoutes;
