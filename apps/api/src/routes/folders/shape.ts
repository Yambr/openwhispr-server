// SPDX-License-Identifier: FSL-1.1-ALv2
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
  // Rows read through a raw `tx.execute` arrive as node-postgres TEXT
  // ("2026-01-01 00:00:00+00"), not Date objects, so the list paths emitted a
  // non-ISO timestamp while create/update emitted ISO for the very same row.
  // The desktop hands this value straight back as its `?before=` / `?since=`
  // cursor, and URL decoding turns the `+00` offset into a space — the next
  // page 400s on an unparseable timestamp. The wire schema declares ISO 8601,
  // so normalize here and the shape is identical whichever route produced it.
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
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
  workspace_id: string | null;
  space_id: string | null;
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
    // Space scope — see notes/shape.ts. Explicit nulls, not absent keys.
    workspace_id: null,
    space_id: null,
    deleted_at: isoOrNull(row.deleted_at),
    created_at: isoNonNull(row.created_at),
    updated_at: isoNonNull(row.updated_at),
  };
}
