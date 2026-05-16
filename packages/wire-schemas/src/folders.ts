// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/folders/* family.
 * Mirrors ~/openwhispr/src/services/FoldersService.ts byte-for-byte (D-22).
 *
 * Phase 39 — HIGH sweep: `.strict()` on input, UUID + ISO-8601 on output,
 * non-neg integer sort_order, bounded name length.
 */
import { z } from "zod";

const ISO_DATETIME = z.string().datetime({ offset: true });
const NAME_MAX = 256;

export const FolderInputSchema = z
  .object({
    name: z.string().min(1).max(NAME_MAX),
    client_folder_id: z.string().min(1).max(128).optional(),
    is_default: z.boolean().optional(),
    sort_order: z.number().int().nonnegative().optional(),
  })
  .strict();
export type FolderInput = z.infer<typeof FolderInputSchema>;

export const CloudFolderSchema = z.object({
  id: z.string().uuid(),
  client_folder_id: z.string().min(1).max(128).nullable(),
  name: z.string().min(1).max(NAME_MAX),
  is_default: z.boolean(),
  sort_order: z.number().int().nonnegative(),
  deleted_at: ISO_DATETIME.nullable(),
  created_at: ISO_DATETIME,
  updated_at: ISO_DATETIME,
});
export type CloudFolder = z.infer<typeof CloudFolderSchema>;
