// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/folders/* family.
 * Mirrors ~/openwhispr/src/services/FoldersService.ts byte-for-byte (D-22).
 */
import { z } from "zod";

export const FolderInputSchema = z.object({
  name: z.string(),
  client_folder_id: z.string().optional(),
  is_default: z.boolean().optional(),
  sort_order: z.number().optional(),
});
export type FolderInput = z.infer<typeof FolderInputSchema>;

export const CloudFolderSchema = z.object({
  id: z.string(),
  client_folder_id: z.string().nullable(),
  name: z.string(),
  is_default: z.boolean(),
  sort_order: z.number(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CloudFolder = z.infer<typeof CloudFolderSchema>;
