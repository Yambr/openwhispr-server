// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 68 / Plan 68-01 — REVIEW web HIGH HI-03.
//
// `notes/page.tsx` RSC-prefetches the notes list with the dehydrated key
// `queryKeys.notes.list(cursor)`. `NotesListClient` previously read it
// with `[...queryKeys.notes.list(cursor), { folder: folderFilter }]` — an
// extra tuple element — so the client key NEVER matched the dehydrated
// key and the SSR prefetch was discarded + refetched on first paint.
//
// HI-03: the client `useQuery` notes-list key must be exactly
// `queryKeys.notes.list(cursor)` (folder filtering is a pure client-side
// `.filter()`, not a fetch parameter — it has no business in the cache
// key). This test pins source parity between the two key sites.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, "../../../../../src");
const CLIENT_SRC = resolve(ROOT, "components/screens/notes/NotesListClient.tsx");
const PAGE_SRC = resolve(ROOT, "app/(auth)/app/notes/page.tsx");

describe("HI-03 — NotesListClient queryKey must match the RSC dehydrated key", () => {
  it("HI-03: NotesListClient notes-list queryKey has no { folder } tuple element", () => {
    const src = readFileSync(CLIENT_SRC, "utf8");
    const code = src.replace(/\/\/[^\n]*/g, "");
    // the notes-list useQuery key must NOT spread + append a folder object
    expect(/queryKeys\.notes\.list\(cursor\),\s*\{\s*folder/.test(code)).toBe(false);
    // it must be the bare canonical key
    expect(/queryKey:\s*queryKeys\.notes\.list\(cursor\)/.test(code)).toBe(true);
  });

  it("HI-03: notes/page.tsx prefetch uses the same canonical key", () => {
    const src = readFileSync(PAGE_SRC, "utf8");
    expect(/queryKey:\s*queryKeys\.notes\.list\(cursor\)/.test(src)).toBe(true);
  });
});
