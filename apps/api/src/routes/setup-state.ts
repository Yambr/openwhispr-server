// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-02 / Task 5 — Public GET /api/setup-state.
//
// Boolean-shaped status endpoint consumed by the unauthenticated
// `/setup` RSC page (Plan 12-03). `/api/capabilities` is session-
// required (D-07), but the wizard renders BEFORE any admin user exists,
// so a separate public endpoint is required (RESEARCH §15(a) endorses
// this trade — the disclosure is the same bit `/api/auth/providers`
// already implies via `providers.length` + Better Auth's public sign-up
// route shape).
//
// Response body shape: EXACTLY `{ status: 'pending' | 'completed' |
// 'skipped_legacy' }`. T-12.02-05 mitigation: Object.keys(body) ===
// ['status']. No tenant id, no email, no env-derived fields, no
// timestamps. The wizard MUST always see fresh status (a stale
// `pending` after a successful POST would re-render an already-claimed
// wizard), so the handler emits `Cache-Control: no-store` and NO ETag.
//
// Rate-limit: `{max:30, timeWindow:'1 minute'}` per IP — cheap read
// that supports the /setup RSC fetch and follow-up retries / dev hot
// reloads without lockout (T-12.02-05). Plan 12-03 fetches this once
// per /setup render plus optional retries after a failed claim; 30/min
// has comfortable headroom.

import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface SetupStateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export type SetupStatus = "pending" | "completed" | "skipped_legacy";

export interface SetupStateResponse {
  readonly status: SetupStatus;
}

interface SetupStateRow {
  status: SetupStatus | null;
}

async function readSetupStatus(db: TransactionalDb<ExecutableTx>): Promise<SetupStatus> {
  // Defensive default: a missing row (stack-boot race, manual DELETE
  // for legacy migration paths) is treated as `pending`. Mirrors the
  // same posture Plan 12-03's claim handler will adopt (T-12.03-06).
  let status: SetupStatus = "pending";
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

export const buildSetupStateRoutes = (deps: SetupStateDeps) =>
  async function setupStateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/setup-state",
      // T-12.02-05 — per-IP rate-limit. The Fastify global rate-limit
      // plugin's keyGenerator auto-degrades to the client IP for any
      // request that lacks a stamped session identity; this endpoint
      // is public so every request buckets on IP (correct anti-abuse
      // semantics for anonymous-only routes).
      //
      // Phase 35 / CR-2 (CRIT-FIX-04) — opt out of the global dualAuthHook
      // so the wizard's pre-admin /setup RSC fetch succeeds. Without
      // `auth: false`, the global hook short-circuits with 401 BEFORE
      // the handler runs and the wizard never renders the claim form.
      config: { auth: false, rateLimit: { max: 30, timeWindow: "1 minute" } },
      handler: async (_req: FastifyRequest, reply: FastifyReply) => {
        const status = await readSetupStatus(deps.db);
        const body: SetupStateResponse = { status };
        return reply.header("cache-control", "no-store").code(200).send(body);
      },
    });
  };

export default buildSetupStateRoutes;
