// Phase 05 / Plan 06 — shared row→wire shape helper for folders routes.
//
// Mirrors apps/api/src/routes/notes/shape.ts. Every folders route MUST
// route through rowToCloudFolder() so wire-shape drift is impossible.
//
// Upstream CloudFolder per ~/openwhispr/src/services/FoldersService.ts:
//   id, client_folder_id, name, is_default, sort_order,
//   deleted_at, created_at, updated_at
//
// NOTE: parent_folder_id exists in the DB (FK self-reference, ON DELETE
// SET NULL per Plan 01) but is intentionally OMITTED from the wire
// shape — upstream CloudFolder does not expose it (D-22 byte-for-byte).

export interface CloudFolderRow {
  id: string;
  tenant_id?: string;
  user_id?: string;
  client_folder_id: string | null;
  name: string;
  parent_folder_id?: string | null;
  is_default: boolean;
  sort_order: number;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function isoOrNull(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function isoNonNull(v: Date | string | null | undefined): string {
  return isoOrNull(v) ?? "";
}

/**
 * Map a raw folders-row (pg/Drizzle return shape) to the canonical
 * CloudFolder wire shape (~/openwhispr/src/services/FoldersService.ts).
 */
export function rowToCloudFolder(row: CloudFolderRow): {
  id: string;
  client_folder_id: string | null;
  name: string;
  is_default: boolean;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: row.id,
    client_folder_id: row.client_folder_id ?? null,
    name: row.name,
    is_default: Boolean(row.is_default),
    sort_order: Number(row.sort_order ?? 0),
    deleted_at: isoOrNull(row.deleted_at),
    created_at: isoNonNull(row.created_at),
    updated_at: isoNonNull(row.updated_at),
  };
}
