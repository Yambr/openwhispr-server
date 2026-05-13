// Phase 05 / Plan 04 / Task 2 — GET /api/note-recording-config (WIRE-12).
//
// Wire shape: BACKEND_SPEC.md:460.
//   200 OK -> {
//     maxDurationSeconds: number,
//     sampleRateHz: number,
//     allowedFormats: string[],
//     diarizationEnabled: boolean,
//   }
//   401    -> { error: string } (centralized envelope)
//
// Behavior matches /api/stt-config (WIRE-11) — see that file for the
// full design rationale. The only difference is the helper invoked:
// `resolveNoteRecordingConfig` reads `note_recording_config` (tenant)
// + `note_recording_overrides` (user) JSONB columns and falls through
// to NOTE_RECORDING_* env defaults.

import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../errors.js";
import { resolveNoteRecordingConfig } from "../lib/settings-resolver.js";

export interface NoteRecordingConfigDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildNoteRecordingConfigRoutes = (deps: NoteRecordingConfigDeps) =>
  async function noteRecordingConfigRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/note-recording-config",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const userId = req.user.id;
        const body = await withTenant(deps.db, tenantId, (tx) =>
          resolveNoteRecordingConfig(tx, tenantId, userId),
        );
        return reply.code(200).send(body);
      },
    });
  };

export default buildNoteRecordingConfigRoutes;
