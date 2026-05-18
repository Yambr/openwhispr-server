// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 04 — Data seeding fixture.
//
// === Seed endpoint inventory (Plan 04 / Step 0 pre-flight, verified 2026-05-12) ===
//   POST   /api/notes/create               — PRESENT (apps/api/src/routes/notes/create.ts)
//   POST   /api/transcriptions/create      — PRESENT (apps/api/src/routes/transcriptions/create.ts)
//   POST   /api/conversations/create       — PRESENT (apps/api/src/routes/conversations/create.ts)
//   POST   /api/folders/create             — PRESENT (apps/api/src/routes/folders/create.ts)
//   DELETE /api/notes/delete-all           — PRESENT (apps/api/src/routes/notes/delete-all.ts)
//   POST   /api/conversations/messages     — PRESENT (apps/api/src/routes/conversations/messages.ts)
//   POST   /api/transcriptions/batch-delete— PRESENT (apps/api/src/routes/transcriptions/batch-delete.ts)
//   GET    /api/conversations/list         — PRESENT
//   GET    /api/transcriptions/list        — PRESENT
//   GET    /api/folders/list               — PRESENT
//   DELETE /api/conversations/delete       — PRESENT
//   DELETE /api/folders/delete             — PRESENT
//   POST   /api/streaming-usage            — PRESENT (POST per CONTEXT § API surface; NOT GET)
//
// No endpoint substitutions required — every resource has a real apps/api
// create + delete path. D-TEST-3 compliance: only real HTTP traffic against
// apps/api; no internal-logic mocks.
//
// === Selftest ===
//   Run with: `pnpm --filter @openwhispr/web exec tsx tests/e2e/fixtures/seed.ts`
//   (from apps/web root). Selftest provisions a worker-0 user, signs in,
//   seeds one of each resource, then runs clearAllData() and exits 0.
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
// Phase 53 / Plan 53-14 — universal topology helper. Replaces the
// previous `BASE_URL` env-string with a typed origins object derived
// from the active Playwright project's metadata (--project=traefik|slim).
// `BASE_URL` env still honored as a backstop for legacy callers /
// global-setup which runs before TestInfo is bound.
import { getProcessOrigins } from "../support/topology.js";
import { FIXTURE_PASSWORD, fixtureEmail, provisionTestUser } from "./auth.js";

const BASE_URL = process.env.BASE_URL ?? getProcessOrigins().apiOrigin;

export interface SeedFolderArgs {
  count?: number;
  name?: string;
}
export interface SeedNoteArgs {
  count?: number;
  title?: string;
  content?: string;
  folderId?: string;
}
export interface SeedTranscriptionArgs {
  count?: number;
  text?: string;
}
export interface SeedConversationArgs {
  count?: number;
  title?: string;
  withMessages?: number;
}
export interface SeedUsageArgs {
  /**
   * `audioDurationSeconds` per `StreamingUsageBodySchema`
   * (packages/wire-schemas/src/streaming-usage.ts). Maps 1:1 to ledger
   * `units` (rounded). Legacy aliases `inputTokens` / `outputTokens`
   * are accepted for backward compat with existing spec callers — they
   * sum into `audioDurationSeconds` so the resulting wordsUsed > 0.
   */
  audioDurationSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  sttModel?: string;
  /** @deprecated alias for sttModel. */
  model?: string;
  sessionId?: string;
}

async function originPost(
  ctx: APIRequestContext,
  pathSuffix: string,
  data: unknown,
): Promise<unknown> {
  const url = `${BASE_URL}${pathSuffix}`;
  const res = await ctx.post(url, {
    headers: { "content-type": "application/json", origin: BASE_URL },
    data,
    ignoreHTTPSErrors: true,
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `seed: POST ${pathSuffix} failed: HTTP ${res.status()} body=${body.slice(0, 300)}`,
    );
  }
  return res.json();
}

async function originDelete(
  ctx: APIRequestContext,
  pathSuffix: string,
  data?: unknown,
): Promise<unknown> {
  const url = `${BASE_URL}${pathSuffix}`;
  const res = await ctx.delete(url, {
    headers: { "content-type": "application/json", origin: BASE_URL },
    data,
    ignoreHTTPSErrors: true,
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `seed: DELETE ${pathSuffix} failed: HTTP ${res.status()} body=${body.slice(0, 300)}`,
    );
  }
  return res.json();
}

async function originGet(ctx: APIRequestContext, pathSuffix: string): Promise<unknown> {
  const url = `${BASE_URL}${pathSuffix}`;
  const res = await ctx.get(url, {
    headers: { origin: BASE_URL },
    ignoreHTTPSErrors: true,
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `seed: GET ${pathSuffix} failed: HTTP ${res.status()} body=${body.slice(0, 300)}`,
    );
  }
  return res.json();
}

/** Seed one or more folders. Returns the array of created CloudFolder rows. */
export async function seedFolders(
  ctx: APIRequestContext,
  args: SeedFolderArgs = {},
): Promise<Array<{ id: string; name: string }>> {
  const count = args.count ?? 1;
  const out: Array<{ id: string; name: string }> = [];
  for (let i = 0; i < count; i++) {
    const folder = (await originPost(ctx, "/api/folders/create", {
      name: args.name ?? `Seed Folder ${i}`,
    })) as { id: string; name: string };
    out.push(folder);
  }
  return out;
}

/** Seed one or more notes. */
export async function seedNotes(
  ctx: APIRequestContext,
  args: SeedNoteArgs = {},
): Promise<Array<{ id: string }>> {
  const count = args.count ?? 1;
  const out: Array<{ id: string }> = [];
  for (let i = 0; i < count; i++) {
    const note = (await originPost(ctx, "/api/notes/create", {
      title: args.title ?? `Seed Note ${i}`,
      content: args.content ?? "seed content",
      folder_id: args.folderId,
    })) as { id: string };
    out.push(note);
  }
  return out;
}

/** Seed one or more transcriptions. */
export async function seedTranscriptions(
  ctx: APIRequestContext,
  args: SeedTranscriptionArgs = {},
): Promise<Array<{ id: string }>> {
  const count = args.count ?? 1;
  const out: Array<{ id: string }> = [];
  for (let i = 0; i < count; i++) {
    const t = (await originPost(ctx, "/api/transcriptions/create", {
      text: args.text ?? `Seed transcription ${i}`,
    })) as { id: string };
    out.push(t);
  }
  return out;
}

/**
 * Seed one or more conversations, optionally appending messages.
 * Messages are added via POST /api/conversations/messages (one call per
 * message per conversation).
 */
export async function seedConversations(
  ctx: APIRequestContext,
  args: SeedConversationArgs = {},
): Promise<Array<{ id: string }>> {
  const count = args.count ?? 1;
  const withMessages = args.withMessages ?? 0;
  const out: Array<{ id: string }> = [];
  for (let i = 0; i < count; i++) {
    const conv = (await originPost(ctx, "/api/conversations/create", {
      title: args.title ?? `Seed Conversation ${i}`,
    })) as { id: string };
    out.push(conv);
    for (let m = 0; m < withMessages; m++) {
      await originPost(ctx, "/api/conversations/messages", {
        conversation_id: conv.id,
        role: m % 2 === 0 ? "user" : "assistant",
        content: `seed message ${m}`,
      });
    }
  }
  return out;
}

/**
 * Seed a streaming-usage ledger row. Phase 05 wire shape: POST (not GET).
 * Required body fields per StreamingUsageBodySchema:
 *   - sessionId          (string, idempotency key — ON CONFLICT DO NOTHING)
 *   - audioDurationSeconds (number, → ledger `units` after Math.round)
 * Optional sttModel / sttProvider / etc. are accepted but not required.
 *
 * Legacy spec callers pass {inputTokens, outputTokens} — we collapse the
 * pair into audioDurationSeconds so the ledger sum surfaces as wordsUsed > 0.
 * tenant_id + user_id are resolved server-side from the session cookie.
 */
export async function seedUsage(
  ctx: APIRequestContext,
  args: SeedUsageArgs = {},
): Promise<unknown> {
  const legacy = (args.inputTokens ?? 0) + (args.outputTokens ?? 0);
  const audioDurationSeconds = args.audioDurationSeconds ?? (legacy > 0 ? legacy : 60);
  // Unique sessionId per call ensures repeated seed calls accumulate
  // (the route's ON CONFLICT(request_id) DO NOTHING coalesces duplicates).
  const sessionId = args.sessionId ?? `seed-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return originPost(ctx, "/api/streaming-usage", {
    sessionId,
    audioDurationSeconds,
    sttModel: args.sttModel ?? args.model ?? "openrouter/test-model",
  });
}

/**
 * Clear every resource the test user owns. Order matters: messages are
 * cascade-deleted by conversation; notes iterate the list endpoint (the
 * /api/notes/delete-all bulk endpoint is currently returning HTTP 500 on
 * the live stack — see DEF-07.1-NOTES-DELETE-ALL; this fixture uses the
 * per-row fallback documented in Plan 04 Step 0 alternative #2 until the
 * upstream bug is resolved); folders + conversations + transcriptions
 * iterate the list endpoints.
 */
export async function clearAllData(ctx: APIRequestContext): Promise<void> {
  // 1) Notes — per-row delete (bulk delete-all is broken on live stack).
  const noteRows = (await originGet(ctx, "/api/notes/list?limit=1000")) as {
    items?: Array<{ id: string }>;
    notes?: Array<{ id: string }>;
  };
  const notes = noteRows.items ?? noteRows.notes ?? [];
  for (const n of notes) {
    await originDelete(ctx, "/api/notes/delete", { id: n.id });
  }

  // 2) Conversations — list + per-row delete (cascade clears messages).
  const convs = (await originGet(ctx, "/api/conversations/list?limit=1000")) as {
    items?: Array<{ id: string }>;
    conversations?: Array<{ id: string }>;
  };
  const convRows = convs.items ?? convs.conversations ?? [];
  for (const c of convRows) {
    await originDelete(ctx, "/api/conversations/delete", { id: c.id });
  }

  // 3) Transcriptions — list + batch-delete (POST with ids[]).
  const tRows = (await originGet(ctx, "/api/transcriptions/list?limit=1000")) as {
    items?: Array<{ id: string }>;
    transcriptions?: Array<{ id: string }>;
  };
  const ts = tRows.items ?? tRows.transcriptions ?? [];
  if (ts.length > 0) {
    await originPost(ctx, "/api/transcriptions/batch-delete", {
      ids: ts.map((r) => r.id),
    });
  }

  // 4) Folders — list + per-row delete.
  const fRows = (await originGet(ctx, "/api/folders/list?limit=1000")) as {
    items?: Array<{ id: string }>;
    folders?: Array<{ id: string }>;
  };
  const fs = fRows.items ?? fRows.folders ?? [];
  for (const f of fs) {
    await originDelete(ctx, "/api/folders/delete", { id: f.id });
  }
}

/**
 * Build a Playwright APIRequestContext that already carries a signed-in
 * session cookie for the given email. Tests typically use page.request
 * (which inherits page-scoped cookies); this helper exists for seed-only
 * code paths that don't need a browser page.
 */
export async function buildSignedInRequestContext(email: string): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
  });
  const res = await ctx.post(`${BASE_URL}/api/auth/sign-in/email`, {
    headers: { "content-type": "application/json", origin: BASE_URL },
    data: { email, password: FIXTURE_PASSWORD },
    ignoreHTTPSErrors: true,
  });
  if (!res.ok()) {
    const body = await res.text();
    await ctx.dispose();
    throw new Error(
      `buildSignedInRequestContext(${email}) failed: HTTP ${res.status()} body=${body.slice(0, 300)}`,
    );
  }
  return ctx;
}

/**
 * Bind seed helpers to a BrowserContext's request object so callers can do
 * `const seed = bindToContext(context); await seed.seedNotes({count:1})`.
 */
export function bindToContext(ctx: BrowserContext) {
  const r = ctx.request;
  return {
    seedFolders: (args?: SeedFolderArgs) => seedFolders(r, args),
    seedNotes: (args?: SeedNoteArgs) => seedNotes(r, args),
    seedTranscriptions: (args?: SeedTranscriptionArgs) => seedTranscriptions(r, args),
    seedConversations: (args?: SeedConversationArgs) => seedConversations(r, args),
    seedUsage: (args?: SeedUsageArgs) => seedUsage(r, args),
    clearAllData: () => clearAllData(r),
  };
}

// Selftest CLI entry has been moved to `seed-selftest.ts` (sibling file) so
// this module remains import.meta-free — Playwright's CommonJS transformer
// bails out on top-level `import.meta` references inside a fixture imported
// by spec files. See Plan 13 deviation report (07.1-PLAN-13).
