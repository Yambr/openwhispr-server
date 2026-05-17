// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 13 — Selftest CLI entry for the seed fixture.
//
// Lives in its own file (not seed.ts) because Playwright's CommonJS
// transformer crashes with "exports is not defined in ES module scope"
// when seed.ts contains a top-level `import.meta` reference (see Plan 13
// deviation report). seed.ts is imported by every notes/conversations
// spec file; this entry is invoked only as a CLI:
//
//   pnpm --filter @openwhispr/web exec tsx \
//     tests/e2e/fixtures/seed-selftest.ts
//
// Exits 0 on success, 1 on any seed/clear failure.
import { request as playwrightRequest } from "@playwright/test";
import { fixtureEmail, provisionTestUser } from "./auth.js";
import {
  buildSignedInRequestContext,
  clearAllData,
  seedConversations,
  seedFolders,
  seedNotes,
  seedTranscriptions,
} from "./seed.js";

const BASE_URL = process.env.BASE_URL ?? "https://api.localhost";

async function selftest(): Promise<void> {
  const provisionCtx = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
  });
  await provisionTestUser(provisionCtx, 0);
  await provisionCtx.dispose();
  const email = fixtureEmail(0);
  const ctx = await buildSignedInRequestContext(email);
  try {
    await clearAllData(ctx);
    const folders = await seedFolders(ctx, { count: 1 });
    const folder = folders[0];
    if (!folder) {
      throw new Error("seed-selftest: seedFolders returned no rows");
    }
    const _notes = await seedNotes(ctx, { count: 1, folderId: folder.id });
    const _ts = await seedTranscriptions(ctx, { count: 1 });
    const _convs = await seedConversations(ctx, { count: 1, withMessages: 2 });
    await clearAllData(ctx);
  } finally {
    await ctx.dispose();
  }
}

selftest()
  .then(() => process.exit(0))
  .catch((_err) => {
    process.exit(1);
  });
