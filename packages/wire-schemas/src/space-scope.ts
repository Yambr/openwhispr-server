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
 * `z.null()` rather than `z.string().uuid().nullable()` is deliberate while
 * team spaces are unimplemented. A row claiming a space this deployment does
 * not have is a real disagreement between client and server, and accepting it
 * would silently file that row into the caller's personal tree — a mis-scoping
 * the desktop's own purge logic can never detect or undo. Widening this to
 * accept a real space id is the wire change that lands WITH the spaces
 * implementation, not before it.
 */
import { z } from "zod";

export const SPACE_SCOPE_INPUT_FIELDS = {
  workspace_id: z.null().optional(),
  space_id: z.null().optional(),
} as const;
