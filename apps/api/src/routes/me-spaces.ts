// SPDX-License-Identifier: FSL-1.1-ALv2
// GET /api/me/spaces — account-scope guard for the desktop client.
//
// Upstream OpenWhispr 1.9.x introduced team spaces: shared note folders inside
// an organization workspace, with team-based roles and server-enforced
// membership. This server does not implement that feature.
//
// The route exists anyway, because the desktop does not treat this endpoint as
// a listing — it treats it as a DATA-ISOLATION GUARD. On every sign-in and
// account switch, SyncService.verifyTeamSpacesForAccount asks which spaces the
// account may access and then DESTRUCTIVELY deletes every locally cached team
// space that is missing from the answer, so one account's content can never
// survive into another's session. That check is deliberately fail-closed: a
// server that does not answer is indistinguishable from a compromised one, so
// the client refuses to validate the session rather than guess.
//
// Consequence for a self-hosted backend without the route: 404 → the client
// throws inside account reconciliation → the session never validates → the app
// hangs on its loading screen, retrying every 30 seconds. That is exactly what
// happened here on 2026-08-30 after the 1.9.3 desktop rollout.
//
// So the honest answer is an EMPTY list, not a stub: an account on this
// deployment genuinely belongs to no team space, because none can exist. The
// client finds nothing to purge (there is no local team content either) and
// proceeds. Personal notes are never in scope — the purge only considers rows
// whose kind is "team".
//
// If team spaces are ever implemented here, this route grows a real query; the
// response SHAPE is already the one the client expects.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "../errors.js";

/**
 * A space as the desktop expects it (`DataWrap<MySpace[]>`). Kept here as the
 * documented contract even though the list is always empty today.
 */
export interface MySpace {
  id: string;
  workspace_id: string;
  name: string;
}

export interface MeSpacesResponse {
  data: MySpace[];
}

export const buildMeSpacesRoutes = () =>
  async function meSpacesRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/me/spaces",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        // Defensive 401, matching capabilities.ts: the global dualAuthHook
        // should already have rejected anonymous traffic, but an account-scope
        // guard must never answer a caller it cannot attribute.
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        // Not cacheable: the client uses the answer to decide what to delete
        // locally, so a stale 200 could authorize keeping content the account
        // has since lost access to.
        reply.header("Cache-Control", "no-store");
        const body: MeSpacesResponse = { data: [] };
        return reply.send(body);
      },
    });
  };

export default buildMeSpacesRoutes;
