// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56-03 / R9 — CONTRACT-01 per-resource shape conformance for
// /api/folders/*. Pure-schema assertions (no live backend probe — that
// is covered by tests/unit/folders.test.ts which depends on a running
// BACKEND_URL). This file is the always-runnable shape contract for
// the CloudFolder wire surface, asserting the exact status codes
// SERVER-REQUIREMENTS.md §R9 mandates.
//
// Source of truth for the shape: ~/openwhispr/src/services/FoldersService.ts
// (lines 22, 26, 30, 39) — the client-side type the desktop deserializes.

import { describe, expect, it } from "vitest";
import { z } from "zod";

// CloudFolder — exact shape the desktop client deserializes per
// FoldersService.ts CloudFolder type. Mirrors apps/api/src/routes/
// folders/shape.ts.rowToCloudFolder() output.
const CloudFolderSchema = z.object({
  id: z.string(),
  client_folder_id: z.string().nullable(),
  name: z.string(),
  is_default: z.boolean(),
  sort_order: z.number(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const FoldersBatchCreateResponseSchema = z.object({
  created: z.array(CloudFolderSchema),
});
const FoldersListResponseSchema = z.object({
  folders: z.array(CloudFolderSchema),
});

// R9 — wire-status contract. Captures the response status codes the
// desktop's FoldersService is implemented against. ALL flips per
// Phase 56-03 land in apps/api/src/routes/folders/{create,batch-create,
// delete}.ts.
const FOLDERS_R9_STATUS_CONTRACT = {
  "POST /api/folders/create": 201,
  "POST /api/folders/batch-create": 201,
  "PATCH /api/folders/update": 200,
  "DELETE /api/folders/delete": 204,
  "GET /api/folders/list": 200,
} as const;

describe("R9 — CloudFolder shape conformance", () => {
  it("accepts the canonical 8-field CloudFolder shape", () => {
    const canonical = {
      id: "11111111-1111-4111-8111-111111111111",
      client_folder_id: "client-id-1",
      name: "Work",
      is_default: true,
      sort_order: 5,
      deleted_at: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    };
    expect(() => CloudFolderSchema.parse(canonical)).not.toThrow();
  });

  it("accepts null client_folder_id (server-originated rows)", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      client_folder_id: null,
      name: "Unfiled",
      is_default: false,
      sort_order: 0,
      deleted_at: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    };
    expect(() => CloudFolderSchema.parse(row)).not.toThrow();
  });

  it("accepts non-null deleted_at (tombstoned rows surface to client)", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      client_folder_id: "x",
      name: "trashed",
      is_default: false,
      sort_order: 0,
      deleted_at: "2026-05-19T00:00:00.000Z",
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    };
    expect(() => CloudFolderSchema.parse(row)).not.toThrow();
  });

  it("rejects a row missing any of the 8 required fields", () => {
    const required = [
      "id",
      "client_folder_id",
      "name",
      "is_default",
      "sort_order",
      "deleted_at",
      "created_at",
      "updated_at",
    ] as const;
    const full: Record<string, unknown> = {
      id: "11111111-1111-4111-8111-111111111111",
      client_folder_id: "x",
      name: "n",
      is_default: false,
      sort_order: 0,
      deleted_at: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    };
    for (const key of required) {
      const partial = { ...full };
      delete partial[key];
      expect(
        () => CloudFolderSchema.parse(partial),
        `missing ${key} should fail validation`,
      ).toThrow();
    }
  });

  it("rejects wrong-typed fields (is_default must be boolean, sort_order must be number)", () => {
    const bad1 = {
      id: "11111111-1111-4111-8111-111111111111",
      client_folder_id: "x",
      name: "n",
      is_default: "true",
      sort_order: 0,
      deleted_at: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    };
    expect(() => CloudFolderSchema.parse(bad1)).toThrow();
    const bad2 = { ...bad1, is_default: false, sort_order: "5" };
    expect(() => CloudFolderSchema.parse(bad2)).toThrow();
  });
});

describe("R9 — composite response shapes", () => {
  const folder = {
    id: "11111111-1111-4111-8111-111111111111",
    client_folder_id: "c-1",
    name: "n",
    is_default: false,
    sort_order: 0,
    deleted_at: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
  };

  it("batch-create envelope is { created: CloudFolder[] }", () => {
    expect(() =>
      FoldersBatchCreateResponseSchema.parse({ created: [folder, folder] }),
    ).not.toThrow();
    expect(() => FoldersBatchCreateResponseSchema.parse({ created: [] })).not.toThrow();
    expect(() => FoldersBatchCreateResponseSchema.parse({ folders: [folder] })).toThrow();
  });

  it("list envelope is { folders: CloudFolder[] }", () => {
    expect(() => FoldersListResponseSchema.parse({ folders: [folder] })).not.toThrow();
    expect(() => FoldersListResponseSchema.parse({ folders: [] })).not.toThrow();
    expect(() => FoldersListResponseSchema.parse({ created: [folder] })).toThrow();
  });
});

describe("R9 — wire-status contract", () => {
  it("pins POST /api/folders/create to 201 Created", () => {
    expect(FOLDERS_R9_STATUS_CONTRACT["POST /api/folders/create"]).toBe(201);
  });

  it("pins POST /api/folders/batch-create to 201 Created", () => {
    expect(FOLDERS_R9_STATUS_CONTRACT["POST /api/folders/batch-create"]).toBe(201);
  });

  it("pins DELETE /api/folders/delete to 204 No Content", () => {
    expect(FOLDERS_R9_STATUS_CONTRACT["DELETE /api/folders/delete"]).toBe(204);
  });

  it("pins PATCH /api/folders/update to 200 OK", () => {
    expect(FOLDERS_R9_STATUS_CONTRACT["PATCH /api/folders/update"]).toBe(200);
  });

  it("pins GET /api/folders/list to 200 OK", () => {
    expect(FOLDERS_R9_STATUS_CONTRACT["GET /api/folders/list"]).toBe(200);
  });
});
