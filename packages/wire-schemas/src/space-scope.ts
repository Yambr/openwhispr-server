// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Space-scope wire fields shared by the notes and folders input schemas.
 *
 * The desktop attaches `{ workspace_id, space_id }` to every note and folder
 * it pushes as soon as its team-space capability flag is on — and that flag is
 * set by GET /api/me/spaces answering anything but 404
 * (SyncService.syncSpaces). A personal row sends an explicit `null` for both
 * (SyncService.pushScopeFields), which the `.strict()` input schemas rejected
 * outright: folder and note sync answered 400 on every push.
 *
 * A real space id is accepted now that spaces exist. The SHAPE is all this
 * schema decides: whether the caller may actually write into the space it names
 * is an ACCESS question, answered by assertSpaceWritable() in the route with a
 * 403 — not a 400. Silently dropping an unauthorized scope is the one outcome
 * that must never happen: the desktop marks the row synced and the author
 * believes their note is shared while nobody else can see it.
 */
import { z } from "zod";

export const SPACE_SCOPE_INPUT_FIELDS = {
  /** The single workspace (the tenant). Echoed by the client; not authoritative. */
  workspace_id: z.string().uuid().nullable().optional(),
  /** Null (or absent) means personal — which is what every legacy row is. */
  space_id: z.string().uuid().nullable().optional(),
} as const;
