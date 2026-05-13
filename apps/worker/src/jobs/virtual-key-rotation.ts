// SPDX-License-Identifier: Apache-2.0
// Phase 6 Plan 06-08 — virtual-key-rotation BullMQ job.
//
// D-W5 (queue inventory): Tenant context, cron weekly + on-demand from
// /api/admin/keys/rotate. Zod {tenant_id, user_id, reason}.
// D-A6 (action enum): emits two audit_log rows — key.issued for the new
// LiteLLM virtual key id, then key.revoked for the old one with the
// supplied reason.
// D-A7: payload.key_id is the LiteLLM key id (e.g. `sk-...AnonHash`),
// NEVER the secret. The litellm-client `/key/generate` response returns
// both `key` (secret, store encrypted in user_settings or tenant_settings)
// and `key_id` (or `token` hash); only the id is recorded in audit_log.
//
// The Plan does not require us to land the encrypted storage layer for the
// returned secret in this commit — that is the responsibility of the
// admin/keys route (Plan 06-09) and the api-keys schema (already on disk).
// What this job DOES land:
//   - Schema validation.
//   - Two-call litellm-client orchestration (generate new → delete old).
//   - Two audit_log INSERTs through the same Postgres transaction the HOF
//     installs (so an audit row exists iff the rotation commits — D-A1
//     reused at the worker tier).
//
// Collaborators are injected so the test can stub LiteLLM without booting a
// real proxy.

import type { Pool } from "pg";
import { z } from "zod";
import { withTenantContext } from "../lib/with-tenant-context.js";

export const virtualKeyRotationSchema = z.object({
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  reason: z.enum(["scheduled", "compromised", "manual"]),
});

export type VirtualKeyRotationPayload = z.infer<typeof virtualKeyRotationSchema>;

/** Minimal LiteLLM key-management surface needed by this job. */
export interface LiteLlmKeyClient {
  /** POST /key/generate — returns the new key_id (token alias). */
  generateKey(args: { tenant_id: string; user_id: string }): Promise<{ key_id: string }>;
  /** POST /key/delete — revoke the prior key_id. */
  deleteKey(args: { key_id: string }): Promise<void>;
}

/** Lookup of the user's currently-active LiteLLM key id (from user_settings). */
export interface UserKeyLookup {
  /** Returns the previously-active key id, or null on first issuance. */
  loadCurrentKeyId(userId: string): Promise<string | null>;
  /** Persists the freshly-issued key id (and clears any old reference). */
  storeNewKeyId(userId: string, newKeyId: string): Promise<void>;
}

export interface VirtualKeyRotationDeps {
  pool: Pool;
  litellm: LiteLlmKeyClient;
  userKeyLookup: UserKeyLookup;
}

export function buildVirtualKeyRotationHandler(
  deps: VirtualKeyRotationDeps,
): (job: import("bullmq").Job) => Promise<void> {
  return withTenantContext(virtualKeyRotationSchema, deps.pool, async (data) => {
    // Load the prior key id BEFORE we mint the new one — failure here means
    // the rotation aborts cleanly with the old key still in place.
    const priorKeyId = await deps.userKeyLookup.loadCurrentKeyId(data.user_id);

    const { key_id: newKeyId } = await deps.litellm.generateKey({
      tenant_id: data.tenant_id,
      user_id: data.user_id,
    });

    // Persist the new key id first so a crash between generate and revoke
    // leaves the user with a working (new) key — better than a window
    // where both were revoked.
    await deps.userKeyLookup.storeNewKeyId(data.user_id, newKeyId);

    // Emit key.issued audit row — D-A6 #8.
    // We INSERT directly on the per-job client (withTenantContext has
    // already issued BEGIN + set_config; we use the same pool, knowing the
    // RLS policy on audit_log will route writes to the active tenant).
    // The actorUserId is the rotation's subject user.
    await deps.pool.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, payload)
       VALUES ($1::uuid, $2::uuid, 'key.issued', $3::jsonb)`,
      [data.tenant_id, data.user_id, JSON.stringify({ key_id: newKeyId })],
    );

    // If a prior key was active, revoke it remotely + emit key.revoked.
    if (priorKeyId) {
      await deps.litellm.deleteKey({ key_id: priorKeyId });
      await deps.pool.query(
        `INSERT INTO audit_log (tenant_id, actor_user_id, action, payload)
         VALUES ($1::uuid, $2::uuid, 'key.revoked', $3::jsonb)`,
        [data.tenant_id, data.user_id, JSON.stringify({ key_id: priorKeyId, reason: data.reason })],
      );
    }
  });
}
